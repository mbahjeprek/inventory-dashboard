import type { OpnameLine } from "./api";

// Stok Opname by Excel: download the count sheet (one row per line, the line id in column A so an upload
// finds the right line even when the rows are re-sorted), fill in Stok Fisik on paper / in Excel, upload it
// back. The upload only fills the form; the counts are saved with the page's Simpan as usual.

const HEAD = ["ID (jangan diubah)", "Kode", "Nama Barang", "Expired", "Satuan", "Stok Sistem", "Stok Fisik", "Keterangan"];

export async function downloadOpnameSheet(o: { id: number; title: string; tanggal: string; klinik: boolean; hideSistem?: boolean }, lines: OpnameLine[], fisikOf: (l: OpnameLine) => number | null, ketOf: (l: OpnameLine) => string) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Opname ${o.id}`, { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  // Hitung buta: the counters' sheet has no stok sistem.
  const head = HEAD.filter((h) => (o.klinik || h !== "Expired") && (!o.hideSistem || h !== "Stok Sistem"));
  ws.addRow([`Stok Opname #${o.id} - ${o.title}`]).font = { bold: true, size: 13 };
  ws.addRow([`Tanggal ${o.tanggal.split("-").reverse().join("/")} · isi kolom Stok Fisik (kuning) dengan hitungan nyata, lalu upload lewat tombol "Upload hasil SO". Kosongkan bila belum dihitung.`]).font = {
    size: 9,
    color: { argb: "FF5B6B7C" },
  };
  ws.addRow([]);
  const hr = ws.addRow(head);
  hr.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FF1F3D12" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFEAB5" } };
    c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  const fisikCol = head.indexOf("Stok Fisik") + 1;
  for (const l of lines) {
    const r = ws.addRow([l.id, l.kode, l.nama, ...(o.klinik ? [l.exp ? l.exp.split("-").reverse().join("/") : "-"] : []), l.satuan, ...(o.hideSistem ? [] : [l.stok_sistem]), fisikOf(l), ketOf(l)]);
    r.eachCell({ includeEmpty: true }, (c, n) => {
      c.border = { top: { style: "thin", color: { argb: "FFD5DDE6" } }, bottom: { style: "thin", color: { argb: "FFD5DDE6" } }, left: { style: "thin", color: { argb: "FFD5DDE6" } }, right: { style: "thin", color: { argb: "FFD5DDE6" } } };
      if (n === fisikCol) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3C4" } };
      if (n === 1) c.font = { color: { argb: "FF94A3B8" } };
    });
  }
  const widths: Record<string, number> = { "ID (jangan diubah)": 10, Kode: 12, "Nama Barang": 42, Expired: 12, Satuan: 10, "Stok Sistem": 12, "Stok Fisik": 12, Keterangan: 30 };
  head.forEach((h, i) => (ws.getColumn(i + 1).width = widths[h]));
  ws.views = [{ state: "frozen", ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: head.length } };

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `stok-opname-${o.id}-isian.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type OpnameUpload = {
  // Lines whose Stok Fisik / Keterangan the file fills: fisik null = left empty (not counted).
  found: { line: OpnameLine; fisik: number | null; ket: string | null }[];
  invalid: { row: number; text: string }[];
  unknown: number;
};

// A cell as a number: Excel numbers as they are; text in the Indonesian way ("47.600", "2,5") or plain "2.5".
function cellNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : undefined;
  if (typeof v === "object" && v && "result" in v) return cellNumber((v as { result: unknown }).result);
  const t = String(v).trim();
  if (!t || t === "-") return null;
  const s = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^[1-9]\d{0,2}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
const cellText = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" && v && "text" in v ? String((v as { text: unknown }).text) : String(v)).trim();

export async function readOpnameUpload(file: File, lines: OpnameLine[]): Promise<OpnameUpload> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("File Excel kosong");
  // The header row: the first with a "Stok Fisik" cell.
  let headRow = 0;
  const col: Record<string, number> = {};
  ws.eachRow((row, n) => {
    if (headRow) return;
    row.eachCell((c, i) => {
      const t = cellText(c.value).toLowerCase();
      if (t.startsWith("stok fisik")) headRow = n;
      if (t.startsWith("id")) col.id = i;
      else if (t === "kode") col.kode = i;
      else if (t.startsWith("expired")) col.exp = i;
      else if (t.startsWith("stok fisik")) col.fisik = i;
      else if (t.startsWith("keterangan")) col.ket = i;
    });
    if (!headRow) for (const k of Object.keys(col)) delete col[k];
  });
  if (!headRow || !col.fisik) throw new Error('Kolom "Stok Fisik" tidak ditemukan. Pakai file dari tombol "Unduh Excel SO".');

  const byId = new Map(lines.map((l) => [l.id, l]));
  const dmy = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "-");
  const byKode = new Map(lines.map((l) => [`${l.kode.toUpperCase()}|${dmy(l.exp)}`, l]));
  const out: OpnameUpload = { found: [], invalid: [], unknown: 0 };
  const seen = new Set<number>();
  ws.eachRow((row, n) => {
    if (n <= headRow) return;
    const idRaw = col.id ? Number(cellText(row.getCell(col.id).value)) : NaN;
    const kode = col.kode ? cellText(row.getCell(col.kode).value).toUpperCase() : "";
    if (!kode && !Number.isFinite(idRaw)) return;
    const line = byId.get(idRaw) ?? byKode.get(`${kode}|${col.exp ? cellText(row.getCell(col.exp).value) || "-" : "-"}`);
    if (!line || seen.has(line.id)) {
      out.unknown++;
      return;
    }
    seen.add(line.id);
    const fisik = cellNumber(row.getCell(col.fisik).value);
    if (fisik === undefined) {
      out.invalid.push({ row: n, text: `${line.kode} ${line.nama}: "${cellText(row.getCell(col.fisik).value)}" bukan angka` });
      return;
    }
    const ket = col.ket ? cellText(row.getCell(col.ket).value) : null;
    out.found.push({ line, fisik, ket });
  });
  return out;
}
