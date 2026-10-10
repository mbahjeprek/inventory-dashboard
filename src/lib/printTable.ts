export type PrintColumn = { label: string; align?: "left" | "right"; nowrap?: boolean };
type Cell = string | number | null | undefined;

// One definition of a table report, shared by the Cetak (print) and Excel exports so both always
// carry the same title, filters and columns as the on-screen table.
export type TableReport = {
  title: string;
  subtitle?: string[];
  columns: PrintColumn[];
  rows: Cell[][];
  landscape?: boolean;
};

// A report of several tables one after another (e.g. Klinik > Laporan Harian > Ringkasan KPI: the
// KPI figures, visits per day, top diagnoses ...), each under its heading.
// A section can also carry a chart (a picture of the on-screen chart, above its table) and a note
// (the small print under it); a section without columns is just its chart.
export type ChartImage = { svg: string; width: number; height: number };
export type ReportSection = { heading: string; columns: PrintColumn[]; rows: Cell[][]; chart?: ChartImage; note?: string };
// Part of a report that a dashboard panel builds from what it has on screen.
export type ReportPart = { subtitle?: string[]; sections: ReportSection[] };
export type SectionReport = { title: string; subtitle?: string[]; sections: ReportSection[]; landscape?: boolean };
export type AnyReport = TableReport | SectionReport;
const asSections = (r: AnyReport): ReportSection[] => ("sections" in r ? r.sections : [{ heading: "", columns: r.columns, rows: r.rows }]);
const rowCount = (r: AnyReport) => ("sections" in r ? "" : ` · ${r.rows.length.toLocaleString("id-ID")} baris`);

const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Empty cells show "-" and numbers use Indonesian grouping, the same as the on-screen table.
const displayCell = (v: Cell) =>
  v === null || v === undefined || v === "" ? "-" : typeof v === "number" ? v.toLocaleString("id-ID", { maximumFractionDigits: 1 }) : v;

