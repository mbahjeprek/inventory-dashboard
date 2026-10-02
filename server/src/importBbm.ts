import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { execute, queryOne, pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const num = (v: string): number | null => {
  const s = (v || "").trim();
  if (!s) return null;
  // "1.000" = thousands, "76,5" = decimal comma
  const n = parseFloat(s.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isNaN(n) ? null : n;
};

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  mei: "05",
  may: "05",
  jun: "06",
  jul: "07",
  agu: "08",
  agt: "08",
  agustus: "08",
  aug: "08",
  sep: "09",
  okt: "10",
  oct: "10",
  nov: "11",
  des: "12",
  dec: "12",
};

// Dates come as "31-Okt-2023" / "1-Nov-2023" / "14-Agustus-2026" (Indonesian month names, a few English).
function toIsoDate(raw: string): string | null {
  const m = (raw || "").trim().match(/^(\d{1,2})[-/]([A-Za-z]+)[-/](\d{4})$/);
  if (!m) return null;
  const [, d, monRaw, y] = m;
  const mo = MONTHS[monRaw.toLowerCase()];
  if (!mo) return null;
  return `${y}-${mo}-${d.padStart(2, "0")}`;
}

type RowMap = {
  periode: number;
  tanggal: number;
  no_spb: number;
  stock_awal: number;
  diterima: number;
  pinjam: number | null;
  pemakaian: number;
  saldo_stock: number;
  keterangan: number;
  // ESTATE column in Bensin sheets is a free-text sub-location/consumption tag (e.g. LUBAKAN,
  // TAGANG, NILAM, ZAMRUD) - distinct from `lokasi`, the fixed physical site the sheet belongs to.
  // Solar sheets have no such column.
  estate: number | null;
  status_kepemilikan: number | null;
  kode_kendaraan: number | null;
  hm_terakhir: number | null;
};

async function importSheet(
  file: string,
  jenisBbm: string,
  lokasi: string,
  headerRowIndex: number,
  cols: RowMap,
  estateFixed?: string
) {
  const csvPath = path.join(__dirname, "..", file);
  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows: string[][] = parse(raw, { relax_column_count: true });
  // Only keep rows with a real, parseable transaction date - this also drops the trailing
  // "TOTAL" / "Rata-Rata Pemakaian" / "Dilaporkan Oleh" summary rows at the bottom of each sheet.
  const dataRows = rows.slice(headerRowIndex + 1).filter((r) => toIsoDate(r[cols.tanggal]) !== null);

  let count = 0;
  for (const r of dataRows) {
    const tanggal = (r[cols.tanggal] || "").trim();
    // Solar sheets have no per-row ESTATE column - use the fixed estate tag for this sheet
    // (defaults to mirroring `lokasi` when the whole sheet already IS that estate/site).
    const estate = cols.estate !== null ? (r[cols.estate] || "").trim() : estateFixed ?? lokasi;

    await execute(
      `INSERT INTO bbm_log
        (jenis_bbm, lokasi, estate, periode, tanggal, tanggal_iso, no_spb, stock_awal, diterima, pinjam, pemakaian, saldo_stock, keterangan, status_kepemilikan, kode_kendaraan, hm_terakhir)
       VALUES
        (@jenis_bbm, @lokasi, @estate, @periode, @tanggal, @tanggal_iso, @no_spb, @stock_awal, @diterima, @pinjam, @pemakaian, @saldo_stock, @keterangan, @status_kepemilikan, @kode_kendaraan, @hm_terakhir)`,
      {
        jenis_bbm: jenisBbm,
        lokasi,
        estate,
        periode: (r[cols.periode] || "").trim(),
        tanggal,
        tanggal_iso: toIsoDate(tanggal),
        no_spb: (r[cols.no_spb] || "").trim(),
        stock_awal: num(r[cols.stock_awal]),
        diterima: num(r[cols.diterima]),
        pinjam: cols.pinjam !== null ? num(r[cols.pinjam]) : null,
        pemakaian: num(r[cols.pemakaian]),
        saldo_stock: num(r[cols.saldo_stock]),
        keterangan: (r[cols.keterangan] || "").trim(),
        status_kepemilikan: cols.status_kepemilikan !== null ? (r[cols.status_kepemilikan] || "").trim() : null,
        kode_kendaraan: cols.kode_kendaraan !== null ? (r[cols.kode_kendaraan] || "").trim() : null,
        hm_terakhir: cols.hm_terakhir !== null ? (r[cols.hm_terakhir] || "").trim() : null,
      }
    );
    count++;
  }
  console.log(`Imported ${count} records from ${file} (${jenisBbm}/${lokasi}).`);
}

const BENSIN_COLS: RowMap = {
  periode: 0,
  tanggal: 1,
  no_spb: 2,
  stock_awal: 3,
  diterima: 4,
  pinjam: null,
  pemakaian: 5,
  saldo_stock: 6,
  keterangan: 7,
  estate: 8,
  status_kepemilikan: null,
  kode_kendaraan: null,
  hm_terakhir: 9,
};

async function main() {
  await execute("DELETE FROM bbm_log");

  // Bensin: one sheet per physical site (Nilam / WJA / KNS), same column layout.
  await importSheet("data_bbm_bensin_nilam.csv", "BENSIN", "NILAM", 2, BENSIN_COLS);
  await importSheet("data_bbm_bensin_wja.csv", "BENSIN", "WJA", 2, BENSIN_COLS);
  await importSheet("data_bbm_bensin_kns.csv", "BENSIN", "KNS", 2, BENSIN_COLS);

  // Solar Nilam: one column set, no leading blank column.
  await importSheet("data_bbm_solar_nilam.csv", "SOLAR", "NILAM", 5, {
    periode: 0,
    tanggal: 1,
    no_spb: 2,
    stock_awal: 3,
    diterima: 4,
    pinjam: 5,
    pemakaian: 6,
    saldo_stock: 7,
    keterangan: 8,
    estate: null,
    status_kepemilikan: 9,
    kode_kendaraan: 10,
    hm_terakhir: 11,
  });

  // Solar Zamrud: no physical warehouse of its own - Zamrud draws its solar from the Nilam depot,
  // so this is filed under lokasi=NILAM with estate=ZAMRUD (distribution tag), same as Bensin.
  // Has an extra blank column right after PERIODE, shifting everything by 1.
  await importSheet(
    "data_bbm_solar_zamrud.csv",
    "SOLAR",
    "NILAM",
    5,
    {
      periode: 0,
      tanggal: 2,
      no_spb: 3,
      stock_awal: 4,
      diterima: 5,
      pinjam: 6,
      pemakaian: 7,
      saldo_stock: 8,
      keterangan: 9,
      estate: null,
      status_kepemilikan: 10,
      kode_kendaraan: 11,
      hm_terakhir: 12,
    },
    "ZAMRUD"
  );

  // Solar Firus: same reasoning as Zamrud - filed under lokasi=NILAM, estate=FIRUS. Same layout as Nilam.
  await importSheet(
    "data_bbm_solar_firus.csv",
    "SOLAR",
    "NILAM",
    5,
    {
      periode: 0,
      tanggal: 1,
      no_spb: 2,
      stock_awal: 3,
      diterima: 4,
      pinjam: 5,
      pemakaian: 6,
      saldo_stock: 7,
      keterangan: 8,
      estate: null,
      status_kepemilikan: 9,
      kode_kendaraan: 10,
      hm_terakhir: 11,
    },
    "FIRUS"
  );

  // Solar WJA: same layout as Nilam.
  await importSheet("data_bbm_solar_wja.csv", "SOLAR", "WJA", 5, {
    periode: 0,
    tanggal: 1,
    no_spb: 2,
    stock_awal: 3,
    diterima: 4,
    pinjam: 5,
    pemakaian: 6,
    saldo_stock: 7,
    keterangan: 8,
    estate: null,
    status_kepemilikan: 9,
    kode_kendaraan: 10,
    hm_terakhir: 11,
  });

  // Solar KNS: same layout as Nilam.
  await importSheet("data_bbm_solar_kns.csv", "SOLAR", "KNS", 5, {
    periode: 0,
    tanggal: 1,
    no_spb: 2,
    stock_awal: 3,
    diterima: 4,
    pinjam: 5,
    pemakaian: 6,
    saldo_stock: 7,
    keterangan: 8,
    estate: null,
    status_kepemilikan: 9,
    kode_kendaraan: 10,
    hm_terakhir: 11,
  });

  const total = (await queryOne<{ c: number }>("SELECT COUNT(*) c FROM bbm_log"))!.c;
  console.log(`Total BBM records: ${total}.`);
  await pool.end();
}

main();
