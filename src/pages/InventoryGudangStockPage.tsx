import { useEffect, useState } from "react";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  PackagePlus,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Filter,
  Pencil,
  Trash2,
  Package,
  Boxes,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { api, type GudangStockItem, type GudangStockSummary } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { AddGudangStockModal } from "../components/AddGudangStockModal";
import { EditGudangStockModal } from "../components/EditGudangStockModal";

const STATUSES = ["AMAN", "BUFFER STOCK"];

type SortKey = "kode" | "nama" | "buffer_stock" | "stock_tersedia";

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

export function InventoryGudangStockPage({ gudang }: { gudang: string }) {
  const [items, setItems] = useState<GudangStockItem[]>([]);
  const [summary, setSummary] = useState<GudangStockSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("kode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingItem, setEditingItem] = useState<GudangStockItem | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const pageSize = 25;

  const load = () => {
    setLoading(true);
    api.gudangStock({ gudang, search, status, sortBy, sortDir, page, pageSize }).then((res) => {
      setItems(res.data);
      setTotal(res.total);
      setLoading(false);
    });
  };

  const loadSummary = () => api.gudangStockSummary(gudang).then(setSummary);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gudang]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gudang, page, status, sortBy, sortDir]);

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

  const remove = async (item: GudangStockItem) => {
    setDeleteError("");
    if (!confirm(`Hapus barang "${item.nama}" dari gudang ${gudang}?`)) return;
    try {
      await api.deleteGudangStockItem(item.id);
      load();
      loadSummary();
    } catch {
      setDeleteError("Gagal menghapus barang");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Inventory Gudang - {gudang}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{total.toLocaleString("id-ID")} item barang</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
        >
          <PackagePlus size={16} /> Tambah Item
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Item Barang" value={summary.totalItems.toLocaleString("id-ID")} icon={Package} tone="blue" />
          <StatCard label="Total Stock Tersedia" value={summary.totalStock.toLocaleString("id-ID")} icon={Boxes} tone="green" />
          <StatCard label="Stock Menipis (Buffer)" value={summary.lowStock.toLocaleString("id-ID")} icon={AlertTriangle} tone="amber" />
          <StatCard label="Stock Habis" value={summary.outOfStock.toLocaleString("id-ID")} icon={XCircle} tone="red" />
        </div>
      )}

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
                <th className="px-4 py-2.5 text-left">Satuan</th>
                <SortableHeader
                  label="Buffer"
                  sortKey="buffer_stock"
                  align="right"
                  currentSort={sortBy}
                  currentDir={sortDir}
                  onSort={toggleSort}
                />
                <SortableHeader
                  label="Stock Tersedia"
                  sortKey="stock_tersedia"
                  align="right"
                  currentSort={sortBy}
                  currentDir={sortDir}
                  onSort={toggleSort}
                />
                <FilterHeader label="Status" value={status} options={STATUSES} onChange={(v) => { setStatus(v); setPage(1); }} />
                <th className="px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Belum ada barang di gudang {gudang}. Klik "Tambah Item" untuk menambahkan dari master data.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 font-mono text-xs">{item.kode}</td>
                    <td className="px-4 py-2.5">{item.nama}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{item.satuan}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{item.buffer_stock}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{item.stock_tersedia.toLocaleString("id-ID")}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          item.keterangan === "AMAN"
                            ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]"
                            : "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]"
                        }`}
                      >
                        {item.keterangan}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          onClick={() => setEditingItem(item)}
                          title="Edit stok barang"
                          className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => remove(item)}
                          title="Hapus dari gudang ini"
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

      {showAdd && (
        <AddGudangStockModal
          gudang={gudang}
          onClose={() => setShowAdd(false)}
          onSuccess={() => {
            setShowAdd(false);
            load();
            loadSummary();
          }}
        />
      )}

      {editingItem && (
        <EditGudangStockModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSuccess={() => {
            setEditingItem(null);
            load();
            loadSummary();
          }}
        />
      )}
    </div>
  );
}
