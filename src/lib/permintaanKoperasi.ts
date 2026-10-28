import type { KopPermintaan, KopPermintaanCap, KopPermintaanTtd } from "./api";
import { KOP_CSS, PERUSAHAAN, escHtml as esc, kopHtml, tanggalPanjang } from "./surat";
import { isoDisplay } from "./opname";
import { waktuTtd } from "./permintaanSurat";

// Form Permintaan Barang Koperasi as the koperasi's Excel sheet had it: kop of PT.AKSS / Koperasi Karyawan, the list
// (kode, nama, jenis / type, jumlah, satuan, isi per satuan, total, tgl masuk), place and date, and two signatures:
// a box signed in the app carries an electronic stamp (who and when); until HR approves, the letter is marked as such.

export const KOP_PMT_TTD_DEFAULT: KopPermintaanTtd = {
  dibuat: { nama: "M. RAMLI", jabatan: "Admin Koperasi" },
  diketahui: { nama: "MUNIR ISMAIL", jabatan: "HR Business Unit" },
};
// Saved / remembered signers over the defaults: a box left without a name or jabatan gets the default one.
export const kopTtdLengkap = (ttd: Partial<KopPermintaanTtd> | null | undefined): KopPermintaanTtd => {
  const isi = (k: keyof KopPermintaanTtd) => ({
    nama: ttd?.[k]?.nama?.trim() || KOP_PMT_TTD_DEFAULT[k].nama,
    jabatan: ttd?.[k]?.jabatan?.trim() || KOP_PMT_TTD_DEFAULT[k].jabatan,
  });
  return { dibuat: isi("dibuat"), diketahui: isi("diketahui") };
};

const qty = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toLocaleString("id-ID", { maximumFractionDigits: 2 }));

