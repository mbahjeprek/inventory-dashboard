import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Copy, Plus, Trash2, X } from "lucide-react";
import { api, ApiError, errorText, type BbmBatchRow, type BbmSummary } from "../lib/api";
import type { AlatOption } from "./AlatAutocomplete";
import { EvidenceInput, useEvidenceEnabled } from "./EvidenceInput";

// Input Banyak: the day's BBM usage of one lokasi typed as a table (one row per vehicle / genset)
// and saved in one go with one foto bukti, instead of one Transaksi form per row. Keyboard first:
// Enter moves to the next cell and past the last cell opens a new row; Ctrl+D copies the row. The
// saldo runs down the rows as they are typed. Unsaved rows stay as a draft in this browser.
const LOKASI = ["NILAM", "WJA", "KNS", "ZAMRUD", "FIRUS"];
const COLS = ["tipe", "kendaraan", "jumlah", "hm", "estate", "spb", "ket"] as const;
type Col = (typeof COLS)[number];

type Row = { key: number; tipe: "PEMAKAIAN" | "DITERIMA"; kendaraan: string; jumlah: string; hm: string; estate: string; spb: string; ket: string };

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });
// "1.500" / "1500" / "12,5" -> number (dots are thousands, a comma is the decimal mark).
const parseJumlah = (s: string) => Number(s.trim().replace(/\./g, "").replace(",", "."));
// A new row carries the SPB / estate of the one above, so only what is typed per row counts.
const isBlank = (r: Row) => !r.kendaraan.trim() && !r.jumlah.trim() && !r.hm.trim() && !r.ket.trim();

let nextKey = 1;
const draftKey = (jenis: string, lokasi: string) => `bbm-batch-draft:${jenis}:${lokasi}`;
function readDraft(jenis: string, lokasi: string): { tanggal: string; rows: Row[] } | null {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(jenis, lokasi)) || "null");
    if (!d || !Array.isArray(d.rows) || !d.rows.length) return null;
    return { tanggal: d.tanggal || localToday(), rows: d.rows.map((r: Row) => ({ ...r, key: nextKey++ })) };
  } catch {
    return null;
  }
}

