import { useState } from "react";
import { X } from "lucide-react";
import { api, type StockInRecord } from "../lib/api";
import { EditEvidenceField } from "./EvidenceInput";

const TUJUAN_OPTIONS = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"];

export function EditStockInModal({
  record,
  onClose,
  onSuccess,
}: {
  record: StockInRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [namaVendor, setNamaVendor] = useState(record.nama_vendor || "");
  // A new foto bukti replaces the current one (none picked = it stays).
  const [newEvidence, setNewEvidence] = useState<string | null>(null);
  const [qty, setQty] = useState(record.qty);
  const [satuan, setSatuan] = useState(record.satuan || "");
  const [tujuan, setTujuan] = useState(record.tujuan || "");
  const [tanggal, setTanggal] = useState(record.tanggal_terima_iso || "");
  const [keterangan, setKeterangan] = useState(record.keterangan || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (qty <= 0) {
      setError("Jumlah harus lebih dari 0");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.updateStockIn(record.id, {
        ...(newEvidence ? { evidence_id: newEvidence } : {}),
        nama_vendor: namaVendor,
        qty,
        satuan,
        tujuan: tujuan || null,
        tanggal_terima_iso: tanggal || null,
        keterangan,
      });
      onSuccess();
    } catch {
      setError("Gagal menyimpan perubahan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Edit Stock In</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {record.kode} · {record.nama}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tanggal Terima</label>
              <input
                type="date"
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Tujuan / Konsumen</label>
              <select
                value={tujuan}
                onChange={(e) => setTujuan(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              >
                <option value="">-</option>
                {TUJUAN_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Vendor</label>
            <input
              value={namaVendor}
              onChange={(e) => setNamaVendor(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jumlah</label>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(parseInt(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Satuan</label>
              <input
                value={satuan}
                onChange={(e) => setSatuan(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Keterangan</label>
            <input
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
            />
          </div>

          <EditEvidenceField current={record.evidence_id} value={newEvidence} onChange={setNewEvidence} />

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
