// One-off for moving to a VPS (deploy/PINDAH-VPS.md): copies every foto bukti in the `evidence`
// table from the Supabase Storage bucket to EVIDENCE_DIR, at the same path (YYYY-MM/<id>.<ext>), so
// GET /api/evidence/:id finds it on disk. Safe to run again: files already there are skipped.
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... EVIDENCE_DIR=/var/lib/agrobarokah/evidence npm run evidence:copy
import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { pool } from "./db.js";

const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_KEY ?? "";
const dir = process.env.EVIDENCE_DIR ?? "";
if (!url || !key || !dir) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_KEY dan EVIDENCE_DIR wajib diisi");
const headers: Record<string, string> = key.startsWith("sb_") ? { apikey: key } : { Authorization: `Bearer ${key}`, apikey: key };

const rows = (await pool.query<{ path: string }>("SELECT path FROM evidence ORDER BY created_at")).rows;
let copied = 0,
  skipped = 0;
const failed: string[] = [];
for (const { path: p } of rows) {
  const file = path.join(dir, p);
  if (await fs.stat(file).then(() => true, () => false)) {
    skipped++;
    continue;
  }
  const r = await fetch(`${url}/storage/v1/object/evidence/${p}`, { headers });
  if (!r.ok) {
    failed.push(`${p} (${r.status})`);
    continue;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
  if (++copied % 50 === 0) console.log(`${copied} foto disalin...`);
}
console.log(`Selesai: ${copied} disalin, ${skipped} sudah ada, ${failed.length} gagal dari ${rows.length} foto.`);
if (failed.length) console.log("Gagal:\n" + failed.join("\n"));
await pool.end();
