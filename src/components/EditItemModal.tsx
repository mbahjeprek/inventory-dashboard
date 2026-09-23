import { useState } from "react";
import { X } from "lucide-react";
import { api, type Item } from "../lib/api";

export function EditItemModal({
  item,
  onClose,
  onSuccess,
}: {
  item: Item | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!item;
  const [kode, setKode] = useState(item?.kode ?? "");
  const [nama, setNama] = useState(item?.nama ?? "");
  const [satuan, setSatuan] = useState(item?.satuan ?? "");
  const [bufferStock, setBufferStock] = useState(item?.buffer_stock ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!isEdit && !kode.trim()) {
      setError("Kode barang tidak boleh kosong");
      return;
    }
    if (!nama.trim()) {
      setError("Nama barang tidak boleh kosong");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (isEdit) {
        await api.updateItem(item.id, { nama, satuan, buffer_stock: bufferStock });
      } else {
        await api.createItem({ kode, nama, satuan, buffer_stock: bufferStock });
      }
      onSuccess();
    } catch (e: any) {
      setError(e?.message?.includes("409") ? "Kode sudah digunakan barang lain" : "Gagal menyimpan perubahan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">
              {isEdit ? "Edit Data Barang" : "Tambah Barang"}
            </h3>
            {isEdit && <p className="text-xs text-[var(--text-secondary)] font-mono">{item.kode}</p>}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!isEdit && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Kode Barang</label>
              <input
                value={kode}
                onChange={(e) => setKode(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
          )}

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
            {submitting ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Barang"}
          </button>
        </div>
      </div>
    </div>
  );
}
