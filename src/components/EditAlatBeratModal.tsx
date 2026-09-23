import { useState } from "react";
import { X } from "lucide-react";
import { api, type AlatBerat } from "../lib/api";

export function EditAlatBeratModal({
  alatBerat,
  onClose,
  onSuccess,
}: {
  alatBerat: AlatBerat | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!alatBerat;
  const [kode, setKode] = useState(alatBerat?.kode ?? "");
  const [jenisUnit, setJenisUnit] = useState(alatBerat?.jenis_unit ?? "");
  const [nama, setNama] = useState(alatBerat?.nama ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!kode.trim()) {
      setError("Kode tidak boleh kosong");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (isEdit) {
        await api.updateAlatBerat(alatBerat.id, { kode, jenis_unit: jenisUnit, nama });
      } else {
        await api.createAlatBerat({ kode, jenis_unit: jenisUnit, nama });
      }
      onSuccess();
    } catch (e: any) {
      setError(e?.message?.includes("409") ? "Kode sudah digunakan alat lain" : "Gagal menyimpan perubahan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">
              {isEdit ? "Edit Data Alat Berat" : "Tambah Alat Berat"}
            </h3>
            {isEdit && <p className="text-xs text-[var(--text-secondary)] font-mono">{alatBerat.kode}</p>}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Kode Kendaraan/Alat</label>
            <input
              value={kode}
              onChange={(e) => setKode(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jenis Unit</label>
            <input
              value={jenisUnit}
              onChange={(e) => setJenisUnit(e.target.value)}
              placeholder="cth. DUMP TRUCK, EXCAVATOR"
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Nama / Model</label>
            <input
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Alat"}
          </button>
        </div>
      </div>
    </div>
  );
}
