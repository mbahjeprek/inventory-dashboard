import { useEffect, useState } from "react";
import { X, ClipboardCheck } from "lucide-react";
import { api, errorText, GUDANG_TUJUAN, type KlinikBatch, type PickerItem, type StockScope } from "../lib/api";
import { KaryawanAutocomplete } from "./KaryawanAutocomplete";
import { EvidenceInput, useEvidenceEnabled } from "./EvidenceInput";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { TransferShortcut } from "./TransferShortcut";
import { localToday } from "./BatchGrid";
import { isiOf, kemasanName, kemasanText, split } from "../lib/kemasan";

// Gudang Nilam supplies every estate (a Stok Keluar to another estate becomes Stok Masuk in that
// estate's gudang); the other gudang only supply their own estate and its sub-estates.
const NILAM_TUJUAN = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];

type Mode = "IN" | "OUT" | "KOREKSI";

// Opens the form pre-filled, e.g. the "Buang" shortcut on an expired batch in Inventory Klinik:
// Stock Out of exactly that batch, marked as thrown away, its whole remaining qty.
export type TransactionPreset = { mode?: Mode; batchOut?: string; buang?: boolean; qty?: number; note?: string };

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
  preset,
  onClose,
  onSuccess,
}: {
  item: PickerItem;
  scope?: StockScope;
  preset?: TransactionPreset;
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
  const [mode, setMode] = useState<Mode>(() => {
    const wanted = preset?.mode;
    if (wanted === "KOREKSI") return canKoreksi ? "KOREKSI" : "IN";
    if (wanted && canInput) return wanted;
    return canInput ? "IN" : "KOREKSI";
  });
  const [qtyTyped, setQty] = useState(preset?.qty && preset.qty > 0 ? preset.qty : 1);
  const [actualQty, setActualQty] = useState(0);
  // Klinik obat with a pack (STRIP isi 10): Stock In / Out can be typed per pack (Stock In starts
  // that way, obat arrives in strips; Stock Out per biji, what a patient gets), Koreksi as
  // packs + loose pieces. Stock itself stays in the satuan.
  const isi = isKlinik ? isiOf(item) : 0;
  const pakName = kemasanName(item);
  const [perPak, setPerPak] = useState(false);
  const qty = isi && perPak ? qtyTyped * isi : qtyTyped;
  const [korPak, setKorPak] = useState("");
  const [korLepas, setKorLepas] = useState("");
  useEffect(() => {
    setPerPak(!!isi && mode === "IN");
  }, [mode, isi]);
  const [note, setNote] = useState(preset?.note ?? "");
  // The day it happened, for a movement entered later (the server keeps when it was typed).
  const [tanggal, setTanggal] = useState(localToday());
  // Foto bukti, required for Stock In / Out (not for Koreksi).
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const evidenceOn = useEvidenceEnabled();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Klinik only: stock is kept per expiry-date batch.
  const [batches, setBatches] = useState<KlinikBatch[]>([]);
  const [expIn, setExpIn] = useState("");
  const [batchOut, setBatchOut] = useState(preset?.batchOut ?? FEFO);
  const [buang, setBuang] = useState(!!preset?.buang);
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
    if (mode !== "KOREKSI") return;
    setActualQty(korBase);
    if (isi) {
      const { pak, lepas } = split(korBase, isi);
      setKorPak(String(pak));
      setKorLepas(String(lepas));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, korBase]);
  const setKor = (pak: string, lepas: string) => {
    setKorPak(pak);
    setKorLepas(lepas);
    setActualQty((parseInt(pak) || 0) * isi + (parseInt(lepas) || 0));
  };

  // Gudang KNS/WJA/Zamrud/Firus take decimal qty (e.g. 2,5 KG); Nilam and Klinik whole numbers.
  const decimal = scope?.kind === "gudang";
  const parseQty = (v: string) => (decimal ? Math.round((parseFloat(v) || 0) * 1000) / 1000 : parseInt(v) || 0);
  const selisih = Math.round((actualQty - korBase) * 1000) / 1000;

  // Klinik Stock In is always received by whoever is logged in; Stock Out goes to a patient (typed)
  // or one of the estate's karyawan.
  const selfReceives = isKlinik && mode === "IN";
  const receiver = selfReceives ? (user?.nama ?? "") : penerima;

  // Every field on the form is required; only a Klinik batch's expiry date may stay empty (alat/BHP
  // without one), and nobody receives obat that is thrown away.
  const missing = [
    mode === "OUT" && !isKlinik && !tujuan && "Tujuan / Konsumen",
    mode !== "KOREKSI" && !(mode === "OUT" && buang) && !receiver.trim() && (mode === "OUT" ? (isKlinik ? "Pasien / Penerima" : "Penerima / Pengambil") : "Diterima Oleh"),
    !note.trim() && "Catatan",
    mode !== "KOREKSI" && evidenceOn && !evidenceId && "Foto Bukti",
  ].filter(Boolean);

  const submit = async () => {
    setError("");
    if (missing.length) {
      setError(`Wajib diisi: ${missing.join(", ")}`);
      return;
    }
    if (!tanggal || tanggal > localToday()) {
      setError("Tanggal tidak boleh kosong atau lewat dari hari ini");
      return;
    }

    if (mode === "KOREKSI") {
      if (actualQty < 0) {
        setError("Stok aktual tidak boleh negatif");
        return;
      }
      setSubmitting(true);
      try {
        if (scope?.kind === "klinik")
          await api.klinikStockCorrection({ klinik: scope.name, obat_kode: item.kode, actual_qty: actualQty, note, expired_date: korExp, tanggal_iso: tanggal });
        else if (scope?.kind === "gudang") await api.gudangStockCorrection({ gudang: scope.name, item_kode: item.kode, actual_qty: actualQty, note, tanggal_iso: tanggal });
        else await api.stockCorrection({ item_id: item.id, actual_qty: actualQty, note, tanggal_iso: tanggal });
        onSuccess();
      } catch (e) {
        setError(errorText(e, "Gagal menyimpan koreksi stok"));
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
          tanggal_iso: tanggal,
          evidence_id: evidenceId ?? "",
          klinik: scope.name,
          obat_kode: item.kode,
          type: mode,
          qty,
          // The pack count stays readable in the history: "... (10 STRIP isi 10)".
          note: isi && perPak ? `${note} (${qtyTyped} ${pakName} isi ${isi})` : note,
          penerima: receiver,
          tujuan: mode === "OUT" && buang ? "DIBUANG" : undefined,
          expired_date: mode === "IN" ? expIn || undefined : batchOut === FEFO ? undefined : batchOut,
        });
      else if (scope?.kind === "gudang")
        await api.createGudangTransaction({ tanggal_iso: tanggal, evidence_id: evidenceId ?? "", gudang: scope.name, item_kode: item.kode, tujuan, type: mode, qty, note, penerima });
      else await api.createTransaction({ tanggal_iso: tanggal, evidence_id: evidenceId ?? "", item_id: item.id, tujuan, type: mode, qty, note, penerima });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan transaksi", true));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl max-h-[calc(100vh-2rem)] overflow-y-auto">
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
              {kemasanText(item.stock_tersedia, item) && (
                <span className="block text-[11px] font-normal text-right text-[var(--text-muted)]">{kemasanText(item.stock_tersedia, item)}</span>
              )}
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

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tanggal</label>
            <input type="date" value={tanggal} max={localToday()} onChange={(e) => setTanggal(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
            {tanggal && tanggal < localToday() && (
              <p className="text-[11px] text-[var(--accent-amber)] mt-1">Transaksi tanggal lalu - tercatat di tanggal ini, waktu input tetap disimpan.</p>
            )}
          </div>

          {mode === "OUT" && scope && !buang && (
            <TransferShortcut module={isKlinik ? "KLINIK" : "GUDANG"} dari={scope.name} kode={item.kode} qty={qty} note={note} onDone={onSuccess} />
          )}

          {mode === "OUT" && !isKlinik && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tujuan / Konsumen</label>
              <select
                value={tujuan}
                onChange={(e) => setTujuan(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              >
                <option value="">- Pilih tujuan -</option>
                {(scope ? (GUDANG_TUJUAN[scope.name] ?? [scope.name]) : NILAM_TUJUAN).map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              {!scope && tujuan && tujuan !== "NILAM" && (
                <p className="text-[11px] text-[var(--accent-blue)] mt-1">
                  Jumlah ini otomatis tercatat sebagai Stock In di Gudang {tujuan}.
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
                      {b.expired_date ? `Exp ${tgl(b.expired_date)}` : "Tanpa tanggal expired"}
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
                      {b.expired_date ? `Exp ${tgl(b.expired_date)}` : "Tanpa tanggal expired"} · tercatat {b.qty.toLocaleString("id-ID")}
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

          {/* Obat expired yang dibuang has no one receiving it. */}
          {mode !== "KOREKSI" && !(mode === "OUT" && buang) && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">
                {mode === "OUT" ? (isKlinik ? "Pasien / Penerima" : "Penerima / Pengambil") : "Diterima Oleh"}
              </label>
              {selfReceives ? (
                <div className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2 text-[var(--text-secondary)] bg-[#f8fafc]">{receiver}</div>
              ) : (
                <KaryawanAutocomplete estate={scope?.name ?? "NILAM"} value={penerima} onChange={setPenerima} />
              )}
            </div>
          )}

          {mode === "KOREKSI" ? (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">
                Stok Aktual Hasil Hitung Fisik ({item.satuan})
              </label>
              {isi ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <input type="number" min={0} step={1} value={korPak} onChange={(e) => setKor(e.target.value, korLepas)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
                      <span className="whitespace-nowrap">{pakName} utuh</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <input type="number" min={0} step={1} value={korLepas} onChange={(e) => setKor(korPak, e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
                      <span className="whitespace-nowrap">{item.satuan.toLowerCase()} lepas</span>
                    </label>
                  </div>
                  <p className="text-xs mt-1.5 text-[var(--text-secondary)]">
                    = <b>{actualQty.toLocaleString("id-ID")} {item.satuan}</b> (1 {pakName} = {isi})
                  </p>
                </>
              ) : (
                <input
                  type="number"
                  min={0}
                  value={actualQty}
                  step={decimal ? "any" : 1}
                  onChange={(e) => setActualQty(parseQty(e.target.value))}
                  className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
                />
              )}
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
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jumlah ({isi && perPak ? pakName : item.satuan})</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={qtyTyped}
                  step={decimal ? "any" : 1}
                  onChange={(e) => setQty(parseQty(e.target.value))}
                  className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
                />
                {!!isi && (
                  <select
                    value={perPak ? "pak" : "satuan"}
                    onChange={(e) => setPerPak(e.target.value === "pak")}
                    aria-label="Satuan jumlah"
                    className="text-sm rounded-md border border-[var(--border)] px-2 py-2"
                  >
                    <option value="pak">{pakName}</option>
                    <option value="satuan">{item.satuan}</option>
                  </select>
                )}
              </div>
              {!!isi && perPak && (
                <p className="text-xs mt-1.5 text-[var(--text-secondary)]">
                  = <b>{qty.toLocaleString("id-ID")} {item.satuan}</b> ({qtyTyped} {pakName} × {isi})
                </p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Catatan</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={mode === "KOREKSI" ? "cth. Hasil stock opname bulanan" : "cth. Penerimaan dari supplier"}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          {mode !== "KOREKSI" && <EvidenceInput value={evidenceId} onChange={setEvidenceId} />}

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
