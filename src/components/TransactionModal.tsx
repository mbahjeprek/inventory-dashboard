import { useEffect, useState } from "react";
import { X, ClipboardCheck } from "lucide-react";
import { api, GUDANG_TUJUAN, type KlinikBatch, type PickerItem, type StockScope } from "../lib/api";
import { KaryawanAutocomplete } from "./KaryawanAutocomplete";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";

// Gudang Nilam supplies every estate (a Stok Keluar to another estate becomes Stok Masuk in that
// estate's gudang); the other gudang only supply their own estate and its sub-estates.
const NILAM_TUJUAN = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];

type Mode = "IN" | "OUT" | "KOREKSI";

// Klinik batch pickers: FEFO = take the batch that expires first; NEW = count a batch not listed yet.
const FEFO = "__fefo";
const NEW_BATCH = "__new";
const tgl = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "tanpa tanggal expired");
const isPast = (iso: string) => !!iso && iso < new Date().toISOString().slice(0, 10);

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
  // Stock In/Out need the module's Input permission, Koreksi its Koreksi permission (Pengguna).
  const mod = isKlinik ? "klinik" : "gudang";
  const canInput = can(user, `${mod}.input`);
  const canKoreksi = can(user, `${mod}.koreksi`);
  const [item, setItem] = useState(initialItem);
  const [tujuan, setTujuan] = useState("");
  const [penerima, setPenerima] = useState("");
  const [mode, setMode] = useState<Mode>(canInput ? "IN" : "KOREKSI");
  const [qty, setQty] = useState(1);
  const [actualQty, setActualQty] = useState(0);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Klinik only: stock is kept per expiry-date batch.
  const [batches, setBatches] = useState<KlinikBatch[]>([]);
  const [expIn, setExpIn] = useState("");
  const [batchOut, setBatchOut] = useState(FEFO);
  const [buang, setBuang] = useState(false);
  const [batchKor, setBatchKor] = useState(NEW_BATCH);
  const [newExp, setNewExp] = useState("");

  useEffect(() => {
    if (!isKlinik) return;
    api
      .klinikBatches(scope!.name, initialItem.kode)
      .then((b) => {
        setBatches(b);
        if (b.length) setBatchKor(b[0].expired_date);
      })
      .catch(() => setBatches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItem.kode]);

  const korExp = batchKor === NEW_BATCH ? newExp : batchKor;
  const korBatchQty = batches.find((b) => b.expired_date === korExp)?.qty ?? 0;
  const outAvailable = isKlinik && batchOut !== FEFO ? (batches.find((b) => b.expired_date === batchOut)?.qty ?? 0) : item.stock_tersedia;

  useEffect(() => {
    // The picker row already carries the scope's stock; Nilam refreshes it from the item.
    if (!scope) api.item(initialItem.id).then((full) => setItem(full));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItem.id]);

  // Koreksi starts from the current count: the whole stock, or for Klinik the chosen batch.
  const korBase = isKlinik ? korBatchQty : item.stock_tersedia;
  useEffect(() => {
    if (mode === "KOREKSI") setActualQty(korBase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, korBase]);

  // Gudang KNS/WJA/Zamrud/Firus take decimal qty (e.g. 2,5 KG); Nilam and Klinik whole numbers.
  const decimal = scope?.kind === "gudang";
  const parseQty = (v: string) => (decimal ? Math.round((parseFloat(v) || 0) * 1000) / 1000 : parseInt(v) || 0);
  const selisih = Math.round((actualQty - korBase) * 1000) / 1000;

  const submit = async () => {
    setError("");

    if (mode === "KOREKSI") {
      if (actualQty < 0) {
        setError("Stok aktual tidak boleh negatif");
        return;
      }
      setSubmitting(true);
      try {
        if (scope?.kind === "klinik")
          await api.klinikStockCorrection({ klinik: scope.name, obat_kode: item.kode, actual_qty: actualQty, note, expired_date: korExp });
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
    if (mode === "OUT" && qty > outAvailable) {
      setError(`${isKlinik && batchOut !== FEFO ? "Stok batch ini" : "Stock tersedia"} hanya ${outAvailable} ${item.satuan}`);
      return;
    }
    setSubmitting(true);
    try {
      if (scope?.kind === "klinik")
        await api.createKlinikTransaction({
          klinik: scope.name,
          obat_kode: item.kode,
          type: mode,
          qty,
          note,
          penerima,
          tujuan: mode === "OUT" && buang ? "DIBUANG" : undefined,
          expired_date: mode === "IN" ? expIn || undefined : batchOut === FEFO ? undefined : batchOut,
        });
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
          <div className={`grid ${(canInput ? 2 : 0) + (canKoreksi ? 1 : 0) === 3 ? "grid-cols-3" : canInput ? "grid-cols-2" : "grid-cols-1"} gap-2`}>
            {canInput && (
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
            )}
            {canInput && (
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
            )}
            {canKoreksi && (
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

          {isKlinik && mode === "IN" && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tanggal Expired</label>
              <input type="date" value={expIn} onChange={(e) => setExpIn(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Obat dengan tanggal expired berbeda disimpan sebagai batch terpisah. Kosongkan untuk alat/BHP tanpa expired.
              </p>
            </div>
          )}

          {isKlinik && mode === "OUT" && (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">Ambil dari batch</label>
                <select value={batchOut} onChange={(e) => setBatchOut(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2">
                  <option value={FEFO}>Otomatis: yang expired paling dekat dulu</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.expired_date}>
                      Exp {tgl(b.expired_date)}
                      {isPast(b.expired_date) ? " (sudah expired)" : ""} · sisa {b.qty.toLocaleString("id-ID")}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" checked={buang} onChange={(e) => setBuang(e.target.checked)} />
                Buang obat expired (tidak dihitung sebagai pemakaian)
              </label>
            </div>
          )}

          {isKlinik && mode === "KOREKSI" && (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">Batch yang dihitung</label>
                <select value={batchKor} onChange={(e) => setBatchKor(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2">
                  {batches.map((b) => (
                    <option key={b.id} value={b.expired_date}>
                      Exp {tgl(b.expired_date)} · tercatat {b.qty.toLocaleString("id-ID")}
                    </option>
                  ))}
                  <option value={NEW_BATCH}>Batch lain (isi tanggal expired)</option>
                </select>
              </div>
              {batchKor === NEW_BATCH && (
                <input type="date" value={newExp} onChange={(e) => setNewExp(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
              )}
              <p className="text-[11px] text-[var(--text-muted)]">Tercatat di batch ini: {korBatchQty.toLocaleString("id-ID")} {item.satuan}</p>
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
