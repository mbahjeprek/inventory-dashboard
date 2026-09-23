import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { execute, queryOne, pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const num = (v: string) => {
  const n = parseInt((v || "0").replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
};

function normalizeTujuan(raw: string): string | null {
  const s = (raw || "").toUpperCase();
  if (!s.trim()) return null;
  if (s.includes("NILAM")) return "NILAM";
  if (s.includes("ZAM")) return "ZAMRUD";
  if (s.includes("VIRUS") || s.includes("FIRUS")) return "FIRUS";
  return null;
}

function toIsoDate(ddmmyyyy: string): string | null {
  const m = (ddmmyyyy || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

async function importStockIn() {
  const csvPath = path.join(__dirname, "..", "data_stock_in.csv");
  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows: string[][] = parse(raw, { relax_column_count: true });
  const dataRows = rows.slice(1).filter((r) => r[6] && r[6].trim());

  await execute("DELETE FROM stock_in_log");

  for (const r of dataRows) {
    const kode = r[6].trim();
    const item = await queryOne<{ id: number }>("SELECT id FROM items WHERE kode = @kode", { kode });
    const estateRaw = (r[11] || "").trim();
    await execute(
      `INSERT INTO stock_in_log
        (item_id, kode, nama, tanggal_po, no_pr, po_in_akss, nama_vendor, qty, satuan, tujuan, estate_raw, divisi, tanggal_terima, tanggal_terima_iso, keterangan)
       VALUES (@item_id, @kode, @nama, @tanggal_po, @no_pr, @po_in_akss, @nama_vendor, @qty, @satuan, @tujuan, @estate_raw, @divisi, @tanggal_terima, @tanggal_terima_iso, @keterangan)`,
      {
        item_id: item?.id ?? null,
        kode,
        nama: (r[7] || "").trim(),
        tanggal_po: (r[1] || "").trim(),
        no_pr: (r[2] || "").trim(),
        po_in_akss: (r[4] || "").trim(),
        nama_vendor: (r[5] || "").trim(),
        qty: num(r[9]),
        satuan: (r[10] || "").trim(),
        tujuan: normalizeTujuan(estateRaw),
        estate_raw: estateRaw,
        divisi: (r[12] || "").trim(),
        tanggal_terima: (r[13] || "").trim(),
        tanggal_terima_iso: toIsoDate(r[13]),
        keterangan: (r[14] || "").trim(),
      }
    );
  }

  const count = (await queryOne<{ c: number }>("SELECT COUNT(*) c FROM stock_in_log"))!.c;
  console.log(`Imported ${count} stock-in records.`);
}

async function importStockOut() {
  const csvPath = path.join(__dirname, "..", "data_stock_out.csv");
  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows: string[][] = parse(raw, { relax_column_count: true });
  const dataRows = rows.slice(1).filter((r) => r[4] && r[4].trim());

  await execute("DELETE FROM stock_out_log");

  for (const r of dataRows) {
    const kode = r[4].trim();
    const item = await queryOne<{ id: number }>("SELECT id FROM items WHERE kode = @kode", { kode });
    const estateRaw = (r[12] || "").trim();
    await execute(
      `INSERT INTO stock_out_log
        (item_id, kode, nama, no_request, no_po, req_by, qty, satuan, tanggal_keluar, tanggal_keluar_iso, nik_ktp, penerima, tujuan, estate_raw, divisi, no_embrace_gudang, keterangan, nik_karyawan)
       VALUES (@item_id, @kode, @nama, @no_request, @no_po, @req_by, @qty, @satuan, @tanggal_keluar, @tanggal_keluar_iso, @nik_ktp, @penerima, @tujuan, @estate_raw, @divisi, @no_embrace_gudang, @keterangan, @nik_karyawan)`,
      {
        item_id: item?.id ?? null,
        kode,
        nama: (r[5] || "").trim(),
        no_request: (r[1] || "").trim(),
        no_po: (r[2] || "").trim(),
        req_by: (r[3] || "").trim(),
        qty: num(r[7]),
        satuan: (r[8] || "").trim(),
        tanggal_keluar: (r[9] || "").trim(),
        tanggal_keluar_iso: toIsoDate(r[9]),
        nik_ktp: (r[10] || "").trim(),
        penerima: (r[11] || "").trim(),
        tujuan: normalizeTujuan(estateRaw),
        estate_raw: estateRaw,
        divisi: (r[13] || "").trim(),
        no_embrace_gudang: (r[15] || "").trim(),
        keterangan: (r[16] || "").trim(),
        nik_karyawan: (r[17] || "").trim(),
      }
    );
  }

  const count = (await queryOne<{ c: number }>("SELECT COUNT(*) c FROM stock_out_log"))!.c;
  console.log(`Imported ${count} stock-out records.`);
}

async function main() {
  await importStockIn();
  await importStockOut();
  await pool.end();
}

main();
