// Klinik > Laporan Harian: the sheet's worked-out columns (Periode, Kode tgl, Hari, Usia) from the dates.

export const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export const JENIS_KUNJUNGAN = ["Rawat Jalan", "MCU", "Kontrol", "Rawat Inap"];
export const STATUS_PASIEN = ["Pekerja", "Istri", "Anak", "Lainnya"];
export const MAX_TERAPI = 8;

const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];

// "2026-01-02" -> Periode "Januari", Kode tgl "02", Hari "Jumat".
export const periodeOf = (iso: string) => (iso ? BULAN[parts(iso)[1] - 1] : "");
export const kodeTglOf = (iso: string) => (iso ? iso.slice(8, 10) : "");
export const hariOf = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = parts(iso);
  return HARI[new Date(y, m - 1, d).getDay()];
};
// Whole years old on the visit date.
export function usiaOf(lahir: string | null, tanggal: string): number | null {
  if (!lahir || !tanggal || lahir > tanggal) return null;
  const [ly, lm, ld] = parts(lahir);
  const [ty, tm, td] = parts(tanggal);
  return ty - ly - (tm < lm || (tm === lm && td < ld) ? 1 : 0);
}
// "2026-01-02" -> "02 Jan 26", as the sheet writes dates.
export const tglSheet = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = parts(iso);
  return `${String(d).padStart(2, "0")} ${BULAN[m - 1].slice(0, 3)} ${String(y).slice(2)}`;
};
export const yaTidak = (v: boolean) => (v ? "Ya" : "Tidak");
