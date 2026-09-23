import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { execute, queryOne, pool } from "./db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const csvPath = path.join(__dirname, "..", "data_karyawan.csv");
const raw = fs.readFileSync(csvPath, "utf-8");

const rows: string[][] = parse(raw, { relax_column_count: true });

// row 0 = column header, row 1.. = data. Trailing rows with no NIK/nama are blank padding or the legend footer.
const dataRows = rows.slice(1);

async function main() {
  for (const r of dataRows) {
    const status = (r[0] || "").trim();
    const nik = (r[1] || "").trim();
    const nama = (r[2] || "").trim();
    if (!nik || !nama) continue;

    await execute(
      `INSERT INTO karyawan (nik, nama, status, estate, lokasi_kerja, nik_ktp)
       VALUES (@nik, @nama, @status, @estate, @lokasi_kerja, @nik_ktp)
       ON CONFLICT(nik) DO UPDATE SET
         nama=excluded.nama, status=excluded.status, estate=excluded.estate,
         lokasi_kerja=excluded.lokasi_kerja, nik_ktp=excluded.nik_ktp`,
      {
        nik,
        nama,
        status,
        estate: (r[3] || "").trim(),
        lokasi_kerja: (r[4] || "").trim(),
        nik_ktp: (r[5] || "").trim(),
      }
    );
  }

  const count = (await queryOne<{ c: number }>("SELECT COUNT(*) c FROM karyawan"))!.c;
  console.log(`Imported ${count} karyawan.`);
  await pool.end();
}

main();
