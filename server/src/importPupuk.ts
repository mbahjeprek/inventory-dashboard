import "dotenv/config";
import * as XLSXModule from "xlsx";
// xlsx is CommonJS: under Node's ESM loader its API (incl. SSF) sits on the default export.
const XLSX: typeof XLSXModule = (XLSXModule as any).default ?? XLSXModule;
import { execute, queryOne, pool } from "./db.js";

// Imports the "STOCK PUPUK" tab of the inventory Google Sheet into pupuk_log.
//   npm run db:import-pupuk            (only into an empty table)
//   npm run db:import-pupuk -- --replace   (wipes pupuk_log first, manual entries included)
const SHEET_ID = "1drAO4_6QqoATXlvO3a8AZiWoze4aLD1F3qcVZGOHBuE";
const TAB = "STOCK PUPUK";

const INDO_MONTHS = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];

// Columns A..N of the tab: PERIODE, TANGGAL, NAMA BARANG, ESTATE, DIVISI, NO.EMBRACE, KODE BARANG,
// KELUAR (KG), DITERIMA (KG), STOK (KG), KETERANGAN, BLOK, HA, POKOK. Columns O onwards are a
// separate summary block, and STOK is one running balance across all estates, so both are ignored.
const COL = { tanggal: 1, nama: 2, estate: 3, divisi: 4, noEmbrace: 5, kode: 6, keluar: 7, diterima: 8, keterangan: 10, blok: 11, ha: 12, pokok: 13 };

const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (typeof v === "number" ? v : text(v) === "" ? null : Number(text(v).replace(/\./g, "").replace(",", ".")) || null);

// Excel date serial -> { iso, display }; null for blanks and typo'd serials (e.g. 6620423).
function serialToDate(v: unknown): { iso: string; tanggal: string; periode: string } | null {
  if (typeof v !== "number" || v < 40000 || v > 60000) return null;
  const d = XLSX.SSF.parse_date_code(v);
  const mm = String(d.m).padStart(2, "0");
  const dd = String(d.d).padStart(2, "0");
  return { iso: `${d.y}-${mm}-${dd}`, tanggal: `${dd}/${mm}/${d.y}`, periode: `${INDO_MONTHS[d.m - 1]} ${d.y}` };
}

async function main() {
  const replace = process.argv.includes("--replace");
  const existing = (await queryOne<{ c: string }>("SELECT COUNT(*) c FROM pupuk_log"))!.c;
  if (Number(existing) > 0 && !replace) {
    console.error(`pupuk_log already has ${existing} rows; re-run with --replace to wipe and re-import.`);
    process.exit(1);
  }

  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`);
  if (!res.ok) throw new Error(`Sheet download failed: ${res.status}`);
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
  const ws = wb.Sheets[TAB];
  if (!ws) throw new Error(`Tab "${TAB}" not found`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: "" }).slice(2);

  type Rec = { order: number; estate: string; jenis: string; date: NonNullable<ReturnType<typeof serialToDate>>; r: unknown[]; fixedDate: boolean };
  const recs: Rec[] = [];
  const lastDate: Record<string, NonNullable<ReturnType<typeof serialToDate>>> = {};
  rows.forEach((r, i) => {
    const estate = text(r[COL.estate]).toUpperCase();
    const jenis = text(r[COL.nama]).toUpperCase();
    if (!estate || !jenis) return; // notes / blank rows
    let date = serialToDate(r[COL.tanggal]);
    let fixedDate = false;
    if (!date) {
      // A mistyped date keeps its place in the ledger by taking the previous row's date for that estate.
      if (!lastDate[estate]) return;
      date = lastDate[estate];
      fixedDate = true;
    }
    lastDate[estate] = date;
    recs.push({ order: i, estate, jenis, date, r, fixedDate });
  });

  // Sheet rows aren't strictly in date order; balance per estate+jenis in date order, sheet order as tie-break.
  recs.sort((a, b) => a.date.iso.localeCompare(b.date.iso) || a.order - b.order);
  const saldo: Record<string, number> = {};

  if (replace) await execute("DELETE FROM pupuk_log");
  for (const { order, estate, jenis, date, r, fixedDate } of recs) {
    const keluar = num(r[COL.keluar]);
    const diterima = num(r[COL.diterima]);
    const key = `${estate}|${jenis}`;
    saldo[key] = (saldo[key] ?? 0) + (diterima ?? 0) - (keluar ?? 0);
    if (fixedDate) console.warn(`Sheet row ${order + 3} (${estate}): invalid TANGGAL, using ${date.tanggal}`);
    await execute(
      `INSERT INTO pupuk_log (estate, jenis_pupuk, periode, tanggal, tanggal_iso, divisi, no_embrace, kode_barang, keluar, diterima, saldo_stock, keterangan, blok, ha, pokok)
       VALUES (@estate, @jenis, @periode, @tanggal, @tanggal_iso, @divisi, @no_embrace, @kode, @keluar, @diterima, @saldo, @keterangan, @blok, @ha, @pokok)`,
      {
        estate,
        jenis,
        periode: date.periode,
        tanggal: date.tanggal,
        tanggal_iso: date.iso,
        divisi: text(r[COL.divisi]),
        no_embrace: text(r[COL.noEmbrace]),
        kode: text(r[COL.kode]),
        keluar,
        diterima,
        saldo: saldo[key],
        keterangan: text(r[COL.keterangan]),
        blok: text(r[COL.blok]),
        ha: num(r[COL.ha]),
        pokok: num(r[COL.pokok]),
      }
    );
  }

  console.log(`Imported ${recs.length} pupuk rows.`);
  for (const [k, v] of Object.entries(saldo)) console.log(`  ${k}: saldo ${v.toLocaleString("id-ID")} KG`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
