import { useState } from "react";
import { X } from "lucide-react";
import { api, errorText, type OliSummary } from "../lib/api";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";
const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

// Oli masuk or pemakaian for one unit. Like pupuk, pemakaian may go below zero (shown red) so real
// usage can always be recorded even when a delivery hasn't been entered yet.
export function OliTransactionModal({
  estate,
  summary,
  jenisOptions,
  onClose,
  onSuccess,
}: {
  estate: string;
  summary: OliSummary | null;
  jenisOptions: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [jenis, setJenis] = useState(jenisOptions[0] ?? "SAE 15W 40");
  const [tipe, setTipe] = useState<"MASUK" | "PEMAKAIAN">("PEMAKAIAN");
  const [tanggal, setTanggal] = useState(todayIso());
  const [jumlah, setJumlah] = useState(0);
  const [noEmbrace, setNoEmbrace] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const stokSaatIni = summary?.saldoTerakhir.find((s) => s.jenis_oli === jenis)?.saldo_stock ?? 0;
  const stokSetelah = tipe === "MASUK" ? stokSaatIni + jumlah : stokSaatIni - jumlah;

  const submit = async () => {
    setError("");
    if (jumlah <= 0) return setError("Jumlah harus lebih dari 0");
    const missing = [!noEmbrace.trim() && "No. BPB", !keterangan.trim() && (tipe === "PEMAKAIAN" ? "Unit / Keterangan" : "Keterangan")].filter(Boolean);
    if (missing.length) return setError(`Wajib diisi: ${missing.join(", ")}`);
    setSubmitting(true);
    try {
      await api.createOli({ estate, jenis_oli: jenis, tanggal_iso: tanggal, tipe, jumlah, no_embrace: noEmbrace, keterangan });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan transaksi"));
    } finally {
      setSubmitting(false);
    }
  };

  const tipeBtn = (t: "MASUK" | "PEMAKAIAN", label: string, on: string) => (
    <button
      onClick={() => setTipe(t)}
      className={`py-1.5 rounded-md text-xs font-medium border ${tipe === t ? on : "border-[var(--border)] text-[var(--text-secondary)]"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl max-h-[calc(100vh-2rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Input Transaksi Oli</h3>
            <p className="text-xs text-[var(--text-secondary)]">Estate {estate}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-2.5 bg-[#f8fafc] border-b border-[var(--border)] grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-[var(--text-secondary)]">Stok Saat Ini</div>
            <div className={`text-base font-semibold ${stokSaatIni < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>{fmt(stokSaatIni)} LTR</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[var(--text-secondary)]">Setelah Transaksi</div>
            <div className={`text-base font-semibold ${stokSetelah < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>{fmt(stokSetelah)} LTR</div>
          </div>
          {stokSetelah < 0 && <p className="col-span-2 text-[11px] text-[var(--accent-red)]">Stok akan minus - pastikan oli masuk sudah diinput.</p>}
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Jenis Oli</label>
              <select value={jenis} onChange={(e) => setJenis(e.target.value)} className={inputCls}>
                {jenisOptions.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Estate</label>
              <div className={`${inputCls} text-[var(--text-secondary)] bg-[#f8fafc]`}>{estate}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {tipeBtn("MASUK", "Oli Masuk", "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]")}
            {tipeBtn("PEMAKAIAN", "Pemakaian", "bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-[var(--accent-red-border)]")}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tanggal</label>
              <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Jumlah (LTR)</label>
              <input type="number" min={0} step="any" value={jumlah || ""} onChange={(e) => setJumlah(Number(e.target.value) || 0)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>No. BPB (Bon Permintaan Barang)</label>
              <input value={noEmbrace} onChange={(e) => setNoEmbrace(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{tipe === "PEMAKAIAN" ? "Unit / Keterangan" : "Keterangan"}</label>
              <input
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder={tipe === "MASUK" ? "OLI MASUK" : "cth. EXCA MPN 02 EST NILAM"}
                className={inputCls}
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
