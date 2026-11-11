import type { SuratBarang } from "./api";
import { BULAN, escHtml as esc, logoPerusahaan, perusahaanEstate } from "./surat";
import { kotaEstate } from "./permintaanSurat";

// The printed Permintaan Barang Klinik (non-obat), as the klinik's letter template: the green kop (bars, logo, PT and
// estate), Nomor / Tanggal / Perihal, Kepada Yth / cc / Dari, the opening, the barang table (Nama Barang, Type, Qty,
// Satuan, Keterangan), the closing and Dimohon / Diperiksa / Disetujui Oleh, with "We Are Solid & Have Power" at the
// foot of the page. Legal paper, Aptos 12 pt, as the Word file.

export const SB_URUT = ["dimohon", "diperiksa", "disetujui"] as const;
export type SbLevel = (typeof SB_URUT)[number];
export const SB_LABEL: Record<SbLevel, string> = { dimohon: "Dimohon Oleh", diperiksa: "Diperiksa Oleh", disetujui: "Disetujui Oleh" };

const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
// "590 /BAP-AKSS/Klinik-NLM/XI/2026": the number typed by hand, then the format with the month / year of the tanggal.
// The klinik's code is the estate without its vowels after the first letter (NILAM -> NLM).
export const singkatEstate = (k: string) => k.charAt(0) + k.slice(1).replace(/[AIUEO]/gi, "");
export const formatNomor = (klinik: string, tanggal: string, dariNomor?: string | null) => {
  const bulan = ROMAWI[Number(tanggal.slice(5, 7)) - 1] ?? "";
  const tahun = tanggal.slice(0, 4);
  // The klinik's last letter keeps its own format (only the month / year move on).
  const lama = dariNomor?.match(/^\s*[^/]*?(\/.*)\/[IVXL]+\/\d{4}\s*$/)?.[1];
  return `${lama ?? `/BAP-${logoPerusahaan(perusahaanEstate(klinik)).alt}/Klinik-${singkatEstate(klinik)}`}/${bulan}/${tahun}`;
};
// The format after a new tanggal: one ending in /<bulan romawi>/<tahun> keeps its start and takes the new month / year;
// an empty one starts from the klinik's last nomor; anything else typed by hand stays as it is.
export const ikutTanggal = (klinik: string, tanggal: string, format: string, lastNomor?: string | null) =>
  !format.trim() ? formatNomor(klinik, tanggal, lastNomor) : /\/[IVXL]+\/\d{4}\s*$/.test(format) ? formatNomor(klinik, tanggal, format) : format;
// A stored nomor split back into the typed number and the format.
export const pisahNomor = (nomor: string) => {
  const i = nomor.indexOf("/");
  return i < 0 ? { urut: nomor.trim(), format: "" } : { urut: nomor.slice(0, i).trim(), format: nomor.slice(i).trim() };
};
export const gabungNomor = (urut: string, format: string) => [urut.trim(), format.trim()].filter(Boolean).join(" ");

