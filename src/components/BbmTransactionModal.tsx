import { useEffect, useState } from "react";
import { wrongJenis } from "../lib/bbmJenis";
import { X } from "lucide-react";
import { api, errorText, type BbmSummary } from "../lib/api";
import { AlatAutocomplete, type AlatOption } from "./AlatAutocomplete";
import { EvidenceInput, useEvidenceEnabled } from "./EvidenceInput";

const JENIS_OPTIONS = ["SOLAR", "BENSIN"] as const;
// BBM storage sites (see BBM_LOKASI_OPTIONS in server/src/app.ts). Sub-locations like AKSS/UKM are
// distribution destinations picked via the Estate field, not separate storage.
const LOKASI_BY_JENIS: Record<string, string[]> = {
  SOLAR: ["NILAM", "WJA", "KNS", "ZAMRUD", "FIRUS"],
  BENSIN: ["NILAM", "WJA", "KNS", "ZAMRUD", "FIRUS"],
};

// Local date (toISOString is UTC, which is still yesterday before 07:00 WIB).
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BbmTransactionModal({
  summary,
  lokasiLock,
  jenisAwal,
  onClose,
  onSuccess,
}: {
  summary: BbmSummary | null;
  lokasiLock?: string;
  // The jenis the page is showing, so a Bensin entry isn't typed into Solar by accident.
  jenisAwal?: "SOLAR" | "BENSIN";
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [jenisBbm, setJenisBbm] = useState<"SOLAR" | "BENSIN">(jenisAwal ?? "SOLAR");
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
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const evidenceOn = useEvidenceEnabled();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setEstate("");
    api.bbmEstateOptions(jenisBbm, lokasi).then(setEstateOptions);
  }, [jenisBbm, lokasi]);

  // A genset has no HM/KM reading, so the field is hidden once the kode kendaraan names one (by its
  // code or its jenis unit in Master Alat Berat).
  const [alat, setAlat] = useState<AlatOption>();
  const isGenset = /genset/i.test(kodeKendaraan) || alat?.jenis_unit === "GENSET";

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
      evidenceOn && !evidenceId && "Foto Bukti",
    ].filter(Boolean);
    if (missing.length) {
      setError(`Wajib diisi: ${missing.join(", ")}`);
      return;
    }
    if (jumlah <= 0) {
      setError("Jumlah harus lebih dari 0");
      return;
    }
    const salahJenis = wrongJenis(jenisBbm, keterangan);
    if (salahJenis) {
      setError(salahJenis);
      return;
    }
    if (tipe === "PEMAKAIAN" && jumlah > saldoSaatIni) {
      setError(`Stok saat ini hanya ${saldoSaatIni.toLocaleString("id-ID")} LTR`);
      return;
    }
    setSubmitting(true);
    try {
      await api.createBbmTransaction({
        evidence_id: evidenceId ?? "",
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
              Stock In
            </button>
            <button
              onClick={() => setTipe("PEMAKAIAN")}
              className={`py-1.5 rounded-md text-xs font-medium border ${
                tipe === "PEMAKAIAN"
                  ? "bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-[var(--accent-red-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              Stock Out
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
              <AlatAutocomplete value={kodeKendaraan} onChange={setKodeKendaraan} onAlat={setAlat} />
              {alat && (alat.jenis_unit || alat.nama) && (
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{[alat.jenis_unit, alat.nama].filter(Boolean).join(" · ")}</p>
              )}
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

          <EvidenceInput value={evidenceId} onChange={setEvidenceId} />

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
