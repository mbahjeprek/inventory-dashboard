import { useState } from "react";
import { X } from "lucide-react";
import { api, type Karyawan } from "../lib/api";

const ESTATE_OPTIONS = ["Nilam", "Zamrud", "Firus"];
const STATUS_OPTIONS = ["STAFF PKWTT", "STAFF PKWT", "NON STAFF PKWTT", "NON STAFF PKWT"];

export function EditKaryawanModal({
  karyawan,
  onClose,
  onSuccess,
}: {
  karyawan: Karyawan;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [nik, setNik] = useState(karyawan.nik);
  const [nama, setNama] = useState(karyawan.nama);
  const [status, setStatus] = useState(karyawan.status);
  const [estate, setEstate] = useState(karyawan.estate);
  const [lokasiKerja, setLokasiKerja] = useState(karyawan.lokasi_kerja);
  const [nikKtp, setNikKtp] = useState(karyawan.nik_ktp);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!nik.trim() || !nama.trim()) {
      setError("NIK dan nama tidak boleh kosong");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.updateKaryawan(karyawan.id, {
        nik,
        nama,
        status,
        estate,
        lokasi_kerja: lokasiKerja,
        nik_ktp: nikKtp,
      });
      onSuccess();
    } catch (e: any) {
      setError(e?.message?.includes("409") ? "NIK sudah digunakan karyawan lain" : "Gagal menyimpan perubahan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Edit Data Karyawan</h3>
            <p className="text-xs text-[var(--text-secondary)] font-mono">{karyawan.nik}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">NIK / NPP</label>
              <input
                value={nik}
                onChange={(e) => setNik(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">NIK KTP</label>
              <input
                value={nikKtp}
                onChange={(e) => setNikKtp(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Nama Karyawan</label>
            <input
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              >
                <option value="">- Pilih -</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Estate</label>
              <select
                value={estate}
                onChange={(e) => setEstate(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              >
                <option value="">- Pilih -</option>
                {ESTATE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Lokasi Kerja</label>
            <input
              value={lokasiKerja}
              onChange={(e) => setLokasiKerja(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

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
