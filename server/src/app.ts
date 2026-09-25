import express from "express";
import cookieParser from "cookie-parser";
import type { PoolClient } from "pg";
import { queryMany, queryOne, execute, withTransaction } from "./db.js";
import { COOKIE_NAME, hashPassword, verifyPassword, signSession, verifySession, ESTATES, ALL_PERMS, parseList, type SessionUser } from "./auth.js";

export const app = express();
// Frontend and API are always same-origin (one Vercel domain in production, Vite's dev proxy
// locally) - no cross-origin requests happen, so no CORS middleware is needed. Keeping it out
// matters now that auth uses a cookie: a permissive `cors()` would otherwise widen who can send
// credentialed requests.
app.use(express.json());
app.use(cookieParser());

const isProd = process.env.NODE_ENV === "production";

function setSessionCookie(res: express.Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// ---- Auth ----
// ---- Session user: the cookie names the account, access is read fresh from users ----
type UserRow = { id: number; username: string; nama: string; role: "superuser" | "estate"; estate: string | null; estates: string | null; perms: string | null };

function toSessionUser(row: UserRow): SessionUser {
  const superuser = row.role === "superuser";
  const estates = superuser ? [...ESTATES] : parseList(row.estates ?? row.estate, ESTATES);
  return {
    id: row.id,
    username: row.username,
    nama: row.nama,
    role: row.role,
    estate: (estates[0] ?? null) as SessionUser["estate"],
    estates,
    perms: superuser ? [...ALL_PERMS] : parseList(row.perms, ALL_PERMS),
  };
}

// Short per-instance cache so every API call doesn't hit the users table; cleared when an account
// is changed here, so a new checkbox applies within seconds everywhere.
const sessionCache = new Map<number, { user: SessionUser; at: number }>();
const SESSION_TTL_MS = 15_000;
async function sessionFromCookie(req: express.Request): Promise<SessionUser | null> {
  const token = req.cookies?.[COOKIE_NAME];
  const claims = token ? verifySession(token) : null;
  if (!claims) return null;
  const hit = sessionCache.get(claims.id);
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.user;
  const row = await queryOne<UserRow>("SELECT id, username, nama, role, estate, estates, perms FROM users WHERE id = @id", { id: claims.id });
  if (!row) return null;
  const user = toSessionUser(row);
  sessionCache.set(user.id, { user, at: Date.now() });
  return user;
}

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username dan password wajib diisi" });

  const row = await queryOne<UserRow & { password_hash: string }>("SELECT * FROM users WHERE username = @username", { username });
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: "Username atau password salah" });
  }

  const user = toSessionUser(row);
  setSessionCookie(res, signSession(user));
  // Login history for the Log Aktivitas User page; a failure here never blocks the login.
  await execute("INSERT INTO login_log (user_id) VALUES (@id)", { id: user.id }).catch((e) => console.error("login log failed", e));
  res.json({ user });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

app.get("/api/auth/me", async (req, res) => {
  const user = await sessionFromCookie(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  res.json({ user });
});

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

// ---- Everything else under /api requires a valid session ----
app.use("/api", async (req, res, next) => {
  const user = await sessionFromCookie(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.user = user;
  next();
});

// ---- Access: a superuser can do everything; an estate account only what is ticked for it ----
// Each request maps to the permission(s) that allow it (any one is enough): the module from the
// path (without the /api prefix), the action from the method. "super" = superusers
// only; null = any logged-in account (the route still checks the estate itself).
type Need = string[] | "super" | null;
const ACTIVITY_PERM: Record<string, string> = { BARANG: "gudang", BBM: "bbm", PUPUK: "pupuk", KLINIK: "klinik" };
function requiredPerms(req: express.Request): Need {
  // Inside app.use("/api") req.path is relative to the mount, inside a route it is the full path.
  const p = (req.baseUrl + req.path).replace(/^\/api/, "");
  const m = req.method;
  const q = req.query as Record<string, string>;
  const act = m === "GET" ? "view" : m === "POST" ? "input" : m === "PUT" ? "edit" : m === "DELETE" ? "delete" : "";
  const is = (re: RegExp) => re.test(p);

  if (is(/^\/auth\//) || is(/^\/karyawan\/pick$/)) return null;
  // Stok Opname: each route checks the opname's own module (view / opname / approve) and estate.
  if (is(/^\/stock-opname(\/|$)/)) return null;
  if (is(/^\/(stock-correction|gudang-stock\/correction)$/)) return ["gudang.koreksi"];
  if (is(/^\/klinik-stock\/correction$/)) return ["klinik.koreksi"];
  // items = the master barang list, which is also Nilam's gudang stock.
  if (is(/^\/items$/) && m === "GET") return ["gudang.view", "master.barang"];
  if (is(/^\/items(\/\d+)?$/) && m !== "GET") return ["master.barang", `gudang.${act}`];
  if (is(/^\/satuan-options$/)) return ["gudang.view", "master.barang"];
  if (is(/^\/(summary|items|transactions|stock-in|stock-out|gudang-stock)(\/|$)/)) return [`gudang.${act}`];
  if (is(/^\/bbm(\/|$)/)) return [`bbm.${act}`];
  if (is(/^\/pupuk(\/|$)/)) return [`pupuk.${act}`];
  if (is(/^\/klinik-stock(\/|$)/)) return [`klinik.${act}`];
  if (is(/^\/top-keluar$/)) return [q.source === "klinik" ? "klinik.view" : "gudang.view"];
  if (is(/^\/activity-log$/)) return ACTIVITY_PERM[q.module] ? [`${ACTIVITY_PERM[q.module]}.view`] : "super";
  if (is(/^\/obat(\/|$)/)) return ["master.obat"];
  if (is(/^\/karyawan(\/|$)/)) return ["master.karyawan"];
  if (is(/^\/alat-berat(\/|$)/)) return ["master.alat"];
  if (is(/^\/users(\/|$)/)) return ["master.users"];
  if (is(/^\/user-activity$/)) return ["monitor.log_user"];
  return "super";
}

app.use("/api", (req, res, next) => {
  if (req.user!.role === "superuser") return next();
  const need = requiredPerms(req);
  if (need === "super" || (need && !need.some((p) => req.user!.perms.includes(p)))) {
    return res.status(403).json({ error: "Akses ditolak" });
  }
  next();
});

// ---- Stok Opname lock: while a location has an open opname (DRAFT / SUBMITTED) its stock can't move ----
type OpnameModule = "GUDANG" | "KLINIK" | "BBM" | "PUPUK";
type StockLocation = { module: OpnameModule; estate: string };

// The locations whose stock a request would change. Only stock-moving routes are listed: master
// data, buffer/catatan edits and the imported Nilam stock in/out history don't change the stock.
async function stockLocations(req: express.Request): Promise<StockLocation[]> {
  const m = req.method;
  if (m === "GET") return [];
  const p = (req.baseUrl + req.path).replace(/^\/api/, "");
  const b = req.body ?? {};
  const id = p.match(/\/(\d+)$/)?.[1];
  const col = async (table: string, column: string) =>
    id ? (await queryOne<{ v: string }>(`SELECT ${column} v FROM ${table} WHERE id = @id`, { id }))?.v : undefined;
  const at = (module: OpnameModule) => (estate: unknown) => (typeof estate === "string" && estate ? [{ module, estate }] : []);
  const [G, K, B, P] = (["GUDANG", "KLINIK", "BBM", "PUPUK"] as const).map(at);
  // A Nilam Stok Keluar to another estate's gudang also books a Stok Masuk there (see addTransfer).
  const transferTo = (tujuan: unknown, type: unknown) => (type === "OUT" && GUDANG_STOCK_OPTIONS.includes(String(tujuan)) ? G(tujuan) : []);

  if (p === "/stock-correction") return G("NILAM");
  if (p === "/transactions" && m === "POST") return [...G("NILAM"), ...transferTo(b.tujuan, b.type)];
  if (/^\/transactions\/\d+$/.test(p)) {
    const t = await queryOne<{ gudang: string }>("SELECT gudang FROM gudang_stock_tx WHERE transfer_from_id = @id", { id });
    return [...G("NILAM"), ...G(t?.gudang), ...(m === "PUT" ? transferTo(b.tujuan, b.type) : [])];
  }
  if (/^\/gudang-stock(\/transactions|\/correction)?$/.test(p) && m === "POST") return G(b.gudang);
  if (/^\/gudang-stock\/\d+$/.test(p)) return G(await col("gudang_stock", "gudang"));
  if (/^\/gudang-stock\/history\/\d+$/.test(p)) return G(await col("gudang_stock_tx", "gudang"));
  if (/^\/klinik-stock\/(transactions|correction)$/.test(p)) return K(b.klinik);
  if (/^\/klinik-stock\/batch\/\d+$/.test(p)) return K(await col("klinik_batch", "klinik"));
  if (/^\/klinik-stock\/\d+$/.test(p) && m === "DELETE") return K(await col("klinik_stock", "klinik"));
  if (/^\/klinik-stock\/history\/\d+$/.test(p)) return K(await col("klinik_stock_tx", "klinik"));
  if (p === "/bbm" && m === "POST") return B(b.lokasi);
  if (/^\/bbm\/\d+$/.test(p)) return B(await col("bbm_log", "lokasi"));
  if (p === "/pupuk" && m === "POST") return P(b.estate);
  if (/^\/pupuk\/\d+$/.test(p)) return P(await col("pupuk_log", "estate"));
  return [];
}

const OPNAME_MODULE_LABEL: Record<OpnameModule, string> = { GUDANG: "Gudang", KLINIK: "Klinik", BBM: "BBM", PUPUK: "Pupuk" };

app.use("/api", async (req, res, next) => {
  const locs = await stockLocations(req);
  if (!locs.length) return next();
  const open = await queryOne<{ id: number; module: OpnameModule; estate: string; status: string }>(
    `SELECT id, module, estate, status FROM opname
     WHERE status IN ('DRAFT', 'SUBMITTED') AND module || ':' || estate = ANY(@keys::text[]) ORDER BY id LIMIT 1`,
    { keys: locs.map((l) => `${l.module}:${l.estate}`) }
  );
  if (!open) return next();
  res.status(423).json({
    error:
      `${OPNAME_MODULE_LABEL[open.module]} ${open.estate} sedang Stok Opname #${open.id} ` +
      `(${open.status === "DRAFT" ? "sedang dihitung" : "menunggu approval"}). ` +
      "Transaksi stok dikunci sampai opname disetujui atau dibatalkan.",
  });
});

// Routes that used to be superuser-only: the gate above has already checked the account's
// permission for them, so this only still refuses routes with no permission mapped ("super").
function requireSuperuser(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.user!.role === "superuser" || Array.isArray(requiredPerms(req))) return next();
  return res.status(403).json({ error: "Akses ditolak" });
}

function estateAllowed(user: SessionUser, estate: string | null | undefined) {
  return user.role === "superuser" || (!!estate && user.estates.includes(estate));
}

function requireEstate(estate: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!estateAllowed(req.user!, estate)) return res.status(403).json({ error: "Akses ditolak" });
    next();
  };
}

// ---- Activity log (audit trail), see schema.sql's activity_log ----
type LogModule = "BARANG" | "BBM" | "PUPUK" | "KLINIK";

// Records who changed what. Called after the change succeeded; a logging failure is reported but
// never fails the user's action itself.
async function logActivity(
  req: express.Request,
  entry: { module: LogModule; estate: string | null; aksi: string; objek: string; detail?: string }
) {
  const u = req.user!;
  try {
    await execute(
      `INSERT INTO activity_log (module, estate, aksi, objek, detail, user_id, username, nama)
       VALUES (@module, @estate, @aksi, @objek, @detail, @user_id, @username, @nama)`,
      { ...entry, detail: entry.detail ?? "", user_id: u.id, username: u.username, nama: u.nama }
    );
  } catch (e) {
    console.error("activity log failed", e);
  }
}

// "Label: old → new" for each field that actually changed, e.g. "Stock Tersedia: 10 → 12".
function describeChanges(before: Record<string, any>, after: Record<string, any>, labels: Record<string, string>) {
  const show = (v: any) => (v === null || v === undefined || v === "" ? "-" : String(v));
  const changes = Object.entries(labels)
    .filter(([k]) => k in after && show(before[k]) !== show(after[k]))
    .map(([k, label]) => `${label}: ${show(before[k])} → ${show(after[k])}`);
  return changes.length ? changes.join("; ") : "Tidak ada perubahan";
}

// Nilam/Zamrud/Firus are consumer/destination estates, NOT separate physical warehouses.
// There is only one physical stock pool (the main warehouse, located at Nilam).
const TUJUAN_OPTIONS = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];