const tanggalSurat = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d} ${BULAN[Number(m) - 1] ?? ""} ${y}`;
};
const waktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const qty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

export function suratBarangHtml(s: SuratBarang): string {
  const pt = perusahaanEstate(s.klinik);
  const orang = (o: { nama: string; jabatan: string } | undefined) =>
    `<div class="nm"><b><u>${esc(o?.nama ?? "")}</u></b></div>${o?.jabatan ? `<div class="jb">(${esc(o.jabatan)})</div>` : ""}`;
  const cc = (s.cc ?? []).filter((o) => o.nama);
  const items = (s.items ?? [])
    .map(
      (i) =>
        `<tr><td>${esc(i.nama)}</td><td>${esc(i.type)}</td><td>${esc(qty(Number(i.qty)))}</td><td class="kecil">${esc(i.satuan)}</td><td class="kecil">${esc(i.keterangan)}</td></tr>`
    )
    .join("");
  // A box signed in the app gets an electronic stamp in the space for the signature (signed on the paper letter and
  // uploaded: a stamp saying so); an unsigned box stays blank for the pen.
  const ttd = SB_URUT.map((k) => {
    const a = s.approval?.[k];
    const cap = a
      ? `<div class="cap">${a.offline ? "DITANDATANGANI DI SURAT ASLI<br>diupload " : "DISETUJUI SECARA ELEKTRONIK<br>"}${esc(waktu(a.at))}</div>`
      : "";
    return `<div class="tt"><div>${SB_LABEL[k]},</div><div class="ruang">${cap}</div><div class="nm"><b><u>${esc(a?.nama || s.ttd?.[k]?.nama || "")}</u></b></div></div>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.nomor || s.perihal || "Permintaan Barang")}</title><style>
    @page { size: 8.5in 14in; margin: 0.39in 1in 0.5in 1in; }
    body { font-family: Aptos, "Segoe UI", Calibri, Carlito, Arial, sans-serif; font-size: 12pt; color: #000; margin: 0; }
    .kop { position: relative; }
    .kop .bar { display: block; width: 6.27in; height: auto; }
    .kop .id { position: absolute; left: 0; bottom: 0.08in; display: flex; align-items: center; gap: 8px; }
    .kop .logo { width: 0.63in; height: auto; }
    .kop .pt { font-family: Carlito, Calibri, sans-serif; color: #385522; font-size: 18pt; line-height: 1.1; }
    .kop .es { font-family: Carlito, Calibri, sans-serif; color: #385522; font-size: 13pt; font-weight: bold; }
    .garis { border-top: 2.25pt solid #00b050; width: 6.27in; margin: 2px 0 14px; }
    .kepala td { padding: 0; vertical-align: top; }
    .kepala td.l { width: 1.1in; }
    .blok { display: flex; margin-top: 14px; }
    .blok .l { width: 1.1in; flex: none; }
    .blok .isi { flex: 1; }
    .blok .jb { margin-left: 0.55in; }
    .blok .cc + .cc { margin-top: 2px; margin-left: 0.15in; }
    p { margin: 0; }
    .hormat { margin-top: 18px; }
    .buka { margin-top: 18px; text-indent: 0.2in; line-height: 1.35; }
    table.brg { border-collapse: collapse; margin: 30px 0 16px -0.3in; width: calc(6.27in + 0.6in); }
    table.brg th, table.brg td { border: 1px solid #000; text-align: center; padding: 4px 6px; }
    table.brg th { font-size: 14pt; font-weight: bold; }
    table.brg td.kecil { font-size: 10pt; font-weight: bold; }
    .tutup { margin-top: 4px; }
    .ttd { display: flex; justify-content: space-between; margin-top: 70px; }
    .tt { width: 33%; }
    .tt:nth-child(2) { padding-left: 0.3in; }
    .tt:nth-child(3) { padding-left: 0.6in; }
    .tt .ruang { height: 70px; display: flex; align-items: center; }
    .tt .cap { border: 1.5px solid #1f4e9c; color: #1f4e9c; border-radius: 4px; padding: 3px 6px; font-size: 7.5pt; font-weight: bold; line-height: 1.35; font-family: Arial, sans-serif; }
    .kaki { position: fixed; left: 0; right: 0; bottom: 0; border-top: 1px solid #000; text-align: right; padding-top: 3px; font-family: Carlito, Calibri, sans-serif; font-size: 10pt; font-style: italic; font-weight: bold; }
  </style></head><body>
    <div class="kop"><img class="bar" src="${location.origin}/kop-hijau.png" alt=""><div class="id"><img class="logo" src="${location.origin}/${logoPerusahaan(pt).file}" alt="${esc(logoPerusahaan(pt).alt)}"><div><div class="pt">${esc(pt)}</div><div class="es">Estate ${esc(kotaEstate(s.klinik))}</div></div></div></div>
    <div class="garis"></div>
    <table class="kepala">
      <tr><td class="l">Nomor</td><td>: ${esc(s.nomor)}</td></tr>
      <tr><td class="l">Tanggal</td><td>: ${esc(tanggalSurat(s.tanggal))}</td></tr>
      <tr><td class="l">Perihal</td><td>: <b>${esc(s.perihal)}</b></td></tr>
    </table>
    <div class="blok"><div class="l">Kepada Yth</div><div class="isi">: ${orang(s.kepada).replace('<div class="nm">', '<div class="nm" style="display:inline">')}</div></div>
    ${cc.length ? `<div class="blok"><div class="l">cc</div><div class="isi">${cc.map((o, i) => `<div class="cc">${i ? "" : ": "}${orang(o).replace('<div class="nm">', '<div class="nm" style="display:inline">')}</div>`).join("")}</div></div>` : ""}
    <div class="blok"><div class="l">Dari</div><div class="isi">: ${orang(s.dari).replace('<div class="nm">', '<div class="nm" style="display:inline">')}</div></div>
    <p class="hormat">Dengan Hormat,</p>
    <p class="buka">Sehubungan dengan adanya kebutuhan untuk ${esc(s.keperluan || "Klinik")} maka dengan ini kami mengajukan permintaan barang dengan rincian sebagai berikut.</p>
    <table class="brg">
      <colgroup><col style="width:30.6%"><col style="width:19.9%"><col style="width:10.1%"><col style="width:11.5%"><col style="width:28.9%"></colgroup>
      <thead><tr><th>NAMA BARANG</th><th>TYPE</th><th>QTY</th><th>SATUAN</th><th>KETERANGAN</th></tr></thead>
      <tbody>${items}</tbody>
    </table>
    <p class="tutup">Demikian hal ini saya sampaikan , atas persetujuan bapak saya ucapkan terima kasih.</p>
    <div class="ttd">${ttd}</div>
    <div class="kaki">We Are Solid &amp; Have Power</div>
  </body></html>`;
}
