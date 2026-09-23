import express from "express";
import cors from "cors";
import type { PoolClient } from "pg";
import { queryMany, queryOne, execute, withTransaction } from "./db";

export const app = express();
app.use(cors());
app.use(express.json());

// Nilam/Zamrud/Firus are consumer/destination estates, NOT separate physical warehouses.
// There is only one physical stock pool (the main warehouse, located at Nilam).
const TUJUAN_OPTIONS = ["NILAM", "ZAMRUD", "FIRUS"];

// BBM (fuel, Solar & Bensin) only has physical storage/gudang at 3 sites: Nilam, WJA, KNS.
// Zamrud/Firus/AKSS/UKM (under Nilam), LUBAKAN/TAGUL (under WJA) and MALAPIAK/TAGANG (under KNS)
// are distribution/consumption destinations, not separate warehouses - see `estate`.
const BBM_LOKASI_OPTIONS = ["NILAM", "WJA", "KNS"];

// Solar/Nilam is the one lokasi bucket that merges in whole separate sheets (Zamrud's and Firus's
// own independently-numbered running balances, retagged under lokasi=NILAM since they have no
// warehouse of their own) - any query computing "the" Nilam tank balance must exclude those rows,
// or it'll pick up whichever of the 3 unrelated ledgers has the newest date/id.
function foreignLedgerExclusion(alias: string): string {
  return `NOT (${alias}.jenis_bbm = 'SOLAR' AND ${alias}.lokasi = 'NILAM' AND ${alias}.estate IN ('ZAMRUD', 'FIRUS'))`;
}

function isoToDisplay(iso: string): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- Mirror a manual IN/OUT transaction into stock_in_log/stock_out_log so it shows up
// alongside imported history on the Stock In / Stock Out pages. Correction (stock opname)
// transactions are never mirrored - they stay only in `transactions`. ----
async function mirrorTransaction(
  client: PoolClient,
  item: any,
  type: "IN" | "OUT",
  tujuan: string,
  qty: number,
  note: string | null,
  penerima: string
): Promise<{ source: "stock_in_log" | "stock_out_log"; id: number }> {
  const iso = todayIso();
  const display = isoToDisplay(iso);

  if (type === "IN") {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO stock_in_log (item_id, kode, nama, nama_vendor, qty, satuan, tujuan, tanggal_terima, tanggal_terima_iso, keterangan)
       VALUES (@item_id, @kode, @nama, @nama_vendor, @qty, @satuan, @tujuan, @tanggal_terima, @tanggal_terima_iso, @keterangan)
       RETURNING id`,
      {
        item_id: item.id,
        kode: item.kode,
        nama: item.nama,
        nama_vendor: penerima ? `Diterima: ${penerima}` : "Input Manual",
        qty,
        satuan: item.satuan,
        tujuan: tujuan || null,
        tanggal_terima: display,
        tanggal_terima_iso: iso,
        keterangan: note || "",
      },
      client
    );
    return { source: "stock_in_log", id: Number(row!.id) };
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO stock_out_log (item_id, kode, nama, penerima, qty, satuan, tujuan, tanggal_keluar, tanggal_keluar_iso, keterangan)
     VALUES (@item_id, @kode, @nama, @penerima, @qty, @satuan, @tujuan, @tanggal_keluar, @tanggal_keluar_iso, @keterangan)
     RETURNING id`,
    {
      item_id: item.id,
      kode: item.kode,
      nama: item.nama,
      penerima: penerima || "",
      qty,
      satuan: item.satuan,
      tujuan: tujuan || null,
      tanggal_keluar: display,
      tanggal_keluar_iso: iso,
      keterangan: note || "",
    },
    client
  );
  return { source: "stock_out_log", id: Number(row!.id) };
}

async function deleteMirror(client: PoolClient, mirrorSource: string | null, mirrorId: number | null) {
  if (!mirrorSource || !mirrorId) return;
  if (mirrorSource === "stock_in_log") await execute(`DELETE FROM stock_in_log WHERE id = @id`, { id: mirrorId }, client);
  if (mirrorSource === "stock_out_log") await execute(`DELETE FROM stock_out_log WHERE id = @id`, { id: mirrorId }, client);
}