// BBM (fuel, Solar & Bensin) physical storage/gudang sites. Nilam, WJA and KNS hold the imported
// history; Zamrud and Firus were added later as their own lokasi so they can record their own stock
// from the first delivery on (their older Solar sheets stay filed under NILAM, estate=ZAMRUD/FIRUS).
// Zamrud/Firus/AKSS/UKM (under Nilam), LUBAKAN/TAGUL (under WJA) and MALAPIAK/TAGANG (under KNS)
// are distribution/consumption destinations, not separate warehouses - see `estate`.
const BBM_LOKASI_OPTIONS = ["NILAM", "WJA", "KNS", "ZAMRUD", "FIRUS"];

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
app.get("/api/summary", requireEstate("NILAM"), async (_req, res) => {
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

// ---- Top barang keluar (dashboard ranking) ----
// Ranks the items that went out most, over the chosen estates and period, either by total qty or
// by number of transactions. Gudang: Nilam's outflow is stock_out_log (manual OUTs are mirrored
// there, corrections are not), the other gudang use gudang_stock_tx. Klinik uses klinik_stock_tx.
// Koreksi rows are left out - they fix a count, they aren't usage.
app.get("/api/top-keluar", async (req, res) => {
  const { source = "gudang", estates = "", sortBy = "trx", dateFrom = "", dateTo = "", tz = "", limit = "10" } =
    req.query as Record<string, string>;
  if (!["gudang", "klinik"].includes(source)) return res.status(400).json({ error: "Sumber tidak valid" });
  const requested = estates ? estates.split(",") : [...ESTATES];
  const allowed = requested.filter((e) => (ESTATES as readonly string[]).includes(e) && estateAllowed(req.user!, e));
  if (!allowed.length) return res.json({ rows: [], totalQty: 0, totalTrx: 0 });

  const params: any = {
    tz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : "Asia/Jakarta",
    dateFrom: dateFrom || "1900-01-01",
    dateTo: dateTo || "9999-12-31",
    limit: Math.min(Math.max(parseInt(limit) || 10, 1), 50),
  };
  const txDate = "(t.created_at AT TIME ZONE @tz)::date BETWEEN @dateFrom::date AND @dateTo::date";

  let srcSql: string;
  let master: string;
  if (source === "gudang") {
    const parts: string[] = [];
    if (allowed.includes("NILAM")) {
      parts.push(`SELECT s.kode, s.qty FROM stock_out_log s
        WHERE s.kode IS NOT NULL AND s.tanggal_keluar_iso BETWEEN @dateFrom AND @dateTo`);
    }
    params.gudangs = allowed.filter((e) => GUDANG_STOCK_OPTIONS.includes(e));
    if (params.gudangs.length) {
      parts.push(`SELECT t.item_kode, t.qty FROM gudang_stock_tx t
        WHERE t.type = 'OUT' AND t.is_correction = 0 AND t.gudang = ANY(@gudangs::text[]) AND ${txDate}`);
    }
    srcSql = parts.join(" UNION ALL ");
    master = "items";
  } else {
    params.kliniks = allowed;
    srcSql = `SELECT t.obat_kode, t.qty FROM klinik_stock_tx t
      WHERE t.type = 'OUT' AND t.is_correction = 0 AND COALESCE(t.tujuan, '') <> 'DIBUANG' AND t.klinik = ANY(@kliniks::text[]) AND ${txDate}`;
    master = "obat";
  }

  const order = sortBy === "trx" ? "trx DESC, qty DESC" : "qty DESC, trx DESC";
  const rows = await queryMany(
    `WITH src(kode, qty) AS (${srcSql}),
     agg AS (SELECT kode, SUM(qty)::float qty, COUNT(*)::int trx FROM src GROUP BY kode)
     SELECT agg.kode, m.id, COALESCE(m.nama, agg.kode) nama, m.satuan, agg.qty, agg.trx,
       SUM(agg.qty) OVER ()::float "totalQty", SUM(agg.trx) OVER ()::int "totalTrx"
     FROM agg LEFT JOIN ${master} m ON m.kode = agg.kode
     ORDER BY ${order}, nama LIMIT @limit`,
    params
  );
  res.json({
    rows: rows.map(({ totalQty: _q, totalTrx: _t, ...r }) => r),
    totalQty: rows[0]?.totalQty ?? 0,
    totalTrx: rows[0]?.totalTrx ?? 0,
  });
});

// ---- Distinct satuan values (for filter dropdown) ----
app.get("/api/satuan-options", async (_req, res) => {
  const rows = await queryMany<{ satuan: string }>(
    "SELECT DISTINCT satuan FROM items WHERE satuan IS NOT NULL AND satuan != '' ORDER BY satuan"
  );
  res.json(rows.map((r) => r.satuan));
});

// Every word must appear somewhere in kode or nama, in any order, so "filter oli klx" finds
// "FILTER OLI MOTOR KLX". `alias` is the items table alias in the query ("" or "i.").
// Every search word must appear in at least one of `cols` (so "pipa 4" finds "PIPA PVC 4 IN").
function wordSearch(search: string, cols: string[], conditions: string[], params: Record<string, any>) {
  search
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10)
    .forEach((word, i) => {
      conditions.push(`(${cols.map((c) => `${c} ILIKE @search${i}`).join(" OR ")})`);
      params[`search${i}`] = `%${word}%`;
    });
}

// Word search over a master table's kode + nama plus `extra` columns; a bare column name gets the
// table `alias`, a qualified one ("t.note") is used as is.
function addWordSearch(search: string, alias: string, conditions: string[], params: Record<string, any>, extra: string[] = []) {
  const cols = ["kode", "nama", ...extra].map((c) => (c.includes(".") ? c : `${alias}${c}`));
  wordSearch(search, cols, conditions, params);
}

// Obat can also be found by their kategori, jenis (kelompok obat) or deskripsi, e.g. "antibiotik".
const OBAT_SEARCH = ["kategori", "jenis", "deskripsi"];

// ---- Items list with search/filter/sort/pagination ----
app.get("/api/items", async (req, res) => {
  const {
    search = "",
    status = "",
    satuan = "",
    stock = "",
    sortBy = "kode",
    sortDir = "asc",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  const validSort = ["kode", "nama", "stock_tersedia", "buffer_stock"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = [];
  const params: any = {};

  addWordSearch(search, "", conditions, params, ["satuan"]);
  if (status) {
    conditions.push("keterangan = @status");
    params.status = status;
  }
  if (satuan) {
    conditions.push("satuan = @satuan");
    params.satuan = satuan;
  }
  // Same conditions as the lowStock/outOfStock counts in /api/summary, so the stat cards link to matching rows.
  if (stock === "menipis") conditions.push("stock_tersedia <= buffer_stock AND buffer_stock > 0");
  if (stock === "habis") conditions.push("stock_tersedia <= 0");

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

app.get("/api/items/:id", requireEstate("NILAM"), async (req, res) => {
  const item = await queryOne("SELECT * FROM items WHERE id = @id", { id: req.params.id });
  if (!item) return res.status(404).json({ error: "Not found" });
  const transactions = await queryMany(
    "SELECT * FROM transactions WHERE item_id = @id ORDER BY created_at DESC LIMIT 50",
    { id: req.params.id }
  );
  res.json({ ...item, transactions });
});

// A new master barang: from Nilam's gudang page or by a Master Barang admin of any estate.
app.post("/api/items", (req, res, next) => (req.user!.perms.includes("master.barang") ? next() : requireEstate("NILAM")(req, res, next)), async (req, res) => {
  const { kode, nama, satuan, buffer_stock } = req.body;
  if (!kode || !String(kode).trim() || !nama || !String(nama).trim()) {
    return res.status(400).json({ error: "Kode dan nama wajib diisi" });
  }

  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO items (kode, nama, satuan, buffer_stock) VALUES (@kode, @nama, @satuan, @buffer_stock) RETURNING id`,
      {
        kode: String(kode).trim(),
        nama: String(nama).trim(),
        satuan: satuan || "",
        buffer_stock: buffer_stock ?? 0,
      }
    );
    await logActivity(req, {
      module: "BARANG",
      estate: "NILAM",
      aksi: "Tambah Barang",
      objek: `${String(kode).trim()} - ${String(nama).trim()}`,
      detail: `Satuan: ${satuan || "-"}; Buffer: ${buffer_stock ?? 0}`,
    });
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Kode sudah digunakan barang lain" });
    }
    throw e;
  }
});

app.put("/api/items/:id", requireSuperuser, async (req, res) => {
  const { kode, nama, satuan, buffer_stock } = req.body;
  const existing = await queryOne("SELECT * FROM items WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!kode || !String(kode).trim()) {
    return res.status(400).json({ error: "Kode wajib diisi" });
  }

  try {
    await execute("UPDATE items SET kode = @kode, nama = @nama, satuan = @satuan, buffer_stock = @buffer_stock WHERE id = @id", {
      kode: String(kode).trim(),
      nama,
      satuan,
      buffer_stock: buffer_stock ?? 0,
      id: req.params.id,
    });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Kode sudah digunakan barang lain" });
    }
    if (e.code === "23503") {
      return res.status(409).json({ error: "Kode ini dipakai di stok gudang lain, tidak bisa diganti" });
    }
    throw e;
  }
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Edit Barang",
    objek: `${String(kode).trim()} - ${nama}`,
    detail: describeChanges(
      existing,
      { kode: String(kode).trim(), nama, satuan, buffer_stock: buffer_stock ?? 0 },
      { kode: "Kode", nama: "Nama", satuan: "Satuan", buffer_stock: "Buffer" }
    ),
  });
  res.json({ success: true });
});

app.delete("/api/items/:id", requireSuperuser, async (req, res) => {
  const { id } = req.params;
  const existing = await queryOne("SELECT * FROM items WHERE id = @id", { id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const [tx, stockIn, stockOut] = await Promise.all([
    queryOne<any>("SELECT 1 FROM transactions WHERE item_id = @id LIMIT 1", { id }),
    queryOne<any>("SELECT 1 FROM stock_in_log WHERE item_id = @id LIMIT 1", { id }),
    queryOne<any>("SELECT 1 FROM stock_out_log WHERE item_id = @id LIMIT 1", { id }),
  ]);
  if (tx || stockIn || stockOut) {
    return res.status(409).json({ error: "Barang ini punya riwayat transaksi, tidak bisa dihapus" });
  }

  await execute("DELETE FROM items WHERE id = @id", { id });
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Hapus Barang",
    objek: `${existing.kode} - ${existing.nama}`,
    detail: `Stock terakhir: ${existing.stock_tersedia ?? 0}`,
  });
  res.json({ success: true });
});

// ---- Inventory Gudang for the non-Nilam warehouses (KNS/WJA/ZAMRUD/FIRUS) ----
// Nilam's stock lives directly on `items`; these gudang instead keep their own buffer/stock
// quantities in `gudang_stock`, picking the item name/satuan from that same master item list.
const GUDANG_STOCK_OPTIONS = ["KNS", "WJA", "ZAMRUD", "FIRUS"];
// The estates each of these sites supplies (KNS and WJA each supply two): the Stok Keluar tujuan of
// their gudang and the BBM Estate choices of their lokasi. Only Gudang Nilam supplies other estates.
// Keep in sync with GUDANG_TUJUAN in src/lib/api.ts.
const GUDANG_TUJUAN: Record<string, string[]> = {
  KNS: ["MALAPIAK", "TAGANG"],
  WJA: ["LUBAKAN", "TAGUL"],
  ZAMRUD: ["ZAMRUD"],
  FIRUS: ["FIRUS"],
};

app.get("/api/gudang-stock/summary", async (req, res) => {
  const { gudang = "" } = req.query as Record<string, string>;
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });

  const totalItems = (await queryOne<any>("SELECT COUNT(*) c FROM gudang_stock WHERE gudang = @gudang", { gudang }))!.c;
  const lowStock = (
    await queryOne<any>(
      "SELECT COUNT(*) c FROM gudang_stock WHERE gudang = @gudang AND stock_tersedia <= buffer_stock AND buffer_stock > 0",
      { gudang }
    )
  )!.c;
  const outOfStock = (
    await queryOne<any>("SELECT COUNT(*) c FROM gudang_stock WHERE gudang = @gudang AND stock_tersedia <= 0", { gudang })
  )!.c;
  const totalStock =
    (await queryOne<any>("SELECT SUM(stock_tersedia) s FROM gudang_stock WHERE gudang = @gudang", { gudang }))!.s || 0;

  res.json({ totalItems, lowStock, outOfStock, totalStock });
});

app.get("/api/gudang-stock", async (req, res) => {
  const {
    gudang = "",
    search = "",
    satuan = "",
    status = "",
    stock = "",
    sortBy = "kode",
    sortDir = "asc",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });

  const validSort = ["kode", "nama", "stock_tersedia", "buffer_stock"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = ["gs.gudang = @gudang"];
  const params: any = { gudang };

  addWordSearch(search, "i.", conditions, params, ["satuan"]);
  if (satuan) {
    conditions.push("i.satuan = @satuan");
    params.satuan = satuan;
  }
  if (status === "AMAN") {
    conditions.push("gs.stock_tersedia > 0");
  } else if (status === "BUFFER STOCK") {
    conditions.push("gs.stock_tersedia <= 0");
  }
  // Same conditions as the lowStock/outOfStock counts in /api/gudang-stock/summary.
  if (stock === "menipis") conditions.push("gs.stock_tersedia <= gs.buffer_stock AND gs.buffer_stock > 0");
  if (stock === "habis") conditions.push("gs.stock_tersedia <= 0");

  const where = "WHERE " + conditions.join(" AND ");
  const joinSql = `FROM gudang_stock gs JOIN items i ON i.kode = gs.item_kode ${where}`;

  const total = (await queryOne<any>(`SELECT COUNT(*) c ${joinSql}`, params))!.c;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT gs.id, i.kode, i.nama, i.satuan, gs.buffer_stock, gs.stock_tersedia,
            CASE WHEN gs.stock_tersedia > 0 THEN 'AMAN' ELSE 'BUFFER STOCK' END AS keterangan
     ${joinSql}
     ORDER BY ${sortCol === "kode" || sortCol === "nama" ? "i." + sortCol : "gs." + sortCol} ${dir}
     LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

app.post("/api/gudang-stock", async (req, res) => {
  const { gudang, item_kode, buffer_stock, stock_tersedia } = req.body;
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });
  if (!item_kode || !String(item_kode).trim()) return res.status(400).json({ error: "Barang wajib dipilih" });

  const item = await queryOne("SELECT kode FROM items WHERE kode = @item_kode", { item_kode });
  if (!item) return res.status(400).json({ error: "Barang tidak ditemukan di master data" });

  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO gudang_stock (gudang, item_kode, buffer_stock, stock_tersedia)
       VALUES (@gudang, @item_kode, @buffer_stock, @stock_tersedia) RETURNING id`,
      { gudang, item_kode, buffer_stock: buffer_stock ?? 0, stock_tersedia: stock_tersedia ?? 0 }
    );
    const master = await queryOne<any>("SELECT nama FROM items WHERE kode = @item_kode", { item_kode });
    await logActivity(req, {
      module: "BARANG",
      estate: gudang,
      aksi: "Tambah Item",
      objek: `${item_kode} - ${master?.nama ?? ""}`,
      detail: `Buffer: ${buffer_stock ?? 0}; Stock Tersedia: ${stock_tersedia ?? 0}`,
    });
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Barang ini sudah ada di gudang ini" });
    }
    throw e;
  }
});

app.put("/api/gudang-stock/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM gudang_stock WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.gudang)) return res.status(403).json({ error: "Akses ditolak" });

  const { buffer_stock, stock_tersedia } = req.body;
  await execute("UPDATE gudang_stock SET buffer_stock = @buffer_stock, stock_tersedia = @stock_tersedia WHERE id = @id", {
    buffer_stock: buffer_stock ?? 0,
    stock_tersedia: stock_tersedia ?? 0,
    id: req.params.id,
  });
  const master = await queryOne<any>("SELECT nama FROM items WHERE kode = @kode", { kode: existing.item_kode });
  await logActivity(req, {
    module: "BARANG",
    estate: existing.gudang,
    aksi: "Edit Stok",
    objek: `${existing.item_kode} - ${master?.nama ?? ""}`,
    detail: describeChanges(
      existing,
      { buffer_stock: buffer_stock ?? 0, stock_tersedia: stock_tersedia ?? 0 },
      { buffer_stock: "Buffer", stock_tersedia: "Stock Tersedia" }
    ),
  });
  res.json({ success: true });
});

app.delete("/api/gudang-stock/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM gudang_stock WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.gudang)) return res.status(403).json({ error: "Akses ditolak" });

  await execute("DELETE FROM gudang_stock WHERE id = @id", { id: req.params.id });
  const master = await queryOne<any>("SELECT nama FROM items WHERE kode = @kode", { kode: existing.item_kode });
  await logActivity(req, {
    module: "BARANG",
    estate: existing.gudang,
    aksi: "Hapus Item",
    objek: `${existing.item_kode} - ${master?.nama ?? ""}`,
    detail: `Buffer: ${existing.buffer_stock}; Stock Tersedia: ${existing.stock_tersedia}`,
  });
  res.json({ success: true });
});

// ---- Combined movement history for one item (stock in + stock out + manual transactions) ----
// ---- Stock In / Stock Out / Koreksi for the non-Nilam gudang (same form as Nilam) ----

