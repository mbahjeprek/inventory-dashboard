import { useEffect, useMemo, useState } from "react";
import { wrongJenis } from "../lib/bbmJenis";
import { api, type BbmSummary } from "../lib/api";
import type { AlatOption } from "./AlatAutocomplete";
import { PEMASOK, tujuanColumn } from "../lib/kirim";
import { BatchGrid, HeaderField, fmtNum, headerInputCls, isBlankIn, localToday, parseNum, runningStock, type Cells, type GridCol } from "./BatchGrid";

// Input Banyak BBM: the day's usage of one lokasi, one row per vehicle / genset (see BatchGrid).
const LOKASI = ["NILAM", "WJA", "KNS", "ZAMRUD", "FIRUS"];

export function BbmBatchModal({
  summary,
  lokasiLock,
  jenisAwal,
  onClose,
  onSuccess,
}: {
  summary: BbmSummary | null;
  lokasiLock?: string;
  // The jenis the page is showing, so a Bensin entry isn't typed into Solar by accident.
  jenisAwal?: "SOLAR" | "BENSIN";
  onClose: () => void;
  onSuccess: (count: number) => void;
}) {
  const [jenis, setJenis] = useState<"SOLAR" | "BENSIN">(jenisAwal ?? "SOLAR");
  const [lokasi, setLokasi] = useState(lokasiLock ?? "NILAM");
  const [tanggal, setTanggal] = useState(localToday());
  const [estateOptions, setEstateOptions] = useState<string[]>([]);
  const [alat, setAlat] = useState<AlatOption[]>([]);

  useEffect(() => {
    api.bbmEstateOptions(jenis, lokasi).then(setEstateOptions).catch(() => setEstateOptions([]));
  }, [jenis, lokasi]);
  useEffect(() => {
    api.alatPick("").then(setAlat).catch(() => setAlat([]));
  }, []);

  const alatByKode = useMemo(() => new Map(alat.map((a) => [a.kode.toUpperCase(), a])), [alat]);
  const alatOf = (c: Cells) => alatByKode.get((c.kendaraan ?? "").trim().toUpperCase());
  const masuk = (c: Cells) => c.tipe === "DITERIMA";
  const genset = (c: Cells) => /genset/i.test(c.kendaraan ?? "") || alatOf(c)?.jenis_unit === "GENSET";
  // Nilam's Stock Out with a Tujuan: sent into that estate's tank (a Transfer), no vehicle / HM / SPB.
  const supplier = lokasi === PEMASOK;
  const kirim = (c: Cells) => supplier && !masuk(c) && !!c.ke;

  const columns: GridCol[] = [
    {
      key: "tipe",
      label: "Tipe",
      width: 105,
      type: "select",
      options: [
        { value: "PEMAKAIAN", label: "Stock Out" },
        { value: "DITERIMA", label: "Stock In" },
      ],
      tone: (c) => (masuk(c) ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"),
    },
    ...(supplier ? [tujuanColumn(lokasi, (c) => !masuk(c))] : []),
    {
      key: "kendaraan",
      label: "Kendaraan / Alat",
      width: 150,
      options: alat.map((a) => ({ value: a.kode, label: [a.jenis_unit, a.nama].filter(Boolean).join(" · ") })),
      placeholder: "cth. MPN02",
      off: (c) => (masuk(c) || kirim(c)) && "-",
      hint: (c) => {
        const a = alatOf(c);
        return a ? [a.jenis_unit, a.nama].filter(Boolean).join(" · ") : undefined;
      },
    },
    { key: "jumlah", label: "Jumlah (LTR)", width: 90, type: "number", align: "right" },
    { key: "hm", label: "HM / KM", width: 110, placeholder: "cth. 4373.7 h", copy: false, off: (c) => (masuk(c) || kirim(c) ? "-" : genset(c) && "genset") },
    {
      key: "estate",
      label: "Estate",
      width: 120,
      type: "select",
      carry: true,
      options: [{ value: "", label: "-- Pilih --" }, ...estateOptions.map((e) => ({ value: e }))],
      off: (c) => (masuk(c) && lokasi) || (kirim(c) && "-"),
    },
    { key: "spb", label: "No. SPB", width: 90, carry: true },
    { key: "ket", label: "Keterangan", width: 220, placeholder: (c) => (masuk(c) ? "cth. Kiriman dari ..." : "cth. Genset 02 B") },
  ];
  const blank = isBlankIn(columns);
  const blankRow: Cells = { tipe: "PEMAKAIAN", ke: "", kendaraan: "", jumlah: "", hm: "", estate: lokasi, spb: "", ket: "" };

  const saldoAwal = summary?.saldoTerakhir.find((s) => s.jenis_bbm === jenis && s.lokasi === lokasi)?.saldo_stock ?? 0;
  const run = (rows: Cells[]) =>
    runningStock(rows, {
      start: () => saldoAwal,
      keyOf: () => "saldo",
      delta: (c) => (parseNum(c.jumlah) > 0 ? (masuk(c) ? 1 : -1) * parseNum(c.jumlah) : 0),
      blank,
    });

  // Same required fields as the single Transaksi form.
  const problem = (c: Cells, i: number, rows: Cells[]) => {
    const keluar = !masuk(c);
    const pakai = keluar && !kirim(c);
    const missing = [
      !(parseNum(c.jumlah) > 0) && "Jumlah",
      pakai && !c.kendaraan.trim() && "Kendaraan",
      pakai && !genset(c) && !c.hm.trim() && "HM/KM",
      pakai && (!c.estate || (estateOptions.length > 0 && !estateOptions.includes(c.estate))) && "Estate",
      !kirim(c) && !c.spb.trim() && "No. SPB",
      !c.ket.trim() && "Keterangan",
    ].filter(Boolean);
    if (missing.length) return `Wajib diisi: ${missing.join(", ")}`;
    const salahJenis = wrongJenis(jenis, c.ket);
    if (salahJenis) return salahJenis;
    const s = run(rows)[i];
    if (keluar && s && s.after < 0) return `Stok tidak cukup (tinggal ${fmtNum(s.before)} LTR)`;
    return "";
  };

  return (
    <BatchGrid
      title="Input Banyak BBM"
      subtitle="Stock In / Stock Out satu hari sekaligus"
      draftKey={`batch:bbm:${jenis}:${lokasi}`}
      extra={{ tanggal }}
      onRestoreExtra={(x) => {
        const t = (x as { tanggal?: string } | null)?.tanggal;
        if (t) setTanggal(t);
      }}
      header={
        <>
          <HeaderField label="Jenis BBM">
            <select value={jenis} onChange={(e) => setJenis(e.target.value as "SOLAR" | "BENSIN")} className={headerInputCls}>
              <option value="SOLAR">SOLAR</option>
              <option value="BENSIN">BENSIN</option>
            </select>
          </HeaderField>
          <HeaderField label="Lokasi">
            {lokasiLock ? (
              <div className={`${headerInputCls} bg-[#f8fafc] text-[var(--text-secondary)]`}>{lokasiLock}</div>
            ) : (
              <select value={lokasi} onChange={(e) => setLokasi(e.target.value)} className={headerInputCls}>
                {LOKASI.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            )}
          </HeaderField>
          <HeaderField label="Tanggal">
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={headerInputCls} />
          </HeaderField>
        </>
      }
      columns={columns}
      blankRow={blankRow}
      problem={problem}
      saldo={(rows) => run(rows).map((s) => s && { text: fmtNum(s.after), bad: s.after < 0 })}
      summary={(rows) => {
        const keluar = rows.reduce((t, c) => t + (!masuk(c) ? parseNum(c.jumlah) || 0 : 0), 0);
        const masukTotal = rows.reduce((t, c) => t + (masuk(c) ? parseNum(c.jumlah) || 0 : 0), 0);
        const akhir = saldoAwal + masukTotal - keluar;
        return (
          <>
            stock out <b className="text-[var(--accent-red)]">{fmtNum(keluar)} LTR</b>
            {masukTotal > 0 && (
              <>
                {" "}
                · stock in <b className="text-[var(--accent-green)]">{fmtNum(masukTotal)} LTR</b>
              </>
            )}{" "}
            · stok {fmtNum(saldoAwal)} → <b className={akhir < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}>{fmtNum(akhir)} LTR</b>
          </>
        );
      }}
      submit={async (rows, evidenceId) => {
        const res = await api.createBbmBatch({
          evidence_id: evidenceId,
          jenis_bbm: jenis,
          lokasi,
          tanggal_iso: tanggal,
          rows: rows.map((c) => ({
            tipe: masuk(c) ? "DITERIMA" : "PEMAKAIAN",
            jumlah: parseNum(c.jumlah),
            estate: masuk(c) || kirim(c) ? lokasi : c.estate,
            no_spb: c.spb.trim(),
            keterangan: kirim(c) && c.spb.trim() ? `SPB ${c.spb.trim()}: ${c.ket.trim()}` : c.ket.trim(),
            kode_kendaraan: masuk(c) || kirim(c) ? "" : c.kendaraan.trim(),
            hm_terakhir: masuk(c) || kirim(c) || genset(c) ? "" : c.hm.trim(),
            ke: kirim(c) ? c.ke : "",
          })),
        });
        return res.count;
      }}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}
