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
  Pill,
  Boxes,
  AlertTriangle,
  XCircle,
  CalendarClock,
  ArrowLeftRight,
} from "lucide-react";
import { api, errorText, type KlinikStockItem, type KlinikSummary, type PickerItem } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { ExportButtons } from "../components/ExportButtons";
import { ActivityLogButton } from "../components/ActivityLogButton";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EditKlinikStockModal } from "../components/EditKlinikStockModal";
import { ItemPickerModal } from "../components/ItemPickerModal";
import { TransactionModal, type TransactionPreset } from "../components/TransactionModal";
import { useDragScroll } from "../hooks/useDragScroll";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { InventoryTabs, useInventoryTab } from "../components/InventoryTabs";
import { LedgerHistory } from "../components/LedgerHistory";
import { StockBatchModal } from "../components/StockBatchModal";

// Matches EXPIRY_WARNING_DAYS in server/src/app.ts.
const EXPIRY_WARNING_DAYS = 30;

type SortKey = "kode" | "nama" | "kategori" | "jenis" | "stock_tersedia" | "expired_date";
type StockFilter = "" | "tersedia" | "menipis" | "habis" | "expired";

const formatTanggal = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");

// "expired" when past, "soon" within the warning window, "" otherwise.
function expiryState(iso: string | null): "" | "soon" | "expired" {
  if (!iso) return "";
  const days = (new Date(`${iso}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000;
  if (days < 0) return "expired";
  return days <= EXPIRY_WARNING_DAYS ? "soon" : "";
}

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
    <th className={`px-4 py-2.5 whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${active ? "text-[var(--accent-blue)]" : ""}`}
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

// Obat stock of one estate clinic, kept per expiry-date batch. Stock only changes through the
// shared Transaksi form (Stock In / Stock Out / Koreksi); Edit changes buffer, note and a batch's
// expiry date.
export function InventoryKlinikPage({ klinik }: { klinik: string }) {
  const [items, setItems] = useState<KlinikStockItem[]>([]);
  const [summary, setSummary] = useState<KlinikSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [kategoriOptions, setKategoriOptions] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [kategori, setKategori] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("");
  const [sortBy, setSortBy] = useState<SortKey>("kode");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  // Input Banyak (many Stok Masuk / Keluar in one go) and its "saved" notice.
  const [showBatch, setShowBatch] = useState(false);
  const [batchNotice, setBatchNotice] = useState("");
  const [selectedItem, setSelectedItem] = useState<PickerItem | null>(null);
  // Set when the form was opened from a row shortcut (e.g. "Buang" on an expired batch).
  const [txPreset, setTxPreset] = useState<TransactionPreset | undefined>(undefined);
  const [tab, setTab] = useInventoryTab();
  // Bumped after a new transaction so an open Stock In/Out tab reloads.
  const [historyKey, setHistoryKey] = useState(0);
  const { user } = useAuth();
  // Edit / delete buttons follow the account's ticked permissions (Pengguna); the Aksi column shows
  // when it may do either.
  const canEdit = can(user, "klinik.edit");
  const canDelete = can(user, "klinik.delete");
  // "Transaksi" opens the Stok Masuk / Keluar / Koreksi form: shown when any of those is allowed.
  const canInput = can(user, "klinik.input");
  const canTx = canInput || can(user, "klinik.koreksi");
  // Aksi column: per-row Transaksi shortcut plus Edit / Hapus.
  const showActions = canEdit || canDelete || canTx;
  const [editingItem, setEditingItem] = useState<KlinikStockItem | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<KlinikStockItem | null>(null);
  const tableScrollRef = useDragScroll<HTMLDivElement>();
  const pageSize = 25;
  const colCount = showActions ? 10 : 9;

  const query = () => ({ klinik, search, kategori, stock: stockFilter, sortBy, sortDir });

  const load = () => {
    setLoading(true);
    api.klinikStock({ ...query(), page, pageSize }).then((res) => {
      setItems(res.data);
      setTotal(res.total);
      setKategoriOptions(res.kategoriOptions);
      setLoading(false);
    });
  };

  const loadSummary = () => api.klinikSummary(klinik).then(setSummary);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klinik]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klinik, page, kategori, stockFilter, sortBy, sortDir]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const toggleStockFilter = (f: Exclude<StockFilter, "">) => {
    setStockFilter((cur) => (cur === f ? "" : f));
    setPage(1);
  };

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.klinikStock({ ...query(), page: p, pageSize: ps }));
    const filters = [
      search && `Cari: "${search}"`,
      kategori && `Kategori: ${kategori}`,
      stockFilter === "menipis" && "Stock Menipis (Buffer)",
      stockFilter === "tersedia" && "Stok Tersedia (> 0)",
      stockFilter === "habis" && "Stock Habis",
      stockFilter === "expired" && `Expired / ≤ ${EXPIRY_WARNING_DAYS} hari`,
    ].filter(Boolean);
    return {
      title: `Inventory Klinik - ${klinik}`,
      subtitle: filters.length ? [`Filter: ${filters.join(" · ")}`] : [],
      landscape: true,
      // Same columns as the clinic's source GSheet.
      columns: [
        { label: "No", align: "right" },
        { label: "Kode Barang", nowrap: true },
        { label: "Nama Obat/Barang" },
        { label: "Kategori" },
        { label: "Jenis/Kelompok" },
        { label: "Deskripsi / Kegunaan" },
        { label: "Satuan" },
        { label: "Stok Sekarang", align: "right" },
        { label: "Expired Date", nowrap: true },
      ],
      rows: all.map((i, n) => [
        n + 1,
        i.kode,
        i.nama,
        i.kategori,
        i.jenis,
        i.deskripsi,
        i.satuan,
        i.stock_tersedia,
        [
          i.batches.length > 1
            ? i.batches.map((b) => `${b.expired_date ? formatTanggal(b.expired_date) : "Tanpa expired"} (${b.qty})`).join(", ")
            : formatTanggal(i.expired_date),
          i.catatan,
        ]
          .filter(Boolean)
          .join(" · "),
      ]),
    };
  };

  // Opens the Transaksi form straight on this row's obat, skipping the picker.
  const openTx = (item: KlinikStockItem, preset?: TransactionPreset) => {
    setTxPreset(preset);
    setSelectedItem(item);
  };

  const remove = async (item: KlinikStockItem) => {
    setDeleteError("");
    try {
      await api.deleteKlinikStock(item.id);
      load();
      loadSummary();
    } catch (e) {
      setDeleteError(errorText(e, "Gagal menghapus obat dari klinik"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Inventory Klinik - {klinik}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{total.toLocaleString("id-ID")} item obat & alat medis</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivityLogButton module="KLINIK" estate={klinik} />
          {tab === "stok" && <ExportButtons total={total} buildReport={buildReport} fileName={`inventory-klinik-${klinik.toLowerCase()}`} />}
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
        <LedgerHistory scope={{ kind: "klinik", name: klinik }} type={tab === "in" ? "IN" : "OUT"} refreshKey={historyKey} />
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard
                label="Total Item"
                value={summary.totalItems.toLocaleString("id-ID")}
                icon={Pill}
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
              <StatCard
                label={`Expired / ≤ ${EXPIRY_WARNING_DAYS} Hari`}
                value={summary.expiring.toLocaleString("id-ID")}
                icon={CalendarClock}
                tone="red"
                active={stockFilter === "expired"}
                onClick={() => toggleStockFilter("expired")}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kode, nama, jenis atau kegunaan obat..."
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
                    <th className="px-4 py-2.5 text-right">No</th>
                    <SortableHeader label="Kode Barang" sortKey="kode" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                    <SortableHeader label="Nama Obat/Barang" sortKey="nama" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                    <FilterHeader
                      label="Kategori"
                      value={kategori}
                      options={kategoriOptions}
                      onChange={(v) => {
                        setKategori(v);
                        setPage(1);
                      }}
                    />
                    <SortableHeader label="Jenis/Kelompok" sortKey="jenis" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                    <th className="px-4 py-2.5 text-left">Deskripsi / Kegunaan</th>
                    <th className="px-4 py-2.5 text-left">Satuan</th>
                    <SortableHeader
                      label="Stok Sekarang"
                      sortKey="stock_tersedia"
                      align="right"
                      currentSort={sortBy}
                      currentDir={sortDir}
                      onSort={toggleSort}
                    />
                    <SortableHeader label="Expired Date" sortKey="expired_date" currentSort={sortBy} currentDir={sortDir} onSort={toggleSort} />
                    {showActions && <th className="px-4 py-2.5 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={colCount} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        Memuat...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={colCount} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        {search || kategori || stockFilter
                          ? "Tidak ada obat yang cocok dengan filter"
                          : `Belum ada obat di Klinik ${klinik}. Klik "Transaksi" lalu Stock In untuk menambahkan dari master obat.`}
                      </td>
                    </tr>
                  ) : (
                    items.map((item, idx) => {
                      const habis = item.stock_tersedia <= 0;
                      const menipis = !habis && item.buffer_stock > 0 && item.stock_tersedia <= item.buffer_stock;
                      return (
                        <tr key={item.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                          <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">{(page - 1) * pageSize + idx + 1}</td>
                          <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{item.kode}</td>
                          <td className="col-grow px-4 py-2.5">{item.nama}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{item.kategori || "-"}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{item.jenis || "-"}</td>
                          <td className="col-grow px-4 py-2.5 text-xs text-[var(--text-secondary)]">{item.deskripsi || "-"}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{item.satuan}</td>
                          <td
                            className={`px-4 py-2.5 text-right font-medium ${
                              habis ? "text-[var(--accent-red)]" : menipis ? "text-[var(--accent-amber)]" : ""
                            }`}
                            title={habis ? "Stock habis" : menipis ? `Di bawah buffer (${item.buffer_stock})` : ""}
                          >
                            {item.stock_tersedia.toLocaleString("id-ID")}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {/* One line per batch (nearest expiry first) with its quantity; a single
                                batch shows just its date. */}
                            {item.batches.filter((b) => b.expired_date).length === 0 ? (
                              !item.catatan && <span className="text-[var(--text-muted)]">-</span>
                            ) : (
                              item.batches.map((b) => {
                                const st = expiryState(b.expired_date || null);
                                return (
                                  <div
                                    key={b.id}
                                    className={
                                      st === "expired"
                                        ? "text-[var(--accent-red)] font-medium"
                                        : st === "soon"
                                          ? "text-[var(--accent-amber)] font-medium"
                                          : "text-[var(--text-secondary)]"
                                    }
                                    title={st === "expired" ? "Sudah expired" : st === "soon" ? `Expired dalam ≤ ${EXPIRY_WARNING_DAYS} hari` : ""}
                                  >
                                    {b.expired_date ? formatTanggal(b.expired_date) : "Tanpa expired"}
                                    {item.batches.length > 1 && (
                                      <span className="text-xs font-normal text-[var(--text-muted)]"> · {b.qty.toLocaleString("id-ID")}</span>
                                    )}
                                    {st === "expired" && canInput && b.qty > 0 && (
                                      <button
                                        onClick={() =>
                                          openTx(item, {
                                            mode: "OUT",
                                            batchOut: b.expired_date,
                                            buang: true,
                                            qty: b.qty,
                                            note: `Obat expired ${formatTanggal(b.expired_date)} dibuang`,
                                          })
                                        }
                                        title={`Stock Out ${b.qty} ${item.satuan} batch ini sebagai obat expired yang dibuang`}
                                        className="ml-2 align-middle text-[11px] font-medium px-1.5 py-0.5 rounded border border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] text-[var(--accent-red)] hover:opacity-80"
                                      >
                                        Buang
                                      </button>
                                    )}
                                  </div>
                                );
                              })
                            )}
                            {item.catatan && <div className="text-xs text-[var(--accent-amber)] whitespace-normal">{item.catatan}</div>}
                          </td>
                          {showActions && (
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex gap-1.5">
                                {canTx && (
                                  <button
                                    onClick={() => openTx(item)}
                                    title="Stock In / Stock Out / Koreksi obat ini"
                                    className="p-1.5 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
                                  >
                                    <ArrowLeftRight size={14} />
                                  </button>
                                )}
                                {canEdit && (<button
                                  onClick={() => setEditingItem(item)}
                                  title="Edit buffer, catatan & tanggal expired batch"
                                  className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                                >
                                  <Pencil size={14} />
                                </button>)}
                                {canDelete && (<button
                                  onClick={() => setConfirmDelete(item)}
                                  title="Hapus dari klinik ini"
                                  className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                                >
                                  <Trash2 size={14} />
                                </button>)}
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
          scope={{ kind: "klinik", name: klinik }}
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
          scope={{ kind: "klinik", name: klinik }}
          onClose={() => setShowPicker(false)}
          onSelect={(item) => {
            setShowPicker(false);
            setTxPreset(undefined);
            setSelectedItem(item);
          }}
        />
      )}

      {selectedItem && (
        <TransactionModal
          item={selectedItem}
          scope={{ kind: "klinik", name: klinik }}
          preset={txPreset}
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
        <EditKlinikStockModal
          klinik={klinik}
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
          message={`Hapus "${confirmDelete.nama}" dari Klinik ${klinik}? Riwayat transaksinya tetap tersimpan.`}
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