// The chart drawn inside `el` (a recharts <svg>) as a standalone SVG, with an optional legend line
// above it (the dashboard legends are HTML next to the chart, not part of the svg).
export function chartOf(el: Element | null | undefined, legend: { label: string; color: string }[] = []): ChartImage | undefined {
  const svg = el?.querySelector("svg.recharts-surface");
  const box = svg?.getBoundingClientRect();
  if (!svg || !box?.width || !box.height) return undefined;
  const width = Math.round(box.width);
  const top = legend.length ? 22 : 0;
  const height = Math.round(box.height) + top;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("x", "0");
  clone.setAttribute("y", String(top));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(Math.round(box.height)));
  clone.removeAttribute("style");
  let x = 0;
  const key = legend
    .map((l) => {
      const at = x;
      x += 30 + l.label.length * 7;
      return `<rect x="${at}" y="7" width="14" height="3" rx="1" fill="${l.color}"/><text x="${at + 18}" y="12" font-size="11" fill="#5b6b7c">${escapeHtml(l.label)}</text>`;
    })
    .join("");
  const body = new XMLSerializer().serializeToString(clone);
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, Segoe UI, Roboto, sans-serif"><rect width="${width}" height="${height}" fill="#ffffff"/>${key}${body}</svg>`,
  };
}
const svgUrl = (c: ChartImage) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}`;

// The chart as a PNG (twice the screen size, so it stays sharp) for the Excel sheet.
async function chartPng(c: ChartImage): Promise<string> {
  const img = new Image();
  img.src = svgUrl(c);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = c.width * 2;
  canvas.height = c.height * 2;
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

const printedAtText = () => new Date().toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" });

// Pages through a list endpoint (the server caps pageSize at 500) so an export covers every row that
// matches the current filters, not just the page on screen.
export async function fetchAllRows<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ data: T[]; total: number }>
): Promise<T[]> {
  const pageSize = 500;
  const first = await fetchPage(1, pageSize);
  const pages = Math.ceil(first.total / pageSize);
  const rest = await Promise.all(Array.from({ length: Math.max(pages - 1, 0) }, (_, i) => fetchPage(i + 2, pageSize)));
  return [first, ...rest].flatMap((r) => r.data);
}

// Very large exports (BBM has 20k+ rows unfiltered) are slow and hundreds of pages; ask first.
export function confirmLargePrint(total: number): boolean {
  if (total <= 2000) return true;
  return window.confirm(
    `Akan mengambil ${total.toLocaleString("id-ID")} baris (sekitar ${Math.ceil(total / 30).toLocaleString("id-ID")} halaman cetak).\n` +
      "Gunakan filter (misalnya tanggal) untuk memperkecil. Lanjutkan?"
  );
}

// Prints a table laid out like the on-screen grid (same columns, green header, cell borders) via a
// hidden iframe, so it isn't blocked as a popup and the app's own layout doesn't leak into the print.
// A SectionReport prints each of its tables under its heading.
export function printTable(report: AnyReport) {
  const { title, subtitle = [], landscape = false } = report;
  const cls = (c?: PrintColumn) => [c?.align === "right" && "r", c?.nowrap && "nw"].filter(Boolean).join(" ");
  const table = ({ heading, columns, rows, chart, note }: ReportSection) => {
    const pic = chart ? `<img class="chart" src="${svgUrl(chart)}" style="width:${chart.width}px" alt="">` : "";
    const foot = note ? `<p class="note">${escapeHtml(note)}</p>` : "";
    const h = heading ? `<h2>${escapeHtml(heading)}</h2>` : "";
    if (!columns.length) return `${h}${pic}${foot}`;
    const head = columns.map((c) => `<th class="${cls(c)}">${escapeHtml(c.label)}</th>`).join("");
    const body = rows.length
      ? rows.map((r) => `<tr>${r.map((v, i) => `<td class="${cls(columns[i])}">${escapeHtml(displayCell(v))}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${columns.length}" class="empty">Tidak ada data</td></tr>`;
    return `${h}${pic}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${foot}`;
  };

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: system-ui, "Segoe UI", Roboto, sans-serif; color: #1a2634; margin: 0; font-size: 9pt; }
    h1 { font-size: 14pt; margin: 0 0 2px; }
    h2 { font-size: 10.5pt; margin: 14px 0 0; page-break-after: avoid; }
    .meta { color: #5b6b7c; font-size: 8.5pt; margin: 0 0 1px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    h2 + table { margin-top: 4px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th, td { border: 1px solid #b9c4cf; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #cfeab5; color: #1f3d12; font-weight: 600; text-transform: uppercase; font-size: 7.5pt; }
    tbody tr:nth-child(even) td { background: #f7faf5; }
    .r { text-align: right; }
    .nw { white-space: nowrap; }
    .chart { display: block; max-width: 100%; height: auto; margin-top: 6px; page-break-inside: avoid; }
    .note { color: #5b6b7c; font-size: 7.5pt; margin: 3px 0 0; }
    .empty { text-align: center; color: #94a3b8; padding: 16px; }
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle.map((s) => `<p class="meta">${escapeHtml(s)}</p>`).join("")}
    <p class="meta">Dicetak: ${escapeHtml(printedAtText())}${rowCount(report)}</p>
    ${asSections(report).map(table).join("")}
  </body></html>`;

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const win = iframe.contentWindow!;
  win.onafterprint = () => setTimeout(() => iframe.remove(), 0);
  // Charts are images; print once they are drawn.
  setTimeout(() => {
    Promise.all(Array.from(doc.images, (img) => img.decode().catch(() => undefined))).then(() => {
      win.focus();
      win.print();
    });
  }, 50);
}

// Same report as printTable, as a styled .xlsx: title/filter lines, then the table with the green
// header, cell borders and zebra rows. Numbers stay real numbers so they can be summed in Excel. A
// SectionReport puts its tables one under another on the sheet, each under its heading.
export async function exportExcel(report: AnyReport, fileName: string) {
  const { title, subtitle = [], landscape = false } = report;
  const sections = asSections(report);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"), {
    pageSetup: {
      paperSize: 9, // A4
      orientation: landscape ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });

  ws.addRow([title]).font = { bold: true, size: 14 };
  for (const s of [...subtitle, `Dicetak: ${printedAtText()}${rowCount(report)}`]) {
    ws.addRow([s]).font = { size: 9, color: { argb: "FF5B6B7C" } };
  }

  const border = { style: "thin" as const, color: { argb: "FFB9C4CF" } };
  const allBorders = { top: border, left: border, bottom: border, right: border };
  let headerRowNo = 0;

  for (const { heading, columns, rows, chart, note } of sections) {
    ws.addRow([]);
    if (heading) ws.addRow([heading]).font = { bold: true, size: 11 };
    if (chart) {
      // At most ~760px wide on the sheet; blank rows (20px each) keep the table below it.
      const scale = Math.min(1, 760 / chart.width);
      const image = wb.addImage({ base64: await chartPng(chart), extension: "png" });
      ws.addImage(image, { tl: { col: 0, row: ws.rowCount }, ext: { width: chart.width * scale, height: chart.height * scale } });
      for (let i = Math.ceil((chart.height * scale) / 20); i > 0; i--) ws.addRow([]);
    }
    if (!columns.length) {
      if (note) ws.addRow([note]).font = { size: 8, color: { argb: "FF5B6B7C" } };
      continue;
    }
    const header = ws.addRow(columns.map((c) => c.label.toUpperCase()));
    headerRowNo = header.number;
    header.eachCell((cell, i) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFEAB5" } };
      cell.font = { bold: true, size: 9, color: { argb: "FF1F3D12" } };
      cell.border = allBorders;
      cell.alignment = { vertical: "middle", horizontal: columns[i - 1]?.align === "right" ? "right" : "left", wrapText: true };
    });

    if (!rows.length) {
      const empty = ws.addRow(["Tidak ada data"]);
      ws.mergeCells(empty.number, 1, empty.number, columns.length);
      empty.getCell(1).alignment = { horizontal: "center" };
      empty.getCell(1).font = { size: 9, color: { argb: "FF94A3B8" } };
      empty.getCell(1).border = allBorders;
    }

    rows.forEach((r, idx) => {
      const row = ws.addRow(r.map((v) => (v === null || v === undefined || v === "" ? "-" : v)));
      row.eachCell({ includeEmpty: true }, (cell, i) => {
        const col = columns[i - 1];
        cell.font = { size: 9 };
        cell.border = allBorders;
        cell.alignment = { vertical: "top", horizontal: col?.align === "right" ? "right" : "left", wrapText: !col?.nowrap };
        if (typeof cell.value === "number") cell.numFmt = Number.isInteger(cell.value) ? "#,##0" : "#,##0.0";
        if (idx % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7FAF5" } };
      });
    });
    if (note) ws.addRow([note]).font = { size: 8, color: { argb: "FF5B6B7C" } };
  }

  // Column widths from the longest value (capped), so long text like Keterangan wraps instead of
  // producing one huge column.
  const widest = Math.max(...sections.map((s) => s.columns.length));
  for (let i = 0; i < widest; i++) {
    const longest = Math.max(
      8,
      ...sections.flatMap((s) => (s.columns[i] ? [s.columns[i].label.length, ...s.rows.map((r) => String(displayCell(r[i])).length)] : []))
    );
    ws.getColumn(i + 1).width = Math.min(longest + 2, 45);
  }

  // One table: its header stays on screen and on every printed page, with a filter on it.
  if (!("sections" in report)) {
    ws.views = [{ state: "frozen", ySplit: headerRowNo }];
    ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo, column: report.columns.length } };
    ws.pageSetup.printTitlesRow = `${headerRowNo}:${headerRowNo}`;
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
