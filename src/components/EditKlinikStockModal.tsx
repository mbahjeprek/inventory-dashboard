import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { api, errorText, type KlinikStockItem } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";

// Buffer, note and the stock per expiry date of one clinic stock row. The rows are simply what is on
// the shelf: fixing a wrong date, splitting a batch that turned out to have several dates or merging
// them keeps the total and books nothing; a different total is saved as a Koreksi Stok (with reason).
// Stock that just arrived goes through the Transaksi button (Stock In) instead.
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
  const [rows, setRows] = useState(() => item.batches.map((b) => ({ exp: b.expired_date, qty: b.qty })));
  const [alasan, setAlasan] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { user } = useAuth();
  const canKoreksi = can(user, "klinik.koreksi");

  const total = rows.reduce((n, r) => n + r.qty, 0);
  const selisih = total - item.stock_tersedia;
  const key = (list: { exp: string; qty: number }[]) =>
    list.filter((r) => r.qty > 0).map((r) => `${r.exp}:${r.qty}`).sort().join(",");
  const batchesChanged = key(rows) !== key(item.batches.map((b) => ({ exp: b.expired_date, qty: b.qty })));
  const setRow = (i: number, patch: Partial<{ exp: string; qty: number }>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    setError("");
    if (bufferStock < 0) return setError("Buffer tidak boleh negatif");
    if (rows.some((r) => r.qty < 0 || !Number.isInteger(r.qty))) return setError("Jumlah harus bilangan bulat positif");
    if (selisih !== 0 && !canKoreksi) return setError(`Total harus tetap ${item.stock_tersedia}. Akun ini tidak punya izin Koreksi Stok.`);
    if (selisih !== 0 && !alasan.trim()) return setError("Isi alasan koreksi");
    setSubmitting(true);
    try {
      await api.updateKlinikStock(item.id, { buffer_stock: bufferStock, catatan });
      if (batchesChanged) await api.setKlinikBatches(item.id, rows.map((r) => ({ expired_date: r.exp, qty: r.qty })), alasan.trim());
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan perubahan"));
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Buffer Stock</label>
              <input type="number" min={0} value={bufferStock} onChange={(e) => setBufferStock(parseInt(e.target.value) || 0)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Catatan</label>
              <input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="cth. Simpan di kulkas" className={inputCls} />
            </div>
          </div>

          <div>
            <div className="text-xs text-[var(--text-secondary)] mb-1">Stok per tanggal expired</div>
            <div className="border border-[var(--border)] rounded-md">
              <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-muted)] border-b border-[var(--border)] bg-[#f8fafc]">
                <span className="flex-1">Tanggal expired</span>
                <span className="w-20">Jumlah</span>
                <span className="w-[30px]" />
              </div>
              <div className="divide-y divide-[var(--border)]">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2">
                    <input
                      type="date"
                      value={r.exp}
                      onChange={(e) => setRow(i, { exp: e.target.value })}
                      className="flex-1 min-w-0 text-sm rounded-md border border-[var(--border)] px-2 py-1.5"
                    />
                    <input
                      type="number"
                      min={0}
                      value={r.qty || ""}
                      placeholder="0"
                      onChange={(e) => setRow(i, { qty: parseInt(e.target.value) || 0 })}
                      className="w-20 text-sm rounded-md border border-[var(--border)] px-2 py-1.5"
                    />
                    <button
                      type="button"
                      onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}
                      title="Hapus baris"
                      className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setRows((cur) => [...cur, { exp: "", qty: 0 }])}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-blue)] hover:underline"
                >
                  <Plus size={14} /> Tambah tanggal expired
                </button>
                <span className="text-sm">
                  Total <b>{total.toLocaleString("id-ID")}</b> {item.satuan}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              Isi sesuai barang di rak. Tanggal dikosongkan untuk barang tanpa expired.
            </p>
          </div>

          {batchesChanged && selisih === 0 && (
            <p className="text-xs rounded-md px-3 py-2 bg-[var(--accent-green-bg)] text-[var(--accent-green)]">
              Total tetap {item.stock_tersedia.toLocaleString("id-ID")}, hanya rincian tanggal expired yang diubah.
            </p>
          )}

          {selisih !== 0 && (
            <div className="rounded-md px-3 py-2 bg-[var(--accent-amber-bg)] border border-[var(--accent-amber-border)] space-y-2">
              <p className="text-xs text-[var(--accent-amber)]">
                Total {total.toLocaleString("id-ID")}, tercatat {item.stock_tersedia.toLocaleString("id-ID")} (selisih {selisih > 0 ? "+" : ""}
                {selisih.toLocaleString("id-ID")}). Disimpan sebagai <b>Koreksi Stok</b>.
                {selisih > 0 && " Kalau barang baru datang, pakai Stock In di tombol Transaksi."}
              </p>
              {canKoreksi && (
                <input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Alasan koreksi, cth. hasil hitung fisik" className={`${inputCls} bg-white`} />
              )}
            </div>
          )}

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
