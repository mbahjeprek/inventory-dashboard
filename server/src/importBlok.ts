import "dotenv/config";
import { parse } from "csv-parse/sync";
import { execute, pool, queryMany, withTransaction } from "./db.js";

// Master Blok from the "AKSS - BLOCK DETAIL" tab of the block sheet, row for row (see schema.sql
// master_blok). Replaces the whole table, so it can be run again after the sheet changes - only
// before blok are referenced elsewhere. Header on row 2, blank rows skipped, sheet order kept in urut.
const SHEET = "https://docs.google.com/spreadsheets/d/1drAO4_6QqoATXlvO3a8AZiWoze4aLD1F3qcVZGOHBuE/export?format=csv&gid=2067541582";

// "  17,93 " -> 17.93, "  2.655 " -> 2655 (Indonesian decimal comma, thousands dot); "" -> null.
const idNumber = (v: string) => {
  const s = v.trim().replace(/\./g, "").replace(",", ".");
  return s === "" || s === "-" || !Number.isFinite(Number(s)) ? null : Number(s);
};

async function main() {
  const res = await fetch(SHEET);
  if (!res.ok) throw new Error(`Sheet: HTTP ${res.status}`);
  const rows: string[][] = parse(await res.text(), { relax_column_count: true });
  const header = rows[1].map((h) => h.trim().toLowerCase());
  if (header.join("|") !== "estate|divisi|blok|planting material|tahun tanam|ha|sph|pkk") throw new Error(`Kolom sheet berubah: ${rows[1].join(" | ")}`);

  const data = rows
    .slice(2)
    .filter((r) => (r[0] ?? "").trim() && (r[2] ?? "").trim())
    .map((r, i) => ({
      estate: r[0].trim().toUpperCase(),
      divisi: (r[1] ?? "").trim(),
      blok: r[2].trim(),
      planting_material: (r[3] ?? "").trim(),
      tahun_tanam: idNumber(r[4] ?? ""),
      ha: idNumber(r[5] ?? ""),
      sph: idNumber(r[6] ?? ""),
      pkk: idNumber(r[7] ?? ""),
      urut: i + 1,
    }));
  const unknown = data.filter((d) => !["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"].includes(d.estate));
  if (unknown.length) throw new Error(`Estate tidak dikenal: ${[...new Set(unknown.map((d) => d.estate))].join(", ")}`);

  await withTransaction(async (c) => {
    await execute("DELETE FROM master_blok", {}, c);
    for (const d of data)
      await execute(
        `INSERT INTO master_blok (estate, divisi, blok, planting_material, tahun_tanam, ha, sph, pkk, urut)
         VALUES (@estate, @divisi, @blok, @planting_material, @tahun_tanam, @ha, @sph, @pkk, @urut)`,
        d,
        c
      );
  });
  console.log(`${data.length} blok diimpor`);
  const per = await queryMany("SELECT estate, divisi, COUNT(*)::int n, ROUND(SUM(ha)::numeric, 2) ha, SUM(pkk)::int pkk FROM master_blok GROUP BY 1, 2 ORDER BY 1, 2");
  for (const r of per) console.log(`  ${r.estate.padEnd(7)} ${r.divisi.padEnd(11)} ${String(r.n).padStart(3)} blok  ${r.ha} Ha  ${r.pkk} pokok`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
