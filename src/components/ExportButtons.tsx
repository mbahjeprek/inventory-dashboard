import { useState } from "react";
import { Printer, FileSpreadsheet } from "lucide-react";
import { confirmLargePrint, exportExcel, printTable, type AnyReport } from "../lib/printTable";

// Cetak + Excel buttons for an inventory page. Both run off the same report so the printout and
// the spreadsheet always match each other and the on-screen table.
export function ExportButtons({
  total,
  buildReport,
  fileName,
}: {
  total: number;
  buildReport: () => Promise<AnyReport>;
  fileName: string;
}) {
  const [busy, setBusy] = useState<"" | "print" | "excel">("");
  const [error, setError] = useState("");

  const run = async (kind: "print" | "excel") => {
    if (!confirmLargePrint(total)) return;
    setBusy(kind);
    setError("");
    try {
      const report = await buildReport();
      if (kind === "print") printTable(report);
      else await exportExcel(report, `${fileName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      setError(kind === "print" ? "Gagal menyiapkan cetak" : "Gagal membuat file Excel");
    } finally {
      setBusy("");
    }
  };

  const btn =
    "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[#f1f5f9] disabled:opacity-50";

  return (
    <>
      {error && <span className="text-xs text-[var(--accent-red)]">{error}</span>}
      <button onClick={() => run("print")} disabled={!!busy} className={btn}>
        <Printer size={16} /> {busy === "print" ? "Menyiapkan..." : "Cetak"}
      </button>
      <button onClick={() => run("excel")} disabled={!!busy} className={btn}>
        <FileSpreadsheet size={16} className="text-[var(--accent-green)]" /> {busy === "excel" ? "Menyiapkan..." : "Excel"}
      </button>
    </>
  );
}
