import type { Permintaan, PermintaanTtd, PermintaanUrgensi } from "./api";
import { KOP_CSS, PERUSAHAAN, escHtml as esc, kopHtml, tanggalPanjang } from "./surat";

// The printed "Form Permintaan Obat, BMHP dan Alat Medis" of a klinik, as the paper form: kop, title and
// nomor, Tanggal / Periode / Estate / Departemen, the items (No, Uraian, Satuan, Jumlah, Urgensi,
// Keterangan/Stok), the four signatures (Dibuat oleh, Diketahui, Disetujui, Disetujui) and the addresses.

export const URGENSI_LABEL: Record<PermintaanUrgensi, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
export const kotaEstate = (k: string) => k.charAt(0) + k.slice(1).toLowerCase();
export const estateLabel = (k: string) => (k === "KNS" || k === "WJA" ? k : kotaEstate(k));

// The signatories of the paper form; a new request copies the klinik's last ones instead when it has any.
export const TTD_DEFAULT = (klinik: string): PermintaanTtd => ({
  dibuat: { nama: klinik === "FIRUS" ? "PUJI HARTONO" : "", jabatan: "Manager Estate" },
  diketahui: { nama: "MOHD. NASRUL HAKIM BIN ANUYAR", jabatan: "GM Finance & Audit" },
  disetujui1: { nama: "FITRIONO EFENDI", jabatan: "Corporate GM Plantation" },
  disetujui2: { nama: "JOHAR LATIFAH", jabatan: "Head of Business Unit" },
});
// The order the boxes are signed in, with the name shown on screen.
export const TTD_LEVEL_LABEL: Record<keyof PermintaanTtd, string> = { dibuat: "Dibuat oleh", diketahui: "Diketahui", disetujui1: "Disetujui 1", disetujui2: "Disetujui 2" };
export const TTD_URUT: (keyof PermintaanTtd)[] = ["dibuat", "diketahui", "disetujui1", "disetujui2"];
export const ttdBerikut = (p: Pick<Permintaan, "approval">) => TTD_URUT.find((k) => !p.approval?.[k]) ?? null;
export const waktuTtd = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "");
export const TTD_LABEL: [keyof PermintaanTtd, string][] = [
  ["dibuat", "Dibuat Oleh,"],
  ["diketahui", "Diketahui,"],
  ["disetujui1", "Disetujui,"],
  ["disetujui2", "Disetujui,"],
];

const qty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

export function permintaanHtml(p: Permintaan): string {
  const unit = `Klinik Estate ${estateLabel(p.klinik)}`;
  const rows = p.lines
    .map(
      (l, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.nama)}</td>
        <td class="c">${esc(l.satuan)}</td>
        <td class="c">${qty(l.jumlah)}</td>
        <td class="c u-${l.urgensi.toLowerCase()}">${URGENSI_LABEL[l.urgensi]}</td>
        <td class="c">${esc([l.stok_text, l.keterangan].filter(Boolean).join(" · "))}</td>
      </tr>`
    )
    .join("");
  // A box signed in the app: the signer's name and an electronic stamp with the time instead of the blank space.
  const ttd = TTD_LABEL.map(([k, judul]) => {
    const a = p.approval?.[k];
    const ruang = a ? `<div class="ruang el"><div class="cap">DISETUJUI SECARA ELEKTRONIK<br>${esc(waktuTtd(a.at))}</div></div>` : `<div class="ruang"></div>`;
    return `<div class="ttd"><div>${esc(judul)}</div>${ruang}<div class="nama">${esc(a?.nama || p.ttd?.[k]?.nama || "(................................)")}</div><div class="jab">${esc(a?.jabatan || p.ttd?.[k]?.jabatan || "")}</div></div>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.nomor)}</title><style>
    @page { size: A4 portrait; margin: 12mm 12mm 14mm 14mm; }
    body { font-family: "Times New Roman", serif; font-size: 11pt; color: #000; margin: 0; }
    ${KOP_CSS}
    h1 { text-align: center; font-size: 12.5pt; text-decoration: underline; margin: 14px 0 2px; }
    .nomor { text-align: center; margin-bottom: 12px; }
    table.info td { padding: 1px 6px 1px 0; vertical-align: top; }
    table.info td:first-child { width: 110px; }
    table.daftar { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10.5pt; }
    table.daftar th, table.daftar td { border: 1px solid #000; padding: 3px 5px; }
    table.daftar th { background: #e8e8e8; }
    table.daftar thead { display: table-header-group; }
    table.daftar tr { page-break-inside: avoid; }
    .c { text-align: center; }
    .u-high { font-weight: bold; }
    .catatan { margin-top: 8px; font-size: 10pt; }
    .penutup { page-break-inside: avoid; break-inside: avoid; }
    .tempat { text-align: right; margin-top: 14px; }
    .ttds { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; page-break-inside: avoid; border: 1px solid #000; }
    .ttd { flex: 1; text-align: center; padding: 4px 4px 6px; border-right: 1px solid #000; font-size: 10pt; }
    .ttd:last-child { border-right: 0; }
    .ttd .ruang { height: 62px; }
    .ttd .ruang.el { display: flex; align-items: center; justify-content: center; }
    .ttd .cap { border: 1.5px solid #1f4e9c; color: #1f4e9c; border-radius: 4px; padding: 3px 6px; font-size: 7.5pt; font-weight: bold; line-height: 1.35; font-family: Arial, sans-serif; }
    .ttd .nama { font-weight: bold; text-decoration: underline; text-transform: uppercase; }
    .ttd .jab { font-size: 9pt; text-transform: uppercase; }
    .alamat { display: flex; justify-content: space-between; gap: 20px; margin-top: 18px; padding-top: 5px; border-top: 3px double #000; font-size: 8.5pt; font-style: italic; page-break-inside: avoid; }
  </style></head><body>
    ${kopHtml(PERUSAHAAN, unit)}
    <h1>FORM PERMINTAAN OBAT, BMHP DAN ALAT MEDIS</h1>
    <div class="nomor">Nomor: ${esc(p.nomor)}</div>
    <table class="info">
      <tr><td>Tanggal</td><td>: ${esc(tanggalPanjang(p.tanggal))}</td></tr>
      <tr><td>Periode</td><td>: ${esc(p.periode)}</td></tr>
      <tr><td>Estate</td><td>: ${esc(estateLabel(p.klinik))}</td></tr>
      <tr><td>Departemen</td><td>: ${esc(p.departemen || unit)}</td></tr>
    </table>
    <table class="daftar">
      <thead><tr><th style="width:30px">No</th><th>Uraian</th><th style="width:62px">Satuan</th><th style="width:52px">Jumlah</th><th style="width:58px">Urgensi</th><th style="width:150px">Keterangan/Stok</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${p.catatan ? `<div class="catatan"><b>Catatan:</b> ${esc(p.catatan)}</div>` : ""}
    <div class="penutup"><div class="tempat">${esc(estateLabel(p.klinik))}, ${esc(tanggalPanjang(p.tanggal))}</div>
    <div class="ttds">${ttd}</div></div>
    <div class="alamat">
      <div><b>Alamat Kantor Pusat :</b><br>Altira Business Tower Floor Lt. 19 Unit A, B &amp; D<br>Jln. Yos Sudarso Kav. 85, Sunter Jaya<br>Tg. Priok, Jakarta Utara - DKI Jakarta</div>
      <div><b>Alamat Estate :</b><br>Desa Sesayap Desa &amp; Tideng Pale<br>Kecamatan Sesayap Hilir &amp; Sesayap<br>Kabupaten Tana Tidung - Kaltara</div>
    </div>
  </body></html>`;
}