// ---- Summary for dashboard ----
app.get("/api/summary", async (_req, res) => {
  const totalItems = (await queryOne<any>("SELECT COUNT(*) c FROM items"))!.c;
  const lowStock = (
    await queryOne<any>("SELECT COUNT(*) c FROM items WHERE stock_tersedia <= buffer_stock AND buffer_stock > 0")
  )!.c;
  const outOfStock = (await queryOne<any>("SELECT COUNT(*) c FROM items WHERE stock_tersedia <= 0"))!.c;
  const statusBreakdown = await queryMany(
    "SELECT keterangan, COUNT(*) c FROM items GROUP BY keterangan ORDER BY c DESC"
  );

  const totalStock = (await queryOne<any>("SELECT SUM(stock_tersedia) s FROM items"))!.s || 0;
  const totalStockIn = (await queryOne<any>("SELECT SUM(stock_in) s FROM items"))!.s || 0;
  const totalStockOut = (await queryOne<any>("SELECT SUM(stock_out) s FROM items"))!.s || 0;

  // Consumption distribution per destination (Nilam/Zamrud/Firus) - this is a flow metric
  // (how much went out to each estate), not a separate stock balance. Manual OUT transactions
  // are mirrored into stock_out_log, so that table alone already covers imported + manual flows.
  const perTujuan = await queryMany(
    `SELECT tujuan, SUM(qty) qty FROM stock_out_log WHERE tujuan IS NOT NULL GROUP BY tujuan ORDER BY qty DESC`
  );

  res.json({ totalItems, lowStock, outOfStock, totalStock, totalStockIn, totalStockOut, statusBreakdown, perTujuan });
});

// ---- Distinct satuan values (for filter dropdown) ----
app.get("/api/satuan-options", async (_req, res) => {
  const rows = await queryMany<{ satuan: string }>(
    "SELECT DISTINCT satuan FROM items WHERE satuan IS NOT NULL AND satuan != '' ORDER BY satuan"
  );
  res.json(rows.map((r) => r.satuan));
});

// ---- Items list with search/filter/sort/pagination ----
app.get("/api/items", async (req, res) => {
  const { search = "", status = "", satuan = "", sortBy = "kode", sortDir = "asc", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;

  const validSort = ["kode", "nama", "stock_tersedia", "buffer_stock"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = [];
  const params: any = {};

  if (search) {
    conditions.push("(kode ILIKE @search OR nama ILIKE @search)");
    params.search = `%${search}%`;
  }
  if (status) {
    conditions.push("keterangan = @status");
    params.status = status;
  }
  if (satuan) {
    conditions.push("satuan = @satuan");
    params.satuan = satuan;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM items ${where}`, params))!.c;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const items = await queryMany(
    `SELECT * FROM items ${where} ORDER BY ${sortCol} ${dir} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data: items, total: Number(total), page: parseInt(page), pageSize: limit });
});

app.get("/api/items/:id", async (req, res) => {
  const item = await queryOne("SELECT * FROM items WHERE id = @id", { id: req.params.id });
  if (!item) return res.status(404).json({ error: "Not found" });
  const transactions = await queryMany(
    "SELECT * FROM transactions WHERE item_id = @id ORDER BY created_at DESC LIMIT 50",
    { id: req.params.id }
  );
  res.json({ ...item, transactions });
});

app.put("/api/items/:id", async (req, res) => {
  const { nama, satuan, buffer_stock } = req.body;
  const existing = await queryOne("SELECT * FROM items WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await execute("UPDATE items SET nama = @nama, satuan = @satuan, buffer_stock = @buffer_stock WHERE id = @id", {
    nama,
    satuan,
    buffer_stock: buffer_stock ?? 0,
    id: req.params.id,
  });
  res.json({ success: true });
});

// ---- Combined movement history for one item (stock in + stock out + manual transactions) ----
app.get("/api/items/:id/movements", async (req, res) => {
  const itemId = req.params.id;

  const stockIn = await queryMany<any>(
    `SELECT id, tanggal_terima_iso as date, tanggal_terima as "dateDisplay", qty, satuan, tujuan, keterangan as note, nama_vendor as ref, po_in_akss as "refCode"
     FROM stock_in_log WHERE item_id = @id`,
    { id: itemId }
  );

  const stockOut = await queryMany<any>(
    `SELECT id, tanggal_keluar_iso as date, tanggal_keluar as "dateDisplay", qty, satuan, tujuan, keterangan as note, penerima as ref, no_embrace_gudang as "refCode"
     FROM stock_out_log WHERE item_id = @id`,
    { id: itemId }
  );

  // Regular manual IN/OUT transactions are mirrored into stock_in_log/stock_out_log (above),
  // so only correction (stock opname) rows are pulled from `transactions` here to avoid duplicates.
  const manual = await queryMany<any>(
    `SELECT id, created_at as date, created_at as "dateDisplay", qty, tujuan, type, note, penerima
     FROM transactions WHERE item_id = @id AND is_correction = 1`,
    { id: itemId }
  );

  const rows = [
    ...stockIn.map((r) => ({
      id: r.id,
      date: r.date,
      dateDisplay: r.dateDisplay,
      type: "IN",
      source: "STOCK_IN",
      tujuan: r.tujuan,
      qty: r.qty,
      satuan: r.satuan,
      note: r.note,
      ref: r.ref === "-" ? "" : r.ref,
      refCode: r.refCode,
    })),
    ...stockOut.map((r) => ({
      id: r.id,
      date: r.date,
      dateDisplay: r.dateDisplay,
      type: "OUT",
      source: "STOCK_OUT",
      tujuan: r.tujuan,
      qty: r.qty,
      satuan: r.satuan,
      note: r.note,
      ref: r.ref,
      refCode: r.refCode,
    })),
    ...manual.map((r) => ({
      id: r.id,
      date: r.date,
      dateDisplay: r.dateDisplay,
      type: r.type,
      source: "MANUAL",
      tujuan: r.tujuan || null,
      qty: r.qty,
      satuan: null,
      note: r.note,
      ref: r.penerima && r.penerima.trim() ? r.penerima : "Input Manual",
      refCode: null,
    })),
  ];

  rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  res.json({ data: rows });
});