// Picker list for the transaction form: every master barang with its stock in this gudang
// (0 when the gudang doesn't hold it yet - a Stock In adds it).
app.get("/api/gudang-stock/pick", async (req, res) => {
  const { gudang = "", search = "", page = "1", pageSize = "50" } = req.query as Record<string, string>;
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });

  const conditions: string[] = [];
  const params: any = { gudang };
  addWordSearch(search, "i.", conditions, params, ["satuan"]);
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const joinSql = `FROM items i LEFT JOIN gudang_stock gs ON gs.item_kode = i.kode AND gs.gudang = @gudang ${where}`;

  const total = (await queryOne<any>(`SELECT COUNT(*) c ${joinSql}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT i.id, i.kode, i.nama, i.satuan, COALESCE(gs.buffer_stock, 0) buffer_stock,
            COALESCE(gs.stock_tersedia, 0) stock_tersedia,
            CASE WHEN COALESCE(gs.stock_tersedia, 0) > 0 THEN 'AMAN' ELSE 'BUFFER STOCK' END AS keterangan
     ${joinSql} ORDER BY i.kode LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

// A per-location stock ledger: the stock table, its movement table and their column names.
// Gudang (KNS/WJA/Zamrud/Firus) and Klinik share the same Stock In/Out/Koreksi logic.
type StockLedger = { stock: string; tx: string; scope: string; item: string };
const GUDANG_LEDGER: StockLedger = { stock: "gudang_stock", tx: "gudang_stock_tx", scope: "gudang", item: "item_kode" };
const KLINIK_LEDGER: StockLedger = { stock: "klinik_stock", tx: "klinik_stock_tx", scope: "klinik", item: "obat_kode" };

// Gudang (KNS/WJA/Zamrud/Firus) qty may be decimal (see schema.sql); Klinik qty is a whole number.
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const validQty = (l: StockLedger, v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && (l === GUDANG_LEDGER || Number.isInteger(v));

type Movement = {
  scope: string;
  item: string;
  type: "IN" | "OUT";
  qty: number;
  tujuan: string;
  penerima: string;
  note: string | null;
  is_correction: number;
  // Only on gudang_stock_tx: the Nilam Stok Keluar (transactions.id) this Stok Masuk came from.
  transferFromId?: number;
};

// Applies one movement to a location's stock, creating its stock row on first use.
// Returns the stock before the change.
async function applyMovement(client: PoolClient, req: express.Request, l: StockLedger, m: Movement) {
  await execute(
    `INSERT INTO ${l.stock} (${l.scope}, ${l.item}, buffer_stock, stock_tersedia) VALUES (@scope, @item, 0, 0)
     ON CONFLICT (${l.scope}, ${l.item}) DO NOTHING`,
    m,
    client
  );
  const row = (await queryOne<any>(
    `SELECT id, stock_tersedia FROM ${l.stock} WHERE ${l.scope} = @scope AND ${l.item} = @item FOR UPDATE`,
    m,
    client
  ))!;
  const link = m.transferFromId !== undefined;
  await execute(
    `INSERT INTO ${l.tx} (${l.scope}, ${l.item}, type, qty, tujuan, penerima, note, is_correction, user_id${link ? ", transfer_from_id" : ""})
     VALUES (@scope, @item, @type, @qty, @tujuan, @penerima, @note, @is_correction, @user_id${link ? ", @transferFromId" : ""})`,
    { ...m, user_id: req.user!.id },
    client
  );
  await execute(
    `UPDATE ${l.stock} SET stock_tersedia = ROUND((stock_tersedia + @delta)::numeric, 3) WHERE id = @id`,
    { delta: m.type === "IN" ? m.qty : -m.qty, id: row.id },
    client
  );
  return row.stock_tersedia as number;
}

// Stock In / Stock Out; a Stock Out larger than the stock is rolled back. Returns an error message or null.
async function recordMovement(req: express.Request, l: StockLedger, m: Movement): Promise<string | null> {
  try {
    await withTransaction(async (client) => {
      const before = await applyMovement(client, req, l, m);
      // Thrown inside the transaction so the movement is rolled back.
      if (m.type === "OUT" && m.qty > before) throw Object.assign(new Error("insufficient stock"), { stockAvailable: before });
    });
    return null;
  } catch (e: any) {
    if (e.stockAvailable !== undefined) return `Stock tersedia hanya ${e.stockAvailable}`;
    throw e;
  }
}

// Koreksi: sets the stock to the counted quantity via one IN/OUT movement. Returns the stock before.
async function recordCorrection(req: express.Request, l: StockLedger, scope: string, item: string, actual: number, note: string) {
  return withTransaction((client) => ledgerCorrection(client, req, l, scope, item, actual, `Koreksi Stok (Opname)${note ? `: ${note}` : ""}`));
}

// The movement of a Koreksi inside an open transaction (also used by an approved Stok Opname).
async function ledgerCorrection(client: PoolClient, req: express.Request, l: StockLedger, scope: string, item: string, actual: number, note: string) {
  const current = await queryOne<any>(
    `SELECT stock_tersedia FROM ${l.stock} WHERE ${l.scope} = @scope AND ${l.item} = @item FOR UPDATE`,
    { scope, item },
    client
  );
  const before: number = current?.stock_tersedia ?? 0;
  const delta = round3(actual - before);
  if (delta === 0) return before;
  await applyMovement(client, req, l, {
    scope,
    item,
    type: delta > 0 ? "IN" : "OUT",
    qty: Math.abs(delta),
    tujuan: "",
    penerima: "",
    note,
    is_correction: 1,
  });
  return before;
}

const movementDetail = (qty: number, tujuan?: string, penerima?: string, note?: string) =>
  [`Jumlah: ${qty}`, tujuan && `Tujuan: ${tujuan}`, penerima && `Penerima: ${penerima}`, note && `Catatan: ${note}`].filter(Boolean).join("; ");

app.post("/api/gudang-stock/transactions", async (req, res) => {
  const { gudang, item_kode, type, qty, tujuan, penerima, note } = req.body;
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });
  if (!["IN", "OUT"].includes(type) || !validQty(GUDANG_LEDGER, qty) || qty <= 0) return res.status(400).json({ error: "Invalid payload" });
  if (tujuan && !GUDANG_TUJUAN[gudang].includes(tujuan)) {
    return res.status(400).json({ error: `Gudang ${gudang} hanya bisa menyuplai ${GUDANG_TUJUAN[gudang].join(", ")}` });
  }

  const item = await queryOne<any>("SELECT kode, nama FROM items WHERE kode = @item_kode", { item_kode });
  if (!item) return res.status(404).json({ error: "Barang tidak ditemukan di master data" });

  const err = await recordMovement(req, GUDANG_LEDGER, {
    scope: gudang,
    item: item_kode,
    type,
    qty: round3(qty),
    tujuan: tujuan || "",
    penerima: penerima || "",
    note: note || null,
    is_correction: 0,
  });
  if (err) return res.status(400).json({ error: err });

  await logActivity(req, {
    module: "BARANG",
    estate: gudang,
    aksi: type === "IN" ? "Stok Masuk" : "Stok Keluar",
    objek: `${item.kode} - ${item.nama}`,
    detail: movementDetail(qty, tujuan, penerima, note),
  });
  res.json({ success: true });
});

app.post("/api/gudang-stock/correction", requireSuperuser, async (req, res) => {
  const { gudang, item_kode, actual_qty, note } = req.body;
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!validQty(GUDANG_LEDGER, actual_qty) || actual_qty < 0) return res.status(400).json({ error: "Invalid payload" });

  const item = await queryOne<any>("SELECT kode, nama FROM items WHERE kode = @item_kode", { item_kode });
  if (!item) return res.status(404).json({ error: "Barang tidak ditemukan di master data" });

  const before = await recordCorrection(req, GUDANG_LEDGER, gudang, item_kode, actual_qty, note);
  const delta = actual_qty - before;

  await logActivity(req, {
    module: "BARANG",
    estate: gudang,
    aksi: "Koreksi Stok",
    objek: `${item.kode} - ${item.nama}`,
    detail: `Stock: ${before} → ${actual_qty} (selisih ${delta > 0 ? "+" : ""}${delta})${note ? `; Catatan: ${note}` : ""}`,
  });
  res.json({ success: true, delta });
});

app.get("/api/items/:id/movements", requireEstate("NILAM"), async (req, res) => {
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

// ---- Transfer Gudang Nilam -> gudang estate lain ----
// Gudang Nilam supplies every estate; a Nilam Stok Keluar whose tujuan is KNS/WJA/Zamrud/Firus books
// the same qty as Stok Masuk in that estate's gudang. The receiving gudang_stock_tx row points back
// via transfer_from_id (see schema.sql), is rebuilt when the Stok Keluar is edited, removed with it,
// and can't be edited or deleted on its own. The other gudang only supply their own estate (GUDANG_TUJUAN).
type TransferChange = { estate: string; qty: number } | null;
const TRANSFER_LOCKED = "Stok masuk ini otomatis dari Gudang NILAM. Ubah atau hapus lewat stok keluar di Gudang NILAM.";

async function addTransfer(
  client: PoolClient,
  req: express.Request,
  nilamTxId: number,
  itemKode: string,
  tujuan: string | undefined,
  qty: number,
  penerima: string | undefined,
  note: string | null | undefined
): Promise<TransferChange> {
  if (!tujuan || !GUDANG_STOCK_OPTIONS.includes(tujuan)) return null;
  await applyMovement(client, req, GUDANG_LEDGER, {
    scope: tujuan,
    item: itemKode,
    type: "IN",
    qty,
    tujuan: "",
    penerima: penerima || "",
    note: `Transfer dari Gudang NILAM${note ? `: ${note}` : ""}`,
    is_correction: 0,
    transferFromId: nilamTxId,
  });
  return { estate: tujuan, qty };
}

// Undoes the Stok Masuk a Nilam Stok Keluar transferred into another gudang, if any.
async function removeTransfer(client: PoolClient, nilamTxId: number): Promise<TransferChange> {
  const g = await queryOne<any>(`DELETE FROM gudang_stock_tx WHERE transfer_from_id = @id RETURNING *`, { id: nilamTxId }, client);
  if (!g) return null;
  await execute(
    `UPDATE gudang_stock SET stock_tersedia = ROUND((stock_tersedia - @qty)::numeric, 3) WHERE gudang = @gudang AND item_kode = @item`,
    { qty: g.qty, gudang: g.gudang, item: g.item_kode },
    client
  );
  return { estate: g.gudang, qty: g.qty };
}

// Logs the receiving side of a transfer in the receiving estate's activity log.
async function logTransfer(req: express.Request, objek: string, removed: TransferChange, added: TransferChange) {
  if (removed && added && removed.estate === added.estate) {
    if (removed.qty === added.qty) return;
    await logActivity(req, { module: "BARANG", estate: added.estate, aksi: "Edit Stok Masuk", objek, detail: `Transfer: Jumlah ${removed.qty} → ${added.qty}` });
    return;
  }
  if (removed) await logActivity(req, { module: "BARANG", estate: removed.estate, aksi: "Hapus Stok Masuk", objek, detail: `Transfer dibatalkan; Jumlah: ${removed.qty}` });
  if (added) await logActivity(req, { module: "BARANG", estate: added.estate, aksi: "Stok Masuk", objek, detail: `Transfer masuk; Jumlah: ${added.qty}` });
}

app.post("/api/transactions", requireEstate("NILAM"), async (req, res) => {
  const { item_id, tujuan, type, qty, note, penerima } = req.body;

  if (!item_id || !["IN", "OUT"].includes(type) || !qty || qty <= 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const item = await queryOne<any>("SELECT * FROM items WHERE id = @id", { id: item_id });
  if (!item) return res.status(404).json({ error: "Not found" });

  let transfer: TransferChange = null;
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
    if (type === "OUT") transfer = await addTransfer(client, req, result!.id, item.kode, tujuan, qty, penerima, note);
  });

  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: type === "IN" ? "Stok Masuk" : "Stok Keluar",
    objek: `${item.kode} - ${item.nama}`,
    detail: [`Jumlah: ${qty}`, tujuan && `Tujuan: ${tujuan}`, penerima && `Penerima: ${penerima}`, note && `Catatan: ${note}`]
      .filter(Boolean)
      .join("; "),
  });
  await logTransfer(req, `${item.kode} - ${item.nama}`, null, transfer);
  res.json({ success: true });
});

app.put("/api/transactions/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM transactions WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { tujuan, type, qty, note, penerima } = req.body;
  if (!["IN", "OUT"].includes(type) || !qty || qty <= 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const item = await queryOne<any>("SELECT * FROM items WHERE id = @id", { id: existing.item_id });

  let removed: TransferChange = null;
  let added: TransferChange = null;
  await withTransaction(async (client) => {
    removed = await removeTransfer(client, existing.id);
    if (type === "OUT" && !existing.is_correction) {
      added = await addTransfer(client, req, existing.id, item.kode, tujuan, qty, penerima, note);
    }
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

  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Edit Transaksi",
    objek: `${item?.kode} - ${item?.nama}`,
    detail: describeChanges(
      existing,
      { type, qty, tujuan: tujuan || "", penerima: penerima || "", note: note || null },
      { type: "Tipe", qty: "Jumlah", tujuan: "Tujuan", penerima: "Penerima", note: "Catatan" }
    ),
  });
  await logTransfer(req, `${item?.kode} - ${item?.nama}`, removed, added);
  res.json({ success: true });
});

app.delete("/api/transactions/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM transactions WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  let removed: TransferChange = null;
  await withTransaction(async (client) => {
    removed = await removeTransfer(client, existing.id);
    await applyStockEffect(client, existing.item_id, existing.type, existing.qty, -1);
    if (!existing.is_correction) await deleteMirror(client, existing.mirror_source, existing.mirror_id);
    await execute("DELETE FROM transactions WHERE id = @id", { id: req.params.id }, client);
  });

  const item = await queryOne<any>("SELECT kode, nama FROM items WHERE id = @id", { id: existing.item_id });
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Hapus Transaksi",
    objek: `${item?.kode} - ${item?.nama}`,
    detail: `${existing.type === "IN" ? "Stok Masuk" : "Stok Keluar"} ${existing.qty}${existing.tujuan ? `; Tujuan: ${existing.tujuan}` : ""}`,
  });
  await logTransfer(req, `${item?.kode} - ${item?.nama}`, removed, null);
  res.json({ success: true });
});

// ---- Stock correction (stock opname / physical count adjustment) ----
app.post("/api/stock-correction", requireSuperuser, async (req, res) => {
  const { item_id, actual_qty, note } = req.body;

  if (!item_id || actual_qty === undefined || actual_qty < 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const item = await queryOne<any>("SELECT * FROM items WHERE id = @id", { id: item_id });
  if (!item) return res.status(404).json({ error: "Not found" });

  const delta = actual_qty - item.stock_tersedia;
  await withTransaction((client) => nilamCorrection(client, item_id, actual_qty, `Koreksi Stok (Opname)${note ? `: ${note}` : ""}`));

  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Koreksi Stok",
    objek: `${item.kode} - ${item.nama}`,
    detail: `Stock: ${item.stock_tersedia} → ${actual_qty} (selisih ${delta > 0 ? "+" : ""}${delta})${note ? `; Catatan: ${note}` : ""}`,
  });
  res.json({ success: true, delta });
});

// Sets a Nilam item's stock to the counted quantity (one correction transaction, never mirrored into
// the stock in/out logs). Returns the stock before.
async function nilamCorrection(client: PoolClient, itemId: number, actual: number, note: string) {
  const item = (await queryOne<any>("SELECT id, stock_tersedia FROM items WHERE id = @id FOR UPDATE", { id: itemId }, client))!;
  const delta = actual - item.stock_tersedia;
  if (delta !== 0) {
    const type: "IN" | "OUT" = delta > 0 ? "IN" : "OUT";
    const qty = Math.abs(delta);
    await execute(
      `INSERT INTO transactions (item_id, tujuan, type, qty, note, is_correction) VALUES (@item_id, '', @type, @qty, @note, 1)`,
      { item_id: itemId, type, qty, note },
      client
    );
    await applyStockEffect(client, itemId, type, qty, 1);
  }
  await execute(
    `UPDATE items SET stock_fisik = @stock_fisik, selisih_stock = @selisih_stock WHERE id = @id`,
    { stock_fisik: actual, selisih_stock: delta, id: itemId },
    client
  );
  return item.stock_tersedia as number;
}

app.get("/api/transactions", requireEstate("NILAM"), async (req, res) => {
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
app.get("/api/stock-in", requireEstate("NILAM"), async (req, res) => {
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

  addWordSearch(search, "", conditions, params, ["satuan", "nama_vendor", "tujuan", "divisi", "po_in_akss", "no_pr", "keterangan"]);
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

app.get("/api/stock-in/vendors", requireEstate("NILAM"), async (_req, res) => {
  const rows = await queryMany<{ nama_vendor: string }>(
    "SELECT DISTINCT nama_vendor FROM stock_in_log WHERE nama_vendor IS NOT NULL AND nama_vendor NOT IN ('', '-') ORDER BY nama_vendor"
  );
  res.json(rows.map((r) => r.nama_vendor));
});

app.put("/api/stock-in/:id", requireSuperuser, async (req, res) => {
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
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Edit Stock In",
    objek: `${existing.kode} - ${existing.nama}`,
    detail: describeChanges(
      existing,
      { nama_vendor: nama_vendor ?? "", qty: qty ?? 0, satuan: satuan ?? "", tujuan, tanggal_terima_iso: tanggal_terima_iso || null, keterangan: keterangan ?? "" },
      { nama_vendor: "Vendor", qty: "Jumlah", satuan: "Satuan", tujuan: "Tujuan", tanggal_terima_iso: "Tanggal", keterangan: "Keterangan" }
    ),
  });
  res.json({ success: true });
});

app.delete("/api/stock-in/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM stock_in_log WHERE id = @id", { id: req.params.id });
  const result = await execute("DELETE FROM stock_in_log WHERE id = @id", { id: req.params.id });
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Hapus Stock In",
    objek: `${existing?.kode} - ${existing?.nama}`,
    detail: `Jumlah: ${existing?.qty}; Tanggal: ${existing?.tanggal_terima || "-"}; Vendor: ${existing?.nama_vendor || "-"}`,
  });
  res.json({ success: true });
});

// ---- Stock Out log (history from Google Sheet) ----
app.get("/api/stock-out", requireEstate("NILAM"), async (req, res) => {
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

  addWordSearch(search, "", conditions, params, ["satuan", "penerima", "tujuan", "divisi", "req_by", "no_request", "no_embrace_gudang", "keterangan"]);
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

app.put("/api/stock-out/:id", requireSuperuser, async (req, res) => {
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
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Edit Stock Out",
    objek: `${existing.kode} - ${existing.nama}`,
    detail: describeChanges(
      existing,
      { penerima: penerima ?? "", qty: qty ?? 0, satuan: satuan ?? "", tujuan, tanggal_keluar_iso: tanggal_keluar_iso || null, keterangan: keterangan ?? "" },
      { penerima: "Penerima", qty: "Jumlah", satuan: "Satuan", tujuan: "Tujuan", tanggal_keluar_iso: "Tanggal", keterangan: "Keterangan" }
    ),
  });
  res.json({ success: true });
});

app.delete("/api/stock-out/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM stock_out_log WHERE id = @id", { id: req.params.id });
  const result = await execute("DELETE FROM stock_out_log WHERE id = @id", { id: req.params.id });
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Hapus Stock Out",
    objek: `${existing?.kode} - ${existing?.nama}`,
    detail: `Jumlah: ${existing?.qty}; Tanggal: ${existing?.tanggal_keluar || "-"}; Penerima: ${existing?.penerima || "-"}`,
  });
  res.json({ success: true });
});

// ---- Own password: any logged-in user, the current password must match ----
app.post("/api/auth/change-password", async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return res.status(422).json({ error: "Password baru minimal 6 karakter" });
  }
  const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = @id", { id: req.user!.id });
  if (!row) return res.status(404).json({ error: "Akun tidak ditemukan" });
  if (!verifyPassword(String(currentPassword ?? ""), row.password_hash)) {
    return res.status(400).json({ error: "Password lama salah" });
  }
  await execute("UPDATE users SET password_hash = @hash WHERE id = @id", { hash: hashPassword(newPassword), id: req.user!.id });
  res.json({ success: true });
});

// ---- Users (login accounts) master data ----
// users.estates / users.perms from the form's checkboxes (only kept for estate accounts).
const listValue = (v: unknown, known: readonly string[]) => (Array.isArray(v) ? known.filter((k) => v.includes(k)).join(",") : "");

app.get("/api/users", requireSuperuser, async (req, res) => {
  const { search = "", sortBy = "nama", sortDir = "asc", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;

  const validSort = ["username", "nama", "created_at"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "nama";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = [];
  const params: any = {};

  if (search) {
    conditions.push("(username ILIKE @search OR nama ILIKE @search)");
    params.search = `%${search}%`;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM users ${where}`, params))!.c;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT id, username, nama, role, estates, perms, created_at FROM users ${where} ORDER BY ${sortCol} ${dir} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

// A superuser has every estate and permission; an estate account needs at least one estate.
function userAccess(body: any): { role: "superuser" | "estate"; estates: string; perms: string; error?: string } {
  const role = body.role === "estate" ? "estate" : "superuser";
  if (role === "superuser") return { role, estates: "", perms: "" };
  const estates = listValue(body.estates, ESTATES);
  if (!estates) return { role, estates, perms: "", error: "Pilih minimal satu estate untuk akun estate" };
  return { role, estates, perms: listValue(body.perms, ALL_PERMS) };
}

