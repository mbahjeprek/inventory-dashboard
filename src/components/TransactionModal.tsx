import { useEffect, useState } from "react";
import { X, ClipboardCheck } from "lucide-react";
import { api, type Item } from "../lib/api";
import { KaryawanAutocomplete } from "./KaryawanAutocomplete";

const TUJUAN_OPTIONS = ["NILAM", "ZAMRUD", "FIRUS"];

type Mode = "IN" | "OUT" | "KOREKSI";

export function TransactionModal({
  item: initialItem,
  onClose,
  onSuccess,
}: {
  item: Item;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [item, setItem] = useState(initialItem);
  const [tujuan, setTujuan] = useState("");
  const [penerima, setPenerima] = useState("");
  const [mode, setMode] = useState<Mode>("IN");
  const [qty, setQty] = useState(1);
  const [actualQty, setActualQty] = useState(0);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.item(initialItem.id).then((full) => setItem(full));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItem.id]);

  useEffect(() => {
    if (mode === "KOREKSI") setActualQty(item.stock_tersedia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const selisih = actualQty - item.stock_tersedia;

  const submit = async () => {
    setError("");

    if (mode === "KOREKSI") {
      if (actualQty < 0) {
        setError("Stok aktual tidak boleh negatif");
        return;
      }
      setSubmitting(true);
      try {
        await api.stockCorrection({ item_id: item.id, actual_qty: actualQty, note });
        onSuccess();
      } catch {
        setError("Gagal menyimpan koreksi stok");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (qty <= 0) {
      setError("Jumlah harus lebih dari 0");
      return;
    }
    if (mode === "OUT" && qty > item.stock_tersedia) {
      setError(`Stock tersedia hanya ${item.stock_tersedia} ${item.satuan}`);
      return;
    }
    setSubmitting(true);
    try {
      await api.createTransaction({ item_id: item.id, tujuan, type: mode, qty, note, penerima });
      onSuccess();
    } catch {
      setError("Gagal menyimpan transaksi");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Input Transaksi Stock</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {item.kode} · {item.nama}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 bg-[#f8fafc] border-b border-[var(--border)] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">Stock Tersedia</span>
            <span className="text-lg font-semibold text-[var(--text-primary)]">
              {item.stock_tersedia.toLocaleString("id-ID")} {item.satuan}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${
                item.keterangan === "AMAN"
                  ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]"
                  : "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]"
              }`}
            >
              {item.keterangan}
            </span>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setMode("IN")}
              className={`py-2 rounded-md text-xs font-medium border ${
                mode === "IN"
                  ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              Stock In
            </button>
            <button
              onClick={() => setMode("OUT")}
              className={`py-2 rounded-md text-xs font-medium border ${
                mode === "OUT"
                  ? "bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-[var(--accent-red-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              Stock Out
            </button>
            <button
              onClick={() => setMode("KOREKSI")}
              className={`py-2 rounded-md text-xs font-medium border flex items-center justify-center gap-1 ${
                mode === "KOREKSI"
                  ? "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              <ClipboardCheck size={13} /> Koreksi
            </button>
          </div>

          {mode === "OUT" && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tujuan / Konsumen (opsional)</label>
              <select
                value={tujuan}
                onChange={(e) => setTujuan(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              >
                <option value="">- Tidak ditentukan -</option>
                {TUJUAN_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode !== "KOREKSI" && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">
                {mode === "OUT" ? "Penerima / Pengambil (opsional)" : "Diterima Oleh (opsional)"}
              </label>
              <KaryawanAutocomplete value={penerima} onChange={setPenerima} />
            </div>
          )}

          {mode === "KOREKSI" ? (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">
                Stok Aktual Hasil Hitung Fisik ({item.satuan})
              </label>
              <input
                type="number"
                min={0}
                value={actualQty}
                onChange={(e) => setActualQty(parseInt(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
              <p
                className={`text-xs mt-1.5 font-medium ${
                  selisih === 0
                    ? "text-[var(--text-muted)]"
                    : selisih > 0
                    ? "text-[var(--accent-green)]"
                    : "text-[var(--accent-red)]"
                }`}
              >
                {selisih === 0
                  ? "Sesuai, tidak ada selisih"
                  : selisih > 0
                  ? `Selisih: +${selisih} (stok bertambah)`
                  : `Selisih: ${selisih} (stok berkurang)`}
              </p>
            </div>
          ) : (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jumlah ({item.satuan})</label>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(parseInt(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Catatan (opsional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={mode === "KOREKSI" ? "cth. Hasil stock opname bulanan" : "cth. Penerimaan dari supplier"}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : mode === "KOREKSI" ? "Simpan Koreksi Stok" : "Simpan Transaksi"}
          </button>
        </div>
      </div>
    </div>
  );
}
