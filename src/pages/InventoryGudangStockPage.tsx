import { useEffect, useState } from "react";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  PackagePlus,
  ListPlus,
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
import { api, errorText, type GudangStockItem, type GudangStockSummary, type PickerItem } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { ExportButtons } from "../components/ExportButtons";
import { ActivityLogButton } from "../components/ActivityLogButton";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EditGudangStockModal } from "../components/EditGudangStockModal";
import { ItemPickerModal } from "../components/ItemPickerModal";
import { TransactionModal } from "../components/TransactionModal";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { useDragScroll } from "../hooks/useDragScroll";
import { InventoryTabs, useInventoryTab } from "../components/InventoryTabs";
import { LedgerHistory } from "../components/LedgerHistory";
import { StockBatchModal } from "../components/StockBatchModal";

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
            className={`appearance-none bg-transparent text-xs pl-1 pr-4 py-0.5 max-w-[8rem] truncate [field-sizing:content] rounded border cursor-pointer ${
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
  const [stockFilter, setStockFilter] = useState<"" | "tersedia" | "menipis" | "habis">("");
  const [sortBy, setSortBy] = useState<SortKey>("kode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  // Input Banyak (many Stok Masuk / Keluar in one go) and its "saved" notice.
  const [showBatch, setShowBatch] = useState(false);
  const [batchNotice, setBatchNotice] = useState("");
  const [selectedItem, setSelectedItem] = useState<PickerItem | null>(null);
  const [tab, setTab] = useInventoryTab();
  // Bumped after a new transaction so an open Stock In/Out tab reloads.
  const [historyKey, setHistoryKey] = useState(0);
  const { user } = useAuth();
  // Edit / delete buttons follow the account's ticked permissions (Pengguna); the Aksi column shows
  // when it may do either.
  const canEdit = can(user, "gudang.edit");
  const canDelete = can(user, "gudang.delete");
  const showActions = canEdit || canDelete;
  // "Transaksi" opens the Stok Masuk / Keluar / Koreksi form: shown when any of those is allowed.
  const canInput = can(user, "gudang.input");
  const canTx = canInput || can(user, "gudang.koreksi");
  const [editingItem, setEditingItem] = useState<GudangStockItem | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<GudangStockItem | null>(null);
  const tableScrollRef = useDragScroll<HTMLDivElement>();
  const pageSize = 25;

  const load = () => {
    setLoading(true);
    api.gudangStock({ gudang, search, status, stock: stockFilter, sortBy, sortDir, page, pageSize }).then((res) => {
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
  }, [gudang, page, status, stockFilter, sortBy, sortDir]);

  const toggleStockFilter = (f: "tersedia" | "menipis" | "habis") => {
    setStockFilter((cur) => (cur === f ? "" : f));
    setPage(1);
  };

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

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) =>
      api.gudangStock({ gudang, search, status, stock: stockFilter, sortBy, sortDir, page: p, pageSize: ps })
    );
    const filters = [
      search && `Cari: "${search}"`,
      status && `Status: ${status}`,
      stockFilter === "menipis" && "Stock Menipis (Buffer)",
      stockFilter === "tersedia" && "Stok Tersedia (> 0)",
      stockFilter === "habis" && "Stock Habis",
    ].filter(Boolean);
    return {
      title: `Inventory Gudang - ${gudang}`,
      subtitle: filters.length ? [`Filter: ${filters.join(" · ")}`] : [],
      columns: [
        { label: "Kode" },
        { label: "Nama Barang" },
        { label: "Satuan" },
        { label: "Buffer", align: "right" },
        { label: "Stock Tersedia", align: "right" },
        { label: "Status" },
      ],
      rows: all.map((i) => [i.kode, i.nama, i.satuan, i.buffer_stock, i.stock_tersedia, i.keterangan]),
    };
  };

  const remove = async (item: GudangStockItem) => {
    setDeleteError("");
    try {
      await api.deleteGudangStockItem(item.id);
      load();
      loadSummary();
    } catch (e) {
      setDeleteError(errorText(e, "Gagal menghapus barang"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Inventory Gudang - {gudang}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{total.toLocaleString("id-ID")} item barang</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivityLogButton module="BARANG" estate={gudang} />
          {tab === "stok" && <ExportButtons total={total} buildReport={buildReport} fileName={`inventory-gudang-${gudang.toLowerCase()}`} />}
          {canInput && (
            <button
              onClick={() => setShowBatch(true)}
              title="Banyak transaksi sekaligus"
              className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
            >
              <ListPlus size={16} /> Input Banyak
            </button>
          )}
          {canTx && (<button
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
          >
            <PackagePlus size={16} /> Transaksi
          </button>)}
        </div>
      </div>

      <InventoryTabs value={tab} onChange={setTab} />

      {tab !== "stok" ? (
        <LedgerHistory scope={{ kind: "gudang", name: gudang }} type={tab === "in" ? "IN" : "OUT"} refreshKey={historyKey} />
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Total Item Barang"
                value={summary.totalItems.toLocaleString("id-ID")}
                icon={Package}
                tone="blue"
                title="Tampilkan semua item"
                onClick={() => (setStockFilter(""), setPage(1))}
              />
              <StatCard
                label="Total Stock Tersedia"
                value={summary.totalStock.toLocaleString("id-ID")}
                icon={Boxes}
                tone="green"
                active={stockFilter === "tersedia"}
                title={stockFilter === "tersedia" ? "Tampilkan semua item" : "Lihat item yang stoknya ada"}
                onClick={() => toggleStockFilter("tersedia")}
              />
              <StatCard
                label="Stock Menipis (Buffer)"
                value={summary.lowStock.toLocaleString("id-ID")}
                icon={AlertTriangle}
                tone="amber"
                active={stockFilter === "menipis"}
                onClick={() => toggleStockFilter("menipis")}
              />
              <StatCard
                label="Stock Habis"
                value={summary.outOfStock.toLocaleString("id-ID")}
                icon={XCircle}
                tone="red"
                active={stockFilter === "habis"}
                onClick={() => toggleStockFilter("habis")}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kode, nama, atau satuan barang..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
              />
            </div>
          </div>

          {deleteError && <p className="text-xs text-[var(--accent-red)]">{deleteError}</p>}

          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
            <div ref={tableScrollRef} className="overflow-x-auto">
              <table className="grid-table data-table text-sm">
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
                    {showActions && <th className="px-4 py-2.5 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={showActions ? 7 : 6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        Memuat...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={showActions ? 7 : 6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        Belum ada barang di gudang {gudang}. Klik "Tambah Item" untuk menambahkan dari master data.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                        <td className="px-4 py-2.5 font-mono text-xs">{item.kode}</td>
                        <td className="col-grow px-4 py-2.5">{item.nama}</td>
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
                        {showActions && (
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-flex gap-1.5">
                              {canEdit && (<button
                                onClick={() => setEditingItem(item)}
                                title="Edit stok barang"
                                className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                              >
                                <Pencil size={14} />
                              </button>)}
                              {canDelete && (<button
                                onClick={() => setConfirmDelete(item)}
                                title="Hapus dari gudang ini"
                                className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                              >
                                <Trash2 size={14} />
                              </button>)}
                            </div>
                          </td>
                        )}
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
        </>
      )}

      {batchNotice && (
        <div className="fixed bottom-4 right-4 z-50 text-sm rounded-md px-4 py-2.5 shadow-lg bg-[var(--accent-green)] text-white">{batchNotice}</div>
      )}
      {showBatch && (
        <StockBatchModal
          scope={{ kind: "gudang", name: gudang }}
          onClose={() => setShowBatch(false)}
          onSuccess={(count) => {
            setShowBatch(false);
            setBatchNotice(`${count} transaksi tersimpan`);
            setTimeout(() => setBatchNotice(""), 3000);
            setHistoryKey((k) => k + 1);
            load();
            loadSummary();
          }}
        />
      )}
      {showPicker && (
        <ItemPickerModal
          scope={{ kind: "gudang", name: gudang }}
          onClose={() => setShowPicker(false)}
          onSelect={(item) => {
            setShowPicker(false);
            setSelectedItem(item);
          }}
        />
      )}

      {selectedItem && (
        <TransactionModal
          item={selectedItem}
          scope={{ kind: "gudang", name: gudang }}
          onClose={() => setSelectedItem(null)}
          onSuccess={() => {
            setSelectedItem(null);
            setHistoryKey((k) => k + 1);
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

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus barang "${confirmDelete.nama}" dari gudang ${gudang}? Tindakan ini tidak bisa dibatalkan.`}
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
