import type { PruningRekapBaris, PruningRekapData } from "./api";

// The Rekap Pruning as the sheet "AKSS - BLOCK DETAIL" lays it out, and its formulas, in one place for
// the page and the Excel file:
//   PKK                     = Ha x SPH (the row's own, rounded as in the sheet)
//   per month               = pokok (PKK) and Ha pruned that month
//   TOTAL KESELURUHAN PKK   = pokok pruned from 2022 on (the sheet's total starts at 2022), selisih = it - PKK,
//                             % = it / PKK; HA = Ha pruned from 2022 up to last year (the sheet's HA total
//                             leaves the running year out - it sits in TOTAL/TAHUN), % = it / Ha
//   TOTAL HA                = the smaller of TOTAL KESELURUHAN HA and Ha (the area covered at least once)
//   TOTAL/TAHUN (one year)  = pokok pruned that year, % = it / (Ha x SPH); HA = it / SPH, % = HA / Ha
// Bottom rows: Total keseluruhan pruning / area / belum pruning over every row; then per divisi and per
// estate (the estate lines are A + B + C, as the sheet's: C (PLASMA) is shown on its own line).

export const TOTAL_DARI = 2022;
export const BULAN_SHEET = ["JAN", "FEB", "MART", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
export const ESTATE_SHEET: Record<string, string> = { NILAM: "Nilam", ZAMRUD: "Zamrud", FIRUS: "Firus", KNS: "KNS", WJA: "WJA" };

export type Hitung = {
  total: number;
  selisih: number;
  pct: number | null;
  haTotal: number;
  pctHa: number | null;
  totalHa: number;
  tahunPkk: number;
  tahunPct: number | null;
  tahunHa: number;
  tahunPctHa: number | null;
};

const bulanOf = (b: PruningRekapBaris, y: number, m: number) => b.bulan[`${y}-${String(m).padStart(2, "0")}`] ?? [0, 0];

export function hitung(b: PruningRekapBaris, tahun: number, sekarang: number): Hitung {
  let total = 0;
  let haTotal = 0;
  let tahunPkk = 0;
  for (const [k, [p, h]] of Object.entries(b.bulan)) {
    const y = Number(k.slice(0, 4));
    if (y >= TOTAL_DARI) total += p;
    if (y >= TOTAL_DARI && y < sekarang) haTotal += h;
    if (y === tahun) tahunPkk += p;
  }
  const pkk = b.pkk ?? 0;
  const ha = b.ha ?? 0;
  const target = (b.ha ?? 0) * (b.sph ?? 0);
  const tahunHa = b.sph ? tahunPkk / b.sph : 0;
  return {
    total,
    selisih: total - pkk,
    pct: pkk ? total / pkk : null,
    haTotal,
    pctHa: ha ? haTotal / ha : null,
    totalHa: Math.min(haTotal, ha),
    tahunPkk,
    tahunPct: target ? tahunPkk / target : null,
    tahunHa,
    tahunPctHa: ha ? tahunHa / ha : null,
  };
}

export type Kelompok = {
  estate: string;
  divisi: string;
  ha: number;
  sph: number;
  pkk: number; // sum of Ha x SPH (not rounded per row)
  bulan: Record<string, [number, number]>;
  total: number;
  haTotal: number;
  totalHa: number;
  tahunPkk: number;
  tahunHa: number;
};
function kelompok(rows: PruningRekapBaris[], tahun: number, sekarang: number, estate: string, divisi: string): Kelompok {
  const k: Kelompok = { estate, divisi, ha: 0, sph: 0, pkk: 0, bulan: {}, total: 0, haTotal: 0, totalHa: 0, tahunPkk: 0, tahunHa: 0 };
  for (const b of rows) {
    const h = hitung(b, tahun, sekarang);
    k.ha += b.ha ?? 0;
    k.sph += b.sph ?? 0;
    k.pkk += (b.ha ?? 0) * (b.sph ?? 0);
    for (const [m, [p, x]] of Object.entries(b.bulan)) {
      const c = k.bulan[m] ?? [0, 0];
      k.bulan[m] = [c[0] + p, c[1] + x];
    }
    k.total += h.total;
    k.haTotal += h.haTotal;
    k.totalHa += h.totalHa;
    k.tahunPkk += h.tahunPkk;
    k.tahunHa += h.tahunHa;
  }
  return k;
}
const plasma = (d: string) => /plasma/i.test(d);
const ESTATE_URUT = ["NILAM", "ZAMRUD", "FIRUS", "KNS", "WJA"];

export function ringkasan(data: PruningRekapData, rows: PruningRekapBaris[], tahun: number) {
  const semua = kelompok(rows, tahun, data.sekarang, "", "");
  const estates = [...new Set(rows.map((b) => b.estate))].sort((a, b) => ESTATE_URUT.indexOf(a) - ESTATE_URUT.indexOf(b));
  const perDivisi = estates.flatMap((e) =>
    [...new Set(rows.filter((b) => b.estate === e).map((b) => b.divisi))]
      .sort()
      .map((d) => kelompok(rows.filter((b) => b.estate === e && b.divisi === d), tahun, data.sekarang, e, d))
  );
  const perEstate = estates.flatMap((e) => {
    const inti = kelompok(rows.filter((b) => b.estate === e && !plasma(b.divisi)), tahun, data.sekarang, e, "");
    const pl = rows.filter((b) => b.estate === e && plasma(b.divisi));
    return pl.length ? [inti, kelompok(pl, tahun, data.sekarang, e, "PLASMA")] : [inti];
  });
  const years = Array.from({ length: data.tahunAkhir - data.tahunAwal + 1 }, (_, i) => data.tahunAwal + i);
  return { semua, perDivisi, perEstate, years, bulanOf };
}
export { bulanOf };
