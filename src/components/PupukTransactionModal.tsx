import { useState } from "react";
import { X } from "lucide-react";
import { api, errorText, type PupukSummary } from "../lib/api";
import { EvidenceInput, useEvidenceEnabled } from "./EvidenceInput";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";

// Pupuk masuk (delivery) or keluar (application to a blok). Unlike BBM, keluar may exceed the
// current stock: the imported ledger already runs negative (usage above deliveries), so blocking
// would stop real usage from being recorded. The projected stock just shows red instead.
export function PupukTransactionModal({
  estate,
  summary,
  jenisOptions,
  divisiOptions,
  onClose,
  onSuccess,
}: {
  estate: string;
  summary: PupukSummary | null;
  jenisOptions: string[];
  divisiOptions: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [jenis, setJenis] = useState(jenisOptions[0] ?? "PUPUK NPK");
  const [tipe, setTipe] = useState<"MASUK" | "KELUAR">("KELUAR");
  const [tanggal, setTanggal] = useState(todayIso());
  const [jumlah, setJumlah] = useState(0);
  const [divisi, setDivisi] = useState("");
  const [blok, setBlok] = useState("");
  const [ha, setHa] = useState("");
  const [pokok, setPokok] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const evidenceOn = useEvidenceEnabled();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const stokSaatIni = summary?.saldoTerakhir.find((s) => s.jenis_pupuk === jenis)?.saldo_stock ?? 0;
  const stokSetelah = tipe === "MASUK" ? stokSaatIni + jumlah : stokSaatIni - jumlah;

  const submit = async () => {
    setError("");
    if (jumlah <= 0) return setError("Jumlah harus lebih dari 0");
    // Every field shown is required. Pupuk masuk only needs the keterangan; divisi, blok, HA and
    // pokok describe where it was applied.
    const keluar = tipe === "KELUAR";
    const missing = [
      keluar && !divisi && "Divisi",
      keluar && !blok.trim() && "Blok",
      keluar && ha === "" && "HA",
      keluar && pokok === "" && "Pokok",
      !keterangan.trim() && "Keterangan",
      evidenceOn && !evidenceId && "Foto Bukti",
    ].filter(Boolean);
    if (missing.length) return setError(`Wajib diisi: ${missing.join(", ")}`);
    setSubmitting(true);
    try {
      await api.createPupuk({
        evidence_id: evidenceId ?? "",
        estate,
        jenis_pupuk: jenis,
        tanggal_iso: tanggal,
        tipe,
        jumlah,
        divisi: tipe === "KELUAR" ? divisi : "",
        no_embrace: "",
        kode_barang: "",
        keterangan,
        blok: tipe === "KELUAR" ? blok.trim().toUpperCase().replace(/\./g, "") : "",
        ha: tipe === "KELUAR" && ha !== "" ? Number(ha) : "",
        pokok: tipe === "KELUAR" && pokok !== "" ? Number(pokok) : "",
      });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan transaksi"));
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl max-h-[calc(100vh-2rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Input Transaksi Pupuk</h3>
            <p className="text-xs text-[var(--text-secondary)]">Estate {estate}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-2.5 bg-[#f8fafc] border-b border-[var(--border)] grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-[var(--text-secondary)]">Stok Saat Ini</div>
            <div className={`text-base font-semibold ${stokSaatIni < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>{fmt(stokSaatIni)} KG</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[var(--text-secondary)]">Setelah Transaksi</div>
            <div className={`text-base font-semibold ${stokSetelah < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]"}`}>{fmt(stokSetelah)} KG</div>
          </div>
          {stokSetelah < 0 && (
            <p className="col-span-2 text-[11px] text-[var(--accent-red)]">Stok akan minus - pastikan pupuk masuk sudah diinput.</p>
          )}
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Nama Barang</label>
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
            <button
              onClick={() => setTipe("MASUK")}
              className={`py-1.5 rounded-md text-xs font-medium border ${
                tipe === "MASUK"
                  ? "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              Stock In
            </button>
            <button
              onClick={() => setTipe("KELUAR")}
              className={`py-1.5 rounded-md text-xs font-medium border ${
                tipe === "KELUAR"
                  ? "bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-[var(--accent-red-border)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              Stock Out
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tanggal</label>
              <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Jumlah (KG)</label>
              <input type="number" min={0} value={jumlah || ""} onChange={(e) => setJumlah(Number(e.target.value) || 0)} className={inputCls} />
            </div>
          </div>

          {tipe === "KELUAR" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Divisi</label>
                  <select value={divisi} onChange={(e) => setDivisi(e.target.value)} className={inputCls}>
                    <option value="">- Pilih -</option>
                    {divisiOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Blok</label>
                  <input value={blok} onChange={(e) => setBlok(e.target.value)} placeholder="cth. U23 (tanpa titik)" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>HA</label>
                  <input type="number" min={0} step="any" value={ha} onChange={(e) => setHa(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Pokok</label>
                  <input type="number" min={0} value={pokok} onChange={(e) => setPokok(e.target.value)} className={inputCls} />
                </div>
              </div>
            </>
          )}

          <div>
            <label className={labelCls}>Keterangan</label>
            <input
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder={tipe === "MASUK" ? "PUPUK MASUK" : "cth. PEMUPUKAN BLOK U23 ( DOSIS 1 KG )"}
              className={inputCls}
            />
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
