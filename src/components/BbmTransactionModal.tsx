import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type BbmSummary } from "../lib/api";

const JENIS_OPTIONS = ["SOLAR", "BENSIN"] as const;
// Both SOLAR and BENSIN only have physical storage at these 3 sites - Zamrud/Firus/AKSS/UKM etc.
// are distribution destinations under Nilam, not separate warehouses (picked via the Estate field).
const LOKASI_BY_JENIS: Record<string, string[]> = {
  SOLAR: ["NILAM", "WJA", "KNS"],
  BENSIN: ["NILAM", "WJA", "KNS"],
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BbmTransactionModal({
  summary,
  onClose,
  onSuccess,
}: {
  summary: BbmSummary | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [jenisBbm, setJenisBbm] = useState<"SOLAR" | "BENSIN">("SOLAR");
  const [lokasi, setLokasi] = useState("NILAM");
  const [tipe, setTipe] = useState<"DITERIMA" | "PEMAKAIAN">("PEMAKAIAN");
  const [tanggal, setTanggal] = useState(todayIso());
  const [jumlah, setJumlah] = useState(1);
  const [keterangan, setKeterangan] = useState("");
  const [noSpb, setNoSpb] = useState("");
  const [estate, setEstate] = useState("");
  const [estateOptions, setEstateOptions] = useState<string[]>([]);
  const [kodeKendaraan, setKodeKendaraan] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setEstate("");
    api.bbmEstateOptions(jenisBbm, lokasi).then(setEstateOptions);
  }, [jenisBbm, lokasi]);

  const saldoSaatIni = summary?.saldoTerakhir.find((s) => s.jenis_bbm === jenisBbm && s.lokasi === lokasi)?.saldo_stock ?? 0;
  const saldoProyeksi = tipe === "DITERIMA" ? saldoSaatIni + jumlah : saldoSaatIni - jumlah;

  const submit = async () => {
    setError("");
    if (tipe === "PEMAKAIAN" && !estate) {
      setError("Pilih estate/sub-lokasi terlebih dahulu");
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
        kode_kendaraan: kodeKendaraan,
      });
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
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Input Transaksi BBM</h3>
            <p className="text-xs text-[var(--text-secondary)]">Solar / Bensin per lokasi</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 bg-[#f8fafc] border-b border-[var(--border)] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">Stok Saat Ini</span>
            <span className="text-lg font-semibold text-[var(--text-primary)]">{saldoSaatIni.toLocaleString("id-ID")} LTR</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">Proyeksi Stok Setelah Transaksi</span>
            <span className={`text-sm font-medium ${saldoProyeksi < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>
              {saldoProyeksi.toLocaleString("id-ID")} LTR
            </span>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jenis BBM</label>
              <select
                value={jenisBbm}
                onChange={(e) => {
                  const j = e.target.value as "SOLAR" | "BENSIN";
                  setJenisBbm(j);
                  setLokasi(LOKASI_BY_JENIS[j][0]);
                }}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
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
              <select value={lokasi} onChange={(e) => setLokasi(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2">
                {LOKASI_BY_JENIS[jenisBbm].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTipe("DITERIMA")}
              className={`py-2 rounded-md text-xs font-medium border ${
                tipe === "DITERIMA"
                  ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              Stok Masuk
            </button>
            <button
              onClick={() => setTipe("PEMAKAIAN")}
              className={`py-2 rounded-md text-xs font-medium border ${
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
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jumlah (LTR)</label>
              <input
                type="number"
                min={1}
                value={jumlah}
                onChange={(e) => setJumlah(parseInt(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
          </div>

          {tipe === "PEMAKAIAN" && (
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Estate / Sub-lokasi</label>
              <select
                value={estate}
                onChange={(e) => setEstate(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">No. SPB (opsional)</label>
              <input value={noSpb} onChange={(e) => setNoSpb(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Kode Kendaraan / KM-HM (opsional)</label>
              <input
                value={kodeKendaraan}
                onChange={(e) => setKodeKendaraan(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Keterangan</label>
            <input
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder="cth. Genset 02 B"
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : "Simpan Transaksi"}
          </button>
        </div>
      </div>
    </div>
  );
}
