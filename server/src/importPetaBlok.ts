import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execute, pool, queryOne, withTransaction } from "./db.js";

// Peta Blok layout from server/data_peta_blok.json (read off the "mapping pemupukan npk akss" sheet:
// each blok's cell position, 3 sheet columns x 2 rows per box, hidden columns left out). Replaces
// the layout but keeps a colour painted on a blok of the same name and place. Seeds the progress
// legend of the sheet when there is none yet.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data_peta_blok.json"), "utf-8")) as {
  labels: { text: string; gx: number; gy: number }[];
  cells: { label: string; gx: number; gy: number; h: number; estate: string | null }[];
};

async function main() {
  await withTransaction(async (c) => {
    const kept = await c.query("SELECT label, gx, gy, warna FROM peta_blok WHERE warna IS NOT NULL");
    const warna = new Map(kept.rows.map((r: any) => [`${r.label}|${r.gx}|${r.gy}`, r.warna]));
    await execute("DELETE FROM peta_blok", {}, c);
    for (const l of seed.labels)
      await execute("INSERT INTO peta_blok (kind, label, gx, gy) VALUES ('label', @text, @gx, @gy)", l, c);
    for (const b of seed.cells)
      await execute(
        "INSERT INTO peta_blok (kind, label, gx, gy, h, estate, warna) VALUES ('blok', @label, @gx, @gy, @h, @estate, @warna)",
        { ...b, warna: warna.get(`${b.label}|${b.gx}|${b.gy}`) ?? null },
        c
      );
    if (!(await queryOne<{ n: number }>("SELECT COUNT(*)::int n FROM peta_legend", {}, c))!.n) {
      const legend = [
        { dari: 0, label: "Progress pemupukan NPK 0% - 9%", warna: "#ffffff" },
        { dari: 10, label: "Progress pemupukan NPK 10% - 49%", warna: "#ff0000" },
        { dari: 50, label: "Progress pemupukan NPK 50% - 99%", warna: "#ffff00" },
        { dari: 100, label: "Progress pemupukan NPK 100%", warna: "#6aa84f" },
      ];
      for (const l of legend) await execute("INSERT INTO peta_legend (dari, label, warna) VALUES (@dari, @label, @warna)", l, c);
    }
  });
  console.log(`${seed.cells.length} blok + ${seed.labels.length} label di peta`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
