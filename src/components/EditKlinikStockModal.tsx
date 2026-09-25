import { useState } from "react";
import { X } from "lucide-react";
import { api, type KlinikStockItem } from "../lib/api";

const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "tanpa tanggal");

// Buffer and note of one clinic stock row, plus fixing a batch's expiry date when it was entered
// wrong. Quantities change through the Transaksi form (Stock In / Stock Out / Koreksi) so they
// always leave a history row.
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
  const [catatan, setCatatan] = useState(item.catatan ?? "");
  const [dates, setDates] = useState<Record<number, string>>(() => Object.fromEntries(item.batches.map((b) => [b.id, b.expired_date])));
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
      await api.updateKlinikStock(item.id, { buffer_stock: bufferStock, catatan });
      // Changed expiry dates, one batch at a time (a batch moved onto an existing date merges).
      for (const b of item.batches) {
        if ((dates[b.id] ?? "") !== b.expired_date) await api.updateKlinikBatch(b.id, dates[b.id] ?? "");
      }
      onSuccess();
    } catch {
      setError("Gagal menyimpan perubahan");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl max-h-[92vh] flex flex-col">
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

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--text-secondary)]">Stock Tersedia</span>
            <span className="font-semibold">
              {item.stock_tersedia.toLocaleString("id-ID")} {item.satuan}
            </span>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Buffer Stock</label>
            <input type="number" min={0} value={bufferStock} onChange={(e) => setBufferStock(parseInt(e.target.value) || 0)} className={inputCls} />
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Catatan</label>
            <input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="cth. Simpan di kulkas" className={inputCls} />
          </div>

          {item.batches.length > 0 && (
            <div>
              <div className="text-xs text-[var(--text-secondary)] mb-1">Tanggal expired per batch (ubah kalau salah input)</div>
              <div className="border border-[var(--border)] rounded-md divide-y divide-[var(--border)]">
                {item.batches.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="date"
                      value={dates[b.id] ?? ""}
                      onChange={(e) => setDates((d) => ({ ...d, [b.id]: e.target.value }))}
                      className="flex-1 text-sm rounded-md border border-[var(--border)] px-2 py-1.5"
                    />
                    <span className="text-sm whitespace-nowrap">
                      {b.qty.toLocaleString("id-ID")} {item.satuan}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Kosongkan tanggal untuk barang tanpa expired. Batch yang dipindah ke tanggal yang sudah ada akan digabung
                {item.batches.length > 1 ? ` (sekarang ${item.batches.map((b) => tgl(b.expired_date)).join(", ")})` : ""}.
              </p>
            </div>
          )}

          <p className="text-xs text-[var(--text-muted)]">Jumlah stok diubah lewat tombol Transaksi (Stock In / Stock Out / Koreksi per batch).</p>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-[var(--border)]">
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