export function BbmBatchModal({
  summary,
  lokasiLock,
  onClose,
  onSuccess,
}: {
  summary: BbmSummary | null;
  lokasiLock?: string;
  onClose: () => void;
  onSuccess: (count: number) => void;
}) {
  const [jenis, setJenis] = useState<"SOLAR" | "BENSIN">("SOLAR");
  const [lokasi, setLokasi] = useState(lokasiLock ?? "NILAM");
  const [tanggal, setTanggal] = useState(localToday());
  const [estateOptions, setEstateOptions] = useState<string[]>([]);
  const [alatOptions, setAlatOptions] = useState<AlatOption[]>([]);
  const newRow = (from?: Partial<Row>): Row => ({ key: nextKey++, tipe: "PEMAKAIAN", kendaraan: "", jumlah: "", hm: "", estate: lokasi, spb: "", ket: "", ...from });
  const [rows, setRows] = useState<Row[]>(() => readDraft("SOLAR", lokasiLock ?? "NILAM")?.rows ?? [newRow(), newRow(), newRow()]);
  const [restored, setRestored] = useState(() => !!readDraft("SOLAR", lokasiLock ?? "NILAM"));
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const evidenceOn = useEvidenceEnabled();
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const listId = useId();
  // Which jenis:lokasi the rows belong to: switching saves nothing until that table has been loaded.
  const [owner, setOwner] = useState(`SOLAR:${lokasiLock ?? "NILAM"}`);

  useEffect(() => {
    api.bbmEstateOptions(jenis, lokasi).then(setEstateOptions).catch(() => setEstateOptions([]));
  }, [jenis, lokasi]);
  useEffect(() => {
    api.alatPick("").then(setAlatOptions).catch(() => setAlatOptions([]));
  }, []);

  // Another jenis / lokasi: its own draft (or a fresh table).
  useEffect(() => {
    const k = `${jenis}:${lokasi}`;
    if (owner === k) return;
    setOwner(k);
    const d = readDraft(jenis, lokasi);
    setRows(d?.rows ?? [newRow(), newRow(), newRow()]);
    if (d) setTanggal(d.tanggal);
    setRestored(!!d);
    setRowErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jenis, lokasi]);

  // Keep the draft while typing; an empty table has nothing to keep.
  useEffect(() => {
    if (owner !== `${jenis}:${lokasi}`) return;
    try {
      if (rows.every(isBlank)) localStorage.removeItem(draftKey(jenis, lokasi));
      else localStorage.setItem(draftKey(jenis, lokasi), JSON.stringify({ tanggal, rows }));
    } catch {
      // storage unavailable: the table still works, only without a draft
    }
  }, [rows, tanggal, jenis, lokasi, owner]);

  const alatByKode = useMemo(() => new Map(alatOptions.map((a) => [a.kode.toUpperCase(), a])), [alatOptions]);
  const alatOf = (r: Row) => alatByKode.get(r.kendaraan.trim().toUpperCase());
  const isGenset = (r: Row) => /genset/i.test(r.kendaraan) || alatOf(r)?.jenis_unit === "GENSET";

  const saldoAwal = summary?.saldoTerakhir.find((s) => s.jenis_bbm === jenis && s.lokasi === lokasi)?.saldo_stock ?? 0;
  // Saldo after each row (blank rows and rows without a valid jumlah leave it as it is).
  const saldoAfter = useMemo(() => {
    let s = saldoAwal;
    return rows.map((r) => {
      const n = parseJumlah(r.jumlah);
      if (!isBlank(r) && n > 0) s = r.tipe === "DITERIMA" ? s + n : s - n;
      return s;
    });
  }, [rows, saldoAwal]);
  const filled = rows.filter((r) => !isBlank(r));
  const totalKeluar = filled.reduce((t, r) => t + (r.tipe === "PEMAKAIAN" ? parseJumlah(r.jumlah) || 0 : 0), 0);
  const totalMasuk = filled.reduce((t, r) => t + (r.tipe === "DITERIMA" ? parseJumlah(r.jumlah) || 0 : 0), 0);
  const saldoAkhir = saldoAfter[saldoAfter.length - 1] ?? saldoAwal;

  const setCell = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setRowErrors((e) => (Object.keys(e).length ? {} : e));
  };
  // At once when the cell is there (a fast typist's next key must land in it); a row that is only
  // being added gets its focus once it has rendered.
  const focusCell = (row: number, col: Col) => {
    const find = () => tableRef.current?.querySelector<HTMLElement>(`[data-r="${row}"][data-c="${col}"]`);
    const el = find();
    if (el) el.focus();
    else requestAnimationFrame(() => find()?.focus());
  };
  const addRow = (at: number, from?: Partial<Row>) => {
    setRows((rs) => [...rs.slice(0, at), newRow(from), ...rs.slice(at)]);
    focusCell(at, "kendaraan");
  };
  const copyRow = (i: number) => {
    const { tipe, kendaraan, jumlah, estate, spb, ket } = rows[i];
    // The HM / KM reading is the vehicle's own, so a copy starts without it.
    addRow(i + 1, { tipe, kendaraan, jumlah, estate, spb, ket });
  };
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [newRow()]));

  // Enter: next cell of the row (skipping the HM / KM of a genset or a Stok Masuk); after the last
  // cell, the next row (a new one at the end). Ctrl+D: copy the row below it.
  const onKey = (i: number, col: Col) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      copyRow(i);
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const r = rows[i];
    const skip = (c: Col) => (c === "hm" && (isGenset(r) || r.tipe === "DITERIMA")) || (r.tipe === "DITERIMA" && (c === "kendaraan" || c === "estate"));
    let c = COLS.indexOf(col) + 1;
    while (c < COLS.length && skip(COLS[c])) c++;
    if (c < COLS.length) return focusCell(i, COLS[c]);
    if (i === rows.length - 1) addRow(rows.length, { estate: r.estate, spb: r.spb });
    else focusCell(i + 1, "kendaraan");
  };

  // Same required fields as the single Transaksi form.
  const problem = (r: Row, i: number): string => {
    const keluar = r.tipe === "PEMAKAIAN";
    const n = parseJumlah(r.jumlah);
    const missing = [
      !(n > 0) && "Jumlah",
      keluar && !r.kendaraan.trim() && "Kendaraan",
      keluar && !isGenset(r) && !r.hm.trim() && "HM/KM",
      keluar && (!r.estate || (estateOptions.length > 0 && !estateOptions.includes(r.estate))) && "Estate",
      !r.spb.trim() && "No. SPB",
      !r.ket.trim() && "Keterangan",
    ].filter(Boolean);
    if (missing.length) return `Wajib diisi: ${missing.join(", ")}`;
    if (keluar && saldoAfter[i] < 0) return `Stok tidak cukup (tinggal ${fmt(saldoAfter[i] + n)} LTR)`;
    return "";
  };

  const submit = async () => {
    setError("");
    const idx = rows.map((r, i) => (isBlank(r) ? -1 : i)).filter((i) => i >= 0);
    if (!idx.length) return setError("Belum ada baris yang diisi");
    const errs: Record<number, string> = {};
    for (const i of idx) {
      const p = problem(rows[i], i);
      if (p) errs[rows[i].key] = p;
    }
    setRowErrors(errs);
    if (Object.keys(errs).length) return setError(`${Object.keys(errs).length} baris belum lengkap / salah (ditandai merah)`);
    if (evidenceOn && !evidenceId) return setError("Foto bukti wajib diupload");

    setSubmitting(true);
    try {
      const payload: BbmBatchRow[] = idx.map((i) => {
        const r = rows[i];
        const keluar = r.tipe === "PEMAKAIAN";
        return {
          tipe: r.tipe,
          jumlah: parseJumlah(r.jumlah),
          estate: keluar ? r.estate : lokasi,
          no_spb: r.spb.trim(),
          keterangan: r.ket.trim(),
          kode_kendaraan: keluar ? r.kendaraan.trim() : "",
          hm_terakhir: keluar && !isGenset(r) ? r.hm.trim() : "",
        };
      });
      const res = await api.createBbmBatch({ evidence_id: evidenceId ?? "", jenis_bbm: jenis, lokasi, tanggal_iso: tanggal, rows: payload });
      try {
        localStorage.removeItem(draftKey(jenis, lokasi));
      } catch {
        // nothing to clear
      }
      onSuccess(res.count);
    } catch (e) {
      const at = e instanceof ApiError && typeof e.data?.row === "number" ? idx[e.data.row] : undefined;
      if (at !== undefined) setRowErrors({ [rows[at].key]: e instanceof ApiError ? e.serverMessage.replace(/^Baris \d+: /, "") : "" });
      setError(errorText(e, "Gagal menyimpan", true));
    } finally {
      setSubmitting(false);
    }
  };

  const cell = "w-full text-sm rounded-md border px-2 py-1.5 bg-white";
  const border = (key: number) => (rowErrors[key] ? "border-[var(--accent-red)]" : "border-[var(--border)]");

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-lg w-full max-w-6xl shadow-xl max-h-[calc(100vh-1rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Input Banyak BBM</h3>
            <p className="text-xs text-[var(--text-secondary)]">Pemakaian / penerimaan satu hari sekaligus · Enter = lanjut, Ctrl+D = salin baris</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[var(--border)] flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--text-secondary)]">
            Jenis BBM
            <select value={jenis} onChange={(e) => setJenis(e.target.value as "SOLAR" | "BENSIN")} className="mt-1 block text-sm rounded-md border border-[var(--border)] px-3 py-1.5">
              <option value="SOLAR">SOLAR</option>
              <option value="BENSIN">BENSIN</option>
            </select>
          </label>
          <label className="text-xs text-[var(--text-secondary)]">
            Lokasi
            {lokasiLock ? (
              <div className="mt-1 text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-[#f8fafc] text-[var(--text-secondary)]">{lokasiLock}</div>
            ) : (
              <select value={lokasi} onChange={(e) => setLokasi(e.target.value)} className="mt-1 block text-sm rounded-md border border-[var(--border)] px-3 py-1.5">
                {LOKASI.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            )}
          </label>
          <label className="text-xs text-[var(--text-secondary)]">
            Tanggal
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className="mt-1 block text-sm rounded-md border border-[var(--border)] px-3 py-1.5" />
          </label>
          <div className="ml-auto flex gap-5 text-right">
            <div>
              <div className="text-xs text-[var(--text-secondary)]">Stok saat ini</div>
              <div className="font-semibold">{fmt(saldoAwal)} LTR</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-secondary)]">Setelah disimpan</div>
              <div className={`font-semibold ${saldoAkhir < 0 ? "text-[var(--accent-red)]" : ""}`}>{fmt(saldoAkhir)} LTR</div>
            </div>
          </div>
        </div>

        {restored && (
          <div className="mx-5 mt-3 text-xs rounded-md px-3 py-2 bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] flex items-center justify-between gap-2">
            <span>Draf yang belum disimpan dimuat lagi.</span>
            <button
              onClick={() => {
                setRows([newRow(), newRow(), newRow()]);
                setRestored(false);
                setRowErrors({});
              }}
              className="underline shrink-0"
            >
              Kosongkan
            </button>
          </div>
        )}

        <div className="px-5 py-3 overflow-auto flex-1 min-h-0">
          <datalist id={listId}>
            {alatOptions.map((o) => (
              <option key={o.kode} value={o.kode} label={[o.jenis_unit, o.nama].filter(Boolean).join(" · ")} />
            ))}
          </datalist>
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="text-left text-xs text-[var(--text-secondary)]">
                <th className="py-1.5 pr-2 w-8">#</th>
                <th className="py-1.5 pr-2 w-[110px]">Tipe</th>
                <th className="py-1.5 pr-2 w-[150px]">Kendaraan / Alat</th>
                <th className="py-1.5 pr-2 w-[90px]">Jumlah (LTR)</th>
                <th className="py-1.5 pr-2 w-[110px]">HM / KM</th>
                <th className="py-1.5 pr-2 w-[120px]">Estate</th>
                <th className="py-1.5 pr-2 w-[90px]">No. SPB</th>
                <th className="py-1.5 pr-2">Keterangan</th>
                <th className="py-1.5 pr-2 w-[90px] text-right">Saldo</th>
                <th className="py-1.5 w-[60px]" />
              </tr>
            </thead>
            <tbody ref={tableRef}>
              {rows.map((r, i) => {
                const masuk = r.tipe === "DITERIMA";
                const genset = isGenset(r);
                const alat = alatOf(r);
                const blank = isBlank(r);
                return (
                  <Fragment key={r.key}>
                    <tr className="align-top">
                      <td className="py-1 pr-2 pt-2.5 text-xs text-[var(--text-muted)]">{i + 1}</td>
                      <td className="py-1 pr-2">
                        <select
                          data-r={i}
                          data-c="tipe"
                          value={r.tipe}
                          onKeyDown={onKey(i, "tipe")}
                          onChange={(e) => setCell(r.key, { tipe: e.target.value as Row["tipe"] })}
                          className={`${cell} ${border(r.key)} ${masuk ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}`}
                        >
                          <option value="PEMAKAIAN">Keluar</option>
                          <option value="DITERIMA">Masuk</option>
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        {masuk ? (
                          <div className="px-2 py-1.5 text-xs text-[var(--text-muted)]">-</div>
                        ) : (
                          <>
                            <input
                              data-r={i}
                              data-c="kendaraan"
                              list={listId}
                              value={r.kendaraan}
                              onKeyDown={onKey(i, "kendaraan")}
                              onChange={(e) => setCell(r.key, { kendaraan: e.target.value })}
                              placeholder="cth. MPN02"
                              className={`${cell} ${border(r.key)}`}
                            />
                            {alat && (alat.jenis_unit || alat.nama) && (
                              <div className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate">{[alat.jenis_unit, alat.nama].filter(Boolean).join(" · ")}</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          data-r={i}
                          data-c="jumlah"
                          inputMode="decimal"
                          value={r.jumlah}
                          onKeyDown={onKey(i, "jumlah")}
                          onChange={(e) => setCell(r.key, { jumlah: e.target.value })}
                          className={`${cell} ${border(r.key)} text-right`}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        {masuk || genset ? (
                          <div className="px-2 py-1.5 text-xs text-[var(--text-muted)]">{genset && !masuk ? "genset" : "-"}</div>
                        ) : (
                          <input
                            data-r={i}
                            data-c="hm"
                            value={r.hm}
                            onKeyDown={onKey(i, "hm")}
                            onChange={(e) => setCell(r.key, { hm: e.target.value })}
                            placeholder="cth. 4373.7 h"
                            className={`${cell} ${border(r.key)}`}
                          />
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        {masuk ? (
                          <div className="px-2 py-1.5 text-xs text-[var(--text-muted)]">{lokasi}</div>
                        ) : (
                          <select
                            data-r={i}
                            data-c="estate"
                            value={r.estate}
                            onKeyDown={onKey(i, "estate")}
                            onChange={(e) => setCell(r.key, { estate: e.target.value })}
                            className={`${cell} ${border(r.key)}`}
                          >
                            <option value="">-- Pilih --</option>
                            {estateOptions.map((o) => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          data-r={i}
                          data-c="spb"
                          value={r.spb}
                          onKeyDown={onKey(i, "spb")}
                          onChange={(e) => setCell(r.key, { spb: e.target.value })}
                          className={`${cell} ${border(r.key)}`}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          data-r={i}
                          data-c="ket"
                          value={r.ket}
                          onKeyDown={onKey(i, "ket")}
                          onChange={(e) => setCell(r.key, { ket: e.target.value })}
                          placeholder={masuk ? "cth. Kiriman dari ..." : "cth. Genset 02 B"}
                          className={`${cell} ${border(r.key)}`}
                        />
                      </td>
                      <td className={`py-1 pr-2 pt-2.5 text-right whitespace-nowrap ${saldoAfter[i] < 0 ? "text-[var(--accent-red)] font-semibold" : "text-[var(--text-secondary)]"}`}>
                        {blank ? "" : fmt(saldoAfter[i])}
                      </td>
                      <td className="py-1 pt-1.5 whitespace-nowrap">
                        <button onClick={() => copyRow(i)} title="Salin baris (Ctrl+D)" className="p-1 rounded text-[var(--text-muted)] hover:bg-[#f1f5f9]">
                          <Copy size={14} />
                        </button>
                        <button onClick={() => removeRow(i)} title="Hapus baris" className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[#f1f5f9]">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    {rowErrors[r.key] && (
                      <tr>
                        <td />
                        <td colSpan={9} className="pb-1 text-[11px] text-[var(--accent-red)]">
                          {rowErrors[r.key]}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <button
            onClick={() => addRow(rows.length, { estate: rows[rows.length - 1]?.estate ?? lokasi, spb: rows[rows.length - 1]?.spb ?? "" })}
            className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-blue)] hover:underline"
          >
            <Plus size={14} /> Tambah baris
          </button>
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm text-[var(--text-secondary)]">
              <b className="text-[var(--text-primary)]">{filled.length}</b> baris · keluar <b className="text-[var(--accent-red)]">{fmt(totalKeluar)} LTR</b>
              {totalMasuk > 0 && (
                <>
                  {" "}
                  · masuk <b className="text-[var(--accent-green)]">{fmt(totalMasuk)} LTR</b>
                </>
              )}
            </div>
            <div className="w-full sm:w-72">
              <EvidenceInput value={evidenceId} onChange={setEvidenceId} label="Foto Bukti (satu untuk semua baris)" />
            </div>
          </div>
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
          <button
            onClick={submit}
            disabled={submitting || !filled.length}
            className="w-full py-2 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : `Simpan ${filled.length || ""} Transaksi`}
          </button>
        </div>
      </div>
    </div>
  );
}
