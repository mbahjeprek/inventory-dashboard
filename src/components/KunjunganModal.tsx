import { useEffect, useState, type ReactNode } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { api, errorText, type Kunjungan, type KunjunganInput, type KunjunganObat, type KunjunganOptions } from "../lib/api";
import { KaryawanAutocomplete } from "./KaryawanAutocomplete";
import { EvidenceInput, EvidenceLink } from "./EvidenceInput";
import { JENIS_KUNJUNGAN, MAX_TERAPI, STATUS_PASIEN, hariOf, kodeTglOf, periodeOf, usiaOf } from "../lib/kunjungan";

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-[var(--bg-card)] disabled:bg-[#f8fafc] disabled:text-[var(--text-muted)]";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const blankObat = (): KunjunganObat => ({ obat_kode: "", nama_obat: "", qty: null, satuan: "" });

function blank(tanggal: string): KunjunganInput {
  return {
    tanggal_iso: tanggal,
    jenis_kunjungan: "Rawat Jalan",
    nama_pasien: "",
    jenis_kelamin: "",
    tanggal_lahir_iso: null,
    usia: null,
    status_pasien: "",
    penanggung: "",
    jabatan: "",
    divisi: "",
    tempat_tinggal: "",
    asal_pasien: "",
    diagnosis: "",
    kecelakaan_kerja: false,
    istirahat: false,
    hari_istirahat: 0,
    rujukan: false,
    provider: "",
    detail_kejadian: "",
    obat: [blankObat(), blankObat(), blankObat()],
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border border-[var(--border)] rounded-lg p-3 sm:p-4">
      <legend className="px-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--accent-blue)]">{title}</legend>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{children}</div>
    </fieldset>
  );
}
function Field({ label, children, span = 1, hint }: { label: string; children: ReactNode; span?: 1 | 2 | 4; hint?: string }) {
  const cls = span === 4 ? "col-span-2 sm:col-span-4" : span === 2 ? "col-span-2" : "";
  return (
    <label className={`block min-w-0 ${cls}`}>
      <span className="text-xs text-[var(--text-secondary)] mb-1 block">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">{hint}</span>}
    </label>
  );
}
// Ya / Tidak (or L / P) as two buttons, like the sheet's dropdown.
function Toggle<T extends string | boolean>({ value, options, onChange }: { value: T | ""; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-cols-2 rounded-md border border-[var(--border)] overflow-hidden">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          className={`text-sm py-2 ${value === o.v ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-secondary)] hover:bg-[#f1f5f9]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
const YA_TIDAK = [
  { v: true, label: "Ya" },
  { v: false, label: "Tidak" },
];

// Input / edit one patient visit: the Daily Report sheet's columns in its order and groups (Data
// Kunjungan, Identitas, Medis, Farmasi, Dokumentasi). No, Periode, Kode tgl, Hari and Usia fill
// themselves from the dates.
export function KunjunganModal({ klinik, kunjungan, onClose, onSaved }: { klinik: string; kunjungan: Kunjungan | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!kunjungan;
  const [f, setF] = useState<KunjunganInput>(() => {
    if (!kunjungan) return blank(today());
    const obat = kunjungan.obat.length ? kunjungan.obat : [blankObat()];
    return { ...kunjungan, obat };
  });
  const [opts, setOpts] = useState<KunjunganOptions | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    api.kunjunganOptions(klinik).then(setOpts).catch(() => setOpts(null));
  }, [klinik]);

  const set = <K extends keyof KunjunganInput>(k: K, v: KunjunganInput[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const usiaAuto = usiaOf(f.tanggal_lahir_iso, f.tanggal_iso);
  const usia = usiaAuto ?? f.usia;
  const obatByNama = new Map((opts?.obat ?? []).map((o) => [o.nama.toLowerCase(), o]));
  const setObat = (i: number, patch: Partial<KunjunganObat>) => setF((cur) => ({ ...cur, obat: cur.obat.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));
  const pickObat = (i: number, nama: string) => {
    const m = obatByNama.get(nama.trim().toLowerCase());
    setObat(i, m ? { nama_obat: nama, obat_kode: m.kode, satuan: f.obat[i].satuan || (m.satuan ?? "").toUpperCase() } : { nama_obat: nama, obat_kode: "" });
  };

  const save = async (again: boolean) => {
    setError("");
    const missing = [
      !f.tanggal_iso && "Tanggal",
      !f.jenis_kunjungan && "Jenis Kunjungan",
      !f.nama_pasien.trim() && "Nama Pasien",
      !f.jenis_kelamin && "Jenis Kelamin",
      !f.status_pasien && "Status Pasien",
      f.istirahat && !(f.hari_istirahat > 0) && "Jumlah Hari Istirahat",
    ].filter(Boolean);
    if (missing.length) return setError(`Wajib diisi: ${missing.join(", ")}`);
    const payload = { ...f, usia, hari_istirahat: f.istirahat ? f.hari_istirahat : 0, provider: f.rujukan ? f.provider : "", obat: f.obat.filter((o) => o.nama_obat.trim() || o.qty) };
    setSaving(true);
    try {
      if (isEdit) await api.updateKunjungan(kunjungan.id, { ...payload, evidence_id: evidenceId });
      else await api.createKunjungan({ ...payload, klinik, evidence_id: evidenceId });
      if (again) {
        // Next patient of the same day.
        setF(blank(f.tanggal_iso));
        setEvidenceId(null);
        setSavedCount((n) => n + 1);
        onSaved();
        document.getElementById("kunjungan-form")?.scrollTo({ top: 0 });
      } else {
        onSaved();
        onClose();
      }
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan kunjungan"));
    } finally {
      setSaving(false);
    }
  };

  const list = (id: string, values: string[] | undefined) => (
    <datalist id={id}>
      {(values ?? []).map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-[var(--bg-card)] rounded-lg w-full max-w-4xl shadow-xl max-h-[calc(100vh-1rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">{isEdit ? "Edit Kunjungan" : "Input Kunjungan"} - Klinik {klinik}</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              {isEdit ? `No ${kunjungan.nomor} · ${kunjungan.nama_pasien}` : savedCount ? `${savedCount} kunjungan tersimpan · lanjut pasien berikutnya` : "Laporan harian pasien"}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Tutup">
            <X size={18} />
          </button>
        </div>

        <div id="kunjungan-form" className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          <Section title="Data Kunjungan">
            <Field label="No">
              <input value={isEdit ? kunjungan.nomor : "otomatis"} disabled className={inputCls} />
            </Field>
            <Field label="Tanggal">
              <input type="date" value={f.tanggal_iso} max={today()} onChange={(e) => set("tanggal_iso", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Periode">
              <input value={periodeOf(f.tanggal_iso)} disabled className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kode tgl">
                <input value={kodeTglOf(f.tanggal_iso)} disabled className={inputCls} />
              </Field>
              <Field label="Hari">
                <input value={hariOf(f.tanggal_iso)} disabled className={inputCls} />
              </Field>
            </div>
            <Field label="Jenis Kunjungan" span={4}>
              <div className="grid grid-cols-2 sm:grid-cols-4 rounded-md border border-[var(--border)] overflow-hidden">
                {JENIS_KUNJUNGAN.map((j) => (
                  <button
                    key={j}
                    type="button"
                    onClick={() => set("jenis_kunjungan", j)}
                    className={`text-sm py-2 ${f.jenis_kunjungan === j ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-secondary)] hover:bg-[#f1f5f9]"}`}
                  >
                    {j}
                  </button>
                ))}
              </div>
            </Field>
          </Section>

          <Section title="Data Identitas">
            <Field label="Nama Pasien" span={2}>
              <KaryawanAutocomplete estate={klinik} value={f.nama_pasien} onChange={(v) => set("nama_pasien", v)} placeholder="ketik nama pasien" />
            </Field>
            <Field label="Jenis Kelamin L/P">
              <Toggle value={f.jenis_kelamin} options={[{ v: "L", label: "L" }, { v: "P", label: "P" }]} onChange={(v) => set("jenis_kelamin", v)} />
            </Field>
            <Field label="Status Pasien">
              <select value={f.status_pasien} onChange={(e) => set("status_pasien", e.target.value)} className={inputCls}>
                <option value="">- Pilih -</option>
                {STATUS_PASIEN.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Tanggal Lahir">
              <input
                type="date"
                value={f.tanggal_lahir_iso ?? ""}
                max={f.tanggal_iso}
                onChange={(e) => set("tanggal_lahir_iso", e.target.value || null)}
                className={inputCls}
              />
            </Field>
            <Field label="Usia" hint={usiaAuto !== null ? "dari tanggal lahir" : "isi kalau tanggal lahir tidak diketahui"}>
              <input
                type="number"
                min={0}
                max={120}
                value={usia ?? ""}
                disabled={usiaAuto !== null}
                onChange={(e) => set("usia", e.target.value === "" ? null : Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field label="Nama Yang Menanggung" span={2} hint="Untuk Istri / Anak: nama pekerja yang menanggung">
              <KaryawanAutocomplete estate={klinik} value={f.penanggung} onChange={(v) => set("penanggung", v)} placeholder="nama pekerja" />
            </Field>
            <Field label="Jabatan">
              <input value={f.jabatan} onChange={(e) => set("jabatan", e.target.value)} list="kj-jabatan" className={inputCls} />
              {list("kj-jabatan", opts?.jabatan)}
            </Field>
            <Field label="Divisi">
              <input value={f.divisi} onChange={(e) => set("divisi", e.target.value)} list="kj-divisi" className={inputCls} />
              {list("kj-divisi", opts?.divisi)}
            </Field>
            <Field label="Tempat Tinggal">
              <input value={f.tempat_tinggal} onChange={(e) => set("tempat_tinggal", e.target.value)} list="kj-tinggal" className={inputCls} />
              {list("kj-tinggal", opts?.tempat_tinggal)}
            </Field>
            <Field label="Asal Pasien Non PT AKSS">
              <input value={f.asal_pasien} onChange={(e) => set("asal_pasien", e.target.value)} list="kj-asal" className={inputCls} />
              {list("kj-asal", opts?.asal_pasien)}
            </Field>
          </Section>

          <Section title="Data Medis">
            <Field label="Diagnosis" span={4} hint="Lebih dari satu diagnosis: pisahkan dengan koma">
              <input value={f.diagnosis} onChange={(e) => set("diagnosis", e.target.value)} list="kj-diagnosis" className={inputCls} />
              {list("kj-diagnosis", opts?.diagnosis)}
            </Field>
            <Field label="Kecelakaan Kerja Y/N">
              <Toggle value={f.kecelakaan_kerja} options={YA_TIDAK} onChange={(v) => set("kecelakaan_kerja", v)} />
            </Field>
            <Field label="Istirahat">
              <Toggle value={f.istirahat} options={YA_TIDAK} onChange={(v) => setF((c) => ({ ...c, istirahat: v, hari_istirahat: v ? c.hari_istirahat || 1 : 0 }))} />
            </Field>
            <Field label="Jumlah Hari Istirahat">
              <input
                type="number"
                min={1}
                value={f.istirahat ? f.hari_istirahat || "" : ""}
                disabled={!f.istirahat}
                onChange={(e) => set("hari_istirahat", Number(e.target.value) || 0)}
                className={inputCls}
              />
            </Field>
            <Field label="Rujukan">
              <Toggle value={f.rujukan} options={YA_TIDAK} onChange={(v) => set("rujukan", v)} />
            </Field>
            <Field label="Provider" span={4}>
              <input value={f.rujukan ? f.provider : ""} disabled={!f.rujukan} onChange={(e) => set("provider", e.target.value)} list="kj-provider" placeholder={f.rujukan ? "tempat rujukan" : "-"} className={inputCls} />
              {list("kj-provider", opts?.provider)}
            </Field>
          </Section>

          <fieldset className="border border-[var(--border)] rounded-lg p-3 sm:p-4">
            <legend className="px-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--accent-blue)]">Data Farmasi</legend>
            <div className="hidden sm:grid grid-cols-[2rem_1fr_6rem_8rem_2rem] gap-2 text-xs text-[var(--text-secondary)] mb-1">
              <span />
              <span>Terapi</span>
              <span>Qty</span>
              <span>Satuan</span>
              <span />
            </div>
            <div className="space-y-2">
              {f.obat.map((o, i) => {
                const m = obatByNama.get(o.nama_obat.trim().toLowerCase());
                return (
                  <div key={i} className="grid grid-cols-[2rem_1fr_2rem] sm:grid-cols-[2rem_1fr_6rem_8rem_2rem] gap-2 items-start">
                    <span className="text-xs text-[var(--text-muted)] pt-2.5">{i + 1}</span>
                    <div className="min-w-0">
                      <input value={o.nama_obat} onChange={(e) => pickObat(i, e.target.value)} list="kj-obat" placeholder={`Terapi ${i + 1}`} aria-label={`Terapi ${i + 1}`} className={inputCls} />
                      {m && m.stok !== null && <span className="text-[11px] text-[var(--text-muted)]">stok klinik {m.stok.toLocaleString("id-ID")} {m.satuan}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setF((c) => ({ ...c, obat: c.obat.length > 1 ? c.obat.filter((_, j) => j !== i) : [blankObat()] }))}
                      title="Hapus baris"
                      className="sm:order-last p-2 rounded-md text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                    >
                      <Trash2 size={14} />
                    </button>
                    <div className="col-start-2 sm:col-start-auto grid grid-cols-2 sm:contents gap-2">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={o.qty ?? ""}
                        onChange={(e) => setObat(i, { qty: e.target.value === "" ? null : Number(e.target.value) })}
                        placeholder={`Qty ${i + 1}`}
                        aria-label={`Qty ${i + 1}`}
                        className={inputCls}
                      />
                      <input value={o.satuan} onChange={(e) => setObat(i, { satuan: e.target.value.toUpperCase() })} list="kj-satuan" placeholder="Satuan" aria-label={`Satuan ${i + 1}`} className={inputCls} />
                    </div>
                  </div>
                );
              })}
            </div>
            {list("kj-satuan", opts?.satuan)}
            <datalist id="kj-obat">
              {(opts?.obat ?? []).map((o) => (
                <option key={o.kode} value={o.nama} />
              ))}
            </datalist>
            {f.obat.length < MAX_TERAPI && (
              <button type="button" onClick={() => setF((c) => ({ ...c, obat: [...c.obat, blankObat()] }))} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-blue)] hover:underline">
                <Plus size={14} /> Tambah terapi ({f.obat.length}/{MAX_TERAPI})
              </button>
            )}
          </fieldset>

          <fieldset className="border border-[var(--border)] rounded-lg p-3 sm:p-4 space-y-3">
            <legend className="px-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--accent-blue)]">Dokumentasi</legend>
            {isEdit && kunjungan.evidence_id && !evidenceId && (
              <div className="text-xs text-[var(--text-secondary)]">
                Foto tersimpan: <EvidenceLink id={kunjungan.evidence_id} /> · upload di bawah untuk mengganti
              </div>
            )}
            <EvidenceInput value={evidenceId} onChange={setEvidenceId} label="Foto (opsional)" />
            <Field label="Detail Kejadian" span={4}>
              <textarea value={f.detail_kejadian} onChange={(e) => set("detail_kejadian", e.target.value)} rows={2} placeholder="cth. kronologi kecelakaan kerja" className={inputCls} />
            </Field>
          </fieldset>
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] space-y-2">
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
              Batal
            </button>
            {!isEdit && (
              <button onClick={() => save(true)} disabled={saving} className="px-4 py-2 text-sm rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)] disabled:opacity-50">
                Simpan & input pasien berikutnya
              </button>
            )}
            <button onClick={() => save(false)} disabled={saving} className="px-4 py-2 text-sm rounded-md font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50">
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
