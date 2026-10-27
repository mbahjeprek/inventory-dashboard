import { escHtml as esc, logoPerusahaan, logoUrl, perusahaanEstate } from "./surat";

// The blank "Bukti Penerimaan BBM (Delivery Order)" to fill in by hand when a tanker delivers, laid out like the
// gudang's Bukti Penerimaan Barang: kop, nomor DO / PO, supplier, lokasi, the tanker and its seal, the lines
// (jenis BBM, quantity on the DO vs received, selisih), how it was measured, and four signatures.
// The company (kop and logo) of the lokasi it is printed for: KNS -> PT. Kartika Nugraha Sakti, WJA -> PT. Wana Jaya Abadi, else AKSS.
export function formDoBbmHtml(lokasi?: string): string {
  const pt = perusahaanEstate(lokasi);
  const isian = (label: string) => `<tr><td class="lbl">${esc(label)}</td><td class="tt">:</td><td class="garis"></td></tr>`;
  const baris = Array.from({ length: 13 }, (_, i) => `<tr><td class="c">${i + 1}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");
  const kotak = (judul: string, jabatan: string) => `<td><div class="tj">${esc(judul)}</div><div class="ruang"></div><div class="nm">(............................)</div><div class="jb">${esc(jabatan)}</div></td>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bukti Penerimaan BBM (DO)</title><style>
    @page { size: A4 portrait; margin: 12mm 14mm 12mm 14mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #000; margin: 0; }
    .kop { display: flex; align-items: center; gap: 12px; }
    .kop img { width: 92px; height: auto; }
    .kop .t { flex: 1; text-align: center; padding-right: 92px; }
    .pt { font-weight: bold; font-size: 13pt; text-decoration: underline; }
    .judul { font-weight: bold; font-size: 12.5pt; text-decoration: underline; margin-top: 8px; }
    .sub { font-size: 9.5pt; margin-top: 1px; }
    table.info { margin-top: 14px; border-collapse: collapse; width: 100%; }
    table.info td { padding: 3px 0; vertical-align: bottom; }
    table.info .lbl { width: 170px; }
    table.info .tt { width: 14px; }
    table.info .garis { border-bottom: 1px dotted #000; height: 20px; }
    .dua { display: flex; gap: 22px; }
    .dua > table { flex: 1; }
    table.daftar { width: 100%; border-collapse: collapse; margin-top: 12px; }
    table.daftar th, table.daftar td { border: 1px solid #000; padding: 3px 5px; }
    table.daftar th { font-weight: normal; font-size: 9.5pt; background: #f0f0f0; }
    table.daftar td { height: 27px; }
    .c { text-align: center; }
    .ukur { margin-top: 10px; border: 1px solid #000; padding: 6px 8px; font-size: 9.5pt; line-height: 1.9; }
    .kb { display: inline-block; width: 11px; height: 11px; border: 1px solid #000; vertical-align: -1px; margin: 0 4px 0 10px; }
    .tt2 { display: inline-block; min-width: 70px; border-bottom: 1px dotted #000; }
    .model { text-align: right; font-size: 9pt; margin-top: 4px; }
    table.ttd { width: 100%; border-collapse: separate; border-spacing: 8px 0; margin-top: 10px; page-break-inside: avoid; }
    table.ttd td { border: 1px solid #000; text-align: center; vertical-align: top; width: 25%; padding: 4px 4px 6px; }
    .tj { font-size: 10pt; }
    .ruang { height: 58px; }
    .nm { font-size: 9.5pt; }
    .jb { font-size: 9.5pt; border-top: 1px solid #000; margin: 2px 8px 0; padding-top: 2px; }
    .ket { margin-top: 14px; font-size: 9.5pt; }
    .ket u { font-weight: bold; }
  </style></head><body>
    <div class="kop">
      <img src="${esc(logoUrl(pt))}" alt="${esc(logoPerusahaan(pt).alt)}">
      <div class="t">
        <div class="pt">${esc(pt.toUpperCase())}</div>
        <div class="judul">BUKTI PENERIMAAN BBM</div>
        <div class="sub">(DELIVERY ORDER)</div>
      </div>
    </div>
    <div class="dua">
      <table class="info">
        ${isian("Nomor DO / Surat Jalan")}
        ${isian("Nomor PO / BAP")}
        ${isian("Diterima Dari (Supplier)")}
        ${isian("Lokasi Terima / Tangki")}
        ${isian("Tanggal / Jam Tiba")}
      </table>
      <table class="info">
        ${isian("No. Polisi Mobil Tangki")}
        ${isian("Nama Sopir")}
        ${isian("No. Segel")}
        ${isian("Kapasitas Tangki Mobil")}
        ${isian("Tanggal / Jam Bongkar")}
      </table>
    </div>
    <table class="daftar">
      <thead><tr>
        <th style="width:34px">No</th><th>Jenis BBM<br>(Solar / Bensin / Bensin Campur)</th><th style="width:62px">Satuan</th>
        <th style="width:92px">Jumlah di DO<br>(Liter)</th><th style="width:92px">Jumlah Diterima<br>(Liter)</th><th style="width:78px">Selisih<br>(Liter)</th><th style="width:150px">Keterangan</th>
      </tr></thead>
      <tbody>${baris}</tbody>
    </table>
    <div class="ukur">
      Cara ukur:<span class="kb"></span>Flowmeter<span class="kb"></span>Sounding / dipstick tangki<span class="kb"></span>Lainnya <span class="tt2"></span><br>
      Kondisi segel:<span class="kb"></span>Utuh<span class="kb"></span>Rusak / tidak sesuai &nbsp;&nbsp;&nbsp; Air / kotoran:<span class="kb"></span>Tidak ada<span class="kb"></span>Ada <span class="tt2"></span><br>
      Tinggi cairan tangki sebelum bongkar <span class="tt2"></span> cm, sesudah <span class="tt2"></span> cm<br>
      Angka flowmeter awal <span class="tt2"></span> akhir <span class="tt2"></span>
    </div>
    <div class="model">Model : ..................</div>
    <table class="ttd"><tr>
      ${kotak("Diserahkan", "Sopir / Pengirim")}
      ${kotak("Diterima / Dibuat", "Kepala Gudang")}
      ${kotak("Diperiksa", "KTU / Kasi")}
      ${kotak("Disetujui", "Manager")}
    </tr></table>
    <div class="ket"><u>Keterangan :</u><br>Lembar 1: Bagian Pembelian &nbsp;·&nbsp; Lembar 2: Gudang / Admin BBM &nbsp;·&nbsp; Lembar 3: Supplier / Sopir</div>
  </body></html>`;
}
