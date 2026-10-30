import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, errorText, type PinjamanBarang } from "../lib/api";
import { EvidenceInput, useEvidenceEnabled } from "./EvidenceInput";
import { fmtQty, localToday } from "../lib/opname";
import { parseNum } from "./BatchGrid";

// Pinjaman Pribadi: the estate borrows BBM from a karyawan (their own fuel) and gives it back in liters of the same jenis
// when its stock comes. It goes into the estate's stock now (not a Stock In) and out at the return (not pemakaian); the
// open ones are listed under Pinjaman & Transfer until they are lunas.
export function PinjamPribadiModal({ estates, estate: awal, onClose, onSuccess }: { estates: string[]; estate?: string; onClose: () => void; onSuccess: () => void }) {
  const [estate, setEstate] = useState(awal && estates.includes(awal) ? awal : estates[0] ?? "");
  const [options, setOptions] = useState<PinjamanBarang[]>([]);
  const [kode, setKode] = useState("SOLAR");
  const [qty, setQty] = useState("");
  const [nama, setNama] = useState("");
  const [nik, setNik] = useState("");
  const [cari, setCari] = useState<{ nik: string; nama: string }[]>([]);
  const [alasan, setAlasan] = useState("");
  const [tanggal, setTanggal] = useState(localToday());
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const evidenceOn = useEvidenceEnabled();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!estate) return;
    api
      .pinjamanBarang("BBM", estate, "")
      .then((o) => {
        setOptions(o);
        if (!o.some((x) => x.kode === kode)) setKode(o[0]?.kode ?? "");
      })
      .catch(() => setOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estate]);
  // the karyawan of the estate, by name or NIK
  useEffect(() => {
    const q = nama.trim();
    if (q.length < 2 || !estate) return setCari([]);
    const t = setTimeout(() => {
      api
        .karyawanPick(estate, q)
        .then(setCari)
        .catch(() => setCari([]));
    }, 250);
    return () => clearTimeout(t);
  }, [nama, estate]);
  const pilihKaryawan = (v: string) => {
    const k = cari.find((x) => `${x.nama} · ${x.nik}` === v);
    if (k) {
      setNama(k.nama);
      setNik(k.nik);
    } else {
      setNama(v);
      setNik("");
    }
  };

  const n = parseNum(qty);
  const barang = options.find((o) => o.kode === kode);
  const submit = async () => {
    setError("");
    if (!nama.trim()) return setError("Isi nama karyawan pemilik BBM");
    if (!barang) return setError("Pilih jenis BBM");
    if (!(n > 0)) return setError("Jumlah liter harus lebih dari 0");
    if (!alasan.trim()) return setError("Alasan wajib diisi");
    if (evidenceOn && !evidenceId) return setError("Foto bukti wajib diupload");
    setSubmitting(true);
    try {
      await api.createPinjamanPribadi({ module: "BBM", ke: estate, kode: barang.kode, qty: n, nama: nama.trim(), nik: nik.trim(), alasan: alasan.trim(), tanggal_iso: tanggal, evidence_id: evidenceId ?? "" });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan pinjaman"));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white";
  const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-lg mt-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">Pinjam BBM dari Karyawan</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">BBM pribadi karyawan dipakai dulu, dikembalikan dalam liter yang sama saat stok datang.</p>
          </div>
          <button onClick={onClose} title="Tutup" className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Estate yang meminjam</label>
              <select value={estate} onChange={(e) => setEstate(e.target.value)} className={inputCls}>
                {estates.map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Tanggal pinjam</label>
              <input type="date" value={tanggal} max={localToday()} onChange={(e) => e.target.value && setTanggal(e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Karyawan pemilik BBM (nama atau NIK)</label>
              <input value={nama} onChange={(e) => pilihKaryawan(e.target.value)} list="pinjam-pribadi-karyawan" placeholder="ketik nama / NIK" className={inputCls} />
              <datalist id="pinjam-pribadi-karyawan">
                {cari.map((k) => (
                  <option key={k.nik} value={`${k.nama} · ${k.nik}`} />
                ))}
              </datalist>
              {nik && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">NIK {nik}</div>}
            </div>
            <div>
              <label className={labelCls}>Jenis BBM</label>
              <select value={kode} onChange={(e) => setKode(e.target.value)} className={inputCls}>
                {options.map((o) => (
                  <option key={o.kode} value={o.kode}>
                    {o.nama}
                  </option>
                ))}
              </select>
              {barang && (
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Stok {estate} sekarang {fmtQty(barang.stok)} {barang.satuan}
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>Jumlah dipinjam ({barang?.satuan || "LTR"})</label>
              <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={`${inputCls} text-right`} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Alasan</label>
              <input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. stok solar habis, DO belum datang; untuk genset kantor" className={inputCls} />
            </div>
          </div>
          <EvidenceInput value={evidenceId} onChange={setEvidenceId} label="Foto bukti (serah terima BBM)" />
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
              Batal
            </button>
            <button onClick={submit} disabled={submitting} className="px-4 py-2 text-sm rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50">
              {submitting ? "Menyimpan..." : "Simpan pinjaman"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
