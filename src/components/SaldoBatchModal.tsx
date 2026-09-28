import { useState } from "react";
import { api, type OliSummary, type PupukSummary } from "../lib/api";
import { BatchGrid, HeaderField, fmtNum, headerInputCls, isBlankIn, localToday, parseNum, runningStock, type Cells, type GridCol } from "./BatchGrid";

// Input Banyak for the saldo inventories of one estate: pupuk and oli, one row per application /
// unit on one date, each jenis's saldo running down its rows (see BatchGrid). As on the single form,
// keluar / pemakaian may take the saldo below zero (shown red, not refused).
const sum = (rows: Cells[], pick: (c: Cells) => boolean) => rows.reduce((t, c) => t + (pick(c) ? parseNum(c.jumlah) || 0 : 0), 0);

function useTanggal() {
  const [tanggal, setTanggal] = useState(localToday());
  const field = (
    <HeaderField label="Tanggal">
      <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={headerInputCls} />
    </HeaderField>
  );
  const restore = (x: unknown) => {
    const t = (x as { tanggal?: string } | null)?.tanggal;
    if (t) setTanggal(t);
  };
  return { tanggal, field, restore };
}

export function PupukBatchModal({
  estate,
  summary,
  jenisOptions,
  divisiOptions,
  onClose,
  onSuccess,
}: {
  estate: string;
  summary: PupukSummary | null;
  jenisOptions: string[];
  divisiOptions: string[];
  onClose: () => void;
  onSuccess: (count: number) => void;
}) {
  const { tanggal, field, restore } = useTanggal();
  const masuk = (c: Cells) => c.tipe === "MASUK";
  const offMasuk = (c: Cells) => masuk(c) && "-";
  const columns: GridCol[] = [
    {
      key: "tipe",
      label: "Tipe",
      width: 100,
      type: "select",
      options: [
        { value: "KELUAR", label: "Stock Out" },
        { value: "MASUK", label: "Stock In" },
      ],
      tone: (c) => (masuk(c) ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"),
    },
    { key: "jenis", label: "Jenis Pupuk", width: 150, type: "select", carry: true, options: jenisOptions.map((j) => ({ value: j })) },
    { key: "jumlah", label: "Jumlah (KG)", width: 95, type: "number", align: "right" },
    {
      key: "divisi",
      label: "Divisi",
      width: 110,
      type: "select",
      carry: true,
      options: [{ value: "", label: "-- Pilih --" }, ...divisiOptions.map((d) => ({ value: d }))],
      off: offMasuk,
    },
    { key: "blok", label: "Blok", width: 90, placeholder: "cth. A12", off: offMasuk },
    { key: "ha", label: "HA", width: 75, type: "number", align: "right", off: offMasuk },
    { key: "pokok", label: "Pokok", width: 80, type: "number", align: "right", off: offMasuk },
    { key: "ket", label: "Keterangan", width: 200, placeholder: (c) => (masuk(c) ? "cth. Kiriman dari ..." : "cth. Pemupukan TM") },
  ];
  const blank = isBlankIn(columns);
  const start = (j: string) => summary?.saldoTerakhir.find((s) => s.jenis_pupuk === j)?.saldo_stock ?? 0;
  const run = (rows: Cells[]) =>
    runningStock(rows, { start, keyOf: (c) => c.jenis, delta: (c) => (parseNum(c.jumlah) > 0 ? (masuk(c) ? 1 : -1) * parseNum(c.jumlah) : 0), blank });

  // Same required fields as the single form.
  const problem = (c: Cells) => {
    const keluar = !masuk(c);
    const missing = [
      !c.jenis && "Jenis",
      !(parseNum(c.jumlah) > 0) && "Jumlah",
      keluar && !c.divisi && "Divisi",
      keluar && !c.blok.trim() && "Blok",
      keluar && !c.ha.trim() && "HA",
      keluar && !c.pokok.trim() && "Pokok",
      !c.ket.trim() && "Keterangan",
    ].filter(Boolean);
    if (missing.length) return `Wajib diisi: ${missing.join(", ")}`;
    if (keluar && (!Number.isFinite(parseNum(c.ha)) || !Number.isFinite(parseNum(c.pokok)))) return "HA / Pokok harus angka";
    return "";
  };

  return (
    <BatchGrid
      title={`Input Banyak Pupuk - ${estate}`}
      subtitle="Stock In / Stock Out pupuk satu hari sekaligus"
      draftKey={`batch:pupuk:${estate}`}
      extra={{ tanggal }}
      onRestoreExtra={restore}
      header={field}
      columns={columns}
      blankRow={{ tipe: "KELUAR", jenis: jenisOptions[0] ?? "", jumlah: "", divisi: "", blok: "", ha: "", pokok: "", ket: "" }}
      problem={problem}
      saldo={(rows) => run(rows).map((s) => s && { text: fmtNum(s.after), bad: s.after < 0 })}
      summary={(rows) => (
        <>
          stock out <b className="text-[var(--accent-red)]">{fmtNum(sum(rows, (c) => !masuk(c)))} KG</b> · stock in{" "}
          <b className="text-[var(--accent-green)]">{fmtNum(sum(rows, masuk))} KG</b>
        </>
      )}
      submit={async (rows, evidenceId) => {
        const res = await api.createPupukBatch({
          evidence_id: evidenceId,
          estate,
          tanggal_iso: tanggal,
          rows: rows.map((c) => {
            const keluar = !masuk(c);
            return {
              jenis_pupuk: c.jenis,
              tipe: keluar ? "KELUAR" : "MASUK",
              jumlah: parseNum(c.jumlah),
              divisi: keluar ? c.divisi : "",
              blok: keluar ? c.blok.trim().toUpperCase().replace(/\./g, "") : "",
              ha: keluar ? parseNum(c.ha) : "",
              pokok: keluar ? parseNum(c.pokok) : "",
              keterangan: c.ket.trim(),
            };
          }),
        });
        return res.count;
      }}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}

export function OliBatchModal({
  estate,
  summary,
  jenisOptions,
  onClose,
  onSuccess,
}: {
  estate: string;
  summary: OliSummary | null;
  jenisOptions: string[];
  onClose: () => void;
  onSuccess: (count: number) => void;
}) {
  const { tanggal, field, restore } = useTanggal();
  const masuk = (c: Cells) => c.tipe === "MASUK";
  const columns: GridCol[] = [
    {
      key: "tipe",
      label: "Tipe",
      width: 115,
      type: "select",
      options: [
        { value: "PEMAKAIAN", label: "Stock Out" },
        { value: "MASUK", label: "Stock In" },
      ],
      tone: (c) => (masuk(c) ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"),
    },
    { key: "jenis", label: "Jenis Oli", width: 150, type: "select", carry: true, options: jenisOptions.map((j) => ({ value: j })) },
    { key: "jumlah", label: "Jumlah (LTR)", width: 95, type: "number", align: "right" },
    { key: "bpb", label: "No. BPB", width: 110, carry: true },
    { key: "ket", label: "Unit / Keterangan", width: 260, placeholder: (c) => (masuk(c) ? "cth. Kiriman dari ..." : "cth. Ganti oli MPN02") },
  ];
  const blank = isBlankIn(columns);
  const start = (j: string) => summary?.saldoTerakhir.find((s) => s.jenis_oli === j)?.saldo_stock ?? 0;
  const run = (rows: Cells[]) =>
    runningStock(rows, { start, keyOf: (c) => c.jenis, delta: (c) => (parseNum(c.jumlah) > 0 ? (masuk(c) ? 1 : -1) * parseNum(c.jumlah) : 0), blank });

  const problem = (c: Cells) => {
    const missing = [
      !c.jenis && "Jenis",
      !(parseNum(c.jumlah) > 0) && "Jumlah",
      !c.bpb.trim() && "No. BPB",
      !c.ket.trim() && (masuk(c) ? "Keterangan" : "Unit / Keterangan"),
    ].filter(Boolean);
    return missing.length ? `Wajib diisi: ${missing.join(", ")}` : "";
  };

  return (
    <BatchGrid
      title={`Input Banyak Oli - ${estate}`}
      subtitle="Stock In / Stock Out oli satu hari sekaligus"
      draftKey={`batch:oli:${estate}`}
      extra={{ tanggal }}
      onRestoreExtra={restore}
      header={field}
      columns={columns}
      blankRow={{ tipe: "PEMAKAIAN", jenis: jenisOptions[0] ?? "", jumlah: "", bpb: "", ket: "" }}
      problem={problem}
      saldo={(rows) => run(rows).map((s) => s && { text: fmtNum(s.after), bad: s.after < 0 })}
      summary={(rows) => (
        <>
          stock out <b className="text-[var(--accent-red)]">{fmtNum(sum(rows, (c) => !masuk(c)))} LTR</b> · stock in{" "}
          <b className="text-[var(--accent-green)]">{fmtNum(sum(rows, masuk))} LTR</b>
        </>
      )}
      submit={async (rows, evidenceId) => {
        const res = await api.createOliBatch({
          evidence_id: evidenceId,
          estate,
          tanggal_iso: tanggal,
          rows: rows.map((c) => ({
            jenis_oli: c.jenis,
            tipe: masuk(c) ? "MASUK" : "PEMAKAIAN",
            jumlah: parseNum(c.jumlah),
            no_embrace: c.bpb.trim(),
            keterangan: c.ket.trim(),
          })),
        });
        return res.count;
      }}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
