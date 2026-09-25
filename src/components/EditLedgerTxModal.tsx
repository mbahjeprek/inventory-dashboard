import { useState } from "react";
import { X } from "lucide-react";
import { api, errorText, GUDANG_TUJUAN, type LedgerTx, type StockScope } from "../lib/api";
import { KaryawanAutocomplete } from "./KaryawanAutocomplete";

// Superuser correction of one Stock In/Out row of a gudang or klinik; the stock follows the qty change.
export function EditLedgerTxModal({
  scope,
  tx,
  onClose,
  onSuccess,
}: {
  scope: StockScope;
  tx: LedgerTx;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [qty, setQty] = useState(tx.qty);
  const [tujuan, setTujuan] = useState(tx.tujuan ?? "");
  const [penerima, setPenerima] = useState(tx.penerima ?? "");
  const [note, setNote] = useState(tx.note ?? "");
  // Klinik Stock In: the batch (expiry date) the stock went into.
  const klinikIn = scope.kind === "klinik" && tx.type === "IN" && !tx.is_correction;
  const [expired, setExpired] = useState(tx.alloc?.[0]?.exp ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isOut = tx.type === "OUT";

  const submit = async () => {
    if (qty <= 0) {
      setError("Jumlah harus lebih dari 0");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.updateLedgerTx(scope, tx.id, { qty, tujuan, penerima, note, ...(klinikIn ? { expired_date: expired } : {}) });
      onSuccess();
    } catch (e: any) {
      setError(errorText(e, e?.message?.includes("400") ? "Tidak bisa disimpan: stok batch tidak mencukupi atau sudah terpakai" : "Gagal menyimpan perubahan"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Edit {isOut ? "Stock Out" : "Stock In"}</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {tx.kode} · {tx.nama}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jumlah ({tx.satuan})</label>
            <input
              type="number"
              min={1}
              value={qty}
              step={scope.kind === "gudang" ? "any" : 1}
              onChange={(e) => {
                // Gudang qty may be decimal; Klinik is a whole number.
                const v = scope.kind === "gudang" ? Math.round((parseFloat(e.target.value) || 0) * 1000) / 1000 : parseInt(e.target.value) || 0;
                setQty(v);
              }}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
            {qty !== tx.qty && (
              <p className="text-xs mt-1 text-[var(--text-muted)]">
                Stok akan {(isOut ? tx.qty - qty : qty - tx.qty) > 0 ? "bertambah" : "berkurang"}{" "}
                {Math.abs(qty - tx.qty)} {tx.satuan}
              </p>
            )}
          </div>

          {klinikIn && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tanggal Expired (batch)</label>
              <input type="date" value={expired} onChange={(e) => setExpired(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
            </div>
          )}

          {isOut && scope.kind === "gudang" && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tujuan / Konsumen</label>
              <select value={tujuan} onChange={(e) => setTujuan(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2">
                <option value="">- Tidak ditentukan -</option>
                {/* A gudang only supplies its own estate (+ sub-estates); an older row keeps the tujuan it had. */}
                {[...new Set([...(GUDANG_TUJUAN[scope.name] ?? [scope.name]), tx.tujuan].filter(Boolean))].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">
              {isOut ? (scope.kind === "klinik" ? "Pasien / Penerima" : "Penerima / Pengambil") : "Diterima Oleh"}
            </label>
            <KaryawanAutocomplete estate={scope.name} value={penerima} onChange={setPenerima} />
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Catatan</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
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
