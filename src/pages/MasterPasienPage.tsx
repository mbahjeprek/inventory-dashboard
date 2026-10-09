import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api, errorText, ESTATES, type Pasien, type PasienInput } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can, userEstates } from "../lib/access";
import { ExportButtons } from "../components/ExportButtons";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { STATUS_PASIEN, tglSheet, usiaOf } from "../lib/kunjungan";

const PAGE_SIZE = 50;
const LABEL: Record<string, string> = { NILAM: "Nilam", KNS: "KNS", WJA: "WJA", ZAMRUD: "Zamrud", FIRUS: "Firus" };
const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-[var(--bg-card)]";
const today = () => new Date().toISOString().slice(0, 10);
type Sort = "nama" | "kunjungan" | "kunjungan_terakhir";

function PasienModal({ estate, pasien, onClose, onSaved }: { estate: string; pasien: Pasien | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<PasienInput>(() => ({
    nama: pasien?.nama ?? "",
    jenis_kelamin: pasien?.jenis_kelamin ?? "",
    tanggal_lahir_iso: pasien?.tanggal_lahir_iso ?? null,
    status_pasien: pasien?.status_pasien ?? "",
    penanggung: pasien?.penanggung ?? "",
    jabatan: pasien?.jabatan ?? "",
    divisi: pasien?.divisi ?? "",
    tempat_tinggal: pasien?.tempat_tinggal ?? "",
    asal_pasien: pasien?.asal_pasien ?? "",
    catatan: pasien?.catatan ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof PasienInput>(k: K, v: PasienInput[K]) => setF((c) => ({ ...c, [k]: v }));
  const save = async () => {
    if (!f.nama.trim()) return setError("Nama pasien wajib diisi");
    setSaving(true);
    setError("");
    try {
      if (pasien) await api.updatePasien(pasien.id, f);
      else await api.createPasien({ ...f, estate });
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan pasien"));
    } finally {
      setSaving(false);
    }
  };
  const field = (label: string, el: React.ReactNode, span = false) => (
    <label className={`block min-w-0 ${span ? "col-span-2" : ""}`}>
      <span className="text-xs text-[var(--text-secondary)] mb-1 block">{label}</span>
      {el}
    </label>
  );
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-card)] rounded-lg w-full max-w-lg shadow-xl max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">
            {pasien ? "Edit Pasien" : "Tambah Pasien"} - Klinik {LABEL[estate]}
          </h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Tutup">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          {field("Nama Pasien", <input value={f.nama} onChange={(e) => set("nama", e.target.value)} className={inputCls} />, true)}
          {field(
            "Jenis Kelamin L/P",
            <select value={f.jenis_kelamin} onChange={(e) => set("jenis_kelamin", e.target.value)} className={inputCls}>
              <option value="">-</option>
              <option value="L">L</option>
              <option value="P">P</option>
            </select>
          )}
          {field("Tanggal Lahir", <input type="date" value={f.tanggal_lahir_iso ?? ""} max={today()} onChange={(e) => set("tanggal_lahir_iso", e.target.value || null)} className={inputCls} />)}
          {field(
            "Status Pasien",
            <select value={f.status_pasien} onChange={(e) => set("status_pasien", e.target.value)} className={inputCls}>
              <option value="">-</option>
              {STATUS_PASIEN.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
          {field("Nama Yang Menanggung", <input value={f.penanggung} onChange={(e) => set("penanggung", e.target.value)} className={inputCls} />)}
          {field("Jabatan", <input value={f.jabatan} onChange={(e) => set("jabatan", e.target.value)} className={inputCls} />)}
          {field("Divisi", <input value={f.divisi} onChange={(e) => set("divisi", e.target.value)} className={inputCls} />)}
          {field("Tempat Tinggal", <input value={f.tempat_tinggal} onChange={(e) => set("tempat_tinggal", e.target.value)} className={inputCls} />)}
          {field("Asal Pasien Non PT AKSS", <input value={f.asal_pasien} onChange={(e) => set("asal_pasien", e.target.value)} className={inputCls} />)}
          {field("Catatan", <textarea value={f.catatan} onChange={(e) => set("catatan", e.target.value)} rows={2} placeholder="cth. alergi obat" className={inputCls} />, true)}
          {error && <p className="col-span-2 text-xs text-[var(--accent-red)]">{error}</p>}
          <button onClick={save} disabled={saving} className="col-span-2 py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50">
            {saving ? "Menyimpan..." : pasien ? "Simpan Perubahan" : "Simpan Pasien"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Master Data > Pasien: the patients of each estate's clinic (not the karyawan list), with how often
// and when they last came. Visits entered in Klinik > Laporan Harian add new patients here.
export function MasterPasienPage() {
  const { user } = useAuth();
  const estates = ESTATES.filter((e) => userEstates(user).includes(e) && ["NILAM", "ZAMRUD", "FIRUS", "KNS", "WJA"].includes(e));
  const [estate, setEstate] = useState(estates.length === 1 ? estates[0] : "");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("nama");
  const [rows, setRows] = useState<Pasien[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Pasien | "new" | null>(null);
  const [deleting, setDeleting] = useState<Pasien | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const canInput = can(user, "klinik.input");
  const canEdit = can(user, "klinik.edit");
  const canDelete = can(user, "klinik.delete");

  const query = (p: number, ps: number) => ({ estate, status, search, sortBy: sort, sortDir: sort === "nama" ? "asc" : "desc", page: p, pageSize: ps });
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .pasien(query(page, PAGE_SIZE))
        .then((r) => {
          setRows(r.data);
          setTotal(r.total);
        })
        .catch(() => {
          setRows([]);
          setTotal(0);
        });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estate, status, search, sort, page, reloadKey]);
  useEffect(() => setPage(1), [estate, status, search, sort]);

  const remove = async () => {
    if (!deleting) return;
    setError("");
    try {
      await api.deletePasien(deleting.id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(errorText(e, "Gagal menghapus pasien"));
    } finally {
      setDeleting(null);
    }
  };

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.pasien(query(p, ps)));
    return {
      title: `Master Pasien Klinik${estate ? ` - Estate ${LABEL[estate]}` : ""}`,
      subtitle: [status && `Status: ${status}`, search && `Cari: "${search}"`].filter(Boolean) as string[],
      landscape: true,
      columns: [
        { label: "No", align: "right" },
        { label: "Estate" },
        { label: "Nama Pasien" },
        { label: "L/P" },
        { label: "Tanggal Lahir", nowrap: true },
        { label: "Usia", align: "right" },
        { label: "Status Pasien" },
        { label: "Nama Yang Menanggung" },
        { label: "Jabatan" },
        { label: "Divisi" },
        { label: "Tempat Tinggal" },
        { label: "Asal Pasien Non PT AKSS" },
        { label: "Jumlah Kunjungan", align: "right" },
        { label: "Kunjungan Pertama", nowrap: true },
        { label: "Kunjungan Terakhir", nowrap: true },
        { label: "Catatan" },
      ],
      rows: all.map((p, i) => [
        i + 1,
        LABEL[p.estate],
        p.nama,
        p.jenis_kelamin,
        tglSheet(p.tanggal_lahir_iso),
        usiaOf(p.tanggal_lahir_iso, today()),
        p.status_pasien,
        p.penanggung,
        p.jabatan,
        p.divisi,
        p.tempat_tinggal,
        p.asal_pasien,
        p.kunjungan,
        tglSheet(p.kunjungan_pertama),
        tglSheet(p.kunjungan_terakhir),
        p.catatan,
      ]),
    };
  };

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Master Pasien</h1>
          <p className="text-sm text-[var(--text-secondary)]">Pasien klinik per estate · {total.toLocaleString("id-ID")} pasien</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButtons total={total} buildReport={buildReport} fileName={`master-pasien${estate ? `-${estate.toLowerCase()}` : ""}`} />
          {canInput && estate && (
            <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md font-medium bg-[var(--accent-blue)] text-white hover:opacity-90">
              <Plus size={16} /> Tambah Pasien
            </button>
          )}
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 flex flex-wrap items-center gap-2">
        <select value={estate} onChange={(e) => setEstate(e.target.value)} className="text-sm rounded-md border border-[var(--border)] px-3 py-2" aria-label="Estate">
          {estates.length > 1 && <option value="">Semua estate</option>}
          {estates.map((e) => (
            <option key={e} value={e}>
              Klinik {LABEL[e]}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm rounded-md border border-[var(--border)] px-3 py-2" aria-label="Status pasien">
          <option value="">Semua status</option>
          {STATUS_PASIEN.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="text-sm rounded-md border border-[var(--border)] px-3 py-2" aria-label="Urutan">
          <option value="nama">Urut nama</option>
          <option value="kunjungan">Paling sering berobat</option>
          <option value="kunjungan_terakhir">Terakhir berobat</option>
        </select>
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama, penanggung, jabatan, divisi..." className="w-full text-sm rounded-md border border-[var(--border)] pl-8 pr-3 py-2" />
        </div>
        {canInput && !estate && <span className="text-xs text-[var(--text-muted)]">Pilih estate untuk menambah pasien</span>}
      </div>

      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="grid-table data-table text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-3 py-2.5 text-right">No</th>
                {!estate && <th className="px-3 py-2.5 text-left">Estate</th>}
                <th className="px-3 py-2.5 text-left">Nama Pasien</th>
                <th className="px-3 py-2.5 text-left">L/P</th>
                <th className="px-3 py-2.5 text-left">Tanggal Lahir</th>
                <th className="px-3 py-2.5 text-left">Status</th>
                <th className="px-3 py-2.5 text-left">Jabatan / Divisi</th>
                <th className="px-3 py-2.5 text-left">Tempat Tinggal / Asal</th>
                <th className="px-3 py-2.5 text-right">Kunjungan</th>
                <th className="px-3 py-2.5 text-left">Catatan</th>
                {(canEdit || canDelete) && <th className="px-3 py-2.5 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada pasien
                  </td>
                </tr>
              ) : (
                rows.map((p, i) => {
                  const usia = usiaOf(p.tanggal_lahir_iso, today());
                  return (
                    <tr key={p.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc] align-top">
                      <td className="px-3 py-2 text-right text-[var(--text-muted)]">{(page - 1) * PAGE_SIZE + i + 1}</td>
                      {!estate && <td className="px-3 py-2">{LABEL[p.estate]}</td>}
                      <td className="px-3 py-2 whitespace-nowrap">{p.nama}</td>
                      <td className="px-3 py-2">{p.jenis_kelamin || "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.tanggal_lahir_iso ? tglSheet(p.tanggal_lahir_iso) : "-"}
                        {usia !== null && <div className="text-[11px] text-[var(--text-muted)]">{usia} th</div>}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">
                        {p.status_pasien || "-"}
                        {p.penanggung && <div className="text-[11px] text-[var(--text-muted)]">ditanggung {p.penanggung}</div>}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">
                        {p.jabatan || "-"}
                        {p.divisi && <div className="text-[11px] text-[var(--text-muted)]">{p.divisi}</div>}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">
                        {p.tempat_tinggal || "-"}
                        {p.asal_pasien && <div className="text-[11px] text-[var(--text-muted)]">{p.asal_pasien}</div>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {p.kunjungan}×{p.kunjungan_terakhir && <div className="text-[11px] text-[var(--text-muted)]">terakhir {tglSheet(p.kunjungan_terakhir)}</div>}
                      </td>
                      <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">{p.catatan || "-"}</td>
                      {(canEdit || canDelete) && (
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-1.5">
                            {canEdit && (
                              <button onClick={() => setEditing(p)} title="Edit pasien" className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                                <Pencil size={14} />
                              </button>
                            )}
                            {canDelete && p.kunjungan === 0 && (
                              <button onClick={() => setDeleting(p)} title="Hapus pasien" className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-sm text-[var(--text-secondary)]">
          <span>
            Halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40" aria-label="Halaman sebelumnya">
              <ChevronLeft size={16} />
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40" aria-label="Halaman berikutnya">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {editing && <PasienModal estate={editing === "new" ? estate : editing.estate} pasien={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => setReloadKey((k) => k + 1)} />}
      {deleting && <ConfirmDialog message={`Hapus pasien ${deleting.nama}? Pasien ini belum pernah berobat.`} onConfirm={remove} onCancel={() => setDeleting(null)} />}
    </div>
  );
}
