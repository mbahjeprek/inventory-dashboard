import type { Sop, SopIsi } from "./api";
import { PERUSAHAAN, escHtml, tanggalPanjang } from "./surat";
import { SOP_BAGIAN, SOP_ISI_BAGIAN, statusOf } from "./sop";

// The file behind an SOP's link: a Google Docs / Sheets / Slides or Drive file shows in a frame (/preview)
// and downloads as Word / Excel / PowerPoint or PDF through Google's own export links (they work for whoever
// may open the file); any other PDF shows as it is.
export type GoogleLinks = { preview: string; office?: { url: string; label: string }; pdf?: string; buka: string };
export function googleLinks(url: string): GoogleLinks | null {
  const u = url.trim();
  const g = u.match(/^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
  if (g) {
    const base = `https://docs.google.com/${g[1]}/d/${g[2]}`;
    if (g[1] === "document")
      return { preview: `${base}/preview`, office: { url: `${base}/export?format=docx`, label: "Word (.docx)" }, pdf: `${base}/export?format=pdf`, buka: u };
    if (g[1] === "spreadsheets")
      return { preview: `${base}/preview`, office: { url: `${base}/export?format=xlsx`, label: "Excel (.xlsx)" }, pdf: `${base}/export?format=pdf`, buka: u };
    return { preview: `${base}/preview`, office: { url: `${base}/export/pptx`, label: "PowerPoint (.pptx)" }, pdf: `${base}/export/pdf`, buka: u };
  }
  const f = u.match(/^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/);
  if (f)
    return {
      preview: `https://drive.google.com/file/d/${f[1]}/preview`,
      office: { url: `https://drive.google.com/uc?export=download&id=${f[1]}`, label: "Unduh file" },
      buka: u,
    };
  if (/^https?:\/\/\S+\.pdf(\?|$)/i.test(u)) return { preview: u, pdf: u, buka: u };
  return null;
}

export const sopNomor = (s: Pick<Sop, "bagian" | "nomor">) => `${SOP_BAGIAN.find((b) => b.value === s.bagian)?.no ?? "15"}.${s.nomor ?? ""}`;
const isiAda = (isi: SopIsi | undefined) => !!isi && Object.values(isi).some((v) => v && v.trim());
export const sopIsiAda = isiAda;

// Plain text with its line breaks; numbered / bulleted lines keep their hanging indent.
const teks = (v: string | undefined) =>
  v && v.trim()
    ? v
        .trim()
        .split("\n")
        .map((line) => {
          const m = line.match(/^(\s*)((?:\d+[.)]|[a-z][.)]|[-•*])\s+)(.*)$/i);
          if (!m) return `<p class="ln">${escHtml(line) || "&nbsp;"}</p>`;
          const level = Math.min(Math.floor(m[1].replace(/\t/g, "  ").length / 2), 3);
          const mark = m[2].trim().replace(/^[-*]$/, "•");
          return `<p class="li" style="margin-left:${level * 18}pt"><span class="mk">${escHtml(mark)}</span>${escHtml(m[3])}</p>`;
        })
        .join("")
    : `<p class="kosong">-</p>`;

