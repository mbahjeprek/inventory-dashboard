import type { SopStatus } from "./api";

// The bagian of the Daftar SOP, in order (the same codes as SOP_BAGIAN on the server). kode = the short
// code of the bagian for a no. dokumen (SOP/AGR/04/001), catatan = when the bagian applies.
export const SOP_BAGIAN: { value: string; no: string; label: string; kode: string; catatan?: string }[] = [
  { value: "01", no: "1", label: "Persiapan Lahan & Pembukaan", kode: "LHN" },
  { value: "02", no: "2", label: "Pembibitan", kode: "BBT" },
  { value: "03", no: "3", label: "Penanaman & TBM (Tanaman Belum Menghasilkan)", kode: "TBM" },
  { value: "04", no: "4", label: "Pemeliharaan TM (Tanaman Menghasilkan)", kode: "TM" },
  { value: "05", no: "5", label: "Proteksi Tanaman", kode: "PTN" },
  { value: "06", no: "6", label: "Panen & Transport", kode: "PNN" },
  { value: "07", no: "7", label: "Agronomi & Riset", kode: "AGR" },
  { value: "08", no: "8", label: "Pabrik Kelapa Sawit", kode: "PKS", catatan: "Jika punya PKS" },
  { value: "09", no: "9", label: "Teknik, Gudang & Logistik", kode: "TGL" },
  { value: "10", no: "10", label: "K3 (Keselamatan & Kesehatan Kerja)", kode: "K3" },
  { value: "11", no: "11", label: "Lingkungan & Keberlanjutan", kode: "LGK" },
  { value: "12", no: "12", label: "SDM & Hubungan Industrial", kode: "SDM" },
  { value: "13", no: "13", label: "Sosial & Kemitraan", kode: "SOS" },
  { value: "14", no: "14", label: "Administrasi, Keuangan & Keamanan", kode: "ADM" },
  { value: "UMUM", no: "15", label: "Umum", kode: "UMM", catatan: "SOP yang tidak masuk bagian lain" },
];

export const SOP_STATUS: { value: SopStatus; label: string; color: string; bg: string }[] = [
  { value: "BELUM", label: "Belum ada", color: "#64748b", bg: "#f1f5f9" },
  { value: "DRAFT", label: "Draft", color: "#b45309", bg: "#fef3c7" },
  { value: "REVISI", label: "Perlu revisi", color: "#b91c1c", bg: "#fdeaea" },
  { value: "BERLAKU", label: "Berlaku", color: "#15803d", bg: "#e7f7ed" },
];
export const statusOf = (v: string) => SOP_STATUS.find((s) => s.value === v) ?? SOP_STATUS[0];
