import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, ArrowUpCircle, Pencil, Trash2 } from "lucide-react";
import { api, errorText, type StockOutRecord } from "../lib/api";
import { EditStockOutModal } from "../components/EditStockOutModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAuth } from "../context/AuthContext";
import { can, canEditRow } from "../lib/access";
import { ExportButtons } from "../components/ExportButtons";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { EvidenceLink } from "../components/EvidenceInput";
import { tanggalWaktu } from "../lib/datetime";

const TUJUAN_OPTIONS = ["NILAM", "FIRUS", "ZAMRUD", "KNS", "WJA"];

// Nilam's gudang Stock Out history, shown as a tab of Inventory Gudang - Nilam
// (`embedded` drops the page title there).
export function StockOutPage({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState<StockOutRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [qtySum, setQtySum] = useState(0);
  const [search, setSearch] = useState("");
  const [tujuan, setTujuan] = useState("");
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
  const [editing, setEditing] = useState<StockOutRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StockOutRecord | null>(null);
  const pageSize = 25;

  const load = () => {
    setLoading(true);
    api.stockOut({ search, tujuan, dateFrom, dateTo, page, pageSize }).then((res) => {
      setItems(res.data);
      setTotal(res.total);
      setQtySum(res.qtySum);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, tujuan, dateFrom, dateTo]);

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
    const all = await fetchAllRows((p, ps) => api.stockOut({ search, tujuan, dateFrom, dateTo, page: p, pageSize: ps }));
    const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
    const active = [
      search && `Cari: "${search}"`,
      tujuan && `Tujuan: ${tujuan}`,
      (dateFrom || dateTo) && `Tanggal: ${tgl(dateFrom) || "awal"} - ${tgl(dateTo) || "akhir"}`,
    ].filter(Boolean);
    return {
      title: "Stock Out Gudang - Nilam",
      subtitle: active.length ? [`Filter: ${active.join(" · ")}`] : [],
      landscape: true,
      columns: [
        { label: "Tgl Keluar", nowrap: true },
        { label: "Kode", nowrap: true },
        { label: "Nama Barang" },
        { label: "Penerima" },
        { label: "Qty", align: "right" },
        { label: "Satuan" },
        { label: "Tujuan" },
        { label: "Keterangan" },
      ],
      rows: all.map((r) => [tanggalWaktu(r.tanggal_keluar_iso, r.input_at ?? r.created_at, r.tanggal_keluar), r.kode, r.nama, r.penerima, r.qty, r.satuan, r.tujuan, r.keterangan]),
    };
  };

  const handleDelete = async (r: StockOutRecord) => {
    try {
      await api.deleteStockOut(r.id);
    } catch (e) {
      // e.g. bulan lalu (supervisor only) or a transfer already used there: say why instead of leaving the row silently.
      window.alert(errorText(e, "Gagal menghapus stock out", true));
    }
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <div>
          {!embedded && (
            <h1 className="text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ArrowUpCircle size={20} className="text-[var(--accent-red)]" /> Stock Out
            </h1>
          )}
          <p className="text-sm text-[var(--text-secondary)]">
            {total.toLocaleString("id-ID")} transaksi · total {qtySum.toLocaleString("id-ID")} unit keluar
          </p>
        </div>
        <ExportButtons total={total} buildReport={buildReport} fileName="stock-out-gudang-nilam" />
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari barang, penerima, tujuan, divisi, atau keterangan..."
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

        {/* Tanggal dari - sampai: side by side, half the width each on a phone */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="text-sm rounded-md border border-[var(--border)] px-3 py-2 flex-1 min-w-0 sm:flex-none"
          />
          <span className="text-[var(--text-muted)] text-sm">-</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="text-sm rounded-md border border-[var(--border)] px-3 py-2 flex-1 min-w-0 sm:flex-none"
          />
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="table-scroll">
          <table className="grid-table data-table text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-left text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-4 py-2.5 whitespace-nowrap">Tgl Keluar</th>
                <th className="px-4 py-2.5">Kode</th>
                <th className="px-4 py-2.5">Nama Barang</th>
                <th className="px-4 py-2.5">Penerima</th>
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
                  <td colSpan={showActions ? 9 : 8} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Memuat...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={showActions ? 9 : 8} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada data
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{tanggalWaktu(r.tanggal_keluar_iso, r.input_at ?? r.created_at, r.tanggal_keluar)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.kode}</td>
                    <td className="col-grow px-4 py-2.5">{r.nama}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.penerima || "-"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--accent-red)] whitespace-nowrap">
                      -{r.qty} {r.satuan}
                      {r.saldo !== null && r.saldo !== undefined && (
                        <div className="text-[11px] font-normal text-[var(--text-muted)]" title="Stok setelah transaksi ini">stok {r.saldo.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {r.satuan}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{r.tujuan || <span className="text-[var(--text-muted)]">-</span>}</td>
                    <td className="col-grow px-4 py-2.5 text-[var(--text-secondary)] text-xs whitespace-normal break-words" title={r.keterangan}>
                      {r.keterangan || "-"}
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      {r.evidence_id ? <EvidenceLink id={r.evidence_id} label="Lihat" /> : <span className="text-[var(--text-muted)]">-</span>}
                    </td>
                    {showActions && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex gap-1.5">
                          {canEditRow(user, "GUDANG", r) && (<button
                            onClick={() => setEditing(r)}
                            title="Edit"
                            className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]"
                          >
                            <Pencil size={14} />
                          </button>)}
                          {canEditRow(user, "GUDANG", r, "delete") && (<button
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
        <EditStockOutModal
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
          message={`Hapus record stock out ${confirmDelete.kode} - ${confirmDelete.nama} (${confirmDelete.qty})? Tindakan ini tidak bisa dibatalkan.`}
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
