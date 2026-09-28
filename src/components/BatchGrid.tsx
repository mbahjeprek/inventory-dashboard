import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Copy, Plus, Trash2, X } from "lucide-react";
import { ApiError, errorText } from "../lib/api";
import { EvidenceInput, useEvidenceEnabled } from "./EvidenceInput";

// Input Banyak: many Stok Masuk / Keluar typed as a table and saved in one go with one foto bukti.
// Each inventory describes its columns and rules (BbmBatchModal, GudangBatchModal, ...); this table
// does the rest, the same everywhere:
// - Enter moves to the next cell (skipping cells that don't apply to the row); past the last cell it
//   goes to the next row, a new one at the end, which takes over the `carry` columns (tujuan, SPB...).
// - Ctrl+D (or the copy button) copies the row below it; `copy: false` columns start empty.
// - A running saldo / stock column, rows that don't pass marked red with the reason, and the row the
//   server refuses (ApiError.data.row) marked the same way.
// - Unsaved rows stay as a draft in this browser (per `draftKey`) until saved or cleared.
export type Cells = Record<string, string>;
export type Option = { value: string; label?: string };

export type GridCol = {
  key: string;
  label: string;
  width?: number;
  type?: "text" | "number" | "date" | "select";
  // select: its choices; text: suggestions (a datalist), static or looked up as the cell is typed.
  options?: Option[] | ((c: Cells) => Option[]);
  suggest?: (query: string, c: Cells) => Promise<string[]>;
  placeholder?: string | ((c: Cells) => string);
  // Not applicable to this row: the text shown instead of an input (the cell is skipped).
  off?: (c: Cells) => string | false;
  // Small text under the cell (e.g. the barang's name and stock).
  hint?: (c: Cells) => string | undefined;
  align?: "right";
  tone?: (c: Cells) => string;
  carry?: boolean;
  copy?: boolean;
};
export type SaldoCell = { text: string; bad?: boolean } | null;

let nextKey = 1;
type Row = { key: number; c: Cells };
const isOff = (col: GridCol, c: Cells) => typeof col.off?.(c) === "string";
const toRows = (list: Cells[]) => list.map((c) => ({ key: nextKey++, c }));

function readDraft(key: string): { rows: Cells[]; extra: unknown } | null {
  try {
    const d = JSON.parse(localStorage.getItem(key) || "null");
    return d && Array.isArray(d.rows) && d.rows.length ? d : null;
  } catch {
    return null;
  }
}

