import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Filter, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type Item } from "../lib/api";
import { EditItemModal } from "../components/EditItemModal";
import { ConfirmDialog } from "../components/ConfirmDialog";

type SortKey = "kode" | "nama" | "buffer_stock";

function SortableHeader({
  label,
  sortKey,
  align = "left",
  currentSort,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  align?: "left" | "right";
  currentSort: SortKey;
  currentDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const active = currentSort === sortKey;
  const Icon = active ? (currentDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={`px-4 py-2.5 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${
          active ? "text-[var(--accent-blue)]" : ""
        }`}
      >
        {label}
        <Icon size={12} />
      </button>
    </th>
  );
}

function FilterHeader({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <th className="px-4 py-2.5 text-left">
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <div className="relative inline-flex">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`appearance-none bg-transparent text-xs pl-1 pr-4 py-0.5 rounded border cursor-pointer ${
              value
                ? "border-[var(--accent-blue-border)] text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]"
                : "border-transparent text-[var(--text-muted)] hover:border-[var(--border)]"
            }`}
          >
            <option value="">Semua</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <Filter size={10} className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>
    </th>
  );
}

export function MasterBarangPage() {
  const [rows, setRows] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [satuan, setSatuan] = useState("");
  const [satuanOptions, setSatuanOptions] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("kode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Item | null>(null);
  const pageSize = 25;

  const load = () => {
    setLoading(true);
    api.items({ search, satuan, sortBy, sortDir, page, pageSize }).then((res) => {
      setRows(res.data);
      setTotal(res.total);
      setLoading(false);
    });
  };

  useEffect(() => {
    api.satuanOptions().then(setSatuanOptions);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, satuan, sortBy, sortDir]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const remove = async (item: Item) => {
    setDeleteError("");
    try {
      await api.deleteItem(item.id);
      load();
    } catch (e: any) {
      setDeleteError(
        e?.message?.includes("409") ? "Barang ini punya riwayat transaksi, tidak bisa dihapus" : "Gagal menghapus barang"
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Master Data Barang</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {total.toLocaleString("id-ID")} jenis barang · diambil dari daftar barang Gudang Nilam
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90"
        >
          <Plus size={16} />
          Tambah Barang
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari kode atau nama barang..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>
      </div>

      {deleteError && <p className="text-xs text-[var(--accent-red)]">{deleteError}</p>}

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                <SortableHeader label="Kode" sortKey="kode" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Nama Barang" sortKey="nama" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                <FilterHeader label="Satuan" value={satuan} options={satuanOptions} onChange={(v) => { setSatuan(v); setPage(1); }} />
                <SortableHeader
                  label="Buffer Stock"
                  sortKey="buffer_stock"
                  align="right"
                  currentSort={sortBy}
                  currentDir={sortDir}
                  onSort={toggleSort}
                />
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada data
                  </td>
                </tr>
              ) : (
                rows.map((item) => (
                  <tr key={item.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 font-mono text-xs">{item.kode}</td>
                    <td className="px-4 py-2.5">{item.nama}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{item.satuan}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{item.buffer_stock}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          onClick={() => setEditingItem(item)}
                          title="Edit data barang"
                          className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(item)}
                          title="Hapus barang"
                          className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
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

        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-sm text-[var(--text-secondary)]">
          <span>
            Halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40"
            >
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

      {editingItem && (
        <EditItemModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSuccess={() => {
            setEditingItem(null);
            load();
          }}
        />
      )}

      {creating && (
        <EditItemModal
          item={null}
          onClose={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus barang "${confirmDelete.nama}" (${confirmDelete.kode})? Tindakan ini tidak bisa dibatalkan.`}
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