// ---- Stock transaction (IN/OUT) ----
// There is one shared stock pool per item. `tujuan` is informational metadata
// (which estate the goods are for) and never splits the balance.

async function applyStockEffect(
  client: PoolClient,
  item_id: number,
  type: "IN" | "OUT",
  qty: number,
  direction: 1 | -1
) {
  const signedQty = qty * direction;
  const delta = type === "IN" ? signedQty : -signedQty;

  const item = (await queryOne<any>("SELECT * FROM items WHERE id = @id", { id: item_id }, client))!;
  const stockTersedia = item.stock_tersedia + delta;
  const stockIn = item.stock_in + (type === "IN" ? signedQty : 0);
  const stockOut = item.stock_out + (type === "OUT" ? signedQty : 0);
  const keterangan = stockTersedia > 0 ? "AMAN" : "BUFFER STOCK";

  await execute(
    "UPDATE items SET stock_tersedia = @stock_tersedia, stock_in = @stock_in, stock_out = @stock_out, keterangan = @keterangan WHERE id = @id",
    { stock_tersedia: stockTersedia, stock_in: stockIn, stock_out: stockOut, keterangan, id: item_id },
    client
  );
}

app.post("/api/transactions", async (req, res) => {
  const { item_id, tujuan, type, qty, note, penerima } = req.body;

  if (!item_id || !["IN", "OUT"].includes(type) || !qty || qty <= 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const item = await queryOne<any>("SELECT * FROM items WHERE id = @id", { id: item_id });
  if (!item) return res.status(404).json({ error: "Not found" });

  await withTransaction(async (client) => {
    const result = await queryOne<{ id: number }>(
      `INSERT INTO transactions (item_id, tujuan, type, qty, note, penerima) VALUES (@item_id, @tujuan, @type, @qty, @note, @penerima) RETURNING id`,
      { item_id, tujuan: tujuan || "", type, qty, note: note || null, penerima: penerima || "" },
      client
    );

    const mirror = await mirrorTransaction(client, item, type, tujuan || "", qty, note, penerima || "");
    await execute(
      `UPDATE transactions SET mirror_source = @source, mirror_id = @mirror_id WHERE id = @id`,
      { source: mirror.source, mirror_id: mirror.id, id: result!.id },
      client
    );

    await applyStockEffect(client, item_id, type, qty, 1);
  });

  res.json({ success: true });
});

app.put("/api/transactions/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM transactions WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { tujuan, type, qty, note, penerima } = req.body;
  if (!["IN", "OUT"].includes(type) || !qty || qty <= 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const item = await queryOne<any>("SELECT * FROM items WHERE id = @id", { id: existing.item_id });

  await withTransaction(async (client) => {
    await applyStockEffect(client, existing.item_id, existing.type, existing.qty, -1);
    await applyStockEffect(client, existing.item_id, type, qty, 1);
    await execute(
      "UPDATE transactions SET tujuan = @tujuan, type = @type, qty = @qty, note = @note, penerima = @penerima WHERE id = @id",
      { tujuan: tujuan || "", type, qty, note: note || null, penerima: penerima || "", id: req.params.id },
      client
    );

    if (!existing.is_correction) {
      await deleteMirror(client, existing.mirror_source, existing.mirror_id);
      const mirror = await mirrorTransaction(client, item, type, tujuan || "", qty, note, penerima || "");
      await execute(
        `UPDATE transactions SET mirror_source = @source, mirror_id = @mirror_id WHERE id = @id`,
        { source: mirror.source, mirror_id: mirror.id, id: req.params.id },
        client
      );
    }
  });

  res.json({ success: true });
});

app.delete("/api/transactions/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM transactions WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await withTransaction(async (client) => {
    await applyStockEffect(client, existing.item_id, existing.type, existing.qty, -1);
    if (!existing.is_correction) await deleteMirror(client, existing.mirror_source, existing.mirror_id);
    await execute("DELETE FROM transactions WHERE id = @id", { id: req.params.id }, client);
  });

  res.json({ success: true });
});

