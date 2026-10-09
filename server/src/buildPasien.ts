// One-off: builds Master Pasien (klinik_pasien) from the visits read from the Daily Report sheets and
// links every visit to its patient. Run before patients are kept in the app; it rebuilds the list.
//   npm run build:pasien
import "dotenv/config";
import { execute, queryMany, withTransaction, pool } from "./db.js";
import { namaKey, namaMirip, tahunOf } from "./pasien.js";

type Visit = {
  id: number;
  klinik: string;
  tanggal_iso: string;
  nama_pasien: string;
  jenis_kelamin: string;
  tanggal_lahir_iso: string | null;
  status_pasien: string;
  penanggung: string;
  jabatan: string;
  divisi: string;
  tempat_tinggal: string;
  asal_pasien: string;
};

// Most frequent value (the latest one on a tie); visits come oldest first.
function mode(values: string[]) {
  const n = new Map<string, number>();
  values.forEach((v) => n.set(v, (n.get(v) ?? 0) + 1));
  let best = "", bestN = 0;
  for (const v of values) {
    if (n.get(v)! < bestN) continue;
    best = v;
    bestN = n.get(v)!;
  }
  return best;
}
const latest = (vs: Visit[], k: keyof Visit) => [...vs].reverse().map((v) => String(v[k] ?? "").trim()).find(Boolean) ?? "";

const visits = await queryMany<Visit>(
  `SELECT id, klinik, tanggal_iso, nama_pasien, jenis_kelamin, tanggal_lahir_iso, status_pasien, penanggung, jabatan, divisi, tempat_tinggal, asal_pasien
   FROM klinik_kunjungan ORDER BY tanggal_iso, id`,
  {}
);

// Same estate + name, then split by birth year (a year apart at most).
const groups = new Map<string, Visit[]>();
for (const v of visits) {
  const k = `${v.klinik}|${namaKey(v.nama_pasien)}`;
  (groups.get(k) ?? groups.set(k, []).get(k)!).push(v);
}
const patients: Visit[][] = [];
for (const vs of groups.values()) {
  const dated = vs.filter((v) => v.tanggal_lahir_iso).sort((a, b) => tahunOf(a.tanggal_lahir_iso)! - tahunOf(b.tanggal_lahir_iso)!);
  const clusters: Visit[][] = [];
  for (const v of dated) {
    const c = clusters.at(-1);
    if (c && tahunOf(v.tanggal_lahir_iso)! - tahunOf(c[0].tanggal_lahir_iso)! <= 1) c.push(v);
    else clusters.push([v]);
  }
  // Visits without a birth date go to the person seen most often under that name.
  const undated = vs.filter((v) => !v.tanggal_lahir_iso);
  if (undated.length) {
    if (!clusters.length) clusters.push([]);
    clusters.sort((a, b) => b.length - a.length)[0].push(...undated);
  }
  for (const c of clusters) patients.push(c.sort((a, b) => a.tanggal_iso.localeCompare(b.tanggal_iso) || a.id - b.id));
}

// The same person typed with a different spelling: born the same day, same L/P, a similar name.
const parent = patients.map((_, i) => i);
const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
const dobOf = (vs: Visit[]) => mode(vs.map((v) => v.tanggal_lahir_iso).filter((d): d is string => !!d));
const jkOf = (vs: Visit[]) => mode(vs.map((v) => v.jenis_kelamin).filter(Boolean));
const byBirth = new Map<string, number[]>();
patients.forEach((vs, i) => {
  const dob = dobOf(vs);
  if (!dob) return;
  const k = `${vs[0].klinik}|${dob}|${jkOf(vs)}`;
  (byBirth.get(k) ?? byBirth.set(k, []).get(k)!).push(i);
});
let merged = 0;
for (const ids of byBirth.values())
  for (let x = 0; x < ids.length; x++)
    for (let y = x + 1; y < ids.length; y++) {
      const a = ids[x], b = ids[y];
      if (root(a) === root(b) || !namaMirip(patients[a][0].nama_pasien, patients[b][0].nama_pasien)) continue;
      parent[root(b)] = root(a);
      merged++;
    }
const joined = new Map<number, Visit[]>();
patients.forEach((vs, i) => (joined.get(root(i)) ?? joined.set(root(i), []).get(root(i))!).push(...vs));
patients.length = 0;
for (const vs of joined.values()) patients.push(vs.sort((a, b) => a.tanggal_iso.localeCompare(b.tanggal_iso) || a.id - b.id));
console.log(`${merged} ejaan nama digabung (tanggal lahir & L/P sama)`);

const rows = patients.map((vs) => {
  const dobs = vs.map((v) => v.tanggal_lahir_iso).filter((d): d is string => !!d);
  return {
    estate: vs[0].klinik,
    nama: mode(vs.map((v) => v.nama_pasien.trim())),
    jenis_kelamin: mode(vs.map((v) => v.jenis_kelamin).filter(Boolean)),
    tanggal_lahir_iso: dobs.length ? mode(dobs) : null,
    status_pasien: latest(vs, "status_pasien"),
    penanggung: latest(vs, "penanggung"),
    jabatan: latest(vs, "jabatan"),
    divisi: latest(vs, "divisi"),
    tempat_tinggal: latest(vs, "tempat_tinggal"),
    asal_pasien: latest(vs, "asal_pasien"),
    visit_ids: vs.map((v) => v.id),
  };
});

await withTransaction(async (c) => {
  await execute("UPDATE klinik_kunjungan SET pasien_id = NULL", {}, c);
  await execute("DELETE FROM klinik_pasien", {}, c);
  const ids = (await queryMany<{ id: number }>("SELECT nextval('klinik_pasien_id_seq')::int id FROM generate_series(1, @n)", { n: rows.length }, c)).map((r) => r.id);
  await execute(
    `INSERT INTO klinik_pasien (id, estate, nama, jenis_kelamin, tanggal_lahir_iso, status_pasien, penanggung, jabatan, divisi, tempat_tinggal, asal_pasien)
     SELECT x.id, x.estate, x.nama, x.jenis_kelamin, x.tanggal_lahir_iso, x.status_pasien, x.penanggung, x.jabatan, x.divisi, x.tempat_tinggal, x.asal_pasien
     FROM json_to_recordset(@rows::json) AS x(id int, estate text, nama text, jenis_kelamin text, tanggal_lahir_iso text, status_pasien text, penanggung text, jabatan text, divisi text, tempat_tinggal text, asal_pasien text)`,
    { rows: JSON.stringify(rows.map(({ visit_ids: _v, ...r }, i) => ({ ...r, id: ids[i] }))) },
    c
  );
  await execute(
    `UPDATE klinik_kunjungan k SET pasien_id = x.pasien_id FROM json_to_recordset(@rows::json) AS x(id int, pasien_id int) WHERE k.id = x.id`,
    { rows: JSON.stringify(rows.flatMap((r, i) => r.visit_ids.map((id) => ({ id, pasien_id: ids[i] })))) },
    c
  );
});
const per = new Map<string, number>();
rows.forEach((r) => per.set(r.estate, (per.get(r.estate) ?? 0) + 1));
console.log(`${rows.length} pasien dari ${visits.length} kunjungan:`, Object.fromEntries(per));
await pool.end();
