import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, ArrowDownCircle, Pencil, Trash2 } from "lucide-react";
import { api, type StockInRecord } from "../lib/api";
import { EditStockInModal } from "../components/EditStockInModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { ExportButtons } from "../components/ExportButtons";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { useDragScroll } from "../hooks/useDragScroll";
import { EvidenceLink } from "../components/EvidenceInput";

const TUJUAN_OPTIONS = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];

// Nilam's gudang Stock In history, shown as a tab of Inventory Gudang - Nilam
// (`embedded` drops the page title there).
export function StockInPage({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState<StockInRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [qtySum, setQtySum] = useState(0);
  const [search, setSearch] = useState("");
  const [tujuan, setTujuan] = useState("");
  const [vendor, setVendor] = useState("");
  const [vendors, setVendors] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  // Edit / delete buttons follow the account's ticked permissions (Pengguna); the Aksi column shows
  // when it may do either.
  const canEdit = can(user, "gudang.edit");
  const canDelete = can(user, "gudang.delete");
  const showActions = canEdit || canDelete;
  const [editing, setEditing] = useState<StockInRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StockInRecord | null>(null);
  const tableScrollRef = useDragScroll<HTMLDivElement>();
  const pageSize = 25;

  const load = () => {
    setLoading(true);
    api.stockIn({ search, tujuan, vendor, dateFrom, dateTo, page, pageSize }).then((res) => {
      setItems(res.data);
      setTotal(res.total);
      setQtySum(res.qtySum);
      setLoading(false);
    });
  };

  useEffect(() => {
    api.stockInVendors().then(setVendors);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, tujuan, vendor, dateFrom, dateTo]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.stockIn({ search, tujuan, vendor, dateFrom, dateTo, page: p, pageSize: ps }));
    const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
    const active = [
      search && `Cari: "${search}"`,
      tujuan && `Tujuan: ${tujuan}`,
      vendor && `Vendor: ${vendor}`,
      (dateFrom || dateTo) && `Tanggal: ${tgl(dateFrom) || "awal"} - ${tgl(dateTo) || "akhir"}`,
    ].filter(Boolean);
    return {
      title: "Stock In Gudang - Nilam",
      subtitle: active.length ? [`Filter: ${active.join(" · ")}`] : [],
      landscape: true,
      columns: [
        { label: "Tgl Terima", nowrap: true },
        { label: "Kode", nowrap: true },
        { label: "Nama Barang" },
        { label: "Vendor" },
        { label: "PO / PR" },
        { label: "Qty", align: "right" },
        { label: "Satuan" },
        { label: "Tujuan" },
        { label: "Keterangan" },
      ],
      rows: all.map((r) => [r.tanggal_terima, r.kode, r.nama, r.nama_vendor, r.po_in_akss || r.no_pr, r.qty, r.satuan, r.tujuan, r.keterangan]),
    };
  };

  const handleDelete = async (r: StockInRecord) => {
    await api.deleteStockIn(r.id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {!embedded && (
            <h1 className="text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ArrowDownCircle size={20} className="text-[var(--accent-green)]" /> Stock In
            </h1>
          )}
          <p className="text-sm text-[var(--text-secondary)]">
            {total.toLocaleString("id-ID")} transaksi · total {qtySum.toLocaleString("id-ID")} unit masuk
          </p>
        </div>
        <ExportButtons total={total} buildReport={buildReport} fileName="stock-in-gudang-nilam" />
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari barang, vendor, tujuan, no. PR/PO, atau keterangan..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue-border)]"
          />
        </div>

        <select
          value={tujuan}
          onChange={(e) => {
            setTujuan(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-md border border-[var(--border)] px-3 py-2"
        >
          <option value="">Semua Tujuan</option>
          {TUJUAN_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>

        <select
          value={vendor}
          onChange={(e) => {
            setVendor(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-md border border-[var(--border)] px-3 py-2 max-w-[200px]"
        >
          <option value="">Semua Vendor</option>
          {vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-md border border-[var(--border)] px-3 py-2"
        />
        <span className="text-[var(--text-muted)] text-sm">-</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className="text-sm rounded-md border border-[var(--border)] px-3 py-2"
        />
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table className="grid-table w-full text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-left text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-4 py-2.5 whitespace-nowrap">Tgl Terima</th>
                <th className="px-4 py-2.5">Kode</th>
                <th className="px-4 py-2.5">Nama Barang</th>
                <th className="px-4 py-2.5">Vendor</th>
                <th className="px-4 py-2.5">PO / PR</th>
                <th className="px-4 py-2.5 text-right">Qty</th>
                <th className="px-4 py-2.5">Tujuan</th>
                <th className="px-4 py-2.5">Keterangan</th>
                <th className="px-4 py-2.5 text-center">Bukti</th>
                {showActions && <th className="px-4 py-2.5 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={showActions ? 10 : 9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={showActions ? 10 : 9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada data
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{r.tanggal_terima || "-"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.kode}</td>
                    <td className="px-4 py-2.5">{r.nama}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.nama_vendor === "-" ? "-" : r.nama_vendor}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs">{r.po_in_akss || r.no_pr || "-"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--accent-green)]">+{r.qty} {r.satuan}</td>
                    <td className="px-4 py-2.5">{r.tujuan || <span className="text-[var(--text-muted)]">-</span>}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs max-w-[220px] truncate" title={r.keterangan}>
                      {r.keterangan || "-"}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      {r.evidence_id ? <EvidenceLink id={r.evidence_id} label="Lihat" /> : <span className="text-[var(--text-muted)]">-</span>}
                    </td>
                    {showActions && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex gap-1.5">
                          {canEdit && (<button
                            onClick={() => setEditing(r)}
                            title="Edit"
                            className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                          >
                            <Pencil size={14} />
                          </button>)}
                          {canDelete && (<button
                            onClick={() => setConfirmDelete(r)}
                            title="Hapus"
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

      {editing && (
        <EditStockInModal
          record={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Hapus record stock in ${confirmDelete.kode} - ${confirmDelete.nama} (${confirmDelete.qty})? Tindakan ini tidak bisa dibatalkan.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            handleDelete(confirmDelete);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}