// ---- Stock correction (stock opname / physical count adjustment) ----
app.post("/api/stock-correction", async (req, res) => {
  const { item_id, actual_qty, note } = req.body;

  if (!item_id || actual_qty === undefined || actual_qty < 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const item = await queryOne<any>("SELECT * FROM items WHERE id = @id", { id: item_id });
  if (!item) return res.status(404).json({ error: "Not found" });

  const delta = actual_qty - item.stock_tersedia;

  await withTransaction(async (client) => {
    if (delta !== 0) {
      const type: "IN" | "OUT" = delta > 0 ? "IN" : "OUT";
      const qty = Math.abs(delta);
      const finalNote = `Koreksi Stok (Opname)${note ? `: ${note}` : ""}`;
      await execute(
        `INSERT INTO transactions (item_id, tujuan, type, qty, note, is_correction) VALUES (@item_id, '', @type, @qty, @note, 1)`,
        { item_id, type, qty, note: finalNote },
        client
      );
      await applyStockEffect(client, item_id, type, qty, 1);
    }

    await execute(
      `UPDATE items SET stock_fisik = @stock_fisik, selisih_stock = @selisih_stock WHERE id = @id`,
      { stock_fisik: actual_qty, selisih_stock: delta, id: item_id },
      client
    );
  });

  res.json({ success: true, delta });
});

app.get("/api/transactions", async (req, res) => {
  const { limit = "100" } = req.query as Record<string, string>;
  const rows = await queryMany(
    `SELECT transactions.*, items.kode, items.nama FROM transactions
     JOIN items ON items.id = transactions.item_id
     ORDER BY transactions.created_at DESC LIMIT @limit`,
    { limit: Math.min(parseInt(limit) || 100, 500) }
  );
  res.json(rows);
});

// ---- Stock In log (history from Google Sheet) ----
app.get("/api/stock-in", async (req, res) => {
  const {
    search = "",
    tujuan = "",
    vendor = "",
    dateFrom = "",
    dateTo = "",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  const conditions: string[] = [];
  const params: any = {};

  if (search) {
    conditions.push("(kode ILIKE @search OR nama ILIKE @search)");
    params.search = `%${search}%`;
  }
  if (tujuan && TUJUAN_OPTIONS.includes(tujuan)) {
    conditions.push("tujuan = @tujuan");
    params.tujuan = tujuan;
  }
  if (vendor) {
    conditions.push("nama_vendor = @vendor");
    params.vendor = vendor;
  }
  if (dateFrom) {
    conditions.push("tanggal_terima_iso >= @dateFrom");
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push("tanggal_terima_iso <= @dateTo");
    params.dateTo = dateTo;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM stock_in_log ${where}`, params))!.c;
  const qtySum = (await queryOne<any>(`SELECT SUM(qty) s FROM stock_in_log ${where}`, params))!.s || 0;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT * FROM stock_in_log ${where}
     ORDER BY tanggal_terima_iso DESC, id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), qtySum: Number(qtySum), page: parseInt(page), pageSize: limit });
});

app.get("/api/stock-in/vendors", async (_req, res) => {
  const rows = await queryMany<{ nama_vendor: string }>(
    "SELECT DISTINCT nama_vendor FROM stock_in_log WHERE nama_vendor IS NOT NULL AND nama_vendor NOT IN ('', '-') ORDER BY nama_vendor"
  );
  res.json(rows.map((r) => r.nama_vendor));
});

app.put("/api/stock-in/:id", async (req, res) => {
  const existing = await queryOne("SELECT * FROM stock_in_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { nama_vendor, qty, satuan, tujuan, tanggal_terima_iso, keterangan } = req.body;
  await execute(
    `UPDATE stock_in_log SET nama_vendor = @nama_vendor, qty = @qty, satuan = @satuan, tujuan = @tujuan, tanggal_terima_iso = @tanggal_terima_iso, tanggal_terima = @tanggal_terima, keterangan = @keterangan WHERE id = @id`,
    {
      nama_vendor: nama_vendor ?? "",
      qty: qty ?? 0,
      satuan: satuan ?? "",
      tujuan: tujuan && TUJUAN_OPTIONS.includes(tujuan) ? tujuan : null,
      tanggal_terima_iso: tanggal_terima_iso || null,
      tanggal_terima: tanggal_terima_iso ? isoToDisplay(tanggal_terima_iso) : "",
      keterangan: keterangan ?? "",
      id: req.params.id,
    }
  );
  res.json({ success: true });
});

app.delete("/api/stock-in/:id", async (req, res) => {
  const result = await execute("DELETE FROM stock_in_log WHERE id = @id", { id: req.params.id });
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

// ---- Stock Out log (history from Google Sheet) ----
app.get("/api/stock-out", async (req, res) => {
  const {
    search = "",
    tujuan = "",
    dateFrom = "",
    dateTo = "",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  const conditions: string[] = [];
  const params: any = {};

  if (search) {
    conditions.push("(kode ILIKE @search OR nama ILIKE @search OR penerima ILIKE @search)");
    params.search = `%${search}%`;
  }
  if (tujuan && TUJUAN_OPTIONS.includes(tujuan)) {
    conditions.push("tujuan = @tujuan");
    params.tujuan = tujuan;
  }
  if (dateFrom) {
    conditions.push("tanggal_keluar_iso >= @dateFrom");
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push("tanggal_keluar_iso <= @dateTo");
    params.dateTo = dateTo;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM stock_out_log ${where}`, params))!.c;
  const qtySum = (await queryOne<any>(`SELECT SUM(qty) s FROM stock_out_log ${where}`, params))!.s || 0;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT * FROM stock_out_log ${where}
     ORDER BY tanggal_keluar_iso DESC, id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), qtySum: Number(qtySum), page: parseInt(page), pageSize: limit });
});