export function permintaanKoperasiHtml(p: KopPermintaan): string {
  const ttd = kopTtdLengkap(p.ttd);
  // Nothing in yet: a pure request, without the Tgl Masuk column; once some came in it shows when.
  const adaMasuk = p.lines.some((l) => l.masuk ?? l.tgl_masuk);
  const rows = p.lines
    .map(
      (l, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td class="c">${esc(l.barang_kode ?? "")}</td>
        <td>${esc(l.nama)}</td>
        <td class="c">${esc(l.jenis)}</td>
        <td class="c">${qty(l.jumlah)}</td>
        <td class="c">${esc(l.satuan)}</td>
        <td class="c">${qty(l.isi)}</td>
        <td class="c">${l.isi ? qty(l.jumlah * l.isi) : ""}</td>
        ${adaMasuk ? `<td class="c">${esc(isoDisplay(l.masuk ?? l.tgl_masuk ?? ""))}</td>` : ""}
      </tr>`
    )
    .join("");
  const kotak = (judul: string, o: { nama: string; jabatan: string }, cap: KopPermintaanCap | undefined, kata: string) =>
    `<div class="ttd"><div>${esc(judul)}</div>${
      cap ? `<div class="ruang el"><div class="cap">${kata} SECARA ELEKTRONIK<br>${esc(cap.nama)} · ${esc(waktuTtd(cap.at))}</div></div>` : `<div class="ruang"></div>`
    }<div class="nama">${esc(o.nama || "(................................)")}</div><div class="jab">${esc(o.jabatan)}</div></div>`;
  const tanda =
    p.status === "DISETUJUI"
      ? `<div class="final">DISETUJUI HR · DOKUMEN FINAL</div>`
      : `<div class="draft">${p.status === "DIAJUKAN" ? "MENUNGGU PERSETUJUAN HR" : p.status === "DITOLAK" ? "DITOLAK HR" : "DRAFT - BELUM DIAJUKAN"}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.nomor)}</title><style>
    @page { size: A4 portrait; margin: 12mm 12mm 14mm 14mm; }
    body { font-family: "Times New Roman", serif; font-size: 11pt; color: #000; margin: 0; }
    ${KOP_CSS}
    h1 { text-align: center; font-size: 12.5pt; text-decoration: underline; margin: 14px 0 2px; }
    .nomor { text-align: center; margin-bottom: 12px; }
    table.info td { padding: 1px 6px 1px 0; vertical-align: top; }
    table.info td:first-child { width: 90px; }
    table.daftar { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10pt; }
    table.daftar th, table.daftar td { border: 1px solid #000; padding: 3px 5px; }
    table.daftar th { background: #f4b183; font-weight: bold; }
    table.daftar thead { display: table-header-group; }
    table.daftar tr { page-break-inside: avoid; }
    .c { text-align: center; }
    .catatan { margin-top: 8px; font-size: 10pt; }
    .penutup { page-break-inside: avoid; break-inside: avoid; }
    .tempat { margin-top: 16px; }
    .ttds { display: flex; margin-top: 6px; border: 1px solid #000; }
    .ttd { flex: 1; text-align: center; padding: 4px 4px 6px; border-right: 1px solid #000; }
    .ttd:last-child { border-right: 0; }
    .ttd .ruang { height: 70px; }
    .ttd .ruang.el { display: flex; align-items: center; justify-content: center; }
    .ttd .cap { border: 1.5px solid #1f4e9c; color: #1f4e9c; border-radius: 4px; padding: 3px 6px; font-size: 7.5pt; font-weight: bold; line-height: 1.35; font-family: Arial, sans-serif; }
    .draft { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 46pt; font-weight: bold; color: rgba(200, 0, 0, 0.13); transform: rotate(-24deg); z-index: -1; font-family: Arial, sans-serif; }
    .final { text-align: center; font-size: 9pt; font-weight: bold; color: #1f4e9c; margin-top: -8px; margin-bottom: 8px; }
    .tolak { margin-top: 8px; font-size: 10pt; color: #b00000; }
    .ttd .nama { font-weight: bold; text-decoration: underline; text-transform: uppercase; }
    .ttd .jab { font-size: 10pt; }
    .alamat { display: flex; justify-content: space-between; gap: 20px; margin-top: 18px; padding-top: 5px; border-top: 3px double #000; font-size: 8.5pt; font-style: italic; page-break-inside: avoid; }
  </style></head><body>
    ${kopHtml(PERUSAHAAN, "Koperasi Karyawan")}
    <h1>FORM PERMINTAAN BARANG KOPERASI</h1>
    <div class="nomor">Nomor: ${esc(p.nomor)}</div>
    ${tanda}
    <table class="info">
      <tr><td>Tanggal</td><td>: ${esc(tanggalPanjang(p.tanggal))}</td></tr>
      <tr><td>Unit</td><td>: Koperasi Karyawan PT.AKSS</td></tr>
    </table>
    <table class="daftar">
      <thead><tr><th style="width:28px">No</th><th style="width:56px">Kode</th><th>Nama Barang</th><th style="width:78px">Jenis/Type</th><th style="width:50px">Jumlah</th><th style="width:52px">Satuan</th><th style="width:52px">Isi/Dlm Satuan</th><th style="width:50px">Total</th>${adaMasuk ? `<th style="width:72px">Tgl Masuk</th>` : ""}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${p.catatan ? `<div class="catatan"><b>Catatan:</b> ${esc(p.catatan)}</div>` : ""}
    ${p.status === "DITOLAK" && p.tolak ? `<div class="tolak"><b>Ditolak HR</b> (${esc(p.tolak.nama)}, ${esc(waktuTtd(p.tolak.at))}): ${esc(p.tolak.alasan)}</div>` : ""}
    <div class="penutup"><div class="tempat">Tideng Pale, ${esc(tanggalPanjang(p.tanggal))}</div>
    <div class="ttds">${kotak("Dibuat oleh,", ttd.dibuat, p.approval?.dibuat, "DIAJUKAN")}${kotak("Diketahui oleh,", ttd.diketahui, p.approval?.diketahui, "DISETUJUI")}</div></div>
    <div class="alamat">
      <div><b>Alamat Kantor Pusat :</b><br>Altira Business Tower Floor Lt. 19 Unit A, B &amp; D<br>Jln. Yos Sudarso Kav. 85, Sunter Jaya<br>Tg. Priok, Jakarta Utara - DKI Jakarta</div>
      <div><b>Alamat Estate :</b><br>Desa Sesayap Desa &amp; Tideng Pale<br>Kecamatan Sesayap Hilir &amp; Sesayap<br>Kabupaten Tana Tidung - Kaltara</div>
    </div>
  </body></html>`;
}
