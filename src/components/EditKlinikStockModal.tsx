import { useState } from "react";
import { X } from "lucide-react";
import { api, type KlinikStockItem } from "../lib/api";

// Buffer, expired date and note of one clinic stock row. The quantity is changed through the
// Transaksi form (Stock In / Stock Out / Koreksi) so it always leaves a history row.
export function EditKlinikStockModal({
  item,
  onClose,
  onSuccess,
}: {
  item: KlinikStockItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [bufferStock, setBufferStock] = useState(item.buffer_stock);
  const [expiredDate, setExpiredDate] = useState(item.expired_date ?? "");
  const [catatan, setCatatan] = useState(item.catatan ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (bufferStock < 0) {
      setError("Buffer tidak boleh negatif");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.updateKlinikStock(item.id, { buffer_stock: bufferStock, expired_date: expiredDate, catatan });
      onSuccess();
    } catch {
      setError("Gagal menyimpan perubahan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Edit Stok Klinik</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {item.kode} · {item.nama}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--text-secondary)]">Stock Tersedia</span>
            <span className="font-semibold">
              {item.stock_tersedia.toLocaleString("id-ID")} {item.satuan}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Buffer Stock</label>
              <input
                type="number"
                min={0}
                value={bufferStock}
                onChange={(e) => setBufferStock(parseInt(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tanggal Expired</label>
              <input
                type="date"
                value={expiredDate}
                onChange={(e) => setExpiredDate(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Catatan</label>
            <input
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="cth. Batch 2026-08, simpan di kulkas"
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <p className="text-xs text-[var(--text-muted)]">Jumlah stok diubah lewat tombol Transaksi (Stock In / Stock Out / Koreksi).</p>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}
