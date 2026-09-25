import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, errorText, type BbmSummary } from "../lib/api";

const JENIS_OPTIONS = ["SOLAR", "BENSIN"] as const;
// BBM storage sites (see BBM_LOKASI_OPTIONS in server/src/app.ts). Sub-locations like AKSS/UKM are
// distribution destinations picked via the Estate field, not separate storage.
const LOKASI_BY_JENIS: Record<string, string[]> = {
  SOLAR: ["NILAM", "WJA", "KNS", "ZAMRUD", "FIRUS"],
  BENSIN: ["NILAM", "WJA", "KNS", "ZAMRUD", "FIRUS"],
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BbmTransactionModal({
  summary,
  lokasiLock,
  onClose,
  onSuccess,
}: {
  summary: BbmSummary | null;
  lokasiLock?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [jenisBbm, setJenisBbm] = useState<"SOLAR" | "BENSIN">("SOLAR");
  const [lokasi, setLokasi] = useState(lokasiLock ?? "NILAM");
  const [tipe, setTipe] = useState<"DITERIMA" | "PEMAKAIAN">("PEMAKAIAN");
  const [tanggal, setTanggal] = useState(todayIso());
  const [jumlah, setJumlah] = useState(1);
  const [keterangan, setKeterangan] = useState("");
  const [noSpb, setNoSpb] = useState("");
  const [estate, setEstate] = useState("");
  const [estateOptions, setEstateOptions] = useState<string[]>([]);
  const [kodeKendaraan, setKodeKendaraan] = useState("");
  const [hmTerakhir, setHmTerakhir] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setEstate("");
    api.bbmEstateOptions(jenisBbm, lokasi).then(setEstateOptions);
  }, [jenisBbm, lokasi]);

  // A genset has no HM/KM reading, so the field is hidden once the kode kendaraan names one.
  const isGenset = /genset/i.test(kodeKendaraan);

  const saldoSaatIni = summary?.saldoTerakhir.find((s) => s.jenis_bbm === jenisBbm && s.lokasi === lokasi)?.saldo_stock ?? 0;
  const saldoProyeksi = tipe === "DITERIMA" ? saldoSaatIni + jumlah : saldoSaatIni - jumlah;

  const submit = async () => {
    setError("");
    // Every field is required; vehicle and HM/KM only apply to fuel that goes out.
    const keluar = tipe === "PEMAKAIAN";
    const missing = [
      keluar && !estate && "Estate / Sub-lokasi",
      keluar && !kodeKendaraan.trim() && "Kode Kendaraan",
      keluar && !isGenset && !hmTerakhir.trim() && "HM/KM Terakhir",
      !noSpb.trim() && "No. SPB",
      !keterangan.trim() && "Keterangan",
    ].filter(Boolean);
    if (missing.length) {
      setError(`Wajib diisi: ${missing.join(", ")}`);
      return;
    }
    if (jumlah <= 0) {
      setError("Jumlah harus lebih dari 0");
      return;
    }
    if (tipe === "PEMAKAIAN" && jumlah > saldoSaatIni) {
      setError(`Stok saat ini hanya ${saldoSaatIni.toLocaleString("id-ID")} LTR`);
      return;
    }
    setSubmitting(true);
    try {
      await api.createBbmTransaction({
        jenis_bbm: jenisBbm,
        lokasi,
        tanggal_iso: tanggal,
        tipe,
        jumlah,
        keterangan,
        no_spb: noSpb,
        estate: tipe === "DITERIMA" ? lokasi : estate,
        kode_kendaraan: keluar ? kodeKendaraan : "",
        hm_terakhir: keluar && !isGenset ? hmTerakhir : "",
      });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan transaksi"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl max-h-[calc(100vh-2rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Input Transaksi BBM</h3>
            <p className="text-xs text-[var(--text-secondary)]">Solar / Bensin per lokasi</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-2.5 bg-[#f8fafc] border-b border-[var(--border)] grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-[var(--text-secondary)]">Stok Saat Ini</div>
            <div className="text-base font-semibold text-[var(--text-primary)]">{saldoSaatIni.toLocaleString("id-ID")} LTR</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[var(--text-secondary)]">Setelah Transaksi</div>
            <div className={`text-base font-semibold ${saldoProyeksi < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>
              {saldoProyeksi.toLocaleString("id-ID")} LTR
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jenis BBM</label>
              <select
                value={jenisBbm}
                onChange={(e) => {
                  const j = e.target.value as "SOLAR" | "BENSIN";
                  setJenisBbm(j);
                  if (!lokasiLock) setLokasi(LOKASI_BY_JENIS[j][0]);
                }}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
              >
                {JENIS_OPTIONS.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Lokasi</label>
              {lokasiLock ? (
                <div className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--text-secondary)] bg-[#f8fafc]">
                  {lokasiLock}
                </div>
              ) : (
                <select value={lokasi} onChange={(e) => setLokasi(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5">
                  {LOKASI_BY_JENIS[jenisBbm].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTipe("DITERIMA")}
              className={`py-1.5 rounded-md text-xs font-medium border ${
                tipe === "DITERIMA"
                  ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              Stok Masuk
            </button>
            <button
              onClick={() => setTipe("PEMAKAIAN")}
              className={`py-1.5 rounded-md text-xs font-medium border ${
                tipe === "PEMAKAIAN"
                  ? "bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-[var(--accent-red-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              Stok Keluar
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tanggal</label>
              <input
                type="date"
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jumlah (LTR)</label>
              <input
                type="number"
                min={1}
                value={jumlah}
                onChange={(e) => setJumlah(parseInt(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
              />
            </div>
          </div>

          {tipe === "PEMAKAIAN" && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Estate / Sub-lokasi</label>
              <select
                value={estate}
                onChange={(e) => setEstate(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
              >
                <option value="">-- Pilih Estate --</option>
                {estateOptions.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
          )}

          {tipe === "PEMAKAIAN" && (
          <div className={isGenset ? "" : "grid grid-cols-2 gap-3"}>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Kode Kendaraan</label>
              <input
                value={kodeKendaraan}
                onChange={(e) => setKodeKendaraan(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
              />
            </div>
            {!isGenset && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">HM/KM Terakhir</label>
              <input
                value={hmTerakhir}
                onChange={(e) => setHmTerakhir(e.target.value)}
                placeholder="cth. 4373.7 h"
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
              />
            </div>
            )}
          </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">No. SPB</label>
              <input value={noSpb} onChange={(e) => setNoSpb(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Keterangan</label>
              <input
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="cth. Genset 02 B"
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
              />
            </div>
          </div>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : "Simpan Transaksi"}
          </button>
        </div>
      </div>
    </div>
  );
}
