import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ArrowDownCircle, ArrowUpCircle, PackagePlus, Wrench, Pencil, Trash2 } from "lucide-react";
import { api, type Item, type Movement } from "../lib/api";
import { TransactionModal } from "../components/TransactionModal";
import { EditItemModal } from "../components/EditItemModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { useDragScroll } from "../hooks/useDragScroll";

const TUJUAN_OPTIONS = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];

const SOURCE_LABEL: Record<Movement["source"], string> = {
  STOCK_IN: "Penerimaan Vendor",
  STOCK_OUT: "Pengeluaran",
  MANUAL: "Input Manual",
};

function formatDate(m: Movement) {
  if (m.source === "MANUAL" && m.date) {
    return new Date(m.date).toLocaleString("id-ID");
  }
  return m.dateDisplay || "-";
}

export function ItemDetailPage() {
  const { id } = useParams();
  const [item, setItem] = useState<Item | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [tujuanFilter, setTujuanFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const { user } = useAuth();
  // Edit / delete buttons follow the account's ticked permissions (Pengguna); the Aksi column shows
  // when it may do either.
  const canEdit = can(user, "gudang.edit") || can(user, "master.barang");
  const canDelete = can(user, "gudang.delete");
  const showActions = canEdit || canDelete;
  // "Transaksi" opens the Stok Masuk / Keluar / Koreksi form: shown when any of those is allowed.
  const canInput = can(user, "gudang.input");
  const canTx = canInput || can(user, "gudang.koreksi");
  const tableScrollRef = useDragScroll<HTMLDivElement>();
  const [confirmDeleteMovement, setConfirmDeleteMovement] = useState<Movement | null>(null);

  const load = () => {
    if (!id) return;
    Promise.all([api.item(parseInt(id)), api.itemMovements(parseInt(id))]).then(([itemRes, movRes]) => {
      setItem(itemRes);
      setMovements(movRes.data);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !item) {
    return <div className="text-[var(--text-secondary)]">Memuat data...</div>;
  }

  const filtered = movements.filter((m) => {
    if (typeFilter && m.type !== typeFilter) return false;
    if (tujuanFilter && m.tujuan !== tujuanFilter) return false;
    return true;
  });

  const totalIn = movements.filter((m) => m.type === "IN").reduce((s, m) => s + m.qty, 0);
  const totalOut = movements.filter((m) => m.type === "OUT").reduce((s, m) => s + m.qty, 0);

  const handleDeleteMovement = async (m: Movement) => {
    if (m.source === "MANUAL") {
      await api.deleteTransaction(m.id);
    } else if (m.source === "STOCK_IN") {
      await api.deleteStockIn(m.id);
    } else {
      await api.deleteStockOut(m.id);
    }
    load();
  };

  return (
    <div className="space-y-4">
      <Link to="/inventory" className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <ArrowLeft size={16} /> Kembali ke Inventory
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">{item.nama}</h1>
          <p className="text-sm text-[var(--text-secondary)] font-mono">{item.kode}</p>
        </div>
        <div className="flex gap-2">
          {showActions && (
            canEdit && (<button
              onClick={() => setShowEditModal(true)}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f8fafc]"
            >
              <Pencil size={16} /> Edit Barang
            </button>)
          )}
          {canTx && (<button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90"
          >
            <PackagePlus size={16} /> Input Transaksi
          </button>)}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Stock Tersedia</div>
          <div className="text-lg font-semibold">{item.stock_tersedia.toLocaleString("id-ID")} {item.satuan}</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Status</div>
          <span
            className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full border ${
              item.keterangan === "AMAN"
                ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]"
                : "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]"
            }`}
          >
            {item.keterangan}
          </span>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Total Stock In</div>
          <div className="text-lg font-semibold text-[var(--accent-green)]">{item.stock_in.toLocaleString("id-ID")}</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Total Stock Out</div>
          <div className="text-lg font-semibold text-[var(--accent-red)]">{item.stock_out.toLocaleString("id-ID")}</div>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
          <div className="text-xs text-[var(--text-secondary)]">Total In / Out</div>
          <div className="text-sm font-semibold">
            <span className="text-[var(--accent-green)]">+{totalIn.toLocaleString("id-ID")}</span>
            {" / "}
            <span className="text-[var(--accent-red)]">-{totalOut.toLocaleString("id-ID")}</span>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Wrench size={15} /> Riwayat Pergerakan Barang
          </h2>
          <div className="flex gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
            >
              <option value="">Semua Tipe</option>
              <option value="IN">Masuk</option>
              <option value="OUT">Keluar</option>
            </select>
            <select
              value={tujuanFilter}
              onChange={(e) => setTujuanFilter(e.target.value)}
              className="text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
            >
              <option value="">Semua Tujuan</option>
              {TUJUAN_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
          <div ref={tableScrollRef} className="overflow-x-auto max-h-[520px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="bg-[#f8fafc] text-left text-[var(--text-secondary)] text-xs uppercase">
                  <th className="px-4 py-2.5 whitespace-nowrap">Tanggal</th>
                  <th className="px-4 py-2.5">Tipe</th>
                  <th className="px-4 py-2.5">Sumber</th>
                  <th className="px-4 py-2.5">Tujuan</th>
                  <th className="px-4 py-2.5 text-right">Qty</th>
                  <th className="px-4 py-2.5">Referensi</th>
                  <th className="px-4 py-2.5">Keterangan</th>
                  {showActions && <th className="px-4 py-2.5 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={showActions ? 8 : 7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                      Belum ada riwayat pergerakan
                    </td>
                  </tr>
                ) : (
                  filtered.map((m, i) => (
                    <tr key={`${m.source}-${m.id}-${i}`} className="border-t border-[var(--border)] hover:bg-[#f8fafc]">
                      <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">{formatDate(m)}</td>
                      <td className="px-4 py-2.5">
                        {m.type === "IN" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-green)]">
                            <ArrowDownCircle size={14} /> Masuk
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-red)]">
                            <ArrowUpCircle size={14} /> Keluar
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{SOURCE_LABEL[m.source]}</td>
                      <td className="px-4 py-2.5">{m.tujuan || <span className="text-[var(--text-muted)]">-</span>}</td>
                      <td
                        className={`px-4 py-2.5 text-right font-medium ${
                          m.type === "IN" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"
                        }`}
                      >
                        {m.type === "IN" ? "+" : "-"}
                        {m.qty} {m.satuan || item.satuan}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">{m.ref || "-"}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] max-w-[220px] truncate" title={m.note || ""}>
                        {m.note || "-"}
                      </td>
                      {showActions && (
                        <td className="px-4 py-2.5 text-right">
                          {canDelete && (<button
                            onClick={() => setConfirmDeleteMovement(m)}
                            title="Hapus riwayat"
                            className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                          >
                            <Trash2 size={14} />
                          </button>)}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <TransactionModal
          item={item}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            load();
          }}
        />
      )}

      {showEditModal && (
        <EditItemModal
          item={item}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            load();
          }}
        />
      )}

      {confirmDeleteMovement && (
        <ConfirmDialog
          message={`Hapus riwayat ini? (${confirmDeleteMovement.type === "IN" ? "+" : "-"}${confirmDeleteMovement.qty} ${
            confirmDeleteMovement.satuan || item.satuan
          } · ${SOURCE_LABEL[confirmDeleteMovement.source]}) Tindakan ini tidak bisa dibatalkan.`}
          onCancel={() => setConfirmDeleteMovement(null)}
          onConfirm={() => {
            handleDeleteMovement(confirmDeleteMovement);
            setConfirmDeleteMovement(null);
          }}
        />
      )}
    </div>
  );
}
