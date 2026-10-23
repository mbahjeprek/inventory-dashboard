// Pieces of the formal letters printed from the app (Berita Acara, Surat Keterangan Sakit).
export const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
// Terbilang for written-out dates and counts (up to the thousands of a year).
export function terbilang(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${terbilang(n - 10)} belas`;
  if (n < 100) return `${terbilang(Math.floor(n / 10))} puluh${n % 10 ? ` ${terbilang(n % 10)}` : ""}`;
  if (n < 200) return `seratus${n - 100 ? ` ${terbilang(n - 100)}` : ""}`;
  if (n < 1000) return `${terbilang(Math.floor(n / 100))} ratus${n % 100 ? ` ${terbilang(n % 100)}` : ""}`;
  if (n < 2000) return `seribu${n - 1000 ? ` ${terbilang(n - 1000)}` : ""}`;
  return `${terbilang(Math.floor(n / 1000))} ribu${n % 1000 ? ` ${terbilang(n % 1000)}` : ""}`;
}
export const escHtml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// "22 Oktober 2026" from an ISO date.
export const tanggalPanjang = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
};

// The kop of every formal letter: the AKSS logo on the left, the company and unit centred, a double rule
// under it (a same-width spacer on the right keeps the text centred on the page).
export const KOP_CSS = `
  .kop { display: flex; align-items: center; gap: 10px; border-bottom: 3px double #000; padding-bottom: 6px; margin-bottom: 4px; }
  .kop-logo { width: 112px; height: auto; flex: none; }
  .kop-spasi { width: 112px; flex: none; }
  .kop-teks { flex: 1; text-align: center; line-height: 1.3; }
  .kop-pt { font-weight: bold; font-size: 14pt; text-transform: uppercase; letter-spacing: 0.3px; }
  .kop-unit { font-weight: bold; font-size: 12pt; text-transform: uppercase; }`;
export const kopHtml = (perusahaan: string, unit: string) =>
  `<div class="kop"><img class="kop-logo" src="${escHtml(location.origin)}/logo-akss.png" alt="AKSS"><div class="kop-teks"><div class="kop-pt">${escHtml(perusahaan)}</div><div class="kop-unit">${escHtml(unit)}</div></div><div class="kop-spasi"></div></div>`;
export const PERUSAHAAN = "PT. Anugrah Kembang Sawit Sejahtera";

// The clinic staff who sign: the accounts carry the full name with its title ("Sukaena Amd.keb").
// A name that already has a title is printed as it is (no second gelar), the jabatan follows the title,
// and an old-style account name ("Admin Klinik Nilam", "Bidan Sukaina") is never offered as the signer.
export const punyaGelar = (nama: string) => /(^|\s)(dr|ns)\.|\ba\.?\s?md\b|\bamd\b|\bs\.\s?(kep|keb|tr|st|ked|farm)\b/i.test(nama);
export const jabatanDariGelar = (nama: string): string | null =>
  /keb\b/i.test(nama) ? "Bidan" : /kep\b|(^|\s)ns\./i.test(nama) ? "Perawat" : /(^|\s)dr\./i.test(nama) ? "Dokter" : null;
export const namaLama = (nama: string) => /^(admin klinik|bidan |perawat |mantri )/i.test(nama.trim());
// Who signs a letter of a visit: the clinic account printing it (its full name and title), else the
// account that entered the visit.
export const penandatangan = (user: { nama?: string; role?: string } | null | undefined, createdBy: string) =>
  user?.nama && user.role !== "superuser" && !namaLama(user.nama) ? user.nama : createdBy && !namaLama(createdBy) ? createdBy : user?.nama ?? createdBy ?? "";
