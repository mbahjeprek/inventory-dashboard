// Rekap Pruning PT.AKSS: reads the old "AKSS - BLOCK DETAIL" pruning sheet (one row per blok, then per
// year and month the pokok (PKK) and Ha pruned). Pure parsing here; importPruning.ts brought it into
// the app once (pruning_target / pruning_log), where pruning is entered since.
import { parse } from "csv-parse/sync";

export const PRUNING_SHEET = "https://docs.google.com/spreadsheets/d/1c8DmOgN2L56OJsmvDgOJPr8ImG4oaZZd_FSOGJq75Xs/export?format=csv&gid=993841382";

export type PruningBulan = { tahun: number; bulan: number; pkk: number; ha: number };
export type PruningBlok = {
  estate: string;
  divisi: string;
  blok: string;
  planting_material: string;
  tahun_tanam: number | null;
  ha: number | null;
  sph: number | null;
  kondisi: string;
  urut: number;
  bulan: PruningBulan[];
};

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
// " 1,837 " -> 1837, " (850)" -> -850, " - " / "" / "#DIV/0!" -> null.
const num = (v: string | undefined): number | null => {
  let s = clean(v).replace(/,/g, "");
  if (!s || s === "-") return null;
  const neg = /^\(.*\)$/.test(s);
  if (neg) s = s.slice(1, -1);
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};
const ESTATE_OF: Record<string, string> = { nilam: "NILAM", zamrud: "ZAMRUD", firus: "FIRUS", kns: "KNS", wja: "WJA" };

export function parsePruning(csv: string): { rows: PruningBlok[]; tahun: number[] } {
  const grid: string[][] = parse(csv, { relax_column_count: true, skip_empty_lines: false });
  // The header row starts with ESTATE; the year headers (2020, 2021, ...) sit on it, each followed by
  // 12 months of PKK / HA pairs, up to TOTAL KESELURUHAN.
  const h = grid.findIndex((r) => clean(r[0]).toUpperCase() === "ESTATE");
  if (h < 0) throw new Error("Header ESTATE tidak ditemukan di sheet pruning");
  const head = grid[h].map((c) => clean(c).toUpperCase());
  const col = (re: RegExp) => head.findIndex((c) => re.test(c));
  const c = {
    estate: 0,
    divisi: col(/^DIVISI$/),
    blok: col(/^BLOK$/),
    pm: col(/^PLANTING/),
    tt: col(/^TAHUN TANAM$/),
    ha: col(/^HA$/),
    sph: col(/^SPH$/),
    kondisi: col(/^KONDISI/),
  };
  if (c.blok < 0 || c.ha < 0) throw new Error("Kolom Blok / Ha tidak ditemukan di sheet pruning");
  const years = head.map((v, i) => [Number(v), i] as const).filter(([y]) => Number.isInteger(y) && y >= 2000 && y <= 2100);

  const rows: PruningBlok[] = [];
  for (let i = h + 1; i < grid.length; i++) {
    const r = grid[i];
    const estate = ESTATE_OF[clean(r[c.estate]).toLowerCase()];
    const blok = clean(r[c.blok]);
    if (!estate || !blok) continue; // empty lines, per-divisi / estate totals
    const bulan: PruningBulan[] = [];
    for (const [tahun, start] of years)
      for (let m = 0; m < 12; m++) {
        const pkk = num(r[start + m * 2]) ?? 0;
        const ha = num(r[start + m * 2 + 1]) ?? 0;
        if (pkk || ha) bulan.push({ tahun, bulan: m + 1, pkk, ha });
      }
    rows.push({
      estate,
      divisi: c.divisi >= 0 ? clean(r[c.divisi]) : "",
      blok,
      planting_material: c.pm >= 0 ? clean(r[c.pm]) : "",
      tahun_tanam: c.tt >= 0 ? num(r[c.tt]) : null,
      ha: num(r[c.ha]),
      sph: c.sph >= 0 ? num(r[c.sph]) : null,
      kondisi: c.kondisi >= 0 ? clean(r[c.kondisi]) : "",
      urut: rows.length + 1,
      bulan,
    });
  }
  if (!rows.length) throw new Error("Tidak ada baris blok di sheet pruning");
  return { rows, tahun: years.map(([y]) => y) };
}
