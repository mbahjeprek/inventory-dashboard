import type { PruningBlokOption } from "./api";

// Pruning by Excel: a template (one row per blok pruned on a date: Tanggal, Estate, Blok, Pokok, Ha,
// Keterangan, plus a "Daftar Blok" sheet to look the blok up), and reading such a file back into rows for
// /api/pruning/import, which checks and saves them.

const ESTATE_LABEL: Record<string, string> = { NILAM: "Nilam", KNS: "KNS", WJA: "WJA", ZAMRUD: "Zamrud", FIRUS: "Firus" };
const HEAD = ["Tanggal", "Estate", "Blok", "Pokok", "Ha", "Keterangan"];
const border = { style: "thin" as const, color: { argb: "FFD5DDE6" } };

export async function downloadPruningTemplate(blokList: PruningBlokOption[]) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Pruning");
  ws.addRow(["Input Pruning PT.AKSS"]).font = { bold: true, size: 13 };
  ws.addRow([
    "Satu baris = satu blok pada satu tanggal. Tanggal dd/mm/yyyy, Estate Nilam / Zamrud / Firus, Pokok wajib, Ha boleh kosong (dihitung pokok ÷ SPH). Hapus baris contoh sebelum upload.",
  ]).font = { size: 9, color: { argb: "FF5B6B7C" } };
  ws.addRow([]);
  const hr = ws.addRow(HEAD);
  hr.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FF1F3D12" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFEAB5" } };
    c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });
  const contoh = blokList[0];
  const r = ws.addRow([new Date(), contoh ? ESTATE_LABEL[contoh.estate] ?? contoh.estate : "Nilam", contoh?.blok ?? "I-5", 150, null, "contoh - hapus baris ini"]);
  r.getCell(1).numFmt = "dd/mm/yyyy";
  r.font = { italic: true, color: { argb: "FF94A3B8" } };
  ws.getColumn(1).numFmt = "dd/mm/yyyy";
  [14, 12, 12, 10, 10, 40].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 4 }];

  const ref = wb.addWorksheet("Daftar Blok");
  const rh = ref.addRow(["Estate", "Divisi", "Blok", "Ha", "SPH", "Target pokok"]);
  rh.font = { bold: true };
  for (const b of blokList) {
    const x = ref.addRow([ESTATE_LABEL[b.estate] ?? b.estate, b.divisi ?? "", b.blok, b.ha, b.sph === null ? null : Math.round(b.sph * 100) / 100, b.ha && b.sph ? Math.round(b.ha * b.sph) : null]);
    x.eachCell({ includeEmpty: true }, (c) => (c.border = { top: border, bottom: border, left: border, right: border }));
  }
  [10, 14, 10, 10, 10, 14].forEach((w, i) => (ref.getColumn(i + 1).width = w));
  ref.views = [{ state: "frozen", ySplit: 1 }];
  ref.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "template-input-pruning.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type PruningUploadRow = { row: number; tanggal_iso: string; estate: string; blok: string; pkk: number | null; ha: number | null; keterangan: string };

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v && "result" in v) return cellText((v as { result: unknown }).result);
  if (typeof v === "object" && v && "text" in v) return String((v as { text: unknown }).text).trim();
  if (typeof v === "object" && v && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("").trim();
  return String(v).trim();
};
// Excel numbers as they are; text the Indonesian way ("1.250", "2,5") or plain "2.5". NaN = not a number.
function cellNumber(v: unknown): number | null {
  if (typeof v === "object" && v && "result" in v) return cellNumber((v as { result: unknown }).result);
  if (typeof v === "number") return v;
  const t = cellText(v);
  if (!t || t === "-") return null;
  const s = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  return Number(s);
}
const pad = (n: number) => String(n).padStart(2, "0");
// A date cell (Excel date) or text dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd -> yyyy-mm-dd; "" when unreadable.
function cellDate(v: unknown): string {
  if (typeof v === "object" && v && "result" in v) return cellDate((v as { result: unknown }).result);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const t = cellText(v);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return t;
}

// Reads the first sheet: the header row is the first with "Blok" and "Pokok"; without an Estate column
// every row gets `estateDefault` (the estate chosen in the form).
export async function readPruningUpload(file: File, estateDefault: string): Promise<PruningUploadRow[]> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("File Excel kosong");
  let headRow = 0;
  const col: Record<string, number> = {};
  ws.eachRow((row, n) => {
    if (headRow) return;
    const found: Record<string, number> = {};
    row.eachCell((c, i) => {
      const t = cellText(c.value).toLowerCase();
      if (t.startsWith("tanggal") || t === "tgl") found.tanggal = i;
      else if (t === "estate" || t === "kebun") found.estate = i;
      else if (t === "blok" || t === "block") found.blok = i;
      else if (t.startsWith("pokok") || t === "pkk") found.pkk = i;
      else if (t === "ha" || t.startsWith("ha ") || t === "luas") found.ha = i;
      else if (t.startsWith("keterangan") || t === "ket") found.ket = i;
    });
    if (found.blok && found.pkk) {
      headRow = n;
      Object.assign(col, found);
    }
  });
  if (!headRow || !col.tanggal) throw new Error('Kolom Tanggal, Blok dan Pokok tidak ditemukan. Pakai file dari tombol "Unduh template".');
  const rows: PruningUploadRow[] = [];
  ws.eachRow((row, n) => {
    if (n <= headRow) return;
    const blok = cellText(row.getCell(col.blok).value);
    const pkkRaw = row.getCell(col.pkk).value;
    const ket = col.ket ? cellText(row.getCell(col.ket).value) : "";
    if (!blok && cellNumber(pkkRaw) === null) return;
    if (/^contoh/i.test(ket)) return;
    const pkk = cellNumber(pkkRaw);
    const ha = col.ha ? cellNumber(row.getCell(col.ha).value) : null;
    rows.push({
      row: n,
      tanggal_iso: cellDate(row.getCell(col.tanggal).value),
      estate: col.estate ? cellText(row.getCell(col.estate).value) || estateDefault : estateDefault,
      blok,
      pkk: pkk !== null && Number.isNaN(pkk) ? -1 : pkk,
      ha: ha !== null && Number.isNaN(ha) ? -1 : ha,
      keterangan: ket,
    });
  });
  if (!rows.length) throw new Error("Tidak ada baris pruning di file");
  return rows;
}
