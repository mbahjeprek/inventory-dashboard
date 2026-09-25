import { useState } from "react";
import { X } from "lucide-react";
import { api, errorText, type PupukRecord } from "../lib/api";

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";
const str = (n: number | null) => (n === null || n === undefined ? "" : String(n));

export function EditPupukModal({
  record,
  divisiOptions,
  onClose,
  onSuccess,
}: {
  record: PupukRecord;
  divisiOptions: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    tanggal_iso: record.tanggal_iso || "",
    divisi: record.divisi || "",
    no_embrace: record.no_embrace || "",
    kode_barang: record.kode_barang || "",
    keluar: str(record.keluar),
    diterima: str(record.diterima),
    saldo_stock: str(record.saldo_stock),
    keterangan: record.keterangan || "",
    blok: record.blok || "",
    ha: str(record.ha),
    pokok: str(record.pokok),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await api.updatePupuk(record.id, { ...form, tanggal_iso: form.tanggal_iso || undefined });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan perubahan"));
    } finally {
      setSubmitting(false);
    }
  };

  const divisiList = divisiOptions.includes(form.divisi) || !form.divisi ? divisiOptions : [form.divisi, ...divisiOptions];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl max-h-[calc(100vh-2rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Edit Transaksi Pupuk</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {record.jenis_pupuk} · {record.estate}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tanggal</label>
              <input type="date" value={form.tanggal_iso} onChange={set("tanggal_iso")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Divisi</label>
              <select value={form.divisi} onChange={set("divisi")} className={inputCls}>
                <option value="">-</option>
                {divisiList.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Keluar (KG)</label>
              <input type="number" min={0} step="any" value={form.keluar} onChange={set("keluar")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Diterima (KG)</label>
              <input type="number" min={0} step="any" value={form.diterima} onChange={set("diterima")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Saldo Stok (KG)</label>
              <input type="number" step="any" value={form.saldo_stock} onChange={set("saldo_stock")} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Blok</label>
              <input value={form.blok} onChange={set("blok")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>HA</label>
              <input type="number" min={0} step="any" value={form.ha} onChange={set("ha")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Pokok</label>
              <input type="number" min={0} value={form.pokok} onChange={set("pokok")} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>No. Embrace</label>
              <input value={form.no_embrace} onChange={set("no_embrace")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Kode Barang</label>
              <input value={form.kode_barang} onChange={set("kode_barang")} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Keterangan</label>
            <input value={form.keterangan} onChange={set("keterangan")} className={inputCls} />
          </div>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}
