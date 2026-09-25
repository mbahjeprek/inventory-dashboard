import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { api, type KlinikStockItem } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";

const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "tanpa tanggal");

// Buffer and note of one clinic stock row, fixing a batch's expiry date when it was entered wrong,
// and adding batches by hand. A new batch adds stock, so it is booked as a Koreksi (found in a
// physical count) or a Stok Masuk (just arrived) and always leaves a history row.
export function EditKlinikStockModal({
  klinik,
  item,
  onClose,
  onSuccess,
}: {
  klinik: string;
  item: KlinikStockItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [bufferStock, setBufferStock] = useState(item.buffer_stock);
  const [catatan, setCatatan] = useState(item.catatan ?? "");
  const [dates, setDates] = useState<Record<number, string>>(() => Object.fromEntries(item.batches.map((b) => [b.id, b.expired_date])));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { user } = useAuth();
  const canKoreksi = can(user, "klinik.koreksi");
  const canInput = can(user, "klinik.input");
  const [newBatches, setNewBatches] = useState<{ exp: string; qty: number }[]>([]);
  const [newAs, setNewAs] = useState<"KOREKSI" | "IN">(canKoreksi ? "KOREKSI" : "IN");
  const qtyOf = (exp: string) => item.batches.find((b) => b.expired_date === exp)?.qty ?? 0;

  const submit = async () => {
    if (bufferStock < 0) {
      setError("Buffer tidak boleh negatif");
      return;
    }
    const adds = newBatches.filter((b) => b.qty > 0);
    if (newBatches.some((b) => b.qty < 0 || !Number.isInteger(b.qty))) {
      setError("Jumlah batch baru harus bilangan bulat positif");
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
      // New batches (a date that already has a batch adds to it).
      const note = "Tambah batch manual";
      for (const b of adds) {
        if (newAs === "KOREKSI") {
          const current = (await api.klinikBatches(klinik, item.kode)).find((x) => x.expired_date === b.exp)?.qty ?? 0;
          await api.klinikStockCorrection({ klinik, obat_kode: item.kode, actual_qty: current + b.qty, note, expired_date: b.exp });
        } else {
          await api.createKlinikTransaction({ klinik, obat_kode: item.kode, type: "IN", qty: b.qty, note, expired_date: b.exp || undefined });
        }
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

          {(canKoreksi || canInput) && (
            <div>
              {newBatches.length > 0 && (
                <div className="space-y-2 mb-2">
                  <div className="text-xs text-[var(--text-secondary)]">Batch baru</div>
                  {newBatches.map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="date"
                        value={b.exp}
                        onChange={(e) => setNewBatches((cur) => cur.map((x, j) => (j === i ? { ...x, exp: e.target.value } : x)))}
                        className="flex-1 text-sm rounded-md border border-[var(--border)] px-2 py-1.5"
                      />
                      <input
                        type="number"
                        min={1}
                        value={b.qty || ""}
                        placeholder="Jumlah"
                        onChange={(e) => setNewBatches((cur) => cur.map((x, j) => (j === i ? { ...x, qty: parseInt(e.target.value) || 0 } : x)))}
                        className="w-24 text-sm rounded-md border border-[var(--border)] px-2 py-1.5"
                      />
                      <button
                        type="button"
                        onClick={() => setNewBatches((cur) => cur.filter((_, j) => j !== i))}
                        title="Batal tambah batch ini"
                        className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {newBatches.some((b) => b.qty > 0 && qtyOf(b.exp) > 0) && (
                    <p className="text-[11px] text-[var(--accent-amber)]">Tanggal yang sudah punya batch akan ditambahkan ke batch tersebut.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
                    <span>Dicatat sebagai:</span>
                    {canKoreksi && (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="newAs" checked={newAs === "KOREKSI"} onChange={() => setNewAs("KOREKSI")} />
                        Koreksi (hasil hitung fisik)
                      </label>
                    )}
                    {canInput && (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="newAs" checked={newAs === "IN"} onChange={() => setNewAs("IN")} />
                        Stok Masuk (barang datang)
                      </label>
                    )}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setNewBatches((cur) => [...cur, { exp: "", qty: 0 }])}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)]"
              >
                <Plus size={14} /> Tambah batch
              </button>
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
