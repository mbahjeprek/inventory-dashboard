import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { execute, queryOne, pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const csvPath = path.join(__dirname, "..", "data_raw.csv");
const raw = fs.readFileSync(csvPath, "utf-8");

const rows: string[][] = parse(raw, { relax_column_count: true });

// row 0 = destination group header (Nilam/Zamrud/Firus - just consumer breakdown, not separate warehouses), row 1 = column names, row 2.. = data
const dataRows = rows.slice(2).filter((r) => r[0] && r[0].trim() !== "");

const num = (v: string) => {
  const n = parseInt((v || "0").replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
};

// Offsets of the per-destination (Nilam/Zamrud/Firus) breakdown columns in the source sheet.
// These are summed into single totals since there is only one physical stock pool.
const DESTINATION_OFFSETS = [6, 11, 16];

async function main() {
  for (const r of dataRows) {
    const kode = r[0].trim();
    const nama = (r[1] || "").trim();
    if (!kode || !nama) continue;

    const stockTersedia = num(r[5]);

    let stockIn = 0;
    let stockOut = 0;
    let stockFisik = 0;
    let selisih = 0;
    for (const offset of DESTINATION_OFFSETS) {
      stockIn += num(r[offset + 1]);
      stockOut += num(r[offset + 2]);
      stockFisik += num(r[offset + 3]);
      selisih += num(r[offset + 4]);
    }

    await execute(
      `INSERT INTO items (kode, nama, satuan, buffer_stock, keterangan, stock_tersedia, stock_in, stock_out, stock_fisik, selisih_stock)
       VALUES (@kode, @nama, @satuan, @buffer_stock, @keterangan, @stock_tersedia, @stock_in, @stock_out, @stock_fisik, @selisih_stock)
       ON CONFLICT(kode) DO UPDATE SET
         nama=excluded.nama, satuan=excluded.satuan, buffer_stock=excluded.buffer_stock,
         keterangan=excluded.keterangan, stock_tersedia=excluded.stock_tersedia,
         stock_in=excluded.stock_in, stock_out=excluded.stock_out,
         stock_fisik=excluded.stock_fisik, selisih_stock=excluded.selisih_stock`,
      {
        kode,
        nama,
        satuan: (r[2] || "").trim(),
        buffer_stock: num(r[3]),
        keterangan: stockTersedia > 0 ? "AMAN" : "BUFFER STOCK",
        stock_tersedia: stockTersedia,
        stock_in: stockIn,
        stock_out: stockOut,
        stock_fisik: stockFisik,
        selisih_stock: selisih,
      }
    );
  }

  const count = (await queryOne<{ c: number }>("SELECT COUNT(*) c FROM items"))!.c;
  console.log(`Imported ${count} items.`);
  await pool.end();
}

main();
