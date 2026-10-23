// One-time import of the old Rekap Pruning sheet into the app (pruning_target + pruning_log, sumber
// 'sheet'): every blok's Ha and SPH, and per sheet row the pokok / Ha pruned in each month as one
// entry on the 1st of that month. After this the app is the place where pruning is entered.
//   npx tsx server/src/importPruning.ts
// Refuses to run twice (rows from the sheet are already there).
import "dotenv/config";
import { execute, pool, queryOne, withTransaction } from "./db.js";
import { parsePruning, PRUNING_SHEET } from "./pruning.js";

async function main() {
  const done = await queryOne<{ n: number }>("SELECT COUNT(*)::int n FROM pruning_log WHERE sumber = 'sheet'");
  if (done && done.n > 0) throw new Error(`Sudah diimpor (${done.n} baris dari sheet), tidak diulang.`);

  const r = await fetch(PRUNING_SHEET, { redirect: "follow" });
  if (!r.ok) throw new Error(`Sheet tidak bisa dibaca (HTTP ${r.status})`);
  const { rows } = parsePruning(await r.text());

  // One target per estate + blok: a blok split over two sheet rows adds its Ha, SPH weighted by Ha.
  const target = new Map<string, { estate: string; blok: string; divisi: Set<string>; ha: number; pokok: number; urut: number }>();
  for (const x of rows) {
    const k = `${x.estate}|${x.blok.toUpperCase()}`;
    const t = target.get(k) ?? { estate: x.estate, blok: x.blok, divisi: new Set<string>(), ha: 0, pokok: 0, urut: x.urut };
    if (x.divisi) t.divisi.add(x.divisi);
    t.ha += x.ha ?? 0;
    t.pokok += (x.ha ?? 0) * (x.sph ?? 0);
    target.set(k, t);
  }
  const t = [...target.values()];
  const log = rows.flatMap((x) =>
    x.bulan.map((m) => ({ estate: x.estate, blok: x.blok, tanggal: `${m.tahun}-${String(m.bulan).padStart(2, "0")}-01`, pkk: m.pkk, ha: m.ha }))
  );

  await withTransaction(async (c) => {
    await execute(
      `INSERT INTO pruning_target (estate, blok, divisi, ha, sph, urut)
       SELECT * FROM unnest(@estate::text[], @blok::text[], @divisi::text[], @ha::float8[], @sph::float8[], @urut::int[])
       ON CONFLICT (estate, upper(blok)) DO NOTHING`,
      {
        estate: t.map((x) => x.estate),
        blok: t.map((x) => x.blok),
        divisi: t.map((x) => [...x.divisi].join(" / ")),
        ha: t.map((x) => Math.round(x.ha * 100) / 100),
        sph: t.map((x) => (x.ha ? x.pokok / x.ha : null)),
        urut: t.map((x) => x.urut),
      },
      c
    );
    await execute(
      `INSERT INTO pruning_log (estate, blok, tanggal_iso, pkk, ha, keterangan, sumber, created_by)
       SELECT e, b, d, p, h, 'Rekap sheet (total bulan)', 'sheet', 'Impor sheet'
       FROM unnest(@estate::text[], @blok::text[], @tanggal::text[], @pkk::float8[], @ha::float8[]) AS x(e, b, d, p, h)`,
      { estate: log.map((x) => x.estate), blok: log.map((x) => x.blok), tanggal: log.map((x) => x.tanggal), pkk: log.map((x) => x.pkk), ha: log.map((x) => x.ha) },
      c
    );
  });
  console.log(`Target ${t.length} blok, ${log.length} baris pruning diimpor dari ${rows.length} baris sheet.`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