export function BatchGrid({
  title,
  subtitle,
  header,
  stock,
  draftKey,
  extra,
  onRestoreExtra,
  columns,
  blankRow,
  problem,
  saldo,
  saldoLabel = "Saldo",
  summary,
  submit,
  onClose,
  onSuccess,
}: {
  title: string;
  subtitle?: string;
  header?: ReactNode;
  // Stock now / after saving for the header (when the table has one stock).
  stock?: { now: string; after: string; bad?: boolean };
  draftKey: string;
  // Header values kept with the draft (e.g. the date) and given back when it is restored.
  extra?: unknown;
  onRestoreExtra?: (extra: unknown) => void;
  columns: GridCol[];
  blankRow: Cells;
  problem: (c: Cells, i: number, rows: Cells[]) => string;
  saldo?: (rows: Cells[]) => SaldoCell[];
  saldoLabel?: string;
  summary?: (rows: Cells[]) => ReactNode;
  // Gets the filled rows; a refused row comes back as ApiError.data.row (index into those rows).
  submit: (rows: Cells[], evidenceId: string) => Promise<number>;
  onClose: () => void;
  onSuccess: (count: number) => void;
}) {
  const typed = columns.filter((c) => c.type !== "select" && !c.carry).map((c) => c.key);
  const isBlank = (c: Cells) => typed.every((k) => !(c[k] ?? "").trim());
  const fresh = () => toRows([{ ...blankRow }, { ...blankRow }, { ...blankRow }]);

  const [rows, setRows] = useState<Row[]>(() => {
    const d = readDraft(draftKey);
    return d ? toRows(d.rows) : fresh();
  });
  const [restored, setRestored] = useState(() => !!readDraft(draftKey));
  // Which draft the rows belong to: while another one is being loaded nothing is saved over it.
  const [owner, setOwner] = useState(draftKey);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const evidenceOn = useEvidenceEnabled();
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const idBase = useId();

  // The draft's header values, once, when it was restored at open.
  useEffect(() => {
    const d = readDraft(draftKey);
    if (d && d.extra !== undefined) onRestoreExtra?.(d.extra);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Another draft (e.g. another jenis / lokasi picked in the header): its rows, or a fresh table.
  useEffect(() => {
    if (owner === draftKey) return;
    setOwner(draftKey);
    const d = readDraft(draftKey);
    setRows(d ? toRows(d.rows) : fresh());
    if (d && d.extra !== undefined) onRestoreExtra?.(d.extra);
    setRestored(!!d);
    setRowErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (owner !== draftKey) return;
    try {
      if (rows.every((r) => isBlank(r.c))) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify({ rows: rows.map((r) => r.c), extra }));
    } catch {
      // storage unavailable: the table still works, only without a draft
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, extra, owner, draftKey]);

  const cellsList = rows.map((r) => r.c);
  const saldoCells = saldo?.(cellsList) ?? [];
  const filled = cellsList.filter((c) => !isBlank(c));

  // Suggestions of a looked-up column follow the cell being typed in (one list per column), asked
  // once typing pauses.
  const suggestTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const suggestFor = (col: GridCol, c: Cells) => {
    if (!col.suggest) return;
    clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => {
      col.suggest!(c[col.key] ?? "", c)
        .then((list) => setSuggestions((s) => ({ ...s, [col.key]: list })))
        .catch(() => {});
    }, 200);
  };
  const setCell = (key: number, col: GridCol, value: string) => {
    const row = rows.find((r) => r.key === key);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, c: { ...r.c, [col.key]: value } } : r)));
    setRowErrors((e) => (Object.keys(e).length ? {} : e));
    if (row) suggestFor(col, { ...row.c, [col.key]: value });
  };
  // Focus moves at once, so a fast typist's next key lands in the new cell (a row being added is
  // rendered first, synchronously, for the same reason).
  const focusCell = (row: number, col: string) => tableRef.current?.querySelector<HTMLElement>(`[data-r="${row}"][data-c="${col}"]`)?.focus();
  const firstCol = (c: Cells) => columns.find((col) => col.type !== "select" && !isOff(col, c))?.key ?? columns[0].key;
  const addRow = (at: number, c: Cells) => {
    flushSync(() => setRows((rs) => [...rs.slice(0, at), { key: nextKey++, c }, ...rs.slice(at)]));
    focusCell(at, firstCol(c));
  };
  const carried = (from: Cells | undefined) => ({
    ...blankRow,
    ...Object.fromEntries(columns.filter((c) => c.carry && from?.[c.key] !== undefined).map((c) => [c.key, from![c.key]])),
  });
  const copyRow = (i: number) =>
    addRow(i + 1, { ...rows[i].c, ...Object.fromEntries(columns.filter((c) => c.copy === false).map((c) => [c.key, blankRow[c.key] ?? ""])) });
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : fresh()));

  const onKey = (i: number, key: string) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      copyRow(i);
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const c = rows[i].c;
    let n = columns.findIndex((col) => col.key === key) + 1;
    while (n < columns.length && isOff(columns[n], c)) n++;
    if (n < columns.length) return focusCell(i, columns[n].key);
    if (i === rows.length - 1) return addRow(rows.length, carried(c));
    // An empty row below takes over the carried columns too, like a new one.
    const next = rows[i + 1];
    if (isBlank(next.c)) flushSync(() => setRows((rs) => rs.map((r) => (r.key === next.key ? { ...r, c: { ...next.c, ...carried(c), tipe: next.c.tipe } } : r))));
    focusCell(i + 1, firstCol(next.c));
  };

  const save = async () => {
    setError("");
    const idx = rows.map((r, i) => (isBlank(r.c) ? -1 : i)).filter((i) => i >= 0);
    if (!idx.length) return setError("Belum ada baris yang diisi");
    const errs: Record<number, string> = {};
    for (const i of idx) {
      const p = problem(rows[i].c, i, cellsList);
      if (p) errs[rows[i].key] = p;
    }
    setRowErrors(errs);
    if (Object.keys(errs).length) return setError(`${Object.keys(errs).length} baris belum lengkap / salah (ditandai merah)`);
    if (evidenceOn && !evidenceId) return setError("Foto bukti wajib diupload");
    setSubmitting(true);
    try {
      const count = await submit(
        idx.map((i) => rows[i].c),
        evidenceId ?? ""
      );
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // nothing to clear
      }
      onSuccess(count);
    } catch (e) {
      const at = e instanceof ApiError && typeof e.data?.row === "number" ? idx[e.data.row] : undefined;
      if (at !== undefined && e instanceof ApiError) setRowErrors({ [rows[at].key]: e.serverMessage.replace(/^Baris \d+: /, "") });
      setError(errorText(e, "Gagal menyimpan", true));
    } finally {
      setSubmitting(false);
    }
  };

  const optionsOf = (col: GridCol, c: Cells) => (typeof col.options === "function" ? col.options(c) : (col.options ?? []));
  const inputCls = (key: number, extraCls = "") =>
    `w-full text-sm rounded-md border px-2 py-1.5 bg-white ${rowErrors[key] ? "border-[var(--accent-red)]" : "border-[var(--border)]"} ${extraCls}`;
  const minWidth = 60 + columns.reduce((t, c) => t + (c.width ?? 160), 0) + (saldo ? 100 : 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-lg w-full max-w-6xl shadow-xl max-h-[calc(100vh-1rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">{title}</h3>
            <p className="text-xs text-[var(--text-secondary)]">{subtitle ?? "Banyak transaksi sekaligus"} · Enter = lanjut, Ctrl+D = salin baris</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        {(header || stock) && (
          <div className="px-5 py-3 border-b border-[var(--border)] flex flex-wrap items-end gap-3">
            {header}
            {stock && (
              <div className="ml-auto flex gap-5 text-right">
                <div>
                  <div className="text-xs text-[var(--text-secondary)]">Stok saat ini</div>
                  <div className="font-semibold">{stock.now}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--text-secondary)]">Setelah disimpan</div>
                  <div className={`font-semibold ${stock.bad ? "text-[var(--accent-red)]" : ""}`}>{stock.after}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {restored && (
          <div className="mx-5 mt-3 text-xs rounded-md px-3 py-2 bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] flex items-center justify-between gap-2">
            <span>Draf yang belum disimpan dimuat lagi.</span>
            <button
              onClick={() => {
                setRows(fresh());
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
          {columns
            .filter((col) => col.type !== "select" && (col.options || col.suggest))
            .map((col) => (
              <datalist key={col.key} id={`${idBase}-${col.key}`}>
                {(col.suggest ? (suggestions[col.key] ?? []).map((v) => ({ value: v }) as Option) : optionsOf(col, {})).map((o) => (
                  <option key={o.value} value={o.value} label={o.label} />
                ))}
              </datalist>
            ))}
          <table className="w-full text-sm" style={{ minWidth }}>
            <thead>
              <tr className="text-left text-xs text-[var(--text-secondary)]">
                <th className="py-1.5 pr-2 w-8">#</th>
                {columns.map((col) => (
                  <th key={col.key} className={`py-1.5 pr-2 ${col.align === "right" ? "text-right" : ""}`} style={{ width: col.width }}>
                    {col.label}
                  </th>
                ))}
                {saldo && <th className="py-1.5 pr-2 w-[100px] text-right">{saldoLabel}</th>}
                <th className="py-1.5 w-[60px]" />
              </tr>
            </thead>
            <tbody ref={tableRef}>
              {rows.map((r, i) => {
                const blank = isBlank(r.c);
                const s = saldoCells[i];
                return (
                  <Fragment key={r.key}>
                    <tr className="align-top">
                      <td className="py-1 pr-2 pt-2.5 text-xs text-[var(--text-muted)]">{i + 1}</td>
                      {columns.map((col) => {
                        const off = col.off?.(r.c);
                        const hint = col.hint?.(r.c);
                        const value = r.c[col.key] ?? "";
                        const common = {
                          "data-r": i,
                          "data-c": col.key,
                          onKeyDown: onKey(i, col.key),
                        };
                        return (
                          <td key={col.key} className="py-1 pr-2">
                            {typeof off === "string" ? (
                              <div className="px-2 py-1.5 text-xs text-[var(--text-muted)] truncate">{off}</div>
                            ) : col.type === "select" ? (
                              <select {...common} value={value} onChange={(e) => setCell(r.key, col, e.target.value)} className={inputCls(r.key, col.tone?.(r.c) ?? "")}>
                                {optionsOf(col, r.c).map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label ?? o.value}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                {...common}
                                type={col.type === "date" ? "date" : "text"}
                                inputMode={col.type === "number" ? "decimal" : undefined}
                                list={col.options || col.suggest ? `${idBase}-${col.key}` : undefined}
                                value={value}
                                onChange={(e) => setCell(r.key, col, e.target.value)}
                                onFocus={() => suggestFor(col, r.c)}
                                placeholder={typeof col.placeholder === "function" ? col.placeholder(r.c) : col.placeholder}
                                className={inputCls(r.key, col.align === "right" ? "text-right" : "")}
                              />
                            )}
                            {hint && <div className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate" title={hint}>{hint}</div>}
                          </td>
                        );
                      })}
                      {saldo && (
                        <td className={`py-1 pr-2 pt-2.5 text-right whitespace-nowrap ${s?.bad ? "text-[var(--accent-red)] font-semibold" : "text-[var(--text-secondary)]"}`}>
                          {blank || !s ? "" : s.text}
                        </td>
                      )}
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
                        <td colSpan={columns.length + (saldo ? 2 : 1)} className="pb-1 text-[11px] text-[var(--accent-red)]">
                          {rowErrors[r.key]}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <button onClick={() => addRow(rows.length, carried(rows[rows.length - 1]?.c))} className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-blue)] hover:underline">
            <Plus size={14} /> Tambah baris
          </button>
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm text-[var(--text-secondary)]">
              <b className="text-[var(--text-primary)]">{filled.length}</b> baris{summary && <> · {summary(filled)}</>}
            </div>
            <div className="w-full sm:w-80">
              <EvidenceInput value={evidenceId} onChange={setEvidenceId} label="Foto Bukti (satu untuk semua baris)" />
            </div>
          </div>
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
          <button
            onClick={save}
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

// Helpers the inventories share.
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const fmtNum = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });
// Typed number: "1.500" / "1500" -> 1500, "12,5" / "12.5" -> 12.5. With a comma the dots are thousands;
// without one a dot is thousands only when exactly 3 digits follow it (1.500), else a decimal (2.25).
export const parseNum = (s: string | undefined) => {
  const t = (s ?? "").trim().replace(/\s/g, "");
  if (!t) return NaN;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(/^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t);
};
export const isBlankIn = (columns: GridCol[]) => (c: Cells) =>
  columns.filter((col) => col.type !== "select" && !col.carry).every((col) => !(c[col.key] ?? "").trim());
// Running stock per key (item / jenis): the saldo after each row; rows without a valid qty keep it.
export function runningStock(rows: Cells[], opts: { start: (key: string) => number; keyOf: (c: Cells) => string; delta: (c: Cells) => number; blank: (c: Cells) => boolean }) {
  const run = new Map<string, number>();
  return rows.map((c) => {
    const k = opts.keyOf(c);
    if (!k || opts.blank(c)) return null;
    const before = run.has(k) ? run.get(k)! : opts.start(k);
    const after = Math.round((before + opts.delta(c)) * 1000) / 1000;
    run.set(k, after);
    return { before, after };
  });
}
export function HeaderField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-xs text-[var(--text-secondary)]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
export const headerInputCls = "block text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white";
