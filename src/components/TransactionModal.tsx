import { useEffect, useState } from "react";
import { X, ClipboardCheck } from "lucide-react";
import { api, GUDANG_TUJUAN, type PickerItem, type StockScope } from "../lib/api";
import { KaryawanAutocomplete } from "./KaryawanAutocomplete";
import { useAuth } from "../context/AuthContext";

// Gudang Nilam supplies every estate (a Stok Keluar to another estate becomes Stok Masuk in that
// estate's gudang); the other gudang only supply their own estate and its sub-estates.
const NILAM_TUJUAN = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];

type Mode = "IN" | "OUT" | "KOREKSI";

// One Stock In / Stock Out / Koreksi form for every estate. Without `scope` it works on Nilam's
// gudang stock (items); with a scope on that gudang's or klinik's own stock.
export function TransactionModal({
  item: initialItem,
  scope,
  onClose,
  onSuccess,
}: {
  item: PickerItem;
  scope?: StockScope;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isKlinik = scope?.kind === "klinik";
  const { user } = useAuth();
  // Stock corrections are superuser-only (see requireSuperuser on /api/stock-correction).
  const isSuperuser = user?.role === "superuser";
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
    // The picker row already carries the scope's stock; Nilam refreshes it from the item.
    if (!scope) api.item(initialItem.id).then((full) => setItem(full));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItem.id]);

  useEffect(() => {
    if (mode === "KOREKSI") setActualQty(item.stock_tersedia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Gudang KNS/WJA/Zamrud/Firus take decimal qty (e.g. 2,5 KG); Nilam and Klinik whole numbers.
  const decimal = scope?.kind === "gudang";
  const parseQty = (v: string) => (decimal ? Math.round((parseFloat(v) || 0) * 1000) / 1000 : parseInt(v) || 0);
  const selisih = Math.round((actualQty - item.stock_tersedia) * 1000) / 1000;

  const submit = async () => {
    setError("");

    if (mode === "KOREKSI") {
      if (actualQty < 0) {
        setError("Stok aktual tidak boleh negatif");
        return;
      }
      setSubmitting(true);
      try {
        if (scope?.kind === "klinik") await api.klinikStockCorrection({ klinik: scope.name, obat_kode: item.kode, actual_qty: actualQty, note });
        else if (scope?.kind === "gudang") await api.gudangStockCorrection({ gudang: scope.name, item_kode: item.kode, actual_qty: actualQty, note });
        else await api.stockCorrection({ item_id: item.id, actual_qty: actualQty, note });
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
      if (scope?.kind === "klinik")
        await api.createKlinikTransaction({ klinik: scope.name, obat_kode: item.kode, type: mode, qty, note, penerima });
      else if (scope?.kind === "gudang")
        await api.createGudangTransaction({ gudang: scope.name, item_kode: item.kode, tujuan, type: mode, qty, note, penerima });
      else await api.createTransaction({ item_id: item.id, tujuan, type: mode, qty, note, penerima });
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
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">{isKlinik ? `Input Transaksi Obat - Klinik ${scope.name}` : `Input Transaksi Stock${scope ? ` - ${scope.name}` : ""}`}</h3>
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
          <div className={`grid ${isSuperuser ? "grid-cols-3" : "grid-cols-2"} gap-2`}>
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
            {isSuperuser && (
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
            )}
          </div>

          {mode === "OUT" && !isKlinik && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tujuan / Konsumen (opsional)</label>
              <select
                value={tujuan}
                onChange={(e) => setTujuan(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              >
                <option value="">- Tidak ditentukan -</option>
                {(scope ? (GUDANG_TUJUAN[scope.name] ?? [scope.name]) : NILAM_TUJUAN).map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              {!scope && tujuan && tujuan !== "NILAM" && (
                <p className="text-[11px] text-[var(--accent-blue)] mt-1">
                  Jumlah ini otomatis tercatat sebagai Stok Masuk di Gudang {tujuan}.
                </p>
              )}
            </div>
          )}

          {mode !== "KOREKSI" && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">
                {mode === "OUT" ? (isKlinik ? "Pasien / Penerima (opsional)" : "Penerima / Pengambil (opsional)") : "Diterima Oleh (opsional)"}
              </label>
              <KaryawanAutocomplete estate={scope?.name ?? "NILAM"} value={penerima} onChange={setPenerima} />
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
                step={decimal ? "any" : 1}
                onChange={(e) => setActualQty(parseQty(e.target.value))}
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
                step={decimal ? "any" : 1}
                onChange={(e) => setQty(parseQty(e.target.value))}
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
