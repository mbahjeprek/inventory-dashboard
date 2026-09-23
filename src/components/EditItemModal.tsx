import { useState } from "react";
import { X } from "lucide-react";
import { api, type Item } from "../lib/api";

export function EditItemModal({
  item,
  onClose,
  onSuccess,
}: {
  item: Item;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [nama, setNama] = useState(item.nama);
  const [satuan, setSatuan] = useState(item.satuan);
  const [bufferStock, setBufferStock] = useState(item.buffer_stock);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!nama.trim()) {
      setError("Nama barang tidak boleh kosong");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.updateItem(item.id, { nama, satuan, buffer_stock: bufferStock });
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
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Edit Data Barang</h3>
            <p className="text-xs text-[var(--text-secondary)] font-mono">{item.kode}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Nama Barang</label>
            <input
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Satuan</label>
              <input
                value={satuan}
                onChange={(e) => setSatuan(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
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
          </div>

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
