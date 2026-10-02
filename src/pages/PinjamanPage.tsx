import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeftRight, ArrowRight, Plus, X } from "lucide-react";
import { api, errorText, type OpnameModule, type Pinjaman, type PinjamanBarang, type PinjamanStatus } from "../lib/api";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { EvidenceInput, EvidenceLink, useEvidenceEnabled } from "../components/EvidenceInput";
import { can, canModule, userEstates } from "../lib/access";
import { useShownEstates } from "../hooks/useEstateFilter";
import { LOAN_LATE_DAYS, loanDays, useOpenPinjaman } from "../hooks/useOpenPinjaman";
import { OPNAME_MODULES, OPNAME_MODULE_LABEL, fmtQty, opnameModule, round3 } from "../lib/opname";
import { tanggalWaktu } from "../lib/datetime";

const ESTATES = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];
const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";
const selectCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";

const STATUS: Record<PinjamanStatus, { label: string; cls: string }> = {
  DIPINJAM: { label: "Belum Kembali", cls: "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]" },
  LUNAS: { label: "Lunas", cls: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]" },
  BATAL: { label: "Dibatalkan", cls: "bg-[#f1f5f9] border-[var(--border)] text-[var(--text-secondary)]" },
};

// Nilam's gudang, Klinik and BBM are counted in whole units (as on the server).
const whole = (m: OpnameModule, a: string, b: string) => m === "KLINIK" || m === "BBM" || (m === "GUDANG" && (a === "NILAM" || b === "NILAM"));
const inputPerm = (m: OpnameModule) => `${m.toLowerCase()}.input`;

