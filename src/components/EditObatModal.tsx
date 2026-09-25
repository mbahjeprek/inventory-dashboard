import { useState } from "react";
import { X } from "lucide-react";
import { api, type Obat } from "../lib/api";

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2";

export function EditObatModal({
  obat,
  kategoriOptions,
  jenisOptions,
  satuanOptions,
  onClose,
  onSuccess,
}: {
  obat: Obat | null;
  kategoriOptions: string[];
  jenisOptions: { kategori: string; jenis: string }[];
  satuanOptions: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!obat;
  const [form, setForm] = useState({
    kode: obat?.kode ?? "",
    nama: obat?.nama ?? "",
    kategori: obat?.kategori ?? "",
    jenis: obat?.jenis ?? "",
    deskripsi: obat?.deskripsi ?? "",
    satuan: obat?.satuan ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Jenis/Kelompok: a dropdown of the jenis already used in the chosen kategori (all when none is
  // chosen); "+ Jenis baru" switches to typing one.
  const jenisList = [...new Set(jenisOptions.filter((j) => !form.kategori || j.kategori === form.kategori).map((j) => j.jenis))].sort((a, b) =>
    a.localeCompare(b)
  );
  const [jenisBaru, setJenisBaru] = useState(false);
  const typingJenis = jenisBaru || (!!form.jenis && !jenisList.includes(form.jenis) && !jenisOptions.some((j) => j.jenis === form.jenis));
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.kode.trim() || !form.nama.trim()) {
      setError("Kode dan nama tidak boleh kosong");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = { ...form, satuan: form.satuan.trim().toUpperCase() };
      if (isEdit) await api.updateObat(obat.id, payload);
      else await api.createObat(payload);
      onSuccess();
    } catch (e: any) {
      setError(e?.message?.includes("409") ? "Kode sudah dipakai obat lain" : "Gagal menyimpan perubahan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">{isEdit ? "Edit Data Obat" : "Tambah Obat"}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Kode</label>
              <input value={form.kode} onChange={set("kode")} placeholder="OB-0151" className={`${inputCls} font-mono`} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Nama Obat/Barang</label>
              <input value={form.nama} onChange={set("nama")} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Kategori</label>
              <input value={form.kategori} onChange={set("kategori")} list="obat-kategori" className={inputCls} />
              <datalist id="obat-kategori">
                {kategoriOptions.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Jenis/Kelompok</label>
              {typingJenis ? (
                <div className="flex gap-1">
                  <input value={form.jenis} onChange={set("jenis")} placeholder="Jenis baru" autoFocus className={inputCls} />
                  <button
                    type="button"
                    onClick={() => {
                      setJenisBaru(false);
                      setForm((f) => ({ ...f, jenis: "" }));
                    }}
                    title="Kembali ke pilihan"
                    className="px-2 rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <select
                  value={form.jenis}
                  onChange={(e) => {
                    if (e.target.value === "__baru") {
                      setJenisBaru(true);
                      setForm((f) => ({ ...f, jenis: "" }));
                    } else set("jenis")(e);
                  }}
                  className={inputCls}
                >
                  <option value="">- Pilih -</option>
                  {form.jenis && !jenisList.includes(form.jenis) && <option value={form.jenis}>{form.jenis}</option>}
                  {jenisList.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                  <option value="__baru">+ Jenis baru...</option>
                </select>
              )}
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Satuan</label>
              <input value={form.satuan} onChange={set("satuan")} list="obat-satuan" className={inputCls} />
              <datalist id="obat-satuan">
                {satuanOptions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">Deskripsi / Kegunaan</label>
            <textarea value={form.deskripsi} onChange={set("deskripsi")} rows={3} className={inputCls} />
          </div>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2.5 rounded-md text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Simpan Obat"}
          </button>
        </div>
      </div>
    </div>
  );
}
