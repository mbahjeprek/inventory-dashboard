import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { execute, queryOne, pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const csvPath = path.join(__dirname, "..", "data_alat_berat.csv");
const raw = fs.readFileSync(csvPath, "utf-8");

const rows: string[][] = parse(raw, { relax_column_count: true });

// row 0 = sheet title, row 1 = month headers, row 2 = Nilam/Zamrud/Firus/Total sub-headers, row 3.. = data.
// Only the first 3 columns (JENIS UNIT, model/nama, KODE KENDARAAN/ALAT) are master data -
// the rest are monthly fuel usage figures, not part of the equipment master.
const dataRows = rows.slice(3).filter((r) => r[2] && r[2].trim() !== "");

async function main() {
  for (const r of dataRows) {
    const kode = r[2].trim();
    if (!kode) continue;

    await execute(
      `INSERT INTO alat_berat (kode, jenis_unit, nama)
       VALUES (@kode, @jenis_unit, @nama)
       ON CONFLICT(kode) DO UPDATE SET jenis_unit = excluded.jenis_unit, nama = excluded.nama`,
      {
        kode,
        jenis_unit: (r[0] || "").trim(),
        nama: (r[1] || "").trim(),
      }
    );
  }

  const count = (await queryOne<{ c: number }>("SELECT COUNT(*) c FROM alat_berat"))!.c;
  console.log(`Imported ${count} alat berat.`);
  await pool.end();
}

main();
