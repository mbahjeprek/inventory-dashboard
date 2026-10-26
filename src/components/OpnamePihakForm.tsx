import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { api, type OpnameModule, type OpnameOrang, type OpnamePihak } from "../lib/api";
import { KaryawanAutocomplete } from "./KaryawanAutocomplete";

// The people of a stok opname, one by one with their jabatan: the counters (at least two), the saksi (at least
// one), the pemegang gudang, and the account that approves it - picked from those with Approve Opname of the
// module and estate. Names are suggested from the estate's Master Karyawan, jabatan from the usual ones.
export const JABATAN_OPNAME = ["Asisten", "Askep", "Estate Manager", "KTU", "Kasie", "Mandor", "Kerani", "Krani Gudang", "Admin Gudang", "Kepala Gudang", "Staff", "Operator"];
export const kosongPihak = (): OpnamePihak => ({
  tim: [
    { nama: "", jabatan: "" },
    { nama: "", jabatan: "" },
  ],
  saksi: [{ nama: "", jabatan: "" }],
  pemegang: { nama: "", jabatan: "" },
  penyetuju: { user_id: 0, nama: "", jabatan: "" },
});
// An older opname kept the names only (comma separated): its people without jabatan.
export const pihakDari = (o: { pihak?: OpnamePihak | Record<string, never>; tim: string; saksi: string; pemegang: string }): OpnamePihak => {
  if (o.pihak && "tim" in o.pihak && o.pihak.tim?.length) return o.pihak as OpnamePihak;
  const nama = (v: string) => v.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).map((n) => ({ nama: n, jabatan: "" }));
  const k = kosongPihak();
  const tim = nama(o.tim);
  const saksi = nama(o.saksi);
  return { ...k, tim: tim.length >= 2 ? tim : [...tim, ...k.tim].slice(0, Math.max(2, tim.length)), saksi: saksi.length ? saksi : k.saksi, pemegang: { nama: o.pemegang ?? "", jabatan: "" } };
};
// What is still missing (shown before saving; the server checks it too).
export function pihakKurang(p: OpnamePihak): string {
  const tim = p.tim.filter((o) => o.nama.trim());
  const saksi = p.saksi.filter((o) => o.nama.trim());
  if (tim.length < 2) return "Isi tim penghitung minimal 2 orang";
  if (!saksi.length) return "Isi minimal satu saksi";
  if (!p.pemegang.nama.trim()) return "Isi nama pemegang gudang / stok";
  const tanpa = [...tim, ...saksi, p.pemegang].find((o) => !o.jabatan.trim());
  if (tanpa) return `Isi jabatan ${tanpa.nama}`;
  if (!p.penyetuju.user_id) return "Pilih siapa yang menyetujui (approval)";
  if (!p.penyetuju.jabatan.trim()) return "Isi jabatan penyetuju";
  return "";
}

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const sectionCls = "rounded-md border border-[var(--border)] p-3 space-y-2";

export function OpnamePihakForm({ value: p, onChange, module, estate }: { value: OpnamePihak; onChange: (p: OpnamePihak) => void; module: OpnameModule; estate: string }) {
  const [akun, setAkun] = useState<{ id: number; nama: string; superuser: boolean }[] | null>(null);
  useEffect(() => {
    setAkun(null);
    api
      .opnamePenyetuju(module, estate)
      .then(setAkun)
      .catch(() => setAkun([]));
  }, [module, estate]);
  const setList = (k: "tim" | "saksi", i: number, patch: Partial<OpnameOrang>) => onChange({ ...p, [k]: p[k].map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const baris = (k: "tim" | "saksi", min: number) =>
    p[k].map((o, i) => (
      <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
        <KaryawanAutocomplete estate={estate} value={o.nama} onChange={(v) => setList(k, i, { nama: v })} placeholder={`Nama ${k === "tim" ? `penghitung ${i + 1}` : `saksi ${i + 1}`}`} />
        <input list="jabatan-opname" value={o.jabatan} onChange={(e) => setList(k, i, { jabatan: e.target.value })} placeholder="Jabatan" className={inputCls} />
        <button
          type="button"
          onClick={() => onChange({ ...p, [k]: p[k].filter((_, j) => j !== i) })}
          disabled={p[k].length <= min}
          title="Hapus baris"
          className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--accent-red-bg)] hover:text-[var(--accent-red)] disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <X size={15} />
        </button>
      </div>
    ));
  const tambah = (k: "tim" | "saksi", label: string) => (
    <button type="button" onClick={() => onChange({ ...p, [k]: [...p[k], { nama: "", jabatan: "" }] })} className="inline-flex items-center gap-1 text-xs text-[var(--accent-blue)] hover:underline">
      <Plus size={13} /> {label}
    </button>
  );
  const head = (t: string, sub?: string) => (
    <p className="text-xs font-medium text-[var(--text-primary)]">
      {t} {sub && <span className="font-normal text-[var(--text-muted)]">{sub}</span>}
    </p>
  );
  return (
    <div className="space-y-3">
      <datalist id="jabatan-opname">
        {JABATAN_OPNAME.map((j) => (
          <option key={j} value={j} />
        ))}
      </datalist>
      <div className={sectionCls}>
        {head("Tim penghitung", "· minimal 2 orang, sebaiknya bukan pemegang gudang ini")}
        {baris("tim", 2)}
        {tambah("tim", "Tambah penghitung")}
      </div>
      <div className={sectionCls}>
        {head("Saksi", "· minimal 1 orang, mis. Asisten / KTU")}
        {baris("saksi", 1)}
        {tambah("saksi", "Tambah saksi")}
      </div>
      <div className={sectionCls}>
        {head("Pemegang gudang / stok")}
        <div className="grid grid-cols-2 gap-2">
          <KaryawanAutocomplete estate={estate} value={p.pemegang.nama} onChange={(v) => onChange({ ...p, pemegang: { ...p.pemegang, nama: v } })} placeholder="Nama admin / kepala gudang" />
          <input list="jabatan-opname" value={p.pemegang.jabatan} onChange={(e) => onChange({ ...p, pemegang: { ...p.pemegang, jabatan: e.target.value } })} placeholder="Jabatan" className={inputCls} />
        </div>
      </div>
      <div className={sectionCls}>
        {head("Disetujui oleh (approval)", "· akun dengan hak Approve Opname di estate ini; hanya akun ini (atau Super User) yang bisa menyetujui")}
        <div className="grid grid-cols-2 gap-2">
          <select
            value={p.penyetuju.user_id || ""}
            onChange={(e) => {
              const a = akun?.find((x) => x.id === Number(e.target.value));
              onChange({ ...p, penyetuju: { ...p.penyetuju, user_id: a?.id ?? 0, nama: a?.nama ?? "" } });
            }}
            className={inputCls}
          >
            <option value="">{akun === null ? "Memuat..." : akun.length ? "Pilih penyetuju" : "Belum ada akun dengan hak Approve Opname"}</option>
            {akun?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nama}
                {a.superuser ? " (Super User)" : ""}
              </option>
            ))}
          </select>
          <input list="jabatan-opname" value={p.penyetuju.jabatan} onChange={(e) => onChange({ ...p, penyetuju: { ...p.penyetuju, jabatan: e.target.value } })} placeholder="Jabatan, mis. Estate Manager" className={inputCls} />
        </div>
      </div>
    </div>
  );
}