app.put("/api/stock-out/:id", async (req, res) => {
  const existing = await queryOne("SELECT * FROM stock_out_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { penerima, qty, satuan, tujuan, tanggal_keluar_iso, keterangan } = req.body;
  await execute(
    `UPDATE stock_out_log SET penerima = @penerima, qty = @qty, satuan = @satuan, tujuan = @tujuan, tanggal_keluar_iso = @tanggal_keluar_iso, tanggal_keluar = @tanggal_keluar, keterangan = @keterangan WHERE id = @id`,
    {
      penerima: penerima ?? "",
      qty: qty ?? 0,
      satuan: satuan ?? "",
      tujuan: tujuan && TUJUAN_OPTIONS.includes(tujuan) ? tujuan : null,
      tanggal_keluar_iso: tanggal_keluar_iso || null,
      tanggal_keluar: tanggal_keluar_iso ? isoToDisplay(tanggal_keluar_iso) : "",
      keterangan: keterangan ?? "",
      id: req.params.id,
    }
  );
  res.json({ success: true });
});

app.delete("/api/stock-out/:id", async (req, res) => {
  const result = await execute("DELETE FROM stock_out_log WHERE id = @id", { id: req.params.id });
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

// ---- Karyawan master data ----
app.get("/api/karyawan/status-options", async (_req, res) => {
  const rows = await queryMany<{ status: string }>(
    "SELECT DISTINCT status FROM karyawan WHERE status IS NOT NULL AND status != '' ORDER BY status"
  );
  res.json(rows.map((r) => r.status));
});

app.get("/api/karyawan/estate-options", async (_req, res) => {
  const rows = await queryMany<{ estate: string }>(
    "SELECT DISTINCT estate FROM karyawan WHERE estate IS NOT NULL AND estate != '' ORDER BY estate"
  );
  res.json(rows.map((r) => r.estate));
});

app.get("/api/karyawan", async (req, res) => {
  const { search = "", status = "", estate = "", sortBy = "nama", sortDir = "asc", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;

  const validSort = ["nik", "nama", "status", "estate", "lokasi_kerja"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "nama";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = [];
  const params: any = {};

  if (search) {
    conditions.push("(nik ILIKE @search OR nama ILIKE @search OR nik_ktp ILIKE @search)");
    params.search = `%${search}%`;
  }
  if (status) {
    conditions.push("status = @status");
    params.status = status;
  }
  if (estate) {
    conditions.push("estate = @estate");
    params.estate = estate;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM karyawan ${where}`, params))!.c;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT * FROM karyawan ${where} ORDER BY ${sortCol} ${dir} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

app.put("/api/karyawan/:id", async (req, res) => {
  const existing = await queryOne("SELECT * FROM karyawan WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { nik, nama, status, estate, lokasi_kerja, nik_ktp } = req.body;
  if (!nik || !String(nik).trim() || !nama || !String(nama).trim()) {
    return res.status(400).json({ error: "NIK dan nama wajib diisi" });
  }

  try {
    await execute(
      `UPDATE karyawan SET nik = @nik, nama = @nama, status = @status, estate = @estate, lokasi_kerja = @lokasi_kerja, nik_ktp = @nik_ktp WHERE id = @id`,
      {
        nik: String(nik).trim(),
        nama: String(nama).trim(),
        status: status || "",
        estate: estate || "",
        lokasi_kerja: lokasi_kerja || "",
        nik_ktp: nik_ktp || "",
        id: req.params.id,
      }
    );
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "NIK sudah digunakan karyawan lain" });
    }
    throw e;
  }

  res.json({ success: true });
});

// ---- Alat Berat master data (heavy equipment/vehicles that consume fuel) ----
app.get("/api/alat-berat/jenis-options", async (_req, res) => {
  const rows = await queryMany<{ jenis_unit: string }>(
    "SELECT DISTINCT jenis_unit FROM alat_berat WHERE jenis_unit IS NOT NULL AND jenis_unit != '' ORDER BY jenis_unit"
  );
  res.json(rows.map((r) => r.jenis_unit));
});

app.get("/api/alat-berat", async (req, res) => {
  const { search = "", jenis_unit = "", sortBy = "kode", sortDir = "asc", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;

  const validSort = ["kode", "jenis_unit", "nama"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = [];
  const params: any = {};

  if (search) {
    conditions.push("(kode ILIKE @search OR nama ILIKE @search)");
    params.search = `%${search}%`;
  }
  if (jenis_unit) {
    conditions.push("jenis_unit = @jenis_unit");
    params.jenis_unit = jenis_unit;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM alat_berat ${where}`, params))!.c;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT * FROM alat_berat ${where} ORDER BY ${sortCol} ${dir} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

app.put("/api/alat-berat/:id", async (req, res) => {
  const existing = await queryOne("SELECT * FROM alat_berat WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { kode, jenis_unit, nama } = req.body;
  if (!kode || !String(kode).trim()) {
    return res.status(400).json({ error: "Kode wajib diisi" });
  }

  try {
    await execute(`UPDATE alat_berat SET kode = @kode, jenis_unit = @jenis_unit, nama = @nama WHERE id = @id`, {
      kode: String(kode).trim(),
      jenis_unit: jenis_unit || "",
      nama: nama || "",
      id: req.params.id,
    });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Kode sudah digunakan alat lain" });
    }
    throw e;
  }

  res.json({ success: true });
});

// ---- Inventory BBM (fuel: Solar & Bensin) - imported from Google Sheet, read-only history ----
// `lokasi` is the fixed physical stock site the sheet belongs to (Nilam/Zamrud/Firus for Solar;
// Nilam/WJA/KNS for Bensin). `estate` is a free-text sub-location/consumption tag from the raw
// sheet's own ESTATE column (only meaningful for Bensin - e.g. LUBAKAN, TAGANG, or a consuming
// estate like ZAMRUD/AKSS); for Solar it just mirrors `lokasi`.
app.get("/api/bbm/lokasi-options", (_req, res) => {
  res.json(BBM_LOKASI_OPTIONS);
});

// Sheet import artifacts that ended up in the ESTATE column but aren't actual estate/sub-location
// labels (e.g. a stock-in note like "BENSIN MASUK" recorded in the wrong column).
const BBM_ESTATE_JUNK = ["BENSIN MASUK", "STOCK AWAL", "PEMINJAMAN"];

// Known sub-locations that don't have any historical transactions yet, so they wouldn't otherwise
// appear in the distinct-estate query - added manually so they're selectable from the start.
const BBM_ESTATE_EXTRA: Record<string, string[]> = {
  WJA: ["TAGUL"],
  KNS: ["MALAPIAK"],
};

app.get("/api/bbm/estate-options", async (req, res) => {
  const { lokasi = "" } = req.query as Record<string, string>;
  const conditions = ["estate IS NOT NULL", "TRIM(estate) != ''"];
  const params: any = {};
  // Shared across Solar and Bensin on purpose: a sub-location (e.g. AKSS/UKM, only ever recorded
  // for Bensin so far) is a property of the site, not the fuel type, so it should be pickable for
  // Solar too even if no Solar transaction has used it yet.
  if (lokasi && BBM_LOKASI_OPTIONS.includes(lokasi)) {
    conditions.push("lokasi = @lokasi");
    params.lokasi = lokasi;
  }
  const rows = await queryMany<{ estate: string }>(
    `SELECT DISTINCT estate FROM bbm_log WHERE ${conditions.join(" AND ")} ORDER BY estate`,
    params
  );
  const fromData = rows.map((r) => r.estate).filter((e) => !BBM_ESTATE_JUNK.includes(e.toUpperCase()));
  const extra = BBM_ESTATE_EXTRA[lokasi] || [];
  const merged = Array.from(new Set([...fromData, ...extra])).sort();
  res.json(merged);
});

app.get("/api/bbm/summary", async (_req, res) => {
  const perLokasi = await queryMany(
    `SELECT jenis_bbm, lokasi, SUM(diterima) diterima, SUM(pemakaian) pemakaian
     FROM bbm_log GROUP BY jenis_bbm, lokasi ORDER BY jenis_bbm, lokasi`
  );

  // Latest known saldo (running balance) per jenis_bbm+lokasi. Several rows can share the same
  // tanggal_iso (multiple dispensing events per day), so picking "the" latest needs a real
  // tie-break (insertion order via id) - a plain GROUP BY on the max date alone doesn't guarantee
  // which same-day row's saldo_stock comes back, so a window function picks it deterministically.
  const saldoTerakhir = await queryMany(
    `SELECT jenis_bbm, lokasi, saldo_stock, tanggal, tanggal_iso FROM (
       SELECT jenis_bbm, lokasi, saldo_stock, tanggal, tanggal_iso,
              ROW_NUMBER() OVER (PARTITION BY jenis_bbm, lokasi ORDER BY tanggal_iso DESC, id DESC) AS rn
       FROM bbm_log
       WHERE saldo_stock IS NOT NULL AND ${foreignLedgerExclusion("bbm_log")}
     ) sub
     WHERE rn = 1`
  );

  res.json({ perLokasi, saldoTerakhir });
});

const INDO_MONTHS = [
  "JANUARI",
  "FEBRUARI",
  "MARET",
  "APRIL",
  "MEI",
  "JUNI",
  "JULI",
  "AGUSTUS",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DESEMBER",
];
const INDO_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function isoToIndoDate(iso: string): { tanggal: string; periode: string } {
  const [y, mo, d] = iso.split("-").map(Number);
  return {
    tanggal: `${d}-${INDO_MONTHS_SHORT[mo - 1]}-${y}`,
    periode: `${INDO_MONTHS[mo - 1]} ${y}`,
  };
}

// ---- Manual BBM transaction entry (mirrors the "Transaksi" flow on Inventory Gudang) ----
app.post("/api/bbm", async (req, res) => {
  const { jenis_bbm, lokasi, tanggal_iso, tipe, jumlah, keterangan, no_spb, estate, kode_kendaraan, hm_terakhir } = req.body;

  if (!["SOLAR", "BENSIN"].includes(jenis_bbm)) return res.status(400).json({ error: "Jenis BBM tidak valid" });
  if (!BBM_LOKASI_OPTIONS.includes(lokasi)) return res.status(400).json({ error: "Lokasi tidak valid" });
  if (!["DITERIMA", "PEMAKAIAN"].includes(tipe)) return res.status(400).json({ error: "Tipe transaksi tidak valid" });
  if (!jumlah || jumlah <= 0) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
  if (!tanggal_iso || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal_iso)) return res.status(400).json({ error: "Tanggal tidak valid" });
  if (!estate || !String(estate).trim()) return res.status(400).json({ error: "Estate/sub-lokasi wajib dipilih" });

  const last = await queryOne<{ saldo_stock: number }>(
    `SELECT saldo_stock FROM bbm_log WHERE jenis_bbm = @jenis_bbm AND lokasi = @lokasi AND saldo_stock IS NOT NULL
     AND ${foreignLedgerExclusion("bbm_log")}
     ORDER BY tanggal_iso DESC, id DESC LIMIT 1`,
    { jenis_bbm, lokasi }
  );

  const lastSaldo = last?.saldo_stock ?? 0;
  const saldoBaru = tipe === "DITERIMA" ? lastSaldo + jumlah : lastSaldo - jumlah;
  const { tanggal, periode } = isoToIndoDate(tanggal_iso);

  const result = await queryOne<{ id: number }>(
    `INSERT INTO bbm_log
      (jenis_bbm, lokasi, estate, periode, tanggal, tanggal_iso, no_spb, stock_awal, diterima, pinjam, pemakaian, saldo_stock, keterangan, status_kepemilikan, kode_kendaraan, hm_terakhir)
     VALUES
      (@jenis_bbm, @lokasi, @estate, @periode, @tanggal, @tanggal_iso, @no_spb, NULL, @diterima, NULL, @pemakaian, @saldo_stock, @keterangan, NULL, @kode_kendaraan, @hm_terakhir)
     RETURNING id`,
    {
      jenis_bbm,
      lokasi,
      estate,
      periode,
      tanggal,
      tanggal_iso,
      no_spb: no_spb || "",
      diterima: tipe === "DITERIMA" ? jumlah : null,
      pemakaian: tipe === "PEMAKAIAN" ? jumlah : null,
      saldo_stock: saldoBaru,
      keterangan: keterangan || "",
      kode_kendaraan: kode_kendaraan || "",
      hm_terakhir: hm_terakhir || "",
    }
  );

  res.json({ success: true, id: result!.id, saldo_stock: saldoBaru });
});

app.put("/api/bbm/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM bbm_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { tanggal_iso, no_spb, diterima, pemakaian, saldo_stock, keterangan, estate, kode_kendaraan, hm_terakhir } = req.body;
  if (tanggal_iso && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal_iso)) return res.status(400).json({ error: "Tanggal tidak valid" });

  const { tanggal, periode } = tanggal_iso ? isoToIndoDate(tanggal_iso) : { tanggal: existing.tanggal, periode: existing.periode };

  await execute(
    `UPDATE bbm_log SET
       tanggal = @tanggal, tanggal_iso = @tanggal_iso, periode = @periode, no_spb = @no_spb, diterima = @diterima, pemakaian = @pemakaian, saldo_stock = @saldo_stock,
       keterangan = @keterangan, estate = @estate, kode_kendaraan = @kode_kendaraan, hm_terakhir = @hm_terakhir
     WHERE id = @id`,
    {
      tanggal,
      tanggal_iso: tanggal_iso || existing.tanggal_iso,
      periode,
      no_spb: no_spb ?? "",
      diterima: diterima === "" || diterima === undefined ? null : Number(diterima),
      pemakaian: pemakaian === "" || pemakaian === undefined ? null : Number(pemakaian),
      saldo_stock: saldo_stock === "" || saldo_stock === undefined ? null : Number(saldo_stock),
      keterangan: keterangan ?? "",
      estate: estate ?? "",
      kode_kendaraan: kode_kendaraan ?? "",
      hm_terakhir: hm_terakhir ?? "",
      id: req.params.id,
    }
  );
  res.json({ success: true });
});

app.delete("/api/bbm/:id", async (req, res) => {
  const result = await execute("DELETE FROM bbm_log WHERE id = @id", { id: req.params.id });
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

app.get("/api/bbm", async (req, res) => {
  const {
    search = "",
    jenis_bbm = "",
    lokasi = "",
    dateFrom = "",
    dateTo = "",
    sortBy = "tanggal_iso",
    sortDir = "desc",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  const validSort = ["tanggal_iso", "lokasi", "jenis_bbm", "pemakaian", "diterima", "saldo_stock"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "tanggal_iso";
  const dir = sortDir === "asc" ? "ASC" : "DESC";

  const conditions: string[] = [];
  const params: any = {};

  if (search) {
    conditions.push("(keterangan ILIKE @search OR no_spb ILIKE @search OR estate ILIKE @search)");
    params.search = `%${search}%`;
  }
  if (jenis_bbm && ["SOLAR", "BENSIN"].includes(jenis_bbm)) {
    conditions.push("jenis_bbm = @jenis_bbm");
    params.jenis_bbm = jenis_bbm;
  }
  if (lokasi && BBM_LOKASI_OPTIONS.includes(lokasi)) {
    conditions.push("lokasi = @lokasi");
    params.lokasi = lokasi;
  }
  if (dateFrom) {
    conditions.push("tanggal_iso >= @dateFrom");
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push("tanggal_iso <= @dateTo");
    params.dateTo = dateTo;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM bbm_log ${where}`, params))!.c;
  const pemakaianSum = (await queryOne<any>(`SELECT SUM(pemakaian) s FROM bbm_log ${where}`, params))!.s || 0;
  const diterimaSum = (await queryOne<any>(`SELECT SUM(diterima) s FROM bbm_log ${where}`, params))!.s || 0;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT * FROM bbm_log ${where} ORDER BY ${sortCol} ${dir}, id ${dir} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({
    data,
    total: Number(total),
    pemakaianSum: Number(pemakaianSum),
    diterimaSum: Number(diterimaSum),
    page: parseInt(page),
    pageSize: limit,
  });
});
