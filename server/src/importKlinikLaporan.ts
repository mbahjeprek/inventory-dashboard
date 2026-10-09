// One-off move of the clinics' Daily Report Google Sheets (from the start of the year) into
// klinik_kunjungan, after which visits are entered in the app (Klinik > Laporan Harian). Rerunning it
// replaces the rows read from a sheet (sumber = 'SHEET') and keeps the ones typed in the app.
//   npm run import:klinik-laporan            all clinics below
//   npm run import:klinik-laporan -- FIRUS   one clinic
import "dotenv/config";
import { execute, queryMany, withTransaction, pool } from "./db.js";
import { parseDailyReport, sheetCsvUrl } from "./klinikLaporan.js";

const SHEETS: Record<string, string> = {
  NILAM: "https://docs.google.com/spreadsheets/d/1-ly04gh2metJkQlDjELpm8qSRl3NrpkE0ZZnF3EhUGI/edit?gid=0",
  ZAMRUD: "https://docs.google.com/spreadsheets/d/1LDRcGd6_TQaD8X7Gcq5qrolpgkwfJHJhZX1suiZtK0Y/edit?gid=0",
  FIRUS: "https://docs.google.com/spreadsheets/d/1gJ_XThe7sawia3ppq_RXtyZEeB2ABKDcqfrYDwNaTbc/edit?gid=0",
};

async function importKlinik(klinik: string, url: string) {
  const r = await fetch(sheetCsvUrl(url)!, { redirect: "follow" });
  if (!r.ok || !(r.headers.get("content-type") ?? "").includes("text/csv")) throw new Error(`${klinik}: sheet tidak bisa dibaca (dibagikan lewat link?)`);
  const { rows, skipped } = parseDailyReport(await r.text());
  await withTransaction(async (c) => {
    await execute("DELETE FROM klinik_kunjungan WHERE klinik = @klinik AND sumber = 'SHEET'", { klinik }, c);
    // Ids first, so the obat rows can point at their visit in one statement.
    const ids = (await queryMany<{ id: number }>("SELECT nextval('klinik_kunjungan_id_seq')::int id FROM generate_series(1, @n)", { n: rows.length }, c)).map((x) => x.id);
    const cols = Object.keys(rows[0]).filter((k) => k !== "obat");
    const types: Record<string, string> = { no: "int", usia: "int", hari_istirahat: "int", kecelakaan_kerja: "boolean", istirahat: "boolean", rujukan: "boolean" };
    await execute(
      `INSERT INTO klinik_kunjungan (id, klinik, sumber, created_at, created_by, ${cols.join(", ")})
       SELECT x.id, @klinik, 'SHEET', NULL, 'Google Sheet', ${cols.map((k) => `x.${k}`).join(", ")}
       FROM json_to_recordset(@rows::json) AS x(id int, ${cols.map((k) => `${k} ${types[k] ?? "text"}`).join(", ")})`,
      { klinik, rows: JSON.stringify(rows.map(({ obat: _obat, ...v }, i) => ({ ...v, id: ids[i] }))) },
      c
    );
    const obat = rows.flatMap((v, i) => v.obat.map((o, j) => ({ ...o, urut: j + 1, kunjungan_id: ids[i] })));
    if (obat.length)
      await execute(
        `INSERT INTO klinik_kunjungan_obat (kunjungan_id, urut, obat_kode, nama_obat, qty, satuan)
         SELECT x.kunjungan_id, x.urut, x.obat_kode, x.nama_obat, x.qty, x.satuan
         FROM json_to_recordset(@rows::json) AS x(kunjungan_id int, urut int, obat_kode text, nama_obat text, qty float8, satuan text)`,
        { rows: JSON.stringify(obat) },
        c
      );
  });
  const range = rows.map((v) => v.tanggal_iso).sort();
  console.log(`${klinik}: ${rows.length} kunjungan (${range[0]} s/d ${range.at(-1)}), ${rows.reduce((t, v) => t + v.obat.length, 0)} terapi${skipped ? `, ${skipped} baris dilewati` : ""}`);
}

const only = process.argv.slice(2).map((a) => a.toUpperCase());
for (const [klinik, url] of Object.entries(SHEETS)) if (!only.length || only.includes(klinik)) await importKlinik(klinik, url);
await pool.end();
