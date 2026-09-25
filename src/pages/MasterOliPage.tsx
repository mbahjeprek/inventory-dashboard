import { useEffect, useState } from "react";
import { Search, Plus, Pencil, Trash2, X } from "lucide-react";
import { api, errorText, type MasterOli } from "../lib/api";
import { ConfirmDialog } from "../components/ConfirmDialog";

// Master data oli: the jenis oli that Inventory Oli transactions and Stok Opname can use.
export function MasterOliPage() {
  const [rows, setRows] = useState<MasterOli[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MasterOli | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MasterOli | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    api.masterOli(search).then((res) => {
      setRows(res.data);
      setLoading(false);
    });
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const remove = async (o: MasterOli) => {
    setError("");
    try {
      await api.deleteMasterOli(o.id);
      load();
    } catch (e) {
      setError(errorText(e, "Gagal menghapus jenis oli", true));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Master Data Oli</h1>
          <p className="text-sm text-[var(--text-secondary)]">Jenis oli yang bisa dipakai di Inventory Oli dan Stok Opname</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90"
        >
          <Plus size={16} /> Tambah Jenis Oli
        </button>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari kode, nama atau keterangan..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
      </div>

      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="grid-table w-full text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-4 py-2.5 text-left">Kode</th>
                <th className="px-4 py-2.5 text-left">Nama Jenis Oli</th>
                <th className="px-4 py-2.5 text-left">Satuan</th>
                <th className="px-4 py-2.5 text-left">Keterangan</th>
                <th className="px-4 py-2.5 text-right">Transaksi</th>
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    {search ? "Tidak ada jenis oli yang cocok" : "Belum ada jenis oli"}
                  </td>
                </tr>
              ) : (
                rows.map((o) => (
                  <tr key={o.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{o.kode}</td>
                    <td className="px-4 py-2.5 font-medium">{o.nama}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{o.satuan}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{o.keterangan || "-"}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{o.transaksi.toLocaleString("id-ID")}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          onClick={() => setEditing(o)}
                          title="Edit"
                          className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(o)}
                          disabled={o.transaksi > 0}
                          title={o.transaksi > 0 ? "Sudah punya transaksi, tidak bisa dihapus" : "Hapus"}
                          className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)] disabled:opacity-40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <MasterOliModal
          record={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus jenis oli ${confirmDelete.nama}?`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            remove(confirmDelete);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function MasterOliModal({ record, onClose, onSuccess }: { record: MasterOli | null; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    kode: record?.kode ?? "",
    nama: record?.nama ?? "",
    satuan: record?.satuan ?? "LTR",
    keterangan: record?.keterangan ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const renamed = !!record && record.transaksi > 0 && form.nama.trim().toUpperCase() !== record.nama;

  const submit = async () => {
    if (!form.kode.trim() || !form.nama.trim()) return setError("Kode dan nama wajib diisi");
    setSubmitting(true);
    setError("");
    try {
      if (record) await api.updateMasterOli(record.id, form);
      else await api.createMasterOli(form);
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan", true));
      setSubmitting(false);
    }
  };

  const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2";
  const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">{record ? "Edit Jenis Oli" : "Tambah Jenis Oli"}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Kode</label>
              <input value={form.kode} onChange={set("kode")} placeholder="OL-004" className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Nama Jenis Oli</label>
              <input value={form.nama} onChange={set("nama")} placeholder="cth. SAE 20W 50" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Satuan</label>
              <input value={form.satuan} onChange={set("satuan")} className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Keterangan</label>
              <input value={form.keterangan} onChange={set("keterangan")} placeholder="cth. Oli mesin" className={inputCls} />
            </div>
          </div>
          {renamed && (
            <p className="text-xs text-[var(--accent-amber)]">
              Nama diganti: {record!.transaksi.toLocaleString("id-ID")} transaksi lama ikut memakai nama baru.
            </p>
          )}
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)]">
          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}
