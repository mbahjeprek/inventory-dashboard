import type { KopRekap, KopSlipLine } from "./api";

// Slip bon karyawan koperasi: one slip per karyawan (two to an A4 page), the barang taken in the periode,
// what is cut from the salary and when, the limit left, and boxes to sign. Printed through a hidden
// iframe like printTable.
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const qty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
const tgl = (iso: string) => iso.split("-").reverse().join("/");
const periodeText = (p: string) => `${BULAN[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const BAYAR: Record<string, string> = { POTONG_GAJI: "", TUNAI: "tunai", INSTANSI: "instansi" };

export function printKopSlips(opts: { periode: string; jatuhTempo: string; limit: number; people: KopRekap[]; lines: KopSlipLine[] }) {
  const { periode, jatuhTempo, limit, people, lines } = opts;
  const byKode = new Map<string, KopSlipLine[]>();
  for (const l of lines) byKode.set(l.anggota_kode, [...(byKode.get(l.anggota_kode) ?? []), l]);
  const dicetak = new Date().toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const slip = (p: KopRekap) => {
    const own = byKode.get(p.kode) ?? [];
    const sisa = Math.max(p.potong_gaji - p.dibayar, 0);
    const rows = own
      .map(
        (l, i) => `<tr><td class="c">${i + 1}</td><td class="nw">${tgl(l.tanggal_iso)}</td><td>${esc(l.barang_nama)}${BAYAR[l.bayar] ? ` <i>(${BAYAR[l.bayar]})</i>` : ""}</td>
          <td class="r nw">${qty(l.qty)} ${esc(l.satuan)}</td><td class="r nw">${rp(l.harga)}</td><td class="r nw">${rp(l.total)}</td></tr>`
      )
      .join("");
    return `<section class="slip">
      <div class="head">
        <div><div class="org">KOPERASI PT.AKSS</div><div class="ttl">Slip Bon Karyawan · ${esc(periodeText(periode))}</div></div>
        <div class="due">Dipotong dari gaji<br><b>tgl 10–${esc(tgl(jatuhTempo))}</b></div>
      </div>
      <table class="info"><tr>
        <td>NIK</td><td><b>${esc(p.kode)}</b></td><td>Jabatan</td><td>${esc(p.jabatan || "-")}</td></tr><tr>
        <td>Nama</td><td><b>${esc(p.nama || "-")}</b></td><td>Estate / Divisi</td><td>${esc([p.estate, p.divisi].filter(Boolean).join(" / ") || "-")}</td>
      </tr></table>
      <table class="lines"><thead><tr><th class="c">No</th><th>Tanggal</th><th>Barang</th><th class="r">Jumlah</th><th class="r">Harga</th><th class="r">Total</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="c muted">Tidak ada pengambilan</td></tr>`}</tbody></table>
      <div class="sum">
        <div class="lim">Limit ${rp(limit)}/bulan · sisa limit ${rp(Math.max(limit - p.potong_gaji, 0))}<br>${new Set(own.map((l) => l.bon ?? l.tanggal_iso)).size} bon · ${own.length} barang</div>
        <table>
          <tr><td>Total potong gaji</td><td class="r">${rp(p.potong_gaji)}</td></tr>
          ${p.dibayar > 0.5 ? `<tr><td>Sudah dibayar</td><td class="r">- ${rp(p.dibayar)}</td></tr>` : ""}
          <tr class="big"><td>Dipotong dari gaji</td><td class="r">${rp(sisa)}</td></tr>
        </table>
      </div>
      <div class="sign">
        <div>Karyawan<span></span>${esc(p.nama || p.kode)}</div><div>Admin Koperasi<span></span>&nbsp;</div><div>HRD<span></span>&nbsp;</div>
      </div>
      <div class="foot">Dicetak ${esc(dicetak)}. Bila ada barang yang tidak sesuai, lapor ke admin koperasi sebelum tgl 10.</div>
    </section>`;
  };

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Slip Bon Karyawan Koperasi ${esc(periodeText(periode))}</title><style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: system-ui, "Segoe UI", Roboto, sans-serif; color: #1a2634; margin: 0; font-size: 8.5pt; }
    .slip { border: 1px solid #9fb0c0; border-radius: 4px; padding: 8px 10px; margin-bottom: 6mm; page-break-inside: avoid; min-height: 132mm; display: flex; flex-direction: column; }
    .slip:nth-child(2n) { page-break-after: always; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f3d12; padding-bottom: 4px; }
    .org { font-weight: 700; font-size: 10.5pt; color: #1f3d12; }
    .ttl { font-size: 9.5pt; }
    .due { text-align: right; background: #fff3cd; border: 1px solid #f0c040; border-radius: 3px; padding: 2px 6px; }
    table { width: 100%; border-collapse: collapse; }
    .info td { padding: 2px 4px; }
    .info td:nth-child(odd) { color: #5b6b7c; width: 14%; }
    .lines { margin-top: 4px; }
    .lines th, .lines td { border: 1px solid #c3ccd5; padding: 2px 5px; text-align: left; }
    .lines th { background: #cfeab5; color: #1f3d12; font-size: 7.5pt; text-transform: uppercase; }
    .r { text-align: right !important; } .c { text-align: center !important; } .nw { white-space: nowrap; } .muted { color: #94a3b8; }
    .sum { display: flex; justify-content: space-between; gap: 10px; margin-top: 5px; }
    .sum .lim { color: #5b6b7c; }
    .sum table { width: auto; min-width: 46%; } .sum td { padding: 1px 4px; }
    .sum .big td { font-weight: 700; font-size: 10pt; border-top: 1px solid #1a2634; }
    .sign { display: flex; justify-content: space-between; margin-top: auto; padding-top: 8px; text-align: center; }
    .sign div { width: 30%; display: flex; flex-direction: column; } .sign span { height: 32px; }
    .foot { margin-top: 4px; color: #5b6b7c; font-size: 7pt; }
  </style></head><body>${people.map(slip).join("")}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const win = iframe.contentWindow!;
  win.onafterprint = () => setTimeout(() => iframe.remove(), 0);
  setTimeout(() => {
    win.focus();
    win.print();
  }, 50);
}
