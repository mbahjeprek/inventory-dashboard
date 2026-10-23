// One-time: the Rekap Pruning rows as the sheet has them (pruning_baris, row for row - the first import
// had merged a blok's two rows into one pruning_target), and every entry imported from the sheet linked
// to the row it came from (pruning_log.baris_id); entries made in the app go to their blok's first row.
//   npx tsx server/src/importPruningBaris.ts
// Refuses to run twice.
import "dotenv/config";
import { execute, pool, queryMany, queryOne, withTransaction } from "./db.js";
import { parsePruning, PRUNING_SHEET } from "./pruning.js";

async function main() {
  const done = await queryOne<{ n: number }>("SELECT COUNT(*)::int n FROM pruning_baris");
  if (done && done.n > 0) throw new Error(`pruning_baris sudah terisi (${done.n} baris), tidak diulang.`);
  const r = await fetch(PRUNING_SHEET, { redirect: "follow" });
  if (!r.ok) throw new Error(`Sheet tidak bisa dibaca (HTTP ${r.status})`);
  const { rows } = parsePruning(await r.text());

  await withTransaction(async (c) => {
    const ids = await queryMany<{ id: number; urut: number }>(
      `INSERT INTO pruning_baris (estate, divisi, blok, planting_material, tahun_tanam, ha, sph, pkk, kondisi, field_number, urut)
       SELECT * FROM unnest(@estate::text[], @divisi::text[], @blok::text[], @pm::text[], @tt::int[], @ha::float8[], @sph::float8[], @pkk::int[], @kondisi::text[], @field::text[], @urut::int[])
       RETURNING id, urut`,
      {
        estate: rows.map((x) => x.estate),
        divisi: rows.map((x) => x.divisi),
        blok: rows.map((x) => x.blok),
        pm: rows.map((x) => x.planting_material),
        tt: rows.map((x) => (x.tahun_tanam === null ? null : Math.round(x.tahun_tanam))),
        ha: rows.map((x) => x.ha),
        sph: rows.map((x) => x.sph),
        pkk: rows.map((x) => (x.pkk === null ? (x.ha && x.sph ? Math.round(x.ha * x.sph) : null) : Math.round(x.pkk))),
        kondisi: rows.map((x) => x.kondisi),
        field: rows.map((x) => x.field_number),
        urut: rows.map((x) => x.urut),
      },
      c
    );
    const idOf = new Map(ids.map((x) => [x.urut, x.id]));
    // The sheet's month totals, in the order the first import inserted them (rows, then months), matched
    // to the imported entries with the same estate / blok / month / pokok / Ha, n-th to n-th.
    const want = rows.flatMap((x) =>
      x.bulan.map((m) => ({ bid: idOf.get(x.urut)!, e: x.estate, b: x.blok.toUpperCase(), d: `${m.tahun}-${String(m.bulan).padStart(2, "0")}-01`, p: m.pkk, h: Math.round(m.ha * 10000) / 10000 }))
    );
    const res = await execute(
      `WITH w AS (
         SELECT *, row_number() OVER (PARTITION BY e, b, d, p, h ORDER BY ord) rn
         FROM unnest(@bid::int[], @e::text[], @b::text[], @d::text[], @p::float8[], @h::float8[]) WITH ORDINALITY AS x(bid, e, b, d, p, h, ord)
       ), l AS (
         SELECT id, estate e, upper(blok) b, tanggal_iso d, pkk p, round(ha::numeric, 4)::float8 h,
           row_number() OVER (PARTITION BY estate, upper(blok), tanggal_iso, pkk, round(ha::numeric, 4) ORDER BY id) rn
         FROM pruning_log WHERE sumber = 'sheet' AND baris_id IS NULL
       )
       UPDATE pruning_log t SET baris_id = w.bid FROM l JOIN w USING (e, b, d, p, h, rn) WHERE t.id = l.id`,
      { bid: want.map((x) => x.bid), e: want.map((x) => x.e), b: want.map((x) => x.b), d: want.map((x) => x.d), p: want.map((x) => x.p), h: want.map((x) => x.h) },
      c
    );
    // Anything else (entered in the app): the blok's first row.
    await execute(
      `UPDATE pruning_log l SET baris_id = (SELECT b.id FROM pruning_baris b WHERE b.estate = l.estate AND upper(b.blok) = upper(l.blok) ORDER BY b.urut LIMIT 1)
       WHERE l.baris_id IS NULL`,
      {},
      c
    );
    const left = await queryOne<{ n: number }>("SELECT COUNT(*)::int n FROM pruning_log WHERE baris_id IS NULL", {}, c);
    console.log(`${ids.length} baris rekap; ${res.rowCount} entri sheet tertaut ke barisnya; ${left?.n ?? 0} entri tanpa baris.`);
  });
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
