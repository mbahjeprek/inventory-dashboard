import { useState } from "react";
import { X } from "lucide-react";
import { api, type Transaction } from "../lib/api";
import { KaryawanAutocomplete } from "./KaryawanAutocomplete";

const TUJUAN_OPTIONS = ["NILAM", "ZAMRUD", "FIRUS"];

export function EditTransactionModal({
  transaction,
  onClose,
  onSuccess,
}: {
  transaction: Transaction;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [tujuan, setTujuan] = useState(transaction.tujuan || "");
  const [type, setType] = useState<"IN" | "OUT">(transaction.type);
  const [qty, setQty] = useState(transaction.qty);
  const [note, setNote] = useState(transaction.note || "");
  const [penerima, setPenerima] = useState(transaction.penerima || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (qty <= 0) {
      setError("Jumlah harus lebih dari 0");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.updateTransaction(transaction.id, { tujuan, type, qty, note, penerima });
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
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Edit Transaksi</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {transaction.kode} · {transaction.nama}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setType("IN")}
              className={`py-2 rounded-md text-sm font-medium border ${
                type === "IN"
                  ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              Stock In (Masuk)
            </button>
            <button
              onClick={() => setType("OUT")}
              className={`py-2 rounded-md text-sm font-medium border ${
                type === "OUT"
                  ? "bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-[var(--accent-red-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              Stock Out (Keluar)
            </button>
          </div>

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

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Penerima / Pengambil (opsional)</label>
            <KaryawanAutocomplete value={penerima} onChange={setPenerima} />
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jumlah</label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(parseInt(e.target.value) || 0)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Catatan (opsional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
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