app.post("/api/users", requireSuperuser, async (req, res) => {
  const { username, password, nama } = req.body;
  if (!username || !String(username).trim() || !password || !nama || !String(nama).trim()) {
    return res.status(400).json({ error: "Username, password, dan nama wajib diisi" });
  }
  const access = userAccess(req.body);
  if (access.error) return res.status(400).json({ error: access.error });
  if (access.role === "superuser" && req.user!.role !== "superuser") return res.status(403).json({ error: "Hanya Super User yang bisa membuat Super User" });

  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO users (username, password_hash, nama, role, estate, estates, perms)
       VALUES (@username, @password_hash, @nama, @role, @estate, @estates, @perms) RETURNING id`,
      {
        username: String(username).trim(),
        password_hash: hashPassword(password),
        nama: String(nama).trim(),
        role: access.role,
        estate: access.estates.split(",")[0] || null,
        estates: access.estates || null,
        perms: access.role === "estate" ? access.perms : null,
      }
    );
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Username sudah digunakan" });
    }
    throw e;
  }
});

app.put("/api/users/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM users WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { username, nama, password } = req.body;
  if (!username || !String(username).trim() || !nama || !String(nama).trim()) {
    return res.status(400).json({ error: "Username dan nama wajib diisi" });
  }
  const access = userAccess(req.body);
  if (access.error) return res.status(400).json({ error: access.error });
  // A Pengguna admin who isn't a superuser can't make or change Super User accounts.
  if ((access.role === "superuser" || existing.role === "superuser") && req.user!.role !== "superuser") {
    return res.status(403).json({ error: "Hanya Super User yang bisa mengubah akun Super User" });
  }

  try {
    await execute(
      `UPDATE users SET username = @username, nama = @nama, password_hash = @password_hash, role = @role,
         estate = @estate, estates = @estates, perms = @perms, modules = NULL WHERE id = @id`,
      {
        username: String(username).trim(),
        nama: String(nama).trim(),
        password_hash: password ? hashPassword(password) : existing.password_hash,
        role: access.role,
        estate: access.estates.split(",")[0] || null,
        estates: access.estates || null,
        perms: access.role === "estate" ? access.perms : null,
        id: req.params.id,
      }
    );
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Username sudah digunakan" });
    }
    throw e;
  }
  sessionCache.delete(Number(req.params.id));
  res.json({ success: true });
});

app.delete("/api/users/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM users WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { c: userCount } = (await queryOne<{ c: number }>("SELECT COUNT(*) c FROM users"))!;
  if (Number(userCount) <= 1) {
    return res.status(400).json({ error: "Tidak bisa menghapus satu-satunya akun yang tersisa" });
  }

  if (existing.role === "superuser" && req.user!.role !== "superuser") return res.status(403).json({ error: "Hanya Super User yang bisa menghapus Super User" });
  await execute("DELETE FROM users WHERE id = @id", { id: req.params.id });
  sessionCache.delete(Number(req.params.id));
  res.json({ success: true });
});

// ---- Karyawan master data ----
app.get("/api/karyawan/status-options", requireSuperuser, async (_req, res) => {
  const rows = await queryMany<{ status: string }>(
    "SELECT DISTINCT status FROM karyawan WHERE status IS NOT NULL AND status != '' ORDER BY status"
  );
  res.json(rows.map((r) => r.status));
});

app.get("/api/karyawan/estate-options", requireSuperuser, async (_req, res) => {
  const rows = await queryMany<{ estate: string }>(
    "SELECT DISTINCT estate FROM karyawan WHERE estate IS NOT NULL AND estate != '' ORDER BY estate"
  );
  res.json(rows.map((r) => r.estate));
});

// Penerima picker in the transaction forms: only the karyawan of the estate the transaction belongs
// to. Open to that estate's users (the full list above is superuser-only). karyawan.estate is
// stored as e.g. "Nilam", hence the case-insensitive match.
app.get("/api/karyawan/pick", async (req, res) => {
  const { estate = "", search = "" } = req.query as Record<string, string>;
  if (!(ESTATES as readonly string[]).includes(estate)) return res.status(400).json({ error: "Estate tidak valid" });
  if (!estateAllowed(req.user!, estate)) return res.status(403).json({ error: "Akses ditolak" });
  const data = await queryMany(
    `SELECT nik, nama FROM karyawan
     WHERE UPPER(estate) = @estate AND (@search = '' OR nama ILIKE @like OR nik ILIKE @like)
     ORDER BY nama LIMIT 8`,
    { estate, search, like: `%${search}%` }
  );
  res.json(data);
});

app.get("/api/karyawan", requireSuperuser, async (req, res) => {
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

app.post("/api/karyawan", requireSuperuser, async (req, res) => {
  const { nik, nama, status, estate, lokasi_kerja, nik_ktp } = req.body;
  if (!nik || !String(nik).trim() || !nama || !String(nama).trim()) {
    return res.status(400).json({ error: "NIK dan nama wajib diisi" });
  }

  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO karyawan (nik, nama, status, estate, lokasi_kerja, nik_ktp)
       VALUES (@nik, @nama, @status, @estate, @lokasi_kerja, @nik_ktp) RETURNING id`,
      {
        nik: String(nik).trim(),
        nama: String(nama).trim(),
        status: status || "",
        estate: estate || "",
        lokasi_kerja: lokasi_kerja || "",
        nik_ktp: nik_ktp || "",
      }
    );
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "NIK sudah digunakan karyawan lain" });
    }
    throw e;
  }
});

app.put("/api/karyawan/:id", requireSuperuser, async (req, res) => {
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

app.delete("/api/karyawan/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne("SELECT * FROM karyawan WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await execute("DELETE FROM karyawan WHERE id = @id", { id: req.params.id });
  res.json({ success: true });
});

// ---- Alat Berat master data (heavy equipment/vehicles that consume fuel) ----
app.get("/api/alat-berat/jenis-options", requireSuperuser, async (_req, res) => {
  const rows = await queryMany<{ jenis_unit: string }>(
    "SELECT DISTINCT jenis_unit FROM alat_berat WHERE jenis_unit IS NOT NULL AND jenis_unit != '' ORDER BY jenis_unit"
  );
  res.json(rows.map((r) => r.jenis_unit));
});

app.get("/api/alat-berat", requireSuperuser, async (req, res) => {
  const { search = "", jenis_unit = "", sortBy = "kode", sortDir = "asc", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;

  const validSort = ["kode", "jenis_unit", "nama"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = [];
  const params: any = {};

  addWordSearch(search, "", conditions, params, ["jenis_unit"]);
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

app.post("/api/alat-berat", requireSuperuser, async (req, res) => {
  const { kode, jenis_unit, nama } = req.body;
  if (!kode || !String(kode).trim()) {
    return res.status(400).json({ error: "Kode wajib diisi" });
  }

  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO alat_berat (kode, jenis_unit, nama) VALUES (@kode, @jenis_unit, @nama) RETURNING id`,
      { kode: String(kode).trim(), jenis_unit: jenis_unit || "", nama: nama || "" }
    );
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Kode sudah digunakan alat lain" });
    }
    throw e;
  }
});

app.put("/api/alat-berat/:id", requireSuperuser, async (req, res) => {
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

app.delete("/api/alat-berat/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne("SELECT * FROM alat_berat WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await execute("DELETE FROM alat_berat WHERE id = @id", { id: req.params.id });
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
  ZAMRUD: ["ZAMRUD"],
  FIRUS: ["FIRUS"],
};

app.get("/api/bbm/estate-options", async (req, res) => {
  const { lokasi = "" } = req.query as Record<string, string>;
  if (lokasi && !estateAllowed(req.user!, lokasi)) return res.status(403).json({ error: "Akses ditolak" });
  // KNS and WJA supply a fixed pair of estates, same as their gudang (see GUDANG_TUJUAN).
  if (lokasi === "KNS" || lokasi === "WJA") return res.json(GUDANG_TUJUAN[lokasi]);
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

app.get("/api/bbm/alat-options", async (req, res) => {
  const { lokasi = "" } = req.query as Record<string, string>;
  if (lokasi && !estateAllowed(req.user!, lokasi)) return res.status(403).json({ error: "Akses ditolak" });
  const conditions = ["kode_kendaraan IS NOT NULL", "TRIM(kode_kendaraan) != ''"];
  const params: any = {};
  if (lokasi && BBM_LOKASI_OPTIONS.includes(lokasi)) {
    conditions.push("lokasi = @lokasi");
    params.lokasi = lokasi;
  }
  const rows = await queryMany<{ kode_kendaraan: string }>(
    `SELECT DISTINCT kode_kendaraan FROM bbm_log WHERE ${conditions.join(" AND ")} ORDER BY kode_kendaraan`,
    params
  );
  res.json(rows.map((r) => r.kode_kendaraan));
});

app.get("/api/bbm/summary", async (req, res) => {
  const { lokasi = "" } = req.query as Record<string, string>;
  // Estate users must pass their own lokasi (the frontend always does, since every BBM page is
  // lokasi-locked); a superuser can omit it to see everything.
  if (req.user!.role !== "superuser" && (!lokasi || !estateAllowed(req.user!, lokasi))) {
    return res.status(403).json({ error: "Akses ditolak" });
  }

  const params = lokasi ? { lokasi } : {};

  // Stok masuk/keluar totals per jenis+lokasi for a date range (the page passes its date filter,
  // or the current month); saldoTerakhir below is always the latest balance regardless of range.
  const { dateFrom = "", dateTo = "" } = req.query as Record<string, string>;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const flowConditions = [lokasi && "lokasi = @lokasi", isoDate.test(dateFrom) && "tanggal_iso >= @dateFrom", isoDate.test(dateTo) && "tanggal_iso <= @dateTo"].filter(Boolean);
  const perLokasi = await queryMany(
    `SELECT jenis_bbm, lokasi, COALESCE(SUM(diterima), 0)::float8 diterima, COALESCE(SUM(pemakaian), 0)::float8 pemakaian
     FROM bbm_log ${flowConditions.length ? "WHERE " + flowConditions.join(" AND ") : ""}
     GROUP BY jenis_bbm, lokasi ORDER BY jenis_bbm, lokasi`,
    { ...params, ...(isoDate.test(dateFrom) ? { dateFrom } : {}), ...(isoDate.test(dateTo) ? { dateTo } : {}) }
  );

  // Latest known saldo (running balance) per jenis_bbm+lokasi. Several rows can share the same
  // tanggal_iso (multiple dispensing events per day), so picking "the" latest needs a real
  // tie-break (insertion order via id) - a plain GROUP BY on the max date alone doesn't guarantee
  // which same-day row's saldo_stock comes back, so a window function picks it deterministically.
  const latestSaldo = (asOf?: string) =>
    queryMany(
      `SELECT jenis_bbm, lokasi, saldo_stock, tanggal, tanggal_iso FROM (
         SELECT jenis_bbm, lokasi, saldo_stock, tanggal, tanggal_iso,
                ROW_NUMBER() OVER (PARTITION BY jenis_bbm, lokasi ORDER BY tanggal_iso DESC, id DESC) AS rn
         FROM bbm_log
         WHERE saldo_stock IS NOT NULL ${lokasi ? "AND lokasi = @lokasi" : ""} ${asOf ? "AND tanggal_iso <= @asOf" : ""}
       ) sub
       WHERE rn = 1`,
      { ...params, ...(asOf ? { asOf } : {}) }
    );

  // saldoTerakhir is always today's real balance (new transactions continue from it). saldoPerTanggal
  // is the closing balance as of the filter's end date - what the stock cards show while filtered.
  const { asOf = "" } = req.query as Record<string, string>;
  const saldoTerakhir = await latestSaldo();
  const saldoPerTanggal = isoDate.test(asOf) ? await latestSaldo(asOf) : saldoTerakhir;

  res.json({ perLokasi, saldoTerakhir, saldoPerTanggal });
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
  if (!estateAllowed(req.user!, lokasi)) return res.status(403).json({ error: "Akses ditolak" });
  if (!["DITERIMA", "PEMAKAIAN"].includes(tipe)) return res.status(400).json({ error: "Tipe transaksi tidak valid" });
  if (!jumlah || jumlah <= 0) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
  if (!tanggal_iso || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal_iso)) return res.status(400).json({ error: "Tanggal tidak valid" });
  if (!estate || !String(estate).trim()) return res.status(400).json({ error: "Estate/sub-lokasi wajib dipilih" });

  const last = await queryOne<{ saldo_stock: number }>(
    `SELECT saldo_stock FROM bbm_log WHERE jenis_bbm = @jenis_bbm AND lokasi = @lokasi AND saldo_stock IS NOT NULL
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

  await logActivity(req, {
    module: "BBM",
    estate: lokasi,
    aksi: tipe === "DITERIMA" ? "Stok Masuk" : "Stok Keluar",
    objek: `${jenis_bbm} · ${tanggal}${no_spb ? ` · SPB ${no_spb}` : ""}`,
    detail: [
      `Jumlah: ${jumlah} LTR`,
      `Saldo: ${lastSaldo} → ${saldoBaru}`,
      tipe === "PEMAKAIAN" && estate && `Estate: ${estate}`,
      kode_kendaraan && `Kendaraan: ${kode_kendaraan}`,
      hm_terakhir && `HM: ${hm_terakhir}`,
      keterangan && `Keterangan: ${keterangan}`,
    ]
      .filter(Boolean)
      .join("; "),
  });
  res.json({ success: true, id: result!.id, saldo_stock: saldoBaru });
});

app.put("/api/bbm/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM bbm_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.lokasi)) return res.status(403).json({ error: "Akses ditolak" });

  const { tanggal_iso, no_spb, diterima, pemakaian, saldo_stock, keterangan, estate, kode_kendaraan, hm_terakhir } = req.body;
  if (tanggal_iso && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal_iso)) return res.status(400).json({ error: "Tanggal tidak valid" });

  const { tanggal, periode } = tanggal_iso ? isoToIndoDate(tanggal_iso) : { tanggal: existing.tanggal, periode: existing.periode };

  const updated = {
    tanggal,
    tanggal_iso: tanggal_iso || existing.tanggal_iso,
    periode,
    no_spb: no_spb ?? "",
    diterima: diterima === "" || diterima === undefined ? null : Number(diterima),
    pemakaian: pemakaian === "" || pemakaian === undefined ? null : Number(pemakaian),
    saldo_stock: saldo_stock === "" || saldo_stock === undefined ? null : Number(saldo_stock),
    keterangan: keterangan ?? "",
    estate: estate ?? "",
    kode_kendaraan: kode_kendaraan ?? existing.kode_kendaraan ?? "",
    hm_terakhir: hm_terakhir ?? existing.hm_terakhir ?? "",
  };
  await execute(
    `UPDATE bbm_log SET
       tanggal = @tanggal, tanggal_iso = @tanggal_iso, periode = @periode, no_spb = @no_spb, diterima = @diterima, pemakaian = @pemakaian, saldo_stock = @saldo_stock,
       keterangan = @keterangan, estate = @estate, kode_kendaraan = @kode_kendaraan, hm_terakhir = @hm_terakhir
     WHERE id = @id`,
    { ...updated, id: req.params.id }
  );
  await logActivity(req, {
    module: "BBM",
    estate: existing.lokasi,
    aksi: "Edit Transaksi",
    objek: `${existing.jenis_bbm} · ${existing.tanggal}${existing.no_spb ? ` · SPB ${existing.no_spb}` : ""}`,
    detail: describeChanges(existing, updated, {
      tanggal: "Tanggal",
      no_spb: "No. SPB",
      diterima: "Stok Masuk",
      pemakaian: "Stok Keluar",
      saldo_stock: "Saldo",
      keterangan: "Keterangan",
      estate: "Estate",
      kode_kendaraan: "Kode Kendaraan",
      hm_terakhir: "HM",
    }),
  });
  res.json({ success: true });
});

app.delete("/api/bbm/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM bbm_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.lokasi)) return res.status(403).json({ error: "Akses ditolak" });

  await execute("DELETE FROM bbm_log WHERE id = @id", { id: req.params.id });
  await logActivity(req, {
    module: "BBM",
    estate: existing.lokasi,
    aksi: "Hapus Transaksi",
    objek: `${existing.jenis_bbm} · ${existing.tanggal}${existing.no_spb ? ` · SPB ${existing.no_spb}` : ""}`,
    detail: [
      existing.diterima && `Stok Masuk: ${existing.diterima}`,
      existing.pemakaian && `Stok Keluar: ${existing.pemakaian}`,
      existing.saldo_stock !== null && `Saldo: ${existing.saldo_stock}`,
      existing.keterangan && `Keterangan: ${existing.keterangan}`,
    ]
      .filter(Boolean)
      .join("; "),
  });
  res.json({ success: true });
});

// ---- Inventory Pupuk (fertiliser), see schema.sql's pupuk_log ----
// Estates with an Inventory Pupuk. KNS and WJA had no rows in the source sheet and start empty.
const PUPUK_ESTATES = ["NILAM", "ZAMRUD", "FIRUS", "KNS", "WJA"];

function pupukFilters(q: Record<string, string>) {
  const conditions = ["estate = @estate"];
  const params: any = { estate: q.estate };
  if (q.jenis_pupuk) {
    conditions.push("jenis_pupuk = @jenis_pupuk");
    params.jenis_pupuk = q.jenis_pupuk;
  }
  if (q.divisi) {
    conditions.push("divisi = @divisi");
    params.divisi = q.divisi;
  }
  wordSearch(q.search || "", ["jenis_pupuk", "divisi", "blok", "no_embrace", "kode_barang", "keterangan"], conditions, params);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.dateFrom || "")) {
    conditions.push("tanggal_iso >= @dateFrom");
    params.dateFrom = q.dateFrom;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.dateTo || "")) {
    conditions.push("tanggal_iso <= @dateTo");
    params.dateTo = q.dateTo;
  }
  return { where: "WHERE " + conditions.join(" AND "), params };
}

function checkPupukEstate(req: express.Request, res: express.Response, estate: string) {
  if (!PUPUK_ESTATES.includes(estate)) {
    res.status(400).json({ error: "Estate tidak valid" });
    return false;
  }
  if (!estateAllowed(req.user!, estate)) {
    res.status(403).json({ error: "Akses ditolak" });
    return false;
  }
  return true;
}

const latestPupukSaldo = (estate: string, asOf?: string) =>
  queryMany<{ jenis_pupuk: string; saldo_stock: number; tanggal: string }>(
    `SELECT jenis_pupuk, saldo_stock, tanggal FROM (
       SELECT jenis_pupuk, saldo_stock, tanggal,
              ROW_NUMBER() OVER (PARTITION BY jenis_pupuk ORDER BY tanggal_iso DESC, id DESC) AS rn
       FROM pupuk_log WHERE estate = @estate AND saldo_stock IS NOT NULL ${asOf ? "AND tanggal_iso <= @asOf" : ""}
     ) sub WHERE rn = 1 ORDER BY jenis_pupuk`,
    { estate, ...(asOf ? { asOf } : {}) }
  );

app.get("/api/pupuk/summary", async (req, res) => {
  const q = req.query as Record<string, string>;
  if (!checkPupukEstate(req, res, q.estate)) return;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const flow = pupukFilters({ estate: q.estate, dateFrom: q.dateFrom, dateTo: q.dateTo });
  const perJenis = await queryMany(
    `SELECT jenis_pupuk, COALESCE(SUM(diterima), 0)::float8 diterima, COALESCE(SUM(keluar), 0)::float8 keluar
     FROM pupuk_log ${flow.where} GROUP BY jenis_pupuk ORDER BY jenis_pupuk`,
    flow.params
  );
  // Same split as BBM: saldoTerakhir is today's real balance (new entries continue from it);
  // saldoPerTanggal is the balance as of the date filter's end, which the cards show.
  const saldoTerakhir = await latestPupukSaldo(q.estate);
  const saldoPerTanggal = isoDate.test(q.asOf || "") ? await latestPupukSaldo(q.estate, q.asOf) : saldoTerakhir;
  res.json({ perJenis, saldoTerakhir, saldoPerTanggal });
});

