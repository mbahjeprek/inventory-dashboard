export type PrintColumn = { label: string; align?: "left" | "right"; nowrap?: boolean };

const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Pages through a list endpoint (the server caps pageSize at 500) so a print covers every row that
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

// Very large prints (BBM has 20k+ rows unfiltered) are slow and hundreds of pages; ask first.
export function confirmLargePrint(total: number): boolean {
  if (total <= 2000) return true;
  return window.confirm(
    `Akan mencetak ${total.toLocaleString("id-ID")} baris (sekitar ${Math.ceil(total / 30).toLocaleString("id-ID")} halaman).\n` +
      "Gunakan filter (misalnya tanggal) untuk memperkecil. Lanjutkan?"
  );
}

// Prints a table laid out like the on-screen grid (same columns, green header, cell borders) via a
// hidden iframe, so it isn't blocked as a popup and the app's own layout doesn't leak into the print.
export function printTable({
  title,
  subtitle = [],
  columns,
  rows,
  landscape = false,
}: {
  title: string;
  subtitle?: string[];
  columns: PrintColumn[];
  rows: (string | number | null | undefined)[][];
  landscape?: boolean;
}) {
  const printedAt = new Date().toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" });
  const cls = (c?: PrintColumn) => [c?.align === "right" && "r", c?.nowrap && "nw"].filter(Boolean).join(" ");
  const head = columns.map((c) => `<th class="${cls(c)}">${escapeHtml(c.label)}</th>`).join("");
  const body = rows.length
    ? rows
        .map(
          (r) =>
            `<tr>${r.map((v, i) => `<td class="${cls(columns[i])}">${escapeHtml(v ?? "-")}</td>`).join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${columns.length}" class="empty">Tidak ada data</td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: system-ui, "Segoe UI", Roboto, sans-serif; color: #1a2634; margin: 0; font-size: 9pt; }
    h1 { font-size: 14pt; margin: 0 0 2px; }
    .meta { color: #5b6b7c; font-size: 8.5pt; margin: 0 0 1px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th, td { border: 1px solid #b9c4cf; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #cfeab5; color: #1f3d12; font-weight: 600; text-transform: uppercase; font-size: 7.5pt; }
    tbody tr:nth-child(even) td { background: #f7faf5; }
    .r { text-align: right; }
    .nw { white-space: nowrap; }
    .empty { text-align: center; color: #94a3b8; padding: 16px; }
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle.map((s) => `<p class="meta">${escapeHtml(s)}</p>`).join("")}
    <p class="meta">Dicetak: ${escapeHtml(printedAt)} · ${rows.length.toLocaleString("id-ID")} baris</p>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
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
  setTimeout(() => {
    win.focus();
    win.print();
  }, 50);
}
