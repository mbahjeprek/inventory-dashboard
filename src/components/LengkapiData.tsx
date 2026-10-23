import { useEffect, useMemo, useState } from "react";
import { ClipboardList, ImagePlus, Loader2, Save, X } from "lucide-react";
import { api, errorText, type LengkapiKind, type LengkapiList, type LengkapiRow } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { EvidenceLink, shrink } from "./EvidenceInput";

// Lengkapi Data: every transaction of one month of an estate in one table, with the fields the input
// form asks for (No. SPB / BPB, kendaraan & HM, blok, keterangan, foto bukti) as inputs - the empty ones
// ("-" / "0" count as empty) marked - so they are filled in / corrected and saved together instead of
// opening the transactions day by day. Amounts, dates and saldo are not touched; every change is logged
// with its old value. For an account with Input or Edit of the module.

const MODULE_OF: Record<LengkapiKind, string> = { bbm: "bbm", pupuk: "pupuk", oli: "oli", gudang: "gudang", klinik: "klinik", nilam_masuk: "gudang", nilam_keluar: "gudang" };
const TITLE: Record<LengkapiKind, string> = { bbm: "BBM", pupuk: "Pupuk", oli: "Oli", gudang: "Gudang", klinik: "Klinik", nilam_masuk: "Stok Masuk", nilam_keluar: "Stok Keluar" };
const thisMonth = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
const tgl = (iso: string) => iso.split("-").reverse().join("/");
const fmt = (n: number | null) => (n === null || n === undefined || !n ? "" : n.toLocaleString("id-ID", { maximumFractionDigits: 3 }));
const bulanLabel = (b: string) => new Date(`${b}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

// kind: one, or several shown as tabs in the window (Gudang Nilam: Stok Masuk / Stok Keluar).
export function LengkapiDataButton({ kind, estate, onDone }: { kind: LengkapiKind | LengkapiKind[]; estate: string; onDone?: () => void }) {
  const kinds = Array.isArray(kind) ? kind : [kind];
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!estate || !(can(user, `${MODULE_OF[kinds[0]]}.input`) || can(user, `${MODULE_OF[kinds[0]]}.edit`))) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Lengkapi SPB / bukti / kolom yang masih kosong untuk satu bulan sekaligus"
        className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] hover:opacity-90"
      >
        <ClipboardList size={16} /> Lengkapi Data
      </button>
      {open && <LengkapiModal kinds={kinds} estate={estate} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

type Edit = { values: Record<string, string>; evidence_id?: string };

function LengkapiModal({ kinds, estate, onClose, onDone }: { kinds: LengkapiKind[]; estate: string; onClose: () => void; onDone?: () => void }) {
  const [kind, setKind] = useState(kinds[0]);
  const [bulan, setBulan] = useState(thisMonth());
  const [data, setData] = useState<LengkapiList | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [only, setOnly] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);

  const load = () => {
    setData(null);
    setError("");
    api
      .lengkapiList(kind, estate, bulan)
      .then(setData)
      .catch((e) => setError(errorText(e, "Gagal memuat data")));
  };
  useEffect(() => {
    setEdits({});
    setOnly("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulan, kind]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const cols = data ? [...data.fields, ...(data.foto ? [{ key: "foto", label: "Foto Bukti", type: "text" as const }] : [])] : [];
  const kurangCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of data?.rows ?? []) for (const k of r.kurang) c[k] = (c[k] ?? 0) + 1;
    return c;
  }, [data]);
  // only: "" = every transaction, "kurang" = those with something empty, or one field's empties.
  const rows = (data?.rows ?? []).filter((r) => !only || (only === "kurang" ? r.kurang.length > 0 : r.kurang.includes(only)));
  const belum = (data?.rows ?? []).filter((r) => r.kurang.length).length;
  const cur = (r: LengkapiRow, key: string) => (r[key] === null || r[key] === undefined ? "" : String(r[key]));
  const valOf = (r: LengkapiRow, key: string) => edits[r.id]?.values?.[key] ?? cur(r, key);
  const kosong = (v: string) => /^[-0. ]*$/.test(v.trim());
  const changedKeys = (r: LengkapiRow) => Object.keys(edits[r.id]?.values ?? {}).filter((k) => edits[r.id].values[k].trim() !== cur(r, k).trim());
  const setVal = (id: number, key: string, v: string) => setEdits((e) => ({ ...e, [id]: { ...e[id], values: { ...(e[id]?.values ?? {}), [key]: v } } }));
  const changedIds = (data?.rows ?? []).filter((r) => edits[r.id]?.evidence_id || changedKeys(r).length).map((r) => r.id);
  // Isi semua: one value for every still-empty cell of a column among the rows shown.
  const isiSemua = (key: string, label: string) => {
    const v = window.prompt(`Isi ${label} untuk semua baris yang masih kosong${only ? " (yang tampil)" : ""}:`);
    if (!v?.trim()) return;
    setEdits((e) => {
      const n = { ...e };
      for (const r of rows)
        if (r.berlaku.includes(key) && kosong(n[r.id]?.values?.[key] ?? cur(r, key))) n[r.id] = { ...n[r.id], values: { ...(n[r.id]?.values ?? {}), [key]: v.trim() } };
      return n;
    });
  };

  const pickFoto = async (id: number, f: File | undefined) => {
    if (!f) return;
    setUploading(id);
    setError("");
    try {
      const { id: ev } = await api.uploadEvidence(await shrink(f));
      setEdits((e) => ({ ...e, [id]: { values: e[id]?.values ?? {}, evidence_id: ev } }));
    } catch (e) {
      setError(errorText(e, "Foto gagal diupload"));
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!changedIds.length) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const r = await api.lengkapiSave(
        kind,
        estate,
        bulan,
        (data?.rows ?? [])
          .filter((r) => changedIds.includes(r.id))
          .map((r) => ({ id: r.id, values: Object.fromEntries(changedKeys(r).map((k) => [k, edits[r.id].values[k]])), evidence_id: edits[r.id]?.evidence_id }))
      );
      setMsg(`Tersimpan: ${r.saved} transaksi${r.foto ? ` · ${r.foto} foto bukti` : ""}`);
      setEdits({});
      load();
      onDone?.();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (changedIds.length && !window.confirm(`${changedIds.length} baris sudah diisi tapi belum disimpan. Tutup tanpa menyimpan?`)) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-4" onClick={close}>
      <div className="w-full max-w-[1400px] max-h-full flex flex-col rounded-lg bg-[var(--bg-card)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-[var(--border)]">
          <div className="mr-auto">
            <h2 className="font-semibold text-[var(--text-primary)]">Lengkapi Data · {kinds.length > 1 ? "Gudang" : TITLE[kind]} {estate}</h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Semua transaksi bulan ini. Kotak kuning = masih kosong (termasuk "-" / "0"). Isi atau koreksi lalu Simpan sekaligus; jumlah, tanggal dan saldo tidak berubah.
            </p>
          </div>
          {kinds.length > 1 && (
            <div className="flex gap-1">
              {kinds.map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    if (k === kind) return;
                    if (changedIds.length && !window.confirm("Isian yang belum disimpan akan hilang. Lanjut?")) return;
                    setKind(k);
                  }}
                  className={`text-sm px-3 py-1.5 rounded-md border ${k === kind ? "border-[var(--accent-blue)] text-[var(--accent-blue)] bg-[var(--accent-blue-bg)] font-medium" : "border-[var(--border)]"}`}
                >
                  {TITLE[k]}
                </button>
              ))}
            </div>
          )}
          <label className="text-xs text-[var(--text-secondary)] flex items-center gap-2">
            Bulan
            <input type="month" value={bulan} max={thisMonth()} onChange={(e) => e.target.value && setBulan(e.target.value)} className="text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white" />
          </label>
          <button onClick={close} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Tutup">
            <X size={18} />
          </button>
        </div>

        {data && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs border-b border-[var(--border)]">
            <span className="text-[var(--text-secondary)] mr-1">
              <b className="text-[var(--text-primary)]">{data.totalBulan}</b> transaksi {bulanLabel(bulan)}
              {belum ? (
                <>
                  {" "}· <b className="text-[var(--accent-amber)]">{belum}</b> belum lengkap:
                </>
              ) : data.totalBulan ? (
                " · semua kolom sudah terisi"
              ) : (
                ""
              )}
            </span>
            {data.rows.length > 0 && (
              <button onClick={() => setOnly("")} className={`px-2 py-1 rounded border ${!only ? "border-[var(--accent-blue)] text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]" : "border-[var(--border)]"}`}>
                Semua {data.rows.length}
              </button>
            )}
            {belum > 0 && (
              <button onClick={() => setOnly("kurang")} className={`px-2 py-1 rounded border ${only === "kurang" ? "border-[var(--accent-blue)] text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]" : "border-[var(--border)]"}`}>
                Belum lengkap {belum}
              </button>
            )}
            {cols
              .filter((c) => kurangCount[c.key])
              .map((c) => (
                <button
                  key={c.key}
                  onClick={() => setOnly(only === c.key ? "" : c.key)}
                  className={`px-2 py-1 rounded border ${only === c.key ? "border-[var(--accent-blue)] text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]" : "border-[var(--border)]"}`}
                >
                  {c.label} kosong {kurangCount[c.key]}
                </button>
              ))}
          </div>
        )}

        <div className="overflow-auto flex-1">
          {!data ? (
            <p className="p-6 text-sm text-[var(--text-muted)]">{error || "Memuat..."}</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-[var(--text-muted)]">{data.rows.length ? "Tidak ada transaksi untuk filter ini." : "Tidak ada transaksi di bulan ini."}</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-[#f8fafc] text-[var(--text-secondary)] sticky top-0 z-10">
                <tr className="text-left">
                  <th className="px-2 py-2">Tanggal</th>
                  <th className="px-2 py-2">{kind === "klinik" ? "Obat" : kind === "gudang" || kind.startsWith("nilam_") ? "Barang" : "Jenis"}</th>
                  {kind === "bbm" && <th className="px-2 py-2">Sub-lokasi</th>}
                  <th className="px-2 py-2 text-right">Masuk</th>
                  <th className="px-2 py-2 text-right">Keluar</th>
                  {cols.map((c) => (
                    <th key={c.key} className="px-2 py-2 min-w-[120px]">
                      <div className="flex items-center gap-1">
                        {c.label}
                        {c.key !== "foto" && kurangCount[c.key] > 0 && (
                          <button onClick={() => isiSemua(c.key, c.label)} className="font-normal text-[10px] text-[var(--accent-blue)] hover:underline" title="Isi semua yang kosong dengan satu nilai">
                            isi semua
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-t border-[var(--border)] ${changedIds.includes(r.id) ? "bg-[#f0f9eb]" : ""}`}>
                    <td className="px-2 py-1.5 whitespace-nowrap">{tgl(r.tanggal_iso)}</td>
                    <td className="px-2 py-1.5">{r.jenis}</td>
                    {kind === "bbm" && <td className="px-2 py-1.5">{r.sub}</td>}
                    <td className="px-2 py-1.5 text-right">{fmt(r.masuk)}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(r.keluar)}</td>
                    {cols.map((c) => {
                      if (c.key === "foto")
                        return (
                          <td key="foto" className="px-2 py-1">
                            {edits[r.id]?.evidence_id ? (
                              <span className="inline-flex items-center gap-1.5">
                                <EvidenceLink id={edits[r.id].evidence_id} label={r.evidence_id ? "foto pengganti" : "baru"} />
                                <button onClick={() => setEdits((e) => ({ ...e, [r.id]: { values: e[r.id]?.values ?? {} } }))} title="Batalkan foto" className="text-[var(--text-muted)] hover:text-[var(--accent-red)]">
                                  <X size={12} />
                                </button>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                {r.evidence_id && <EvidenceLink id={r.evidence_id} label="ada" />}
                                <label
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded border cursor-pointer ${
                                    r.evidence_id ? "border-[var(--border)] text-[var(--text-secondary)]" : "border-dashed border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]"
                                  }`}
                                  title={r.evidence_id ? "Ganti foto bukti" : "Upload foto bukti"}
                                >
                                  {uploading === r.id ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />} {r.evidence_id ? "Ganti" : "Upload"}
                                  <input type="file" accept="image/*" className="hidden" onChange={(e) => (pickFoto(r.id, e.target.files?.[0]), (e.target.value = ""))} />
                                </label>
                              </span>
                            )}
                          </td>
                        );
                      const applies = r.berlaku.includes(c.key);
                      const v = valOf(r, c.key);
                      const ubah = edits[r.id]?.values?.[c.key] !== undefined && v.trim() !== cur(r, c.key).trim();
                      return (
                        <td key={c.key} className="px-2 py-1">
                          {!applies ? (
                            <span className="text-[var(--text-muted)]">-</span>
                          ) : (
                            <input
                              type={c.type === "number" ? "number" : "text"}
                              step="any"
                              value={v}
                              onChange={(e) => setVal(r.id, c.key, e.target.value)}
                              title={ubah ? `Sebelumnya: ${cur(r, c.key) || "(kosong)"}` : undefined}
                              className={`w-full min-w-[100px] rounded border px-2 py-1 ${
                                ubah ? "border-[var(--accent-green)] bg-white" : kosong(v) ? "border-[var(--accent-amber-border)] bg-[#fffbeb]" : "border-[var(--border)] bg-white"
                              }`}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 p-4 border-t border-[var(--border)]">
          {error && data && <span className="text-xs text-[var(--accent-red)]">{error}</span>}
          {msg && <span className="text-xs text-[var(--accent-green)]">{msg}</span>}
          <span className="ml-auto text-xs text-[var(--text-secondary)]">{changedIds.length} baris diisi</span>
          <button onClick={close} className="text-sm px-3.5 py-2 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]">
            Tutup
          </button>
          <button
            onClick={save}
            disabled={saving || !changedIds.length || uploading !== null}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50"
          >
            <Save size={15} /> {saving ? "Menyimpan..." : `Simpan ${bulanLabel(bulan)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