app.get("/api/pupuk/options", async (req, res) => {
  const { estate = "" } = req.query as Record<string, string>;
  if (!checkPupukEstate(req, res, estate)) return;
  const jenis = await queryMany<{ v: string }>("SELECT DISTINCT jenis_pupuk v FROM pupuk_log ORDER BY v");
  const divisi = await queryMany<{ v: string }>(
    "SELECT DISTINCT divisi v FROM pupuk_log WHERE estate = @estate AND divisi <> '' ORDER BY v",
    { estate }
  );
  // An estate with no pupuk history yet (KNS/WJA) is offered the divisi names used elsewhere.
  const divisiList = divisi.length
    ? divisi
    : await queryMany<{ v: string }>("SELECT DISTINCT divisi v FROM pupuk_log WHERE divisi <> '' ORDER BY v");
  res.json({ jenis: jenis.map((r) => r.v), divisi: divisiList.map((r) => r.v) });
});

app.get("/api/pupuk", async (req, res) => {
  const q = req.query as Record<string, string>;
  if (!checkPupukEstate(req, res, q.estate)) return;
  const { where, params } = pupukFilters(q);
  const totals = (await queryOne<any>(
    `SELECT COUNT(*)::int c, COALESCE(SUM(keluar), 0)::float8 keluar, COALESCE(SUM(diterima), 0)::float8 diterima FROM pupuk_log ${where}`,
    params
  ))!;
  const limit = Math.min(parseInt(q.pageSize) || 50, 500);
  const offset = (Math.max(parseInt(q.page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT * FROM pupuk_log ${where} ORDER BY tanggal_iso DESC, id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total: totals.c, keluarSum: totals.keluar, diterimaSum: totals.diterima, page: parseInt(q.page) || 1, pageSize: limit });
});

const pupukObjek = (r: { jenis_pupuk: string; tanggal: string; blok?: string | null }) =>
  `${r.jenis_pupuk} · ${r.tanggal}${r.blok ? ` · Blok ${r.blok}` : ""}`;

const optNum = (v: any) => (v === "" || v === undefined || v === null ? null : Number(v));

app.post("/api/pupuk", async (req, res) => {
  const { estate, jenis_pupuk, tanggal_iso, tipe, jumlah, divisi, no_embrace, kode_barang, keterangan, blok, ha, pokok } = req.body;
  if (!checkPupukEstate(req, res, estate)) return;
  if (!jenis_pupuk || !String(jenis_pupuk).trim()) return res.status(400).json({ error: "Jenis pupuk wajib diisi" });
  if (!["MASUK", "KELUAR"].includes(tipe)) return res.status(400).json({ error: "Tipe transaksi tidak valid" });
  if (!jumlah || Number(jumlah) <= 0) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal_iso || "")) return res.status(400).json({ error: "Tanggal tidak valid" });

  const jenis = String(jenis_pupuk).trim().toUpperCase();
  const last = await queryOne<{ saldo_stock: number }>(
    `SELECT saldo_stock FROM pupuk_log WHERE estate = @estate AND jenis_pupuk = @jenis AND saldo_stock IS NOT NULL
     ORDER BY tanggal_iso DESC, id DESC LIMIT 1`,
    { estate, jenis }
  );
  const lastSaldo = last?.saldo_stock ?? 0;
  const qty = Number(jumlah);
  const saldoBaru = tipe === "MASUK" ? lastSaldo + qty : lastSaldo - qty;
  const [y, m, d] = tanggal_iso.split("-");
  const tanggal = `${d}/${m}/${y}`;
  const periode = `${INDO_MONTHS[Number(m) - 1]} ${y}`;

  const row = await queryOne<{ id: number }>(
    `INSERT INTO pupuk_log (estate, jenis_pupuk, periode, tanggal, tanggal_iso, divisi, no_embrace, kode_barang, keluar, diterima, saldo_stock, keterangan, blok, ha, pokok)
     VALUES (@estate, @jenis, @periode, @tanggal, @tanggal_iso, @divisi, @no_embrace, @kode_barang, @keluar, @diterima, @saldo, @keterangan, @blok, @ha, @pokok)
     RETURNING id`,
    {
      estate,
      jenis,
      periode,
      tanggal,
      tanggal_iso,
      divisi: divisi || "",
      no_embrace: no_embrace || "",
      kode_barang: kode_barang || "",
      keluar: tipe === "KELUAR" ? qty : null,
      diterima: tipe === "MASUK" ? qty : null,
      saldo: saldoBaru,
      keterangan: keterangan || (tipe === "MASUK" ? "PUPUK MASUK" : ""),
      blok: blok || "",
      ha: optNum(ha),
      pokok: optNum(pokok),
    }
  );
  await logActivity(req, {
    module: "PUPUK",
    estate,
    aksi: tipe === "MASUK" ? "Stok Masuk" : "Stok Keluar",
    objek: pupukObjek({ jenis_pupuk: jenis, tanggal, blok }),
    detail: [`Jumlah: ${qty} KG`, `Saldo: ${lastSaldo} → ${saldoBaru}`, divisi && `Divisi: ${divisi}`, keterangan && `Keterangan: ${keterangan}`]
      .filter(Boolean)
      .join("; "),
  });
  res.json({ success: true, id: row!.id, saldo_stock: saldoBaru });
});

app.put("/api/pupuk/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM pupuk_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  const b = req.body;
  if (b.tanggal_iso && !/^\d{4}-\d{2}-\d{2}$/.test(b.tanggal_iso)) return res.status(400).json({ error: "Tanggal tidak valid" });

  const iso = b.tanggal_iso || existing.tanggal_iso;
  const [y, m, d] = String(iso).split("-");
  const updated = {
    tanggal_iso: iso,
    tanggal: `${d}/${m}/${y}`,
    periode: `${INDO_MONTHS[Number(m) - 1]} ${y}`,
    divisi: b.divisi ?? existing.divisi ?? "",
    no_embrace: b.no_embrace ?? existing.no_embrace ?? "",
    kode_barang: b.kode_barang ?? existing.kode_barang ?? "",
    keluar: b.keluar === undefined ? existing.keluar : optNum(b.keluar),
    diterima: b.diterima === undefined ? existing.diterima : optNum(b.diterima),
    saldo_stock: b.saldo_stock === undefined ? existing.saldo_stock : optNum(b.saldo_stock),
    keterangan: b.keterangan ?? existing.keterangan ?? "",
    blok: b.blok ?? existing.blok ?? "",
    ha: b.ha === undefined ? existing.ha : optNum(b.ha),
    pokok: b.pokok === undefined ? existing.pokok : optNum(b.pokok),
  };
  await execute(
    `UPDATE pupuk_log SET tanggal_iso = @tanggal_iso, tanggal = @tanggal, periode = @periode, divisi = @divisi, no_embrace = @no_embrace,
       kode_barang = @kode_barang, keluar = @keluar, diterima = @diterima, saldo_stock = @saldo_stock, keterangan = @keterangan,
       blok = @blok, ha = @ha, pokok = @pokok
     WHERE id = @id`,
    { ...updated, id: req.params.id }
  );
  await logActivity(req, {
    module: "PUPUK",
    estate: existing.estate,
    aksi: "Edit Transaksi",
    objek: pupukObjek(existing),
    detail: describeChanges(existing, updated, {
      tanggal: "Tanggal",
      divisi: "Divisi",
      no_embrace: "No. Embrace",
      kode_barang: "Kode Barang",
      diterima: "Stok Masuk",
      keluar: "Stok Keluar",
      saldo_stock: "Saldo Stok",
      keterangan: "Keterangan",
      blok: "Blok",
      ha: "HA",
      pokok: "Pokok",
    }),
  });
  res.json({ success: true });
});

app.delete("/api/pupuk/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM pupuk_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  await execute("DELETE FROM pupuk_log WHERE id = @id", { id: req.params.id });
  await logActivity(req, {
    module: "PUPUK",
    estate: existing.estate,
    aksi: "Hapus Transaksi",
    objek: pupukObjek(existing),
    detail: [
      existing.diterima && `Stok Masuk: ${existing.diterima}`,
      existing.keluar && `Stok Keluar: ${existing.keluar}`,
      existing.saldo_stock !== null && `Saldo Stok: ${existing.saldo_stock}`,
      existing.keterangan && `Keterangan: ${existing.keterangan}`,
    ]
      .filter(Boolean)
      .join("; "),
  });
  res.json({ success: true });
});

// ---- Master obat (medicines/medical supplies for the clinics) ----
const OBAT_FIELDS = ["kode", "nama", "kategori", "jenis", "deskripsi", "satuan"] as const;
const obatPayload = (body: any) =>
  Object.fromEntries(OBAT_FIELDS.map((f) => [f, String(body[f] ?? "").replace(/\s+/g, " ").trim()])) as Record<(typeof OBAT_FIELDS)[number], string>;

app.get("/api/obat/options", requireSuperuser, async (_req, res) => {
  const kategori = await queryMany<{ v: string }>("SELECT DISTINCT kategori v FROM obat WHERE kategori <> '' ORDER BY 1");
  const satuan = await queryMany<{ v: string }>("SELECT DISTINCT satuan v FROM obat WHERE satuan <> '' ORDER BY 1");
  res.json({ kategori: kategori.map((r) => r.v), satuan: satuan.map((r) => r.v) });
});