// The SOP as a formal document (kop, identitas, the sections, pengesahan): the same HTML is shown in the
// page, printed and saved for Word. Tables, not flex, so Word lays it out the same.
export function sopDocHtml(s: Sop, isi: SopIsi = s.isi ?? {}) {
  const bagian = SOP_BAGIAN.find((b) => b.value === s.bagian);
  const st = statusOf(s.status);
  const ttd = (label: string, nama?: string, jabatan?: string) =>
    `<td class="ttd"><div class="ttd-label">${label}</div><div class="ttd-ruang"></div><div class="ttd-nama">${escHtml(nama || "")}&nbsp;</div><div class="ttd-jab">${escHtml(jabatan || "")}&nbsp;</div></td>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(s.no_dokumen || "SOP")} - ${escHtml(s.judul)}</title>
<style>
  @page { size: A4; margin: 18mm 18mm 20mm; }
  body { font-family: "Times New Roman", Times, serif; font-size: 11.5pt; color: #000; margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  .kop td { vertical-align: middle; border-bottom: 3px double #000; padding-bottom: 6px; }
  .kop .logo { width: 90px; }
  .kop img { width: 84px; height: auto; }
  .kop .teks { text-align: center; line-height: 1.3; }
  .pt { font-weight: bold; font-size: 14pt; text-transform: uppercase; }
  .unit { font-weight: bold; font-size: 12pt; letter-spacing: 1px; }
  .ident { margin-top: 10px; }
  .ident td { border: 1px solid #000; padding: 4px 7px; font-size: 10.5pt; vertical-align: top; }
  .ident .k { width: 18%; font-weight: bold; background: #f2f2f2; }
  .ident .judul { font-size: 13pt; font-weight: bold; text-transform: uppercase; }
  h2 { font-size: 12pt; margin: 14px 0 4px; text-transform: uppercase; }
  .sec { margin-left: 18pt; }
  p { margin: 0 0 3px; line-height: 1.4; }
  .li { padding-left: 16pt; text-indent: -16pt; }
  .mk { display: inline-block; width: 16pt; text-indent: 0; }
  .kosong { color: #888; font-style: italic; }
  .sah { margin-top: 22px; page-break-inside: avoid; }
  .sah td { border: 1px solid #000; text-align: center; width: 33.3%; padding: 5px; vertical-align: top; }
  .ttd-label { font-weight: bold; font-size: 10.5pt; }
  .ttd-ruang { height: 58px; }
  .ttd-nama { font-weight: bold; text-decoration: underline; }
  .ttd-jab { font-size: 10pt; }
  .foot { margin-top: 10px; font-size: 8.5pt; color: #555; }
</style></head><body>
<table class="kop"><tr>
  <td class="logo"><img src="${escHtml(location.origin)}/logo-akss.png" alt="AKSS"></td>
  <td class="teks"><div class="pt">${escHtml(PERUSAHAAN)}</div><div class="unit">STANDARD OPERATING PROCEDURE</div></td>
  <td class="logo"></td>
</tr></table>
<table class="ident">
  <tr><td class="k">Judul</td><td colspan="3" class="judul">${escHtml(s.judul)}</td></tr>
  <tr><td class="k">No. Dokumen</td><td>${escHtml(s.no_dokumen || "-")}</td><td class="k">Revisi</td><td>${escHtml(s.revisi || "00")}</td></tr>
  <tr><td class="k">Tgl Berlaku</td><td>${s.tgl_berlaku ? escHtml(tanggalPanjang(s.tgl_berlaku)) : "-"}</td><td class="k">Status</td><td>${escHtml(st.label)}</td></tr>
  <tr><td class="k">Bagian</td><td>${escHtml(bagian ? `${bagian.no}. ${bagian.label}` : s.bagian)}</td><td class="k">PIC</td><td>${escHtml(s.pic || "-")}</td></tr>
</table>
${SOP_ISI_BAGIAN.map((b, i) => `<h2>${i + 1}. ${escHtml(b.label)}</h2><div class="sec">${teks(isi[b.key])}</div>`).join("\n")}
<table class="sah"><tr>
  ${ttd("Disusun oleh", isi.disusun_nama, isi.disusun_jabatan)}
  ${ttd("Diperiksa oleh", isi.diperiksa_nama, isi.diperiksa_jabatan)}
  ${ttd("Disetujui oleh", isi.disetujui_nama, isi.disetujui_jabatan)}
</tr></table>
<div class="foot">${escHtml(s.no_dokumen || "SOP")} · Rev. ${escHtml(s.revisi || "00")} · Dokumen terkendali: salinan cetak tidak dikendalikan kecuali bercap.</div>
</body></html>`;
}

// The document as a Word file: Word (and Google Docs, uploaded to Drive) opens HTML saved as .doc.
export function downloadWord(s: Sop, isi?: SopIsi) {
  const html = sopDocHtml(s, isi).replace(
    "<html>",
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">',
  );
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(s.no_dokumen || `SOP ${sopNomor(s)}`).replace(/[\\/:*?"<>|]+/g, "-")} - ${s.judul.replace(/[\\/:*?"<>|]+/g, "-")}.doc`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}
