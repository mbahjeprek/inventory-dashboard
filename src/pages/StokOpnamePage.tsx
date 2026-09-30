import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Plus, ChevronLeft, ChevronRight, X, Lock } from "lucide-react";
import { api, errorText, type OpnameListRow, type OpnameModule } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { OpnameStatusBadge } from "../components/OpnameStatusBadge";
import { canOpname } from "../lib/access";
import { useShownEstates } from "../hooks/useEstateFilter";
import { OPNAME_MODULES, OPNAME_MODULE_LABEL, localToday, opnameModule } from "../lib/opname";
import { tanggalWaktu } from "../lib/datetime";

const PAGE_SIZE = 25;

// Stok Opname sessions of every location the account can see (narrowed to the estates picked on the
// dashboard, if any); "Buat Opname" starts a count.
export function StokOpnamePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { estates, param: pickedEstates } = useShownEstates();
  const visibleModules = OPNAME_MODULES.filter((m) => canOpname(user, opnameModule(m)));
  const createModules = OPNAME_MODULES.filter((m) => canOpname(user, opnameModule(m), "opname"));

  const [module, setModule] = useState("");
  const [estatePick, setEstate] = useState("");
  // A picked estate the dashboard filter no longer shows falls back to all shown ones.
  const estate = estates.includes(estatePick) ? estatePick : "";
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<OpnameListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.opnameList({ module, estate, estates: pickedEstates, status, page, pageSize: PAGE_SIZE }).then((res) => {
      setRows(res.data);
      setTotal(res.total);
      setLoading(false);
    });
  }, [module, estate, pickedEstates, status, page]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const selectCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Stok Opname</h1>
          <p className="text-sm text-[var(--text-secondary)]">Hitung fisik per lokasi, ajukan, lalu stok dikoreksi setelah disetujui</p>
        </div>
        {createModules.length > 0 && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90"
          >
            <Plus size={16} /> Buat Opname
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <select value={module} onChange={(e) => (setModule(e.target.value), setPage(1))} className={selectCls} aria-label="Modul">
          <option value="">Semua modul</option>
          {visibleModules.map((m) => (
            <option key={m} value={m}>
              {OPNAME_MODULE_LABEL[m]}
            </option>
          ))}
        </select>
        <select value={estate} onChange={(e) => (setEstate(e.target.value), setPage(1))} className={selectCls} aria-label="Estate">
          <option value="">Semua estate</option>
          {estates.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className={selectCls} aria-label="Status">
          <option value="">Semua status</option>
          <option value="OPEN">Belum selesai</option>
          <option value="DRAFT">Sedang dihitung</option>
          <option value="SUBMITTED">Menunggu approval</option>
          <option value="APPROVED">Disetujui</option>
          <option value="BATAL">Dibatalkan</option>
        </select>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="grid-table w-full text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-4 py-2.5 text-left">No. Opname</th>
                <th className="px-4 py-2.5 text-left">Tanggal</th>
                <th className="px-4 py-2.5 text-left">Lokasi</th>
                <th className="px-4 py-2.5 text-left">Status</th>
                <th className="px-4 py-2.5 text-right">Dihitung</th>
                <th className="px-4 py-2.5 text-right">Selisih</th>
                <th className="px-4 py-2.5 text-left">Dibuat oleh</th>
                <th className="px-4 py-2.5 text-left">Disetujui oleh</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {module || estate || status ? "Tidak ada opname yang cocok dengan filter" : "Belum ada stok opname"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/stok-opname/${r.id}`)}
                    className="border-t border-[var(--border)] hover:bg-[#f8fafc] cursor-pointer"
                  >
                    <td className="px-4 py-2.5 font-medium text-[var(--accent-blue)] whitespace-nowrap">#{r.id}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{tanggalWaktu(r.tanggal, r.created_at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {OPNAME_MODULE_LABEL[r.module]} {r.estate}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <OpnameStatusBadge status={r.status} />
                        {(r.status === "DRAFT" || r.status === "SUBMITTED") && (
                          <span title="Transaksi stok lokasi ini dikunci">
                            <Lock size={13} className="text-[var(--text-muted)]" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {r.dihitung.toLocaleString("id-ID")} / {r.total.toLocaleString("id-ID")}
                    </td>
                    <td className={`px-4 py-2.5 text-right ${r.selisih ? "text-[var(--accent-amber)] font-medium" : "text-[var(--text-muted)]"}`}>
                      {r.selisih ? `${r.selisih.toLocaleString("id-ID")} item` : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.created_by_nama || "-"}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.approved_by_nama || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-sm text-[var(--text-secondary)]">
          <span>
            {total.toLocaleString("id-ID")} opname · Halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40">
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {creating && (
        <CreateOpnameModal
          modules={createModules}
          estates={estates}
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/stok-opname/${id}`)}
        />
      )}
    </div>
  );
}

function CreateOpnameModal({
  modules,
  estates,
  onClose,
  onCreated,
}: {
  modules: OpnameModule[];
  estates: string[];
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [module, setModule] = useState<OpnameModule>(modules[0]);
  const [estate, setEstate] = useState(estates[0] ?? "");
  const [tanggal, setTanggal] = useState(localToday());
  const [catatan, setCatatan] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await api.createOpname({ module, estate, tanggal, catatan });
      onCreated(res.id);
    } catch (e) {
      setError(errorText(e, "Gagal membuat stok opname", true));
      setSubmitting(false);
    }
  };

  const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
  const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm text-[var(--text-primary)] flex items-center gap-2">
            <ClipboardCheck size={16} className="text-[var(--accent-blue)]" /> Buat Stok Opname
          </h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <label className={labelCls}>Estate / Lokasi</label>
              <select value={estate} onChange={(e) => setEstate(e.target.value)} className={inputCls}>
                {estates.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Tanggal opname</label>
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Catatan (opsional)</label>
            <input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. Opname akhir bulan September" className={inputCls} />
          </div>
          <div className="flex gap-2 text-xs rounded-md border border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] text-[#92400e] p-3">
            <Lock size={14} className="shrink-0 mt-0.5" />
            <span>
              Stok sistem saat ini disimpan sebagai acuan. Selama opname belum disetujui atau dibatalkan, semua transaksi stok{" "}
              <b>
                {OPNAME_MODULE_LABEL[module]} {estate}
              </b>{" "}
              (masuk, keluar, edit, hapus, koreksi) dikunci.
            </span>
          </div>
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)]">
          <button
            onClick={submit}
            disabled={submitting || !estate || !tanggal}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyiapkan..." : "Mulai Opname"}
          </button>
        </div>
      </div>
    </div>
  );
}