app.get("/api/obat", requireSuperuser, async (req, res) => {
  const { search = "", kategori = "", satuan = "", sortBy = "kode", sortDir = "asc", page = "1", pageSize = "50" } = req.query as Record<string, string>;
  const sortCol = ["kode", "nama", "kategori", "jenis", "satuan"].includes(sortBy) ? sortBy : "kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";
  const conditions: string[] = [];
  const params: any = {};
  addWordSearch(search, "", conditions, params, OBAT_SEARCH);
  if (kategori) {
    conditions.push("kategori = @kategori");
    params.kategori = kategori;
  }
  if (satuan) {
    conditions.push("satuan = @satuan");
    params.satuan = satuan;
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM obat ${where}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(`SELECT * FROM obat ${where} ORDER BY ${sortCol} ${dir}, kode LIMIT @limit OFFSET @offset`, { ...params, limit, offset });
  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

app.post("/api/obat", requireSuperuser, async (req, res) => {
  const o = obatPayload(req.body);
  if (!o.kode || !o.nama) return res.status(400).json({ error: "Kode dan nama wajib diisi" });
  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO obat (kode, nama, kategori, jenis, deskripsi, satuan) VALUES (@kode, @nama, @kategori, @jenis, @deskripsi, @satuan) RETURNING id`,
      o
    );
    await logActivity(req, { module: "KLINIK", estate: null, aksi: "Tambah Obat", objek: `${o.kode} - ${o.nama}`, detail: `Kategori: ${o.kategori || "-"}; Satuan: ${o.satuan || "-"}` });
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Kode sudah digunakan obat lain" });
    throw e;
  }
});

app.put("/api/obat/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM obat WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const o = obatPayload(req.body);
  if (!o.kode || !o.nama) return res.status(400).json({ error: "Kode dan nama wajib diisi" });
  try {
    await execute(
      "UPDATE obat SET kode = @kode, nama = @nama, kategori = @kategori, jenis = @jenis, deskripsi = @deskripsi, satuan = @satuan WHERE id = @id",
      { ...o, id: req.params.id }
    );
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Kode sudah digunakan obat lain" });
    throw e;
  }
  await logActivity(req, {
    module: "KLINIK",
    estate: null,
    aksi: "Edit Obat",
    objek: `${o.kode} - ${o.nama}`,
    detail: describeChanges(existing, o, { kode: "Kode", nama: "Nama", kategori: "Kategori", jenis: "Jenis", deskripsi: "Deskripsi", satuan: "Satuan" }),
  });
  res.json({ success: true });
});

app.delete("/api/obat/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM obat WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  try {
    await execute("DELETE FROM obat WHERE id = @id", { id: req.params.id });
  } catch (e: any) {
    // Still held in a clinic's stock or its history.
    if (e.code === "23503") return res.status(409).json({ error: "Obat ini masih ada di stok/riwayat klinik" });
    throw e;
  }
  await logActivity(req, { module: "KLINIK", estate: null, aksi: "Hapus Obat", objek: `${existing.kode} - ${existing.nama}` });
  res.json({ success: true });
});

// ---- Inventory Klinik per estate ----
const KLINIK_OPTIONS = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];

// Days before expiry that count as "segera expired" on the Klinik page.
const EXPIRY_WARNING_DAYS = 30;

function checkKlinik(req: express.Request, res: express.Response, klinik: string) {
  if (!KLINIK_OPTIONS.includes(klinik)) {
    res.status(400).json({ error: "Klinik tidak valid" });
    return false;
  }
  if (!estateAllowed(req.user!, klinik)) {
    res.status(403).json({ error: "Akses ditolak" });
    return false;
  }
  return true;
}

// expired_date is stored as YYYY-MM-DD text, so it compares with CURRENT_DATE via ::date.
const EXPIRING_SQL = `(ks.expired_date IS NOT NULL AND ks.expired_date <> '' AND ks.expired_date::date <= CURRENT_DATE + ${EXPIRY_WARNING_DAYS})`;

// ---- Klinik batches (see schema.sql klinik_batch) ----
type Alloc = { exp: string; qty: number }; // exp '' = batch without expiry date
class StockError extends Error {}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const expText = (exp: string) => (exp ? exp.split("-").reverse().join("/") : "tanpa tanggal");
// Tujuan of a Stock Out that throws expired obat away; it is left out of Top Barang Keluar.
const TUJUAN_DIBUANG = "DIBUANG";

async function addToBatch(client: PoolClient, klinik: string, obat: string, exp: string, qty: number) {
  await execute(
    `INSERT INTO klinik_batch (klinik, obat_kode, expired_date, qty) VALUES (@klinik, @obat, @exp, @qty)
     ON CONFLICT (klinik, obat_kode, expired_date) DO UPDATE SET qty = klinik_batch.qty + EXCLUDED.qty`,
    { klinik, obat, exp, qty },
    client
  );
}

// Takes qty from one batch (exp given) or from the batches that expire first (FEFO, undated last).
async function takeFromBatches(client: PoolClient, klinik: string, obat: string, qty: number, exp?: string): Promise<Alloc[]> {
  const rows = await queryMany<{ id: number; expired_date: string; qty: number }>(
    `SELECT id, expired_date, qty FROM klinik_batch
     WHERE klinik = @klinik AND obat_kode = @obat AND qty > 0 ${exp !== undefined ? "AND expired_date = @exp" : ""}
     ORDER BY expired_date = '', expired_date, id FOR UPDATE`,
    { klinik, obat, exp: exp ?? "" },
    client
  );
  const available = rows.reduce((s, r) => s + r.qty, 0);
  if (available < qty) {
    throw new StockError(exp !== undefined ? `Stok batch expired ${expText(exp)} hanya ${available}` : `Stock tersedia hanya ${available}`);
  }
  const alloc: Alloc[] = [];
  let left = qty;
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(r.qty, left);
    left -= take;
    alloc.push({ exp: r.expired_date, qty: take });
    await execute("UPDATE klinik_batch SET qty = qty - @take WHERE id = @id", { take, id: r.id }, client);
  }
  await execute("DELETE FROM klinik_batch WHERE klinik = @klinik AND obat_kode = @obat AND qty <= 0", { klinik, obat }, client);
  return alloc;
}

// klinik_stock totals follow the batches.
async function syncKlinikStock(client: PoolClient, klinik: string, obat: string) {
  await execute(
    `INSERT INTO klinik_stock (klinik, obat_kode, buffer_stock, stock_tersedia) VALUES (@klinik, @obat, 0, 0)
     ON CONFLICT (klinik, obat_kode) DO NOTHING`,
    { klinik, obat },
    client
  );
  await execute(
    `UPDATE klinik_stock SET
       stock_tersedia = COALESCE((SELECT SUM(qty) FROM klinik_batch b WHERE b.klinik = @klinik AND b.obat_kode = @obat), 0),
       expired_date = (SELECT MIN(NULLIF(expired_date, '')) FROM klinik_batch b WHERE b.klinik = @klinik AND b.obat_kode = @obat AND b.qty > 0)
     WHERE klinik = @klinik AND obat_kode = @obat`,
    { klinik, obat },
    client
  );
}

// Applies one movement to the batches: IN adds to the batch of `exp`, OUT takes from `exp` or FEFO.
async function klinikApply(client: PoolClient, klinik: string, obat: string, type: "IN" | "OUT", qty: number, exp?: string): Promise<Alloc[]> {
  if (type === "IN") {
    await addToBatch(client, klinik, obat, exp ?? "", qty);
    return [{ exp: exp ?? "", qty }];
  }
  return takeFromBatches(client, klinik, obat, qty, exp);
}

// Undoes a stored movement on the batches it touched. A Stock In can only be undone while its batch
// still holds that stock - once part of it went out, the Stock Out has to be changed first (or a
// Koreksi used), otherwise the batches would no longer match what really happened. Rows from before
// batches (no alloc) use the nearest batch.
async function klinikReverse(client: PoolClient, tx: any) {
  const alloc: Alloc[] | null = tx.alloc;
  if (tx.type === "OUT") {
    const fallback = alloc
      ? ""
      : ((await queryOne<{ e: string }>(
          "SELECT expired_date e FROM klinik_batch WHERE klinik = @k AND obat_kode = @o ORDER BY expired_date = '', expired_date LIMIT 1",
          { k: tx.klinik, o: tx.obat_kode },
          client
        ))?.e ?? "");
    for (const a of alloc ?? [{ exp: fallback, qty: tx.qty }]) await addToBatch(client, tx.klinik, tx.obat_kode, a.exp, a.qty);
    return;
  }
  try {
    if (alloc) for (const a of alloc) await takeFromBatches(client, tx.klinik, tx.obat_kode, a.qty, a.exp);
    else await takeFromBatches(client, tx.klinik, tx.obat_kode, tx.qty);
  } catch (e) {
    if (e instanceof StockError) {
      throw new StockError("Stok dari transaksi ini sudah terpakai. Ubah/hapus dulu stok keluarnya, atau pakai Koreksi Stok per batch.");
    }
    throw e;
  }
}

// One Klinik Stock In / Out: batches, history row (with its alloc) and totals in one transaction.
async function recordKlinikMove(
  req: express.Request,
  m: { klinik: string; obat: string; type: "IN" | "OUT"; qty: number; exp?: string; tujuan: string; penerima: string; note: string | null; is_correction: number }
): Promise<string | null> {
  try {
    await withTransaction((client) => klinikMoveTx(client, req, m));
    return null;
  } catch (e) {
    if (e instanceof StockError) return e.message;
    throw e;
  }
}

type KlinikMove = Parameters<typeof recordKlinikMove>[1];
async function klinikMoveTx(client: PoolClient, req: express.Request, m: KlinikMove) {
  const alloc = await klinikApply(client, m.klinik, m.obat, m.type, m.qty, m.exp);
  await execute(
    `INSERT INTO klinik_stock_tx (klinik, obat_kode, type, qty, tujuan, penerima, note, is_correction, user_id, alloc)
     VALUES (@klinik, @obat, @type, @qty, @tujuan, @penerima, @note, @is_correction, @user_id, @alloc::jsonb)`,
    { ...m, user_id: req.user!.id, alloc: JSON.stringify(alloc) },
    client
  );
  await syncKlinikStock(client, m.klinik, m.obat);
}

app.get("/api/klinik-stock/summary", async (req, res) => {
  const { klinik = "" } = req.query as Record<string, string>;
  if (!checkKlinik(req, res, klinik)) return;
  const row = await queryOne<any>(
    `SELECT COUNT(*)::int "totalItems", COALESCE(SUM(stock_tersedia), 0)::int "totalStock",
       COUNT(*) FILTER (WHERE stock_tersedia <= buffer_stock AND buffer_stock > 0)::int "lowStock",
       COUNT(*) FILTER (WHERE stock_tersedia <= 0)::int "outOfStock",
       COUNT(*) FILTER (WHERE ${EXPIRING_SQL})::int "expiring"
     FROM klinik_stock ks WHERE klinik = @klinik`,
    { klinik }
  );
  res.json(row);
});

app.get("/api/klinik-stock", async (req, res) => {
  const { klinik = "", search = "", kategori = "", status = "", stock = "", sortBy = "kode", sortDir = "asc", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;
  if (!checkKlinik(req, res, klinik)) return;

  const sortCols: Record<string, string> = {
    kode: "o.kode",
    nama: "o.nama",
    kategori: "o.kategori",
    jenis: "o.jenis",
    stock_tersedia: "ks.stock_tersedia",
    buffer_stock: "ks.buffer_stock",
    expired_date: "NULLIF(ks.expired_date, '')",
  };
  const sortCol = sortCols[sortBy] ?? "o.kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions = ["ks.klinik = @klinik"];
  const params: any = { klinik };
  addWordSearch(search, "o.", conditions, params, OBAT_SEARCH);
  if (kategori) {
    conditions.push("o.kategori = @kategori");
    params.kategori = kategori;
  }
  if (status === "AMAN") conditions.push("ks.stock_tersedia > 0");
  else if (status === "BUFFER STOCK") conditions.push("ks.stock_tersedia <= 0");
  if (stock === "menipis") conditions.push("ks.stock_tersedia <= ks.buffer_stock AND ks.buffer_stock > 0");
  if (stock === "habis") conditions.push("ks.stock_tersedia <= 0");
  if (stock === "expired") conditions.push(EXPIRING_SQL);

  const joinSql = `FROM klinik_stock ks JOIN obat o ON o.kode = ks.obat_kode WHERE ${conditions.join(" AND ")}`;
  const total = (await queryOne<any>(`SELECT COUNT(*) c ${joinSql}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT ks.id, o.id obat_id, o.kode, o.nama, o.kategori, o.jenis, o.deskripsi, o.satuan, ks.buffer_stock, ks.stock_tersedia,
            ks.expired_date, ks.catatan,
            CASE WHEN ks.stock_tersedia > 0 THEN 'AMAN' ELSE 'BUFFER STOCK' END AS keterangan,
            COALESCE((SELECT json_agg(json_build_object('id', b.id, 'expired_date', b.expired_date, 'qty', b.qty)
                                      ORDER BY b.expired_date = '', b.expired_date)
                      FROM klinik_batch b WHERE b.klinik = ks.klinik AND b.obat_kode = ks.obat_kode AND b.qty > 0), '[]') AS batches
     ${joinSql} ORDER BY ${sortCol} ${dir} NULLS LAST, o.kode LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  const kategoriOptions = (await queryMany<{ v: string }>("SELECT DISTINCT kategori v FROM obat WHERE kategori <> '' ORDER BY 1")).map((r) => r.v);
  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit, kategoriOptions });
});

// Picker list for the transaction form: every obat with its stock in this clinic (0 if not held yet).
app.get("/api/klinik-stock/pick", async (req, res) => {
  const { klinik = "", search = "", page = "1", pageSize = "50" } = req.query as Record<string, string>;
  if (!checkKlinik(req, res, klinik)) return;
  const conditions: string[] = [];
  const params: any = { klinik };
  addWordSearch(search, "o.", conditions, params, OBAT_SEARCH);
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const joinSql = `FROM obat o LEFT JOIN klinik_stock ks ON ks.obat_kode = o.kode AND ks.klinik = @klinik ${where}`;
  const total = (await queryOne<any>(`SELECT COUNT(*) c ${joinSql}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT o.id, o.kode, o.nama, o.satuan, COALESCE(ks.buffer_stock, 0) buffer_stock, COALESCE(ks.stock_tersedia, 0) stock_tersedia,
            CASE WHEN COALESCE(ks.stock_tersedia, 0) > 0 THEN 'AMAN' ELSE 'BUFFER STOCK' END AS keterangan
     ${joinSql} ORDER BY o.kode LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

// Stock In: `expired_date` = the batch ('' / absent = no expiry). Stock Out: `expired_date` picks a
// batch, absent = FEFO; tujuan "DIBUANG" = expired obat thrown away.
app.post("/api/klinik-stock/transactions", async (req, res) => {
  const { klinik, obat_kode, type, qty, tujuan, penerima, note, expired_date } = req.body;
  if (!checkKlinik(req, res, klinik)) return;
  if (!["IN", "OUT"].includes(type) || !Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Invalid payload" });
  if (expired_date && !ISO_DATE.test(expired_date)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
  const obat = await queryOne<any>("SELECT kode, nama FROM obat WHERE kode = @obat_kode", { obat_kode });
  if (!obat) return res.status(404).json({ error: "Obat tidak ditemukan di master data" });

  const exp = type === "IN" ? expired_date || "" : typeof expired_date === "string" ? expired_date : undefined;
  const err = await recordKlinikMove(req, {
    klinik,
    obat: obat_kode,
    type,
    qty,
    exp,
    tujuan: type === "OUT" && tujuan === TUJUAN_DIBUANG ? TUJUAN_DIBUANG : "",
    penerima: penerima || "",
    note: note || null,
    is_correction: 0,
  });
  if (err) return res.status(400).json({ error: err });

  await logActivity(req, {
    module: "KLINIK",
    estate: klinik,
    aksi: type === "IN" ? "Stok Masuk" : tujuan === TUJUAN_DIBUANG ? "Buang Obat Expired" : "Stok Keluar",
    objek: `${obat.kode} - ${obat.nama}`,
    detail: [movementDetail(qty, undefined, penerima, note), exp !== undefined && `Batch expired: ${expText(exp)}`].filter(Boolean).join("; "),
  });
  res.json({ success: true });
});

// Batches of one obat in one clinic (for the transaction form).
app.get("/api/klinik-stock/batches", async (req, res) => {
  const { klinik = "", obat_kode = "" } = req.query as Record<string, string>;
  if (!checkKlinik(req, res, klinik)) return;
  const rows = await queryMany(
    `SELECT id, expired_date, qty FROM klinik_batch WHERE klinik = @klinik AND obat_kode = @obat_kode AND qty > 0
     ORDER BY expired_date = '', expired_date`,
    { klinik, obat_kode }
  );
  res.json(rows);
});

// Fix a batch's expiry date (typo); a batch that ends up on an existing date is merged into it.
app.put("/api/klinik-stock/batch/:id", requireSuperuser, async (req, res) => {
  const batch = await queryOne<any>("SELECT * FROM klinik_batch WHERE id = @id", { id: req.params.id });
  if (!batch) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, batch.klinik)) return res.status(403).json({ error: "Akses ditolak" });
  const exp = String(req.body.expired_date ?? "");
  if (exp && !ISO_DATE.test(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
  if (exp === batch.expired_date) return res.json({ success: true });
  await withTransaction(async (client) => {
    await execute("DELETE FROM klinik_batch WHERE id = @id", { id: batch.id }, client);
    await addToBatch(client, batch.klinik, batch.obat_kode, exp, batch.qty);
    await syncKlinikStock(client, batch.klinik, batch.obat_kode);
  });
  const obat = await queryOne<any>("SELECT nama FROM obat WHERE kode = @k", { k: batch.obat_kode });
  await logActivity(req, {
    module: "KLINIK",
    estate: batch.klinik,
    aksi: "Edit Batch",
    objek: `${batch.obat_kode} - ${obat?.nama ?? ""}`,
    detail: `Expired: ${expText(batch.expired_date)} → ${expText(exp)}; Jumlah: ${batch.qty}`,
  });
  res.json({ success: true });
});

// Koreksi (stock opname) counts one batch: `expired_date` names it ('' = no expiry; a date that has
// no batch yet adds one).
app.post("/api/klinik-stock/correction", requireSuperuser, async (req, res) => {
  const { klinik, obat_kode, actual_qty, note } = req.body;
  const exp = String(req.body.expired_date ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  if (!Number.isInteger(actual_qty) || actual_qty < 0) return res.status(400).json({ error: "Invalid payload" });
  if (exp && !ISO_DATE.test(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
  const obat = await queryOne<any>("SELECT kode, nama FROM obat WHERE kode = @obat_kode", { obat_kode });
  if (!obat) return res.status(404).json({ error: "Obat tidak ditemukan di master data" });

  const before =
    (await queryOne<{ q: number }>("SELECT qty q FROM klinik_batch WHERE klinik = @klinik AND obat_kode = @obat_kode AND expired_date = @exp", {
      klinik,
      obat_kode,
      exp,
    }))?.q ?? 0;
  const delta = actual_qty - before;
  if (delta !== 0) {
    const err = await recordKlinikMove(req, {
      klinik,
      obat: obat_kode,
      type: delta > 0 ? "IN" : "OUT",
      qty: Math.abs(delta),
      exp,
      tujuan: "",
      penerima: "",
      note: `Koreksi Stok (Opname) batch ${expText(exp)}${note ? `: ${note}` : ""}`,
      is_correction: 1,
    });
    if (err) return res.status(400).json({ error: err });
  }
  await logActivity(req, {
    module: "KLINIK",
    estate: klinik,
    aksi: "Koreksi Stok",
    objek: `${obat.kode} - ${obat.nama}`,
    detail: `Batch ${expText(exp)}: ${before} → ${actual_qty} (selisih ${delta > 0 ? "+" : ""}${delta})${note ? `; Catatan: ${note}` : ""}`,
  });
  res.json({ success: true, delta });
});

// Buffer and note of one clinic stock row. The quantity only changes through Stock In/Out/Koreksi
// (so every change has a history row) and expiry dates live on the batches (PUT batch/:id).
app.put("/api/klinik-stock/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM klinik_stock WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.klinik)) return res.status(403).json({ error: "Akses ditolak" });
  const { buffer_stock, catatan } = req.body;
  const next = { buffer_stock: Number(buffer_stock) || 0, catatan: String(catatan ?? "").trim() };
  await execute("UPDATE klinik_stock SET buffer_stock = @buffer_stock, catatan = @catatan WHERE id = @id", {
    ...next,
    id: req.params.id,
  });
  const obat = await queryOne<any>("SELECT nama FROM obat WHERE kode = @k", { k: existing.obat_kode });
  await logActivity(req, {
    module: "KLINIK",
    estate: existing.klinik,
    aksi: "Edit Stok",
    objek: `${existing.obat_kode} - ${obat?.nama ?? ""}`,
    detail: describeChanges(existing, next, { buffer_stock: "Buffer", catatan: "Catatan" }),
  });
  res.json({ success: true });
});

app.delete("/api/klinik-stock/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM klinik_stock WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.klinik)) return res.status(403).json({ error: "Akses ditolak" });
  await withTransaction(async (client) => {
    await execute("DELETE FROM klinik_batch WHERE klinik = @k AND obat_kode = @o", { k: existing.klinik, o: existing.obat_kode }, client);
    await execute("DELETE FROM klinik_stock WHERE id = @id", { id: req.params.id }, client);
  });
  const obat = await queryOne<any>("SELECT nama FROM obat WHERE kode = @k", { k: existing.obat_kode });
  await logActivity(req, {
    module: "KLINIK",
    estate: existing.klinik,
    aksi: "Hapus Item",
    objek: `${existing.obat_kode} - ${obat?.nama ?? ""}`,
    detail: `Stock Tersedia: ${existing.stock_tersedia}`,
  });
  res.json({ success: true });
});

// ---- Stock In / Stock Out history of a gudang (KNS/WJA/Zamrud/Firus) or klinik ----
// One set of handlers for both ledgers; `master` is the table holding the item names.
type LedgerRoute = { path: string; ledger: StockLedger; master: string; options: string[]; module: LogModule };
const LEDGER_ROUTES: LedgerRoute[] = [
  { path: "gudang-stock", ledger: GUDANG_LEDGER, master: "items", options: GUDANG_STOCK_OPTIONS, module: "BARANG" },
  { path: "klinik-stock", ledger: KLINIK_LEDGER, master: "obat", options: KLINIK_OPTIONS, module: "KLINIK" },
];

for (const lr of LEDGER_ROUTES) {
  const { ledger: l, master } = lr;

  app.get(`/api/${lr.path}/history`, async (req, res) => {
    const { scope = "", type = "", search = "", dateFrom = "", dateTo = "", tz = "", page = "1", pageSize = "50" } = req.query as Record<string, string>;
    if (!lr.options.includes(scope)) return res.status(400).json({ error: "Lokasi tidak valid" });
    if (!estateAllowed(req.user!, scope)) return res.status(403).json({ error: "Akses ditolak" });
    if (!["IN", "OUT"].includes(type)) return res.status(400).json({ error: "Tipe tidak valid" });

    const conditions = [`t.${l.scope} = @scope`, "t.type = @type"];
    const params: any = { scope, type, tz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : "Asia/Jakarta" };
    addWordSearch(search, "m.", conditions, params, [...(master === "obat" ? OBAT_SEARCH : ["satuan"]), "t.penerima", "t.tujuan", "t.note"]);
    if (dateFrom) {
      conditions.push("(t.created_at AT TIME ZONE @tz)::date >= @dateFrom::date");
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      conditions.push("(t.created_at AT TIME ZONE @tz)::date <= @dateTo::date");
      params.dateTo = dateTo;
    }
    const fromSql = `FROM ${l.tx} t JOIN ${master} m ON m.kode = t.${l.item} LEFT JOIN users u ON u.id = t.user_id WHERE ${conditions.join(" AND ")}`;
    const agg = (await queryOne<any>(`SELECT COUNT(*)::int c, COALESCE(SUM(t.qty), 0)::int q ${fromSql}`, params))!;
    const limit = Math.min(parseInt(pageSize) || 50, 500);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
    const data = await queryMany(
      `SELECT t.id, t.created_at, t.type, t.qty, t.tujuan, t.penerima, t.note, t.is_correction,
              ${l === GUDANG_LEDGER ? "t.transfer_from_id IS NOT NULL" : "false"} AS is_transfer,
              ${l === KLINIK_LEDGER ? "t.alloc" : "NULL"} AS alloc,
              m.kode, m.nama, m.satuan, COALESCE(u.nama, u.username, '') AS input_oleh
       ${fromSql} ORDER BY t.created_at DESC, t.id DESC LIMIT @limit OFFSET @offset`,
      { ...params, limit, offset }
    );
    res.json({ data, total: agg.c, qtySum: agg.q, page: parseInt(page), pageSize: limit });
  });

  // Edit a movement's qty/tujuan/penerima/note; the stock is adjusted by the qty difference.
  app.put(`/api/${lr.path}/history/:id`, requireSuperuser, async (req, res) => {
    const existing = await queryOne<any>(`SELECT * FROM ${l.tx} WHERE id = @id`, { id: req.params.id });
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.transfer_from_id) return res.status(400).json({ error: TRANSFER_LOCKED });
    const { qty, tujuan, penerima, note } = req.body;
    if (!validQty(l, qty) || qty <= 0) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
    // An older row keeps the tujuan it already had.
    if (l === GUDANG_LEDGER && tujuan && !GUDANG_TUJUAN[existing.gudang].includes(tujuan) && tujuan !== existing.tujuan) {
      return res.status(400).json({ error: `Gudang ${existing.gudang} hanya bisa menyuplai ${GUDANG_TUJUAN[existing.gudang].join(", ")}` });
    }

    if (l === KLINIK_LEDGER) {
      // Klinik: undo the old movement on its batches and apply the new qty (IN: its batch, or a new
      // expiry date; OUT: FEFO again; Koreksi: the same batch).
      const exp: string | undefined =
        existing.type === "IN" || existing.is_correction
          ? typeof req.body.expired_date === "string" && existing.type === "IN"
            ? req.body.expired_date
            : existing.alloc?.[0]?.exp ?? ""
          : undefined;
      if (exp && !ISO_DATE.test(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
      try {
        await withTransaction(async (client) => {
          await klinikReverse(client, existing);
          const alloc = await klinikApply(client, existing.klinik, existing.obat_kode, existing.type, qty, exp);
          await execute(
            `UPDATE klinik_stock_tx SET qty = @qty, penerima = @penerima, note = @note, alloc = @alloc::jsonb WHERE id = @id`,
            { qty, penerima: penerima ?? "", note: note || null, alloc: JSON.stringify(alloc), id: existing.id },
            client
          );
          await syncKlinikStock(client, existing.klinik, existing.obat_kode);
        });
      } catch (e) {
        if (e instanceof StockError) return res.status(400).json({ error: e.message });
        throw e;
      }
    } else {
    const sign = existing.type === "IN" ? 1 : -1;
    const delta = round3(sign * (qty - existing.qty));
    await withTransaction(async (client) => {
      await execute(`UPDATE ${l.tx} SET qty = @qty, tujuan = @tujuan, penerima = @penerima, note = @note WHERE id = @id`, {
        qty,
        tujuan: tujuan ?? "",
        penerima: penerima ?? "",
        note: note || null,
        id: existing.id,
      }, client);
      await execute(
        `UPDATE ${l.stock} SET stock_tersedia = ROUND((stock_tersedia + @delta)::numeric, 3) WHERE ${l.scope} = @scope AND ${l.item} = @item`,
        { delta, scope: existing[l.scope], item: existing[l.item] },
        client
      );
    });
    }
    const m = await queryOne<any>(`SELECT nama FROM ${master} WHERE kode = @k`, { k: existing[l.item] });
    await logActivity(req, {
      module: lr.module,
      estate: existing[l.scope],
      aksi: existing.type === "IN" ? "Edit Stok Masuk" : "Edit Stok Keluar",
      objek: `${existing[l.item]} - ${m?.nama ?? ""}`,
      detail: describeChanges(
        existing,
        { qty, tujuan: tujuan ?? "", penerima: penerima ?? "", note: note || null },
        { qty: "Jumlah", tujuan: "Tujuan", penerima: "Penerima", note: "Catatan" }
      ),
    });
    res.json({ success: true });
  });

  // Delete a movement and reverse its effect on the stock.
  app.delete(`/api/${lr.path}/history/:id`, requireSuperuser, async (req, res) => {
    const existing = await queryOne<any>(`SELECT * FROM ${l.tx} WHERE id = @id`, { id: req.params.id });
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.transfer_from_id) return res.status(400).json({ error: TRANSFER_LOCKED });
    try {
      await withTransaction(async (client) => {
        if (l === KLINIK_LEDGER) await klinikReverse(client, existing);
        await execute(`DELETE FROM ${l.tx} WHERE id = @id`, { id: existing.id }, client);
        if (l === KLINIK_LEDGER) await syncKlinikStock(client, existing.klinik, existing.obat_kode);
        else
          await execute(
            `UPDATE ${l.stock} SET stock_tersedia = ROUND((stock_tersedia - @delta)::numeric, 3) WHERE ${l.scope} = @scope AND ${l.item} = @item`,
            { delta: existing.type === "IN" ? existing.qty : -existing.qty, scope: existing[l.scope], item: existing[l.item] },
            client
          );
      });
    } catch (e) {
      if (e instanceof StockError) return res.status(400).json({ error: e.message });
      throw e;
    }
    const m = await queryOne<any>(`SELECT nama FROM ${master} WHERE kode = @k`, { k: existing[l.item] });
    await logActivity(req, {
      module: lr.module,
      estate: existing[l.scope],
      aksi: existing.type === "IN" ? "Hapus Stok Masuk" : "Hapus Stok Keluar",
      objek: `${existing[l.item]} - ${m?.nama ?? ""}`,
      detail: `Jumlah: ${existing.qty}${existing.penerima ? `; Penerima: ${existing.penerima}` : ""}${existing.note ? `; Catatan: ${existing.note}` : ""}`,
    });
    res.json({ success: true });
  });
}

// ---- Log Aktivitas User (superuser): who acted / logged in over a period ----
// Built from activity_log (every add/edit/delete/transaction, all modules) and login_log. Every
// account is listed, so the ones without a single action in the period stand out.
app.get("/api/user-activity", requireSuperuser, async (req, res) => {
  const { dateFrom = "", dateTo = "", tz = "" } = req.query as Record<string, string>;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(dateFrom) || !iso.test(dateTo)) return res.status(400).json({ error: "Periode tidak valid" });
  const params = { dateFrom, dateTo, tz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : "Asia/Jakarta" };
  const day = (col: string) => `(${col} AT TIME ZONE @tz)::date`;
  const inRange = (col: string) => `${day(col)} BETWEEN @dateFrom::date AND @dateTo::date`;

  const users = await queryMany(
    `SELECT u.id, u.username, u.nama, u.role, u.estates, u.perms,
            (SELECT MAX(created_at) FROM login_log l WHERE l.user_id = u.id) AS last_login,
            (SELECT MAX(created_at) FROM activity_log a WHERE a.user_id = u.id) AS last_action
     FROM users u ORDER BY u.nama`
  );
  const perUser = await queryMany(
    `SELECT user_id, COUNT(*)::int aksi, COUNT(DISTINCT ${day("created_at")})::int hari_aktif,
            COUNT(*) FILTER (WHERE aksi = 'Stok Masuk')::int stok_masuk,
            COUNT(*) FILTER (WHERE aksi = 'Stok Keluar')::int stok_keluar,
            COUNT(*) FILTER (WHERE aksi = 'Koreksi Stok')::int koreksi,
            COUNT(*) FILTER (WHERE module = 'BARANG')::int m_gudang,
            COUNT(*) FILTER (WHERE module = 'BBM')::int m_bbm,
            COUNT(*) FILTER (WHERE module = 'PUPUK')::int m_pupuk,
            COUNT(*) FILTER (WHERE module = 'KLINIK')::int m_klinik
     FROM activity_log WHERE user_id IS NOT NULL AND ${inRange("created_at")} GROUP BY user_id`,
    params
  );
  const logins = await queryMany(
    `SELECT user_id, COUNT(*)::int login FROM login_log WHERE ${inRange("created_at")} GROUP BY user_id`,
    params
  );
  const daily = await queryMany(
    `SELECT user_id, to_char(${day("created_at")}, 'YYYY-MM-DD') tanggal, COUNT(*)::int aksi
     FROM activity_log WHERE user_id IS NOT NULL AND ${inRange("created_at")} GROUP BY 1, 2 ORDER BY 2`,
    params
  );
  res.json({ users, perUser, logins, daily });
});

// ---- Activity log listing: separate logs per module, scoped to the caller's estate ----
app.get("/api/activity-log", async (req, res) => {
  const { module = "", estate = "", aksi = "", search = "", dateFrom = "", dateTo = "", tz = "", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;
  if (!["BARANG", "BBM", "PUPUK", "KLINIK"].includes(module)) return res.status(400).json({ error: "Modul tidak valid" });

  const conditions = ["module = @module"];
  const params: any = { module };

  // Estate accounts only ever see their own estates' log; anyone may narrow to one estate.
  if (estate && estateAllowed(req.user!, estate)) {
    conditions.push("estate = @estate");
    params.estate = estate;
  } else if (req.user!.role !== "superuser") {
    conditions.push("estate = ANY(@estates::text[])");
    params.estates = req.user!.estates;
  }
  if (aksi) {
    conditions.push("aksi = @aksi");
    params.aksi = aksi;
  }
  if (search) {
    conditions.push("(objek ILIKE @search OR detail ILIKE @search OR nama ILIKE @search OR username ILIKE @search)");
    params.search = `%${search}%`;
  }
  // Date filters are calendar days in the viewer's own time zone (sent by the browser as an IANA
  // name), so "today" means today where they are, not in UTC.
  params.tz = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : "Asia/Jakarta";
  if (dateFrom) {
    conditions.push("(created_at AT TIME ZONE @tz)::date >= @dateFrom::date");
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push("(created_at AT TIME ZONE @tz)::date <= @dateTo::date");
    params.dateTo = dateTo;
  }

  const where = "WHERE " + conditions.join(" AND ");
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM activity_log ${where}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  const aksiOptions = (
    await queryMany<{ aksi: string }>("SELECT DISTINCT aksi FROM activity_log WHERE module = @module ORDER BY aksi", { module })
  ).map((r) => r.aksi);

  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit, aksiOptions });
});

// Superusers may correct or remove a log entry's text. This only touches the log itself - the
// stock data the entry describes is left as is.
app.put("/api/activity-log/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne("SELECT id FROM activity_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { aksi, objek, detail } = req.body;
  if (!String(aksi ?? "").trim()) return res.status(400).json({ error: "Aksi tidak boleh kosong" });

  await execute("UPDATE activity_log SET aksi = @aksi, objek = @objek, detail = @detail WHERE id = @id", {
    id: req.params.id,
    aksi: String(aksi).trim(),
    objek: String(objek ?? "").trim(),
    detail: String(detail ?? "").trim(),
  });
  res.json({ success: true });
});

app.delete("/api/activity-log/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne("SELECT id FROM activity_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await execute("DELETE FROM activity_log WHERE id = @id", { id: req.params.id });
  res.json({ success: true });
});

app.get("/api/bbm", async (req, res) => {
  const {
    search = "",
    jenis_bbm = "",
    lokasi = "",
    kode_kendaraan = "",
    dateFrom = "",
    dateTo = "",
    sortBy = "tanggal_iso",
    sortDir = "desc",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  // Estate users must pass their own lokasi (the frontend always does); a superuser can omit it.
  if (req.user!.role !== "superuser" && (!lokasi || !estateAllowed(req.user!, lokasi))) {
    return res.status(403).json({ error: "Akses ditolak" });
  }

  const validSort = ["tanggal_iso", "lokasi", "jenis_bbm", "pemakaian", "diterima", "saldo_stock"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "tanggal_iso";
  const dir = sortDir === "asc" ? "ASC" : "DESC";

  const conditions: string[] = [];
  const params: any = {};

  wordSearch(search, ["jenis_bbm", "estate", "no_spb", "kode_kendaraan", "keterangan"], conditions, params);
  if (jenis_bbm && ["SOLAR", "BENSIN"].includes(jenis_bbm)) {
    conditions.push("jenis_bbm = @jenis_bbm");
    params.jenis_bbm = jenis_bbm;
  }
  if (lokasi && BBM_LOKASI_OPTIONS.includes(lokasi)) {
    conditions.push("lokasi = @lokasi");
    params.lokasi = lokasi;
  }
  if (kode_kendaraan) {
    conditions.push("kode_kendaraan = @kode_kendaraan");
    params.kode_kendaraan = kode_kendaraan;
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

  // total_hm = this reading minus the same vehicle's previous HM/KM reading (hours/km worked since its
  // last refuel). Computed over the whole table before filtering, so the previous reading is found
  // even when it falls outside the current page/filter. hm_terakhir is free text like "4373.7 h".
  const data = await queryMany(
    `SELECT b.*, CASE WHEN h.cur >= h.prev THEN (h.cur - h.prev)::float8 END AS total_hm
     FROM bbm_log b
     LEFT JOIN (
       SELECT id, cur, LAG(cur) OVER (PARTITION BY kode_kendaraan ORDER BY tanggal_iso, id) AS prev
       FROM (
         SELECT id, kode_kendaraan, tanggal_iso, substring(hm_terakhir from '(\\d+(?:\\.\\d+)?)')::numeric AS cur
         FROM bbm_log
         WHERE kode_kendaraan <> '' AND hm_terakhir ~ '\\d'
       ) x
     ) h ON h.id = b.id
     ${where} ORDER BY b.${sortCol} ${dir}, b.id ${dir} LIMIT @limit OFFSET @offset`,
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

// ---- Stok Opname (see schema.sql opname / opname_line and the lock middleware near the top) ----
// Flow: create (snapshot of the system stock) -> count (stok_fisik per line, DRAFT) -> submit ->
// approve (one Koreksi per line whose count differs) or send back to DRAFT; DRAFT/SUBMITTED can be
// cancelled. Every module uses the same five estates.
const OPNAME_MODULES: OpnameModule[] = ["GUDANG", "KLINIK", "BBM", "PUPUK"];
const OPNAME_LOG_MODULE: Record<OpnameModule, LogModule> = { GUDANG: "BARANG", KLINIK: "KLINIK", BBM: "BBM", PUPUK: "PUPUK" };
const BBM_JENIS = ["SOLAR", "BENSIN"];
// Nilam items, klinik batches and BBM saldo (INTEGER) are whole numbers; other gudang and pupuk take decimals.
const opnameWhole = (o: { module: string; estate: string }) => o.module === "KLINIK" || o.module === "BBM" || (o.module === "GUDANG" && o.estate === "NILAM");

type OpnameAction = "view" | "opname" | "approve";
// view = the module's Lihat, Opname or Approve permission; the others need that exact permission.
function opnameCan(user: SessionUser, module: string, action: OpnameAction) {
  if (user.role === "superuser") return true;
  const m = module.toLowerCase();
  return (action === "view" ? ["view", "opname", "approve"] : [action]).some((a) => user.perms.includes(`${m}.${a}`));
}

type OpnameRow = { id: number; module: OpnameModule; estate: string; status: string; tanggal: string; submitted_by: number | null; [k: string]: any };
type OpnameLine = { id?: number; kode: string; nama: string; satuan: string; exp: string; stok_sistem: number; stok_fisik?: number | null; keterangan?: string };

// Loads an opname the account may act on, or answers the request itself and returns null.
async function loadOpname(req: express.Request, res: express.Response, action: OpnameAction, client?: PoolClient) {
  const o = await queryOne<OpnameRow>(`SELECT * FROM opname WHERE id = @id${client ? " FOR UPDATE" : ""}`, { id: Number(req.params.id) || 0 }, client);
  if (!o) {
    res.status(404).json({ error: "Stok opname tidak ditemukan" });
    return null;
  }
  if (!estateAllowed(req.user!, o.estate) || !opnameCan(req.user!, o.module, action)) {
    res.status(403).json({ error: "Akses ditolak" });
    return null;
  }
  return o;
}

// Answers a request with an error and returns null, for the early exits inside a transaction.
function refuse(res: express.Response, status: number, error: string): null {
  res.status(status).json({ error });
  return null;
}

const opnameName = (o: { module: OpnameModule; estate: string }) => `${OPNAME_MODULE_LABEL[o.module]} ${o.estate}`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

// The system stock of a location, one line per thing to count.
async function opnameSnapshot(module: OpnameModule, estate: string, client?: PoolClient): Promise<OpnameLine[]> {
  if (module === "GUDANG" && estate === "NILAM") {
    return queryMany(
      `SELECT kode, nama, COALESCE(satuan, '') satuan, '' exp, COALESCE(stock_tersedia, 0)::float8 stok_sistem FROM items ORDER BY kode`,
      {},
      client
    );
  }
  if (module === "GUDANG") {
    return queryMany(
      `SELECT gs.item_kode kode, i.nama, COALESCE(i.satuan, '') satuan, '' exp, gs.stock_tersedia::float8 stok_sistem
       FROM gudang_stock gs JOIN items i ON i.kode = gs.item_kode WHERE gs.gudang = @estate ORDER BY i.kode`,
      { estate },
      client
    );
  }
  if (module === "KLINIK") {
    // Every batch in stock, plus a no-expiry line for obat the clinic holds without any stock left.
    return queryMany(
      `SELECT * FROM (
         SELECT b.obat_kode kode, o.nama, COALESCE(o.satuan, '') satuan, b.expired_date exp, b.qty::float8 stok_sistem
         FROM klinik_batch b JOIN obat o ON o.kode = b.obat_kode WHERE b.klinik = @estate AND b.qty > 0
         UNION ALL
         SELECT ks.obat_kode, o.nama, COALESCE(o.satuan, ''), '', 0
         FROM klinik_stock ks JOIN obat o ON o.kode = ks.obat_kode
         WHERE ks.klinik = @estate AND NOT EXISTS (SELECT 1 FROM klinik_batch b WHERE b.klinik = ks.klinik AND b.obat_kode = ks.obat_kode AND b.qty > 0)
       ) x ORDER BY kode, exp = '', exp`,
      { estate },
      client
    );
  }
  if (module === "BBM") {
    return queryMany(
      `SELECT j kode, j nama, 'LTR' satuan, '' exp,
         COALESCE((SELECT saldo_stock FROM bbm_log WHERE jenis_bbm = j AND lokasi = @estate AND saldo_stock IS NOT NULL
                   ORDER BY tanggal_iso DESC, id DESC LIMIT 1), 0)::float8 stok_sistem
       FROM unnest(@jenis::text[]) j`,
      { estate, jenis: BBM_JENIS },
      client
    );
  }
  // Every jenis pupuk known in any estate (at least PUPUK NPK), with this estate's saldo or 0, so an
  // estate without pupuk history yet (KNS/WJA) still gets its lines to count.
  return queryMany(
    `SELECT j kode, j nama, 'KG' satuan, '' exp,
       COALESCE((SELECT saldo_stock FROM pupuk_log WHERE jenis_pupuk = j AND estate = @estate AND saldo_stock IS NOT NULL
                 ORDER BY tanggal_iso DESC, id DESC LIMIT 1), 0)::float8 stok_sistem
     FROM (SELECT DISTINCT jenis_pupuk j FROM pupuk_log UNION SELECT @npk) x ORDER BY j`,
    { estate, npk: "PUPUK NPK" },
    client
  );
}

// Latest BBM / pupuk saldo row of one jenis (the running balance new entries continue from).
const latestSaldoRow = (module: "BBM" | "PUPUK", estate: string, jenis: string, client?: PoolClient) =>
  queryOne<{ saldo_stock: number }>(
    module === "BBM"
      ? `SELECT saldo_stock FROM bbm_log WHERE jenis_bbm = @jenis AND lokasi = @estate AND saldo_stock IS NOT NULL ORDER BY tanggal_iso DESC, id DESC LIMIT 1`
      : `SELECT saldo_stock FROM pupuk_log WHERE jenis_pupuk = @jenis AND estate = @estate AND saldo_stock IS NOT NULL ORDER BY tanggal_iso DESC, id DESC LIMIT 1`,
    { estate, jenis },
    client
  );

// One line as it stands now (for a line added during the count); null = not in the master data.
async function opnameCurrent(module: OpnameModule, estate: string, kode: string, exp: string): Promise<OpnameLine | null> {
  if (module === "GUDANG") {
    const r = await queryOne<any>(
      `SELECT i.kode, i.nama, COALESCE(i.satuan, '') satuan, ${
        estate === "NILAM" ? "COALESCE(i.stock_tersedia, 0)" : "COALESCE(gs.stock_tersedia, 0)"
      }::float8 stok_sistem
       FROM items i LEFT JOIN gudang_stock gs ON gs.item_kode = i.kode AND gs.gudang = @estate WHERE i.kode = @kode`,
      { estate, kode }
    );
    return r ? { ...r, exp: "" } : null;
  }
  if (module === "KLINIK") {
    const r = await queryOne<any>(
      `SELECT o.kode, o.nama, COALESCE(o.satuan, '') satuan, COALESCE(b.qty, 0)::float8 stok_sistem
       FROM obat o LEFT JOIN klinik_batch b ON b.obat_kode = o.kode AND b.klinik = @estate AND b.expired_date = @exp WHERE o.kode = @kode`,
      { estate, kode, exp }
    );
    return r ? { ...r, exp } : null;
  }
  if (module === "BBM" && !BBM_JENIS.includes(kode)) return null;
  const last = await latestSaldoRow(module, estate, kode);
  return { kode, nama: kode, satuan: module === "BBM" ? "LTR" : "KG", exp: "", stok_sistem: last?.saldo_stock ?? 0 };
}

// Books the count of one line as a Koreksi. Returns the stock before (the count is the stock after).
async function applyOpnameLine(client: PoolClient, req: express.Request, o: OpnameRow, line: OpnameLine & { stok_fisik: number }) {
  const note = `Koreksi Stok (Opname #${o.id})${line.keterangan ? `: ${line.keterangan}` : ""}`;
  const actual = line.stok_fisik;
  if (o.module === "GUDANG" && o.estate === "NILAM") {
    const item = await queryOne<{ id: number }>("SELECT id FROM items WHERE kode = @kode", { kode: line.kode }, client);
    if (!item) throw new StockError(`Barang ${line.kode} sudah tidak ada di master data`);
    return nilamCorrection(client, item.id, actual, note);
  }
  if (o.module === "GUDANG") return ledgerCorrection(client, req, GUDANG_LEDGER, o.estate, line.kode, actual, note);
  if (o.module === "KLINIK") {
    const before =
      (await queryOne<{ q: number }>(
        "SELECT qty q FROM klinik_batch WHERE klinik = @k AND obat_kode = @o AND expired_date = @exp FOR UPDATE",
        { k: o.estate, o: line.kode, exp: line.exp },
        client
      ))?.q ?? 0;
    const delta = actual - before;
    if (delta !== 0) {
      await klinikMoveTx(client, req, {
        klinik: o.estate,
        obat: line.kode,
        type: delta > 0 ? "IN" : "OUT",
        qty: Math.abs(delta),
        exp: line.exp,
        tujuan: "",
        penerima: "",
        note: `Koreksi Stok (Opname #${o.id}) batch ${expText(line.exp)}${line.keterangan ? `: ${line.keterangan}` : ""}`,
        is_correction: 1,
      });
    }
    return before;
  }

  // BBM / pupuk: a saldo row dated the opname day, or after the latest row so it becomes the saldo.
  const before = (await latestSaldoRow(o.module, o.estate, line.kode, client))?.saldo_stock ?? 0;
  const delta = round3(actual - before);
  if (delta === 0) return before;
  const lastIso =
    (await queryOne<{ d: string | null }>(
      o.module === "BBM"
        ? "SELECT MAX(tanggal_iso) d FROM bbm_log WHERE jenis_bbm = @jenis AND lokasi = @estate"
        : "SELECT MAX(tanggal_iso) d FROM pupuk_log WHERE jenis_pupuk = @jenis AND estate = @estate",
      { jenis: line.kode, estate: o.estate },
      client
    ))?.d ?? "";
  const iso = lastIso > o.tanggal ? lastIso : o.tanggal;
  if (o.module === "BBM") {
    const { tanggal, periode } = isoToIndoDate(iso);
    await execute(
      `INSERT INTO bbm_log (jenis_bbm, lokasi, estate, periode, tanggal, tanggal_iso, no_spb, saldo_stock, keterangan, kode_kendaraan, hm_terakhir, koreksi)
       VALUES (@jenis, @estate, @estate, @periode, @tanggal, @iso, '', @saldo, @note, '', '', @delta)`,
      { jenis: line.kode, estate: o.estate, periode, tanggal, iso, saldo: actual, note, delta },
      client
    );
  } else {
    const [y, m, d] = iso.split("-");
    await execute(
      `INSERT INTO pupuk_log (estate, jenis_pupuk, periode, tanggal, tanggal_iso, divisi, no_embrace, kode_barang, saldo_stock, keterangan, blok, koreksi)
       VALUES (@estate, @jenis, @periode, @tanggal, @iso, '', '', '', @saldo, @note, '', @delta)`,
      { estate: o.estate, jenis: line.kode, periode: `${INDO_MONTHS[Number(m) - 1]} ${y}`, tanggal: `${d}/${m}/${y}`, iso, saldo: actual, note, delta },
      client
    );
  }
  return before;
}

async function logOpname(req: express.Request, o: OpnameRow, aksi: string, detail = "") {
  await logActivity(req, { module: OPNAME_LOG_MODULE[o.module], estate: o.estate, aksi, objek: `Stok Opname #${o.id} - ${opnameName(o)}`, detail });
}

const OPNAME_COUNTS = `COUNT(l.id)::int total, COUNT(l.stok_fisik)::int dihitung,
  COUNT(*) FILTER (WHERE l.stok_fisik IS NOT NULL AND ROUND((l.stok_fisik - l.stok_sistem)::numeric, 3) <> 0)::int selisih`;

app.get("/api/stock-opname", async (req, res) => {
  const { module = "", estate = "", status = "", page = "1", pageSize = "25" } = req.query as Record<string, string>;
  const u = req.user!;
  const params: any = {
    mods: OPNAME_MODULES.filter((m) => opnameCan(u, m, "view") && (!module || m === module)),
    estates: ESTATES.filter((e) => estateAllowed(u, e) && (!estate || e === estate)),
  };
  const conditions = ["o.module = ANY(@mods::text[])", "o.estate = ANY(@estates::text[])"];
  if (status === "OPEN") conditions.push("o.status IN ('DRAFT', 'SUBMITTED')");
  else if (status) {
    conditions.push("o.status = @status");
    params.status = status;
  }
  const where = "WHERE " + conditions.join(" AND ");
  const total = (await queryOne<{ c: number }>(`SELECT COUNT(*)::int c FROM opname o ${where}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 25, 200);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT o.*, ${OPNAME_COUNTS} FROM opname o LEFT JOIN opname_line l ON l.opname_id = o.id ${where}
     GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total, page: parseInt(page) || 1, pageSize: limit });
});

app.post("/api/stock-opname", async (req, res) => {
  const { module, estate, tanggal, catatan } = req.body ?? {};
  if (!OPNAME_MODULES.includes(module)) return res.status(400).json({ error: "Modul tidak valid" });
  if (!(ESTATES as readonly string[]).includes(estate)) return res.status(400).json({ error: "Estate tidak valid" });
  if (!ISO_DATE.test(tanggal || "")) return res.status(400).json({ error: "Tanggal tidak valid" });
  if (!estateAllowed(req.user!, estate) || !opnameCan(req.user!, module, "opname")) return res.status(403).json({ error: "Akses ditolak" });

  const u = req.user!;
  let o: OpnameRow;
  let count = 0;
  try {
    o = await withTransaction(async (client) => {
      const row = (await queryOne<OpnameRow>(
        `INSERT INTO opname (module, estate, tanggal, catatan, created_by, created_by_nama)
         VALUES (@module, @estate, @tanggal, @catatan, @uid, @unama) RETURNING *`,
        { module, estate, tanggal, catatan: String(catatan ?? "").trim(), uid: u.id, unama: u.nama },
        client
      ))!;
      const lines = await opnameSnapshot(module, estate, client);
      count = lines.length;
      await execute(
        `INSERT INTO opname_line (opname_id, kode, nama, satuan, exp, stok_sistem)
         SELECT @id, x.kode, x.nama, x.satuan, x.exp, x.stok_sistem
         FROM json_to_recordset(@lines::json) AS x(kode text, nama text, satuan text, exp text, stok_sistem float8)`,
        { id: row.id, lines: JSON.stringify(lines) },
        client
      );
      return row;
    });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: `${opnameName({ module, estate })} masih punya stok opname yang belum selesai` });
    throw e;
  }
  await logOpname(req, o, "Buat Stok Opname", `Tanggal: ${isoToDisplay(tanggal)}; ${count} item; transaksi stok dikunci`);
  res.json({ success: true, id: o.id });
});

app.get("/api/stock-opname/:id", async (req, res) => {
  const o = await loadOpname(req, res, "view");
  if (!o) return;
  const lines = await queryMany("SELECT * FROM opname_line WHERE opname_id = @id ORDER BY ditambahkan, id", { id: o.id });
  res.json({ opname: o, lines });
});

// Saves counts (stok_fisik null = not counted) and notes while DRAFT.
app.put("/api/stock-opname/:id", async (req, res) => {
  const { lines = [], catatan } = req.body ?? {};
  if (!Array.isArray(lines)) return res.status(400).json({ error: "Data tidak valid" });
  const ok = await withTransaction(async (client) => {
    const o = await loadOpname(req, res, "opname", client);
    if (!o) return null;
    if (o.status !== "DRAFT") return refuse(res, 400, "Opname ini sudah diajukan, tidak bisa diubah");
    const whole = opnameWhole(o);
    const rows: { id: number; stok_fisik: number | null; keterangan: string }[] = [];
    for (const l of lines) {
      const v = l?.stok_fisik;
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || (whole && !Number.isInteger(v)))) {
        return refuse(res, 400, whole ? "Stok fisik harus bilangan bulat, minimal 0" : "Stok fisik harus angka, minimal 0");
      }
      rows.push({ id: Number(l.id), stok_fisik: v === null ? null : round3(v), keterangan: String(l.keterangan ?? "").trim() });
    }
    if (rows.length) {
      await execute(
        `UPDATE opname_line l SET stok_fisik = x.stok_fisik, keterangan = x.keterangan
         FROM json_to_recordset(@rows::json) AS x(id int, stok_fisik float8, keterangan text)
         WHERE l.id = x.id AND l.opname_id = @oid`,
        { rows: JSON.stringify(rows), oid: o.id },
        client
      );
    }
    if (typeof catatan === "string") await execute("UPDATE opname SET catatan = @c WHERE id = @id", { c: catatan.trim(), id: o.id }, client);
    return o;
  });
  if (ok) res.json({ success: true });
});

// A barang / obat batch / jenis pupuk found during the count that isn't in the snapshot.
app.post("/api/stock-opname/:id/lines", async (req, res) => {
  const o = await loadOpname(req, res, "opname");
  if (!o) return;
  if (o.status !== "DRAFT") return res.status(400).json({ error: "Opname ini sudah diajukan, tidak bisa diubah" });
  if (o.module === "BBM") return res.status(400).json({ error: "BBM selalu berisi Solar dan Bensin" });
  let kode = String(req.body?.kode ?? "").trim();
  if (o.module === "PUPUK") kode = kode.toUpperCase();
  const exp = o.module === "KLINIK" ? String(req.body?.exp ?? "") : "";
  if (!kode) return res.status(400).json({ error: "Barang wajib dipilih" });
  if (exp && !ISO_DATE.test(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
  const cur = await opnameCurrent(o.module, o.estate, kode, exp);
  if (!cur) return res.status(404).json({ error: "Tidak ditemukan di master data" });
  try {
    const line = await queryOne(
      `INSERT INTO opname_line (opname_id, kode, nama, satuan, exp, stok_sistem, ditambahkan)
       VALUES (@oid, @kode, @nama, @satuan, @exp, @stok_sistem, true) RETURNING *`,
      { oid: o.id, kode: cur.kode, nama: cur.nama, satuan: cur.satuan, exp: cur.exp, stok_sistem: cur.stok_sistem }
    );
    res.json(line);
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Sudah ada di daftar opname" });
    throw e;
  }
});

app.delete("/api/stock-opname/:id/lines/:lineId", async (req, res) => {
  const o = await loadOpname(req, res, "opname");
  if (!o) return;
  if (o.status !== "DRAFT") return res.status(400).json({ error: "Opname ini sudah diajukan, tidak bisa diubah" });
  const r = await execute("DELETE FROM opname_line WHERE id = @lid AND opname_id = @oid AND ditambahkan", { lid: Number(req.params.lineId) || 0, oid: o.id });
  if (!r.rowCount) return res.status(400).json({ error: "Hanya baris yang ditambahkan saat opname yang bisa dihapus" });
  res.json({ success: true });
});

app.post("/api/stock-opname/:id/submit", async (req, res) => {
  const u = req.user!;
  const done = await withTransaction(async (client) => {
    const o = await loadOpname(req, res, "opname", client);
    if (!o) return null;
    if (o.status !== "DRAFT") return refuse(res, 400, "Opname ini sudah diajukan");
    const c = (await queryOne<{ total: number; dihitung: number; selisih: number }>(
      `SELECT ${OPNAME_COUNTS} FROM opname_line l WHERE l.opname_id = @id`,
      { id: o.id },
      client
    ))!;
    if (!c.dihitung) return refuse(res, 400, "Belum ada stok fisik yang diisi");
    await execute(
      `UPDATE opname SET status = 'SUBMITTED', submitted_by = @uid, submitted_by_nama = @unama, submitted_at = now() WHERE id = @id`,
      { uid: u.id, unama: u.nama, id: o.id },
      client
    );
    return { o, c };
  });
  if (!done) return;
  await logOpname(req, done.o, "Ajukan Stok Opname", `Dihitung ${done.c.dihitung} dari ${done.c.total} item; ${done.c.selisih} item selisih`);
  res.json({ success: true });
});

// Send a submitted opname back to the counter with a reason.
app.post("/api/stock-opname/:id/return", async (req, res) => {
  const catatan = String(req.body?.catatan ?? "").trim();
  if (!catatan) return res.status(400).json({ error: "Alasan wajib diisi" });
  const o = await withTransaction(async (client) => {
    const o = await loadOpname(req, res, "approve", client);
    if (!o) return null;
    if (o.status !== "SUBMITTED") return refuse(res, 400, "Opname ini tidak sedang menunggu approval");
    await execute(
      `UPDATE opname SET status = 'DRAFT', catatan_review = @c, submitted_by = NULL, submitted_by_nama = NULL, submitted_at = NULL WHERE id = @id`,
      { c: catatan, id: o.id },
      client
    );
    return o;
  });
  if (!o) return;
  await logOpname(req, o, "Kembalikan Stok Opname", `Alasan: ${catatan}`);
  res.json({ success: true });
});

app.post("/api/stock-opname/:id/approve", async (req, res) => {
  const u = req.user!;
  type Change = { line: OpnameLine; before: number; after: number };
  let done: { o: OpnameRow; changes: Change[]; counted: number } | null;
  try {
    done = await withTransaction(async (client) => {
      const o = await loadOpname(req, res, "approve", client);
      if (!o) return null;
      if (o.status !== "SUBMITTED") return refuse(res, 400, "Opname ini tidak sedang menunggu approval");
      // The count is checked by someone else; a superuser may approve their own.
      if (o.submitted_by === u.id && u.role !== "superuser") return refuse(res, 403, "Opname yang Anda ajukan sendiri harus disetujui orang lain");
      const lines = await queryMany<OpnameLine & { id: number; stok_fisik: number }>(
        "SELECT * FROM opname_line WHERE opname_id = @id AND stok_fisik IS NOT NULL ORDER BY id",
        { id: o.id },
        client
      );
      const changes: Change[] = [];
      for (const line of lines) {
        const before = round3(await applyOpnameLine(client, req, o, line));
        await execute("UPDATE opname_line SET stok_sistem = @before WHERE id = @id", { before, id: line.id }, client);
        if (before !== line.stok_fisik) changes.push({ line, before, after: line.stok_fisik });
      }
      await execute(
        `UPDATE opname SET status = 'APPROVED', approved_by = @uid, approved_by_nama = @unama, approved_at = now(), catatan_review = '' WHERE id = @id`,
        { uid: u.id, unama: u.nama, id: o.id },
        client
      );
      return { o, changes, counted: lines.length };
    });
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (!done) return;
  const { o, changes } = done;
  for (const { line, before, after } of changes) {
    await logActivity(req, {
      module: OPNAME_LOG_MODULE[o.module],
      estate: o.estate,
      aksi: "Koreksi Stok",
      objek: o.module === "BBM" || o.module === "PUPUK" ? line.kode : `${line.kode} - ${line.nama}`,
      detail: `Stok Opname #${o.id}${o.module === "KLINIK" ? `; Batch ${expText(line.exp)}` : ""}: ${before} → ${after} (selisih ${signed(round3(after - before))})${
        line.keterangan ? `; Catatan: ${line.keterangan}` : ""
      }`,
    });
  }
  await logOpname(req, o, "Setujui Stok Opname", `${done.counted} item dihitung; ${changes.length} item dikoreksi; transaksi stok dibuka`);
  res.json({ success: true, corrected: changes.length });
});

// DRAFT: by the counter or an approver; SUBMITTED: by an approver. Nothing is booked.
app.post("/api/stock-opname/:id/cancel", async (req, res) => {
  const catatan = String(req.body?.catatan ?? "").trim();
  const o = await withTransaction(async (client) => {
    const o = await loadOpname(req, res, "view", client);
    if (!o) return null;
    if (o.status !== "DRAFT" && o.status !== "SUBMITTED") return refuse(res, 400, "Opname ini sudah selesai");
    const u = req.user!;
    const allowed = opnameCan(u, o.module, "approve") || (o.status === "DRAFT" && opnameCan(u, o.module, "opname"));
    if (!allowed) return refuse(res, 403, "Akses ditolak");
    await execute("UPDATE opname SET status = 'BATAL', catatan_review = @c WHERE id = @id", { c: catatan, id: o.id }, client);
    return o;
  });
  if (!o) return;
  await logOpname(req, o, "Batalkan Stok Opname", `${catatan ? `Alasan: ${catatan}; ` : ""}transaksi stok dibuka`);
  res.json({ success: true });
});
