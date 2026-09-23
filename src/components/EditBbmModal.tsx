import { useState } from "react";
import { X } from "lucide-react";
import { api, type BbmRecord } from "../lib/api";

export function EditBbmModal({
  record,
  onClose,
  onSuccess,
}: {
  record: BbmRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [tanggal, setTanggal] = useState(record.tanggal_iso || "");
  const [noSpb, setNoSpb] = useState(record.no_spb || "");
  const [diterima, setDiterima] = useState(record.diterima ?? "");
  const [pemakaian, setPemakaian] = useState(record.pemakaian ?? "");
  const [saldoStock, setSaldoStock] = useState(record.saldo_stock ?? "");
  const [keterangan, setKeterangan] = useState(record.keterangan || "");
  const [estate, setEstate] = useState(record.estate || "");
  const [kodeKendaraan, setKodeKendaraan] = useState(record.kode_kendaraan || "");
  const [hmTerakhir, setHmTerakhir] = useState(record.hm_terakhir || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await api.updateBbm(record.id, {
        tanggal_iso: tanggal || undefined,
        no_spb: noSpb,
        diterima: diterima === "" ? null : Number(diterima),
        pemakaian: pemakaian === "" ? null : Number(pemakaian),
        saldo_stock: saldoStock === "" ? null : Number(saldoStock),
        keterangan,
        estate,
        kode_kendaraan: kodeKendaraan,
        hm_terakhir: hmTerakhir,
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
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Edit Transaksi BBM</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {record.jenis_bbm} · {record.lokasi}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
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
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">No. SPB</label>
              <input value={noSpb} onChange={(e) => setNoSpb(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Stok Masuk</label>
              <input
                type="number"
                min={0}
                value={diterima}
                onChange={(e) => setDiterima(e.target.value === "" ? "" : parseInt(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Stok Keluar</label>
              <input
                type="number"
                min={0}
                value={pemakaian}
                onChange={(e) => setPemakaian(e.target.value === "" ? "" : parseInt(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Sisa</label>
              <input
                type="number"
                value={saldoStock}
                onChange={(e) => setSaldoStock(e.target.value === "" ? "" : parseInt(e.target.value) || 0)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Estate</label>
            <input value={estate} onChange={(e) => setEstate(e.target.value)} className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Kode Kendaraan</label>
              <input
                value={kodeKendaraan}
                onChange={(e) => setKodeKendaraan(e.target.value)}
                className="w-full text-sm rounded-md border border-[var(--border)] px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">HM/KM Terakhir</label>
              <input
                value={hmTerakhir}
                onChange={(e) => setHmTerakhir(e.target.value)}
                placeholder="cth. 4373.7 h"
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