// Pinjaman antar estate: one estate lends another stock of one item; the stock moves at once and
// the loan stays open until the same item has been returned (Kembalikan, may be partial).
export function PinjamanPage() {
  const { user } = useAuth();
  const myEstates = userEstates(user);
  // Loans of the estates picked on the dashboard, if any.
  const { param: pickedEstates } = useShownEstates();
  const viewModules = OPNAME_MODULES.filter((m) => canModule(user, opnameModule(m)));
  const inputModules = OPNAME_MODULES.filter((m) => can(user, inputPerm(m)));

  const [module, setModule] = useState("");
  // ?status= (from a "Pinjaman #N" link in a history table) opens every status, not only the open ones.
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get("status") ?? "OPEN");
  const [rows, setRows] = useState<Pinjaman[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [returning, setReturning] = useState<{ loan: Pinjaman; batal: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Pinjaman | null>(null);
  const refreshOpen = useOpenPinjaman((s) => s.refresh);

  useEffect(() => {
    setLoading(true);
    api
      .pinjamanList({ module, status, estates: pickedEstates, pageSize: 200 })
      .then((res) => {
        setRows(res.data);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }, [module, status, pickedEstates, reload]);

  const canAct = (l: Pinjaman) => l.status === "DIPINJAM" && can(user, inputPerm(l.module)) && (myEstates.includes(l.dari_estate) || myEstates.includes(l.ke_estate));
  const done = () => {
    setCreating(false);
    setReturning(null);
    setDeleting(null);
    setReload((n) => n + 1);
    refreshOpen();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Pinjaman Antar Estate</h1>
          <p className="text-sm text-[var(--text-secondary)]">Stok yang dipinjamkan ke estate lain sampai dikembalikan</p>
        </div>
        {inputModules.length > 0 && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90"
          >
            <Plus size={16} /> Catat Pinjaman
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <select value={module} onChange={(e) => setModule(e.target.value)} className={selectCls} aria-label="Modul">
          <option value="">Semua modul</option>
          {viewModules.map((m) => (
            <option key={m} value={m}>
              {OPNAME_MODULE_LABEL[m]}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} aria-label="Status">
          <option value="OPEN">Belum kembali</option>
          <option value="LUNAS">Lunas</option>
          <option value="BATAL">Dibatalkan</option>
          <option value="">Semua status</option>
        </select>
        <span className="text-xs text-[var(--text-muted)] ml-auto">{total.toLocaleString("id-ID")} pinjaman</span>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-x-auto">
        <table className="data-table text-sm">
          <thead>
            <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
              <th className="px-4 py-2.5 whitespace-nowrap">Tanggal</th>
              <th className="px-4 py-2.5">Barang</th>
              <th className="px-4 py-2.5 whitespace-nowrap">Dari → Ke</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Dipinjam</th>
              <th className="px-4 py-2.5 text-right whitespace-nowrap">Sisa</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Alasan / Riwayat</th>
              <th className="px-4 py-2.5 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[var(--text-muted)]">
                  <ArrowLeftRight size={20} className="inline mb-1" />
                  <div>{status === "OPEN" ? "Tidak ada pinjaman yang belum kembali." : "Belum ada pinjaman."}</div>
                  {status === "OPEN" && (
                    <button onClick={() => setStatus("")} className="mt-1 text-xs text-[var(--accent-blue)] hover:underline">
                      Lihat pinjaman yang sudah lunas / dibatalkan
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((l) => {
                const sisa = round3(l.qty - l.qty_kembali);
                return (
                  <tr key={l.id} className="align-top">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div>{tanggalWaktu(l.tanggal_iso, l.created_at)}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">#{l.id}</div>
                      {l.status === "DIPINJAM" && (
                        <div
                          className={`text-[11px] font-medium ${loanDays(l.tanggal_iso) >= LOAN_LATE_DAYS ? "text-[var(--accent-red)]" : "text-[var(--accent-amber)]"}`}
                        >
                          sudah {loanDays(l.tanggal_iso)} hari
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[var(--text-primary)]">{l.nama}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {OPNAME_MODULE_LABEL[l.module]}
                        {l.kode !== l.nama && ` · ${l.kode}`}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap font-medium">
                      {l.dari_estate} <ArrowRight size={12} className="inline text-[var(--text-muted)]" /> {l.ke_estate}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {fmtQty(l.qty)} {l.satuan}
                    </td>
                    <td className={`px-4 py-2.5 text-right whitespace-nowrap font-semibold ${l.status === "DIPINJAM" ? "text-[var(--accent-amber)]" : "text-[var(--text-muted)]"}`}>
                      {l.status === "DIPINJAM" ? `${fmtQty(sisa)} ${l.satuan}` : "-"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS[l.status].cls}`}>{STATUS[l.status].label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] min-w-[200px]">
                      <div>
                        {l.alasan} <EvidenceLink id={l.evidence_id} label="foto" />
                      </div>
                      <div className="text-[var(--text-muted)]">oleh {l.dibuat_oleh || "-"}</div>
                      {l.kembali.map((k, i) => (
                        <div key={i} className="mt-1 text-[var(--text-muted)]">
                          {tanggalWaktu(k.tanggal_iso, k.created_at)} · {k.batal ? "Dibatalkan" : `Kembali ${fmtQty(k.qty)} ${l.satuan}`}
                          {k.note && `: ${k.note}`} ({k.oleh || "-"}) <EvidenceLink id={k.evidence_id} label="foto" />
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {canAct(l) && (
                        <div className="inline-flex gap-1.5">
                          <button
                            onClick={() => setReturning({ loan: l, batal: false })}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90"
                          >
                            Kembalikan
                          </button>
                          {l.qty_kembali === 0 && (
                            <button
                              onClick={() => setReturning({ loan: l, batal: true })}
                              className="text-xs px-2.5 py-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                            >
                              Batalkan
                            </button>
                          )}
                        </div>
                      )}
                      {user?.role === "superuser" && l.status !== "DIPINJAM" && (
                        <button
                          onClick={() => setDeleting(l)}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                        >
                          Hapus
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {creating && <CreatePinjamanModal modules={inputModules} myEstates={myEstates} onClose={() => setCreating(false)} onSuccess={done} />}
      {returning && <KembaliModal loan={returning.loan} batal={returning.batal} onClose={() => setReturning(null)} onSuccess={done} />}
      {deleting && <HapusModal loan={deleting} onClose={() => setDeleting(null)} onSuccess={done} />}
    </div>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">{title}</h3>
            {subtitle && <p className="text-xs text-[var(--text-secondary)]">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function CreatePinjamanModal({
  modules,
  myEstates,
  onClose,
  onSuccess,
}: {
  modules: OpnameModule[];
  myEstates: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [module, setModule] = useState<OpnameModule>(modules[0]);
  const [dari, setDari] = useState(myEstates[0] ?? "NILAM");
  const [ke, setKe] = useState(() => ESTATES.find((e) => e !== (myEstates[0] ?? "NILAM"))!);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<PinjamanBarang[]>([]);
  const [barang, setBarang] = useState<PinjamanBarang | null>(null);
  const [qty, setQty] = useState("");
  const [alasan, setAlasan] = useState("");
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const evidenceOn = useEvidenceEnabled();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Only the lending estate records a loan: "dari" is one of the account's own estates.
  const dariOptions = ESTATES.filter((e) => myEstates.includes(e));
  const keOptions = ESTATES.filter((e) => e !== dari);
  useEffect(() => {
    if (!keOptions.includes(ke)) setKe(keOptions[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dari]);

  useEffect(() => {
    setBarang(null);
    const t = setTimeout(() => {
      api
        .pinjamanBarang(module, dari, search)
        .then(setOptions)
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [module, dari, search]);

  const n = Number(qty.replace(",", "."));
  const isWhole = whole(module, dari, ke);
  const saldoModule = module === "PUPUK" || module === "OLI";

  const submit = async () => {
    setError("");
    if (!ke) return setError("Pilih estate peminjam");
    if (!barang) return setError("Pilih barang yang dipinjamkan");
    if (!(n > 0)) return setError("Jumlah harus lebih dari 0");
    if (isWhole && !Number.isInteger(n)) return setError("Jumlah harus bilangan bulat");
    if (!saldoModule && n > barang.stok) return setError(`Stok ${dari} hanya ${fmtQty(barang.stok)} ${barang.satuan}`);
    if (!alasan.trim()) return setError("Alasan wajib diisi");
    if (evidenceOn && !evidenceId) return setError("Foto bukti wajib diupload");
    setSubmitting(true);
    try {
      await api.createPinjaman({ evidence_id: evidenceId ?? "", module, dari, ke, kode: barang.kode, qty: n, alasan: alasan.trim() });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan pinjaman"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Catat Pinjaman" subtitle="Dicatat oleh estate yang meminjamkan; stok kedua estate langsung berubah" onClose={onClose}>
      <div>
        <label className={labelCls}>Modul</label>
        <select value={module} onChange={(e) => setModule(e.target.value as OpnameModule)} className={inputCls}>
          {modules.map((m) => (
            <option key={m} value={m}>
              {OPNAME_MODULE_LABEL[m]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div>
          <label className={labelCls}>Dipinjamkan oleh</label>
          <select value={dari} onChange={(e) => setDari(e.target.value)} className={inputCls}>
            {dariOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <ArrowRight size={16} className="mb-2.5 text-[var(--text-muted)]" />
        <div>
          <label className={labelCls}>Dipinjam oleh</label>
          <select value={ke} onChange={(e) => setKe(e.target.value)} className={inputCls}>
            {keOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Barang (stok {dari})</label>
        {barang ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--accent-blue-border)] bg-[var(--accent-blue-bg)] px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text-primary)] truncate">{barang.nama}</div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                {barang.kode !== barang.nama && `${barang.kode} · `}stok {fmtQty(barang.stok)} {barang.satuan}
              </div>
            </div>
            <button onClick={() => setBarang(null)} className="text-xs text-[var(--accent-blue)] hover:underline shrink-0">
              Ganti
            </button>
          </div>
        ) : (
          <>
            {(module === "GUDANG" || module === "KLINIK") && (
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari kode atau nama..." className={inputCls} />
            )}
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
              {options.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Tidak ada stok yang bisa dipinjamkan.</div>
              ) : (
                options.map((o) => (
                  <button
                    key={o.kode}
                    onClick={() => setBarang(o)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[#f8fafc]"
                  >
                    <span className="truncate">{o.nama}</span>
                    <span className={`text-xs whitespace-nowrap ${o.stok < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-muted)]"}`}>
                      {fmtQty(o.stok)} {o.satuan}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Jumlah{barang ? ` (${barang.satuan})` : ""}</label>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder={isWhole ? "cth. 10" : "cth. 2,5"} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Alasan</label>
          <input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="cth. stok habis" className={inputCls} />
        </div>
      </div>

      {barang && n > 0 && (
        <p className="text-xs rounded-md px-3 py-2 bg-[#f8fafc] text-[var(--text-secondary)]">
          Stok {dari} berkurang {fmtQty(n)} {barang.satuan}, stok {ke} bertambah {fmtQty(n)} {barang.satuan}. {ke} mengembalikan barang yang sama nanti.
        </p>
      )}

      <EvidenceInput value={evidenceId} onChange={setEvidenceId} />

      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting}
        className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Menyimpan..." : "Simpan Pinjaman"}
      </button>
    </Modal>
  );
}

function KembaliModal({ loan, batal, onClose, onSuccess }: { loan: Pinjaman; batal: boolean; onClose: () => void; onSuccess: () => void }) {
  const sisa = round3(loan.qty - loan.qty_kembali);
  const [qty, setQty] = useState(String(sisa).replace(".", ","));
  const [note, setNote] = useState("");
  // A return needs its foto bukti; a cancel doesn't.
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const evidenceOn = useEvidenceEnabled();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const n = Number(qty.replace(",", "."));

  const submit = async () => {
    setError("");
    if (!note.trim()) return setError(batal ? "Alasan pembatalan wajib diisi" : "Catatan wajib diisi");
    if (!batal) {
      if (!(n > 0)) return setError("Jumlah harus lebih dari 0");
      if (n > sisa) return setError(`Sisa pinjaman hanya ${fmtQty(sisa)} ${loan.satuan}`);
      if (whole(loan.module, loan.dari_estate, loan.ke_estate) && !Number.isInteger(n)) return setError("Jumlah harus bilangan bulat");
      if (evidenceOn && !evidenceId) return setError("Foto bukti wajib diupload");
    }
    setSubmitting(true);
    try {
      if (batal) await api.batalPinjaman(loan.id, note.trim());
      else await api.kembalikanPinjaman(loan.id, n, note.trim(), evidenceId ?? "");
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={batal ? "Batalkan Pinjaman" : "Kembalikan Pinjaman"}
      subtitle={`#${loan.id} · ${loan.nama} · ${loan.dari_estate} → ${loan.ke_estate}`}
      onClose={onClose}
    >
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--text-secondary)]">Sisa pinjaman</span>
        <span className="font-semibold">
          {fmtQty(sisa)} {loan.satuan}
        </span>
      </div>

      {batal ? (
        <p className="text-xs rounded-md px-3 py-2 bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]">
          Semua {fmtQty(sisa)} {loan.satuan} dikembalikan dari {loan.ke_estate} ke {loan.dari_estate} dan pinjaman ditandai dibatalkan. Pakai ini kalau pinjaman salah input.
        </p>
      ) : (
        <div>
          <label className={labelCls}>Jumlah dikembalikan ({loan.satuan})</label>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={inputCls} />
          <p className="text-[11px] text-[var(--text-muted)] mt-1">
            Stok {loan.ke_estate} berkurang dan stok {loan.dari_estate} bertambah. Boleh sebagian; sisanya tetap tercatat.
          </p>
        </div>
      )}

      <div>
        <label className={labelCls}>{batal ? "Alasan pembatalan" : "Catatan"}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
      </div>

      {!batal && <EvidenceInput value={evidenceId} onChange={setEvidenceId} />}

      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting}
        className={`w-full py-2.5 rounded-md text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 ${batal ? "bg-[var(--accent-red)]" : "bg-[var(--accent-blue)]"}`}
      >
        {submitting ? "Menyimpan..." : batal ? "Batalkan Pinjaman" : "Simpan Pengembalian"}
      </button>
    </Modal>
  );
}

// Superuser: a finished loan (Dibatalkan / Lunas) - e.g. a test or a wrong input - removed with all its
// rows in both estates' history; the stock stays as it is (everything lent already came back).
function HapusModal({ loan, onClose, onSuccess }: { loan: Pinjaman; onClose: () => void; onSuccess: () => void }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!note.trim()) return setError("Alasan penghapusan wajib diisi");
    setSubmitting(true);
    try {
      await api.deletePinjaman(loan.id, note.trim());
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menghapus pinjaman", true));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Hapus Pinjaman" subtitle={`#${loan.id} · ${loan.nama} · ${loan.dari_estate} → ${loan.ke_estate}`} onClose={onClose}>
      <p className="text-xs rounded-md px-3 py-2 bg-[var(--accent-red-bg)] text-[var(--accent-red)]">
        Pinjaman ini beserta semua transaksinya di riwayat {OPNAME_MODULE_LABEL[loan.module]} {loan.dari_estate} dan {loan.ke_estate} dihapus permanen.
        Stok tidak berubah (barangnya sudah kembali semua).
      </p>
      <div>
        <label className={labelCls}>Alasan penghapusan</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="cth. data percobaan" />
      </div>
      {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
      <button
        onClick={submit}
        disabled={submitting}
        className="w-full py-2.5 rounded-md text-sm font-medium text-white bg-[var(--accent-red)] hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Menghapus..." : "Hapus Pinjaman"}
      </button>
    </Modal>
  );
}
