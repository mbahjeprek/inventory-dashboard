import { useState } from "react";
import { X } from "lucide-react";
import { api, type PickerItem } from "../lib/api";
import { ItemPickerModal } from "./ItemPickerModal";

export function AddGudangStockModal({
  gudang,
  onClose,
  onSuccess,
}: {
  gudang: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [item, setItem] = useState<PickerItem | null>(null);
  const [bufferStock, setBufferStock] = useState(0);
  const [stockTersedia, setStockTersedia] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!item) {
    return <ItemPickerModal onClose={onClose} onSelect={setItem} />;
  }

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await api.addGudangStockItem({
        gudang,
        item_kode: item.kode,
        buffer_stock: bufferStock,
        stock_tersedia: stockTersedia,
      });
      onSuccess();
    } catch (e: any) {
      setError(e?.message?.includes("409") ? "Barang ini sudah ada di gudang ini" : "Gagal menambahkan barang");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Tambah Barang - Gudang {gudang}</h3>
            <p className="text-xs text-[var(--text-secondary)] font-mono">{item.kode}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Nama Barang</label>
            <div className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-[#f8fafc]">
              {item.nama} <span className="text-[var(--text-muted)]">({item.satuan})</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Buffer Stock</label>
              <input
                type="number"
                min={0}
                value={bufferStock}
                step="any"
                onChange={(e) => setBufferStock(parseFloat(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Stock Awal</label>
              <input
                type="number"
                min={0}
                value={stockTersedia}
                step="any"
                onChange={(e) => setStockTersedia(parseFloat(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
          </div>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : "Tambahkan ke Gudang"}
          </button>
        </div>
      </div>
    </div>
  );
}
