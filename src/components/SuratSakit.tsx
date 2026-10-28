import { useState } from "react";
import { FileText, X } from "lucide-react";
import type { Kunjungan } from "../lib/api";
import { printDocument } from "../lib/printTable";
import { isoDisplay } from "../lib/opname";
import { escHtml as esc, logoPerusahaan, logoUrl, penandatangan, perusahaanIngat, terbilang } from "../lib/surat";
import { estateLabel } from "../lib/permintaanSurat";
import { useAuth } from "../context/AuthContext";

// Surat Keterangan Sakit from a kunjungan, laid out like the paper form the klinik used: the kop of the estate's
// company (logo, PT and "ESTATE ...", one rule), place and date on the right, the patient's data (with mandor,
// diagnosa and the obat given), the rest days, and two signatures - Pemeriksa (the paramedis) and Mengetahui (HR).
// The company, kop line, signers and their jabatan are remembered per klinik in this browser.

const tambahHari = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Isian = {
  perusahaan: string;
  unit: string;
  tanggal: string;
  hari: number;
  mulai: string;
  mandor: string;
  diagnosa: string;
  obat: string;
  pemeriksa: string;
  jabatan: string;
  mengetahui: string;
  jabatanMengetahui: string;
};
// What is remembered per klinik (the rest comes from the visit).
const INGAT: (keyof Isian)[] = ["perusahaan", "unit", "pemeriksa", "jabatan", "mengetahui", "jabatanMengetahui"];

const obatText = (k: Kunjungan) =>
  (k.obat ?? [])
    .filter((o) => o.nama_obat)
    .map((o) => [o.nama_obat, o.qty ? `${o.qty}${o.satuan ? ` ${o.satuan.toLowerCase()}` : ""}` : ""].filter(Boolean).join(" "))
    .join(", ");

export function suratHtml(k: Kunjungan, f: Isian) {
  const sampai = tambahHari(f.mulai, f.hari - 1);
  const umur = k.usia !== null && k.usia !== undefined ? `${k.usia} tahun` : "";
  const jk = k.jenis_kelamin === "L" ? "Laki-laki" : k.jenis_kelamin === "P" ? "Perempuan" : k.jenis_kelamin || "";
  const baris = (l: string, v: string) => `<tr><td class="l">${esc(l)}</td><td class="t">:</td><td>${esc(v)}</td></tr>`;
  const logo = logoPerusahaan(f.perusahaan);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Surat Keterangan Sakit ${esc(k.nama_pasien)}</title><style>
    @page { size: A4 portrait; margin: 16mm 18mm 18mm 18mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Cambria, Georgia, "Times New Roman", serif; color: #000; font-size: 11.5pt; line-height: 1.45; margin: 0; }
    .kop { display: flex; align-items: center; gap: 12px; border-bottom: 2.5px solid #000; padding-bottom: 6px; }
    .kop img { width: ${logo.lebar ? 170 : 100}px; height: auto; flex: none; }
    .kop .teks { flex: 1; text-align: center; font-family: Arial, Helvetica, sans-serif; font-weight: bold; font-size: 16pt; line-height: 1.25; text-transform: uppercase; }
    .kop .spasi { width: ${logo.lebar ? 60 : 40}px; flex: none; }
    .tempat { text-align: right; margin-top: 4px; font-size: 10.5pt; }
    h1 { text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 13pt; letter-spacing: 0.5px; margin: 26px 0 26px; }
    .isi { margin: 0 6% 0 6%; }
    p { margin: 0; }
    table.data { border-collapse: collapse; margin: 0 0 28px; }
    table.data td { padding: 0 6px 0 0; vertical-align: top; }
    table.data td.l { width: 165px; }
    table.data td.t { width: 14px; }
    .ttd { display: flex; justify-content: space-between; margin: 34px 6% 0 12%; }
    .ttd > div { width: 42%; text-align: center; }
    .ttd .ruang { height: 78px; }
    .ttd .nama { font-weight: bold; }
    .ttd .nama.garis { text-decoration: underline; }
  </style></head><body>
    <div class="kop">
      <img src="${esc(logoUrl(f.perusahaan))}" alt="${esc(logo.alt)}">
      <div class="teks"><div>${esc(f.perusahaan)}</div><div>${esc(f.unit)}</div></div>
      <div class="spasi"></div>
    </div>
    <div class="tempat">${esc(estateLabel(k.klinik))}, ${esc(isoDisplay(f.tanggal))}</div>
    <h1>SURAT KETERANGAN SAKIT</h1>
    <div class="isi">
      <p>Dengan hormat,</p>
      <p>Bersama dengan ini menerangkan bahwa :</p>
      <table class="data">
        ${baris("Nama", k.nama_pasien)}
        ${baris("Umur", umur)}
        ${baris("Jenis kelamin", jk)}
        ${baris("Jabatan/Divisi", [k.jabatan, k.divisi].filter(Boolean).join(" / "))}
        ${baris("Mandor", f.mandor)}
        ${baris("Diagnosa", f.diagnosa)}
        ${baris("Nama dan jumlah obat", f.obat)}
      </table>
      <p>Adalah benar dalam keadaan sakit, dan mohon diberikan ijin istirahat selama ${f.hari} (${esc(terbilang(f.hari))}) hari, dari tanggal ${esc(isoDisplay(f.mulai))} s/d ${esc(isoDisplay(sampai))}.</p>
      <p>Demikian surat keterangan ini dibuat agar dapat dipergunakan sebagaimana mestinya.</p>
    </div>
    <div class="ttd">
      <div>
        <div>Pemeriksa</div>
        <div class="ruang"></div>
        <div class="nama">${esc(f.pemeriksa || "(................................)")}</div>
        <div>${esc(f.jabatan)}</div>
      </div>
      <div>
        <div>Mengetahui</div>
        <div class="ruang"></div>
        <div class="nama garis">${esc(f.mengetahui || "(................................)")}</div>
        <div>${esc(f.jabatanMengetahui)}</div>
      </div>
    </div>
  </body></html>`;
}

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";

export function SuratSakitModal({ k, onClose }: { k: Kunjungan; onClose: () => void }) {
  const { user } = useAuth();
  const key = `surat-sakit-${k.klinik}`;
  const [f, setF] = useState<Isian>(() => {
    let ingat: Partial<Isian> = {};
    try {
      ingat = JSON.parse(localStorage.getItem(key) ?? "{}");
    } catch {
      /* no storage */
    }
    return {
      perusahaan: perusahaanIngat(ingat.perusahaan, k.klinik),
      unit: ingat.unit || `Estate ${estateLabel(k.klinik)}`,
      tanggal: k.tanggal_iso,
      hari: k.istirahat && k.hari_istirahat > 0 ? k.hari_istirahat : 1,
      mulai: k.tanggal_iso,
      mandor: "",
      diagnosa: k.diagnosis || "",
      obat: obatText(k),
      // The signer by its current account name (full name + title), not a name remembered from before.
      pemeriksa: penandatangan(user, k.created_by),
      jabatan: ingat.jabatan || "Paramedis",
      mengetahui: ingat.mengetahui || "",
      jabatanMengetahui: ingat.jabatanMengetahui || "HR",
    };
  });
  const [error, setError] = useState("");
  const set = <K extends keyof Isian>(n: K, v: Isian[K]) => setF((x) => ({ ...x, [n]: v }));
  const cetak = () => {
    if (!(f.hari > 0)) return setError("Isi jumlah hari istirahat");
    if (!f.pemeriksa.trim()) return setError("Isi nama pemeriksa");
    setError("");
    try {
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(INGAT.map((n) => [n, f[n]]))));
    } catch {
      /* no storage */
    }
    printDocument(suratHtml(k, f));
  };
  const field = (n: keyof Isian, label: string, placeholder = "") => (
    <div>
      <label className={labelCls}>{label}</label>
      <input value={String(f[n])} onChange={(e) => set(n, e.target.value as never)} placeholder={placeholder} className={inputCls} />
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-lg mt-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">Surat Keterangan Sakit</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {k.nama_pasien} · kunjungan {isoDisplay(k.tanggal_iso)}
            </p>
          </div>
          <button onClick={onClose} title="Tutup" className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {!k.istirahat && (
            <p className="text-xs rounded-md border border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] px-3 py-2">
              Di kunjungan ini "Istirahat" tidak dicentang. Pastikan pasien memang perlu istirahat.
            </p>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Istirahat (hari)</label>
              <input type="number" min={1} value={f.hari} onChange={(e) => set("hari", Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Dari tanggal</label>
              <input type="date" value={f.mulai} onChange={(e) => e.target.value && set("mulai", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Tanggal surat</label>
              <input type="date" value={f.tanggal} onChange={(e) => e.target.value && set("tanggal", e.target.value)} className={inputCls} />
            </div>
          </div>
          {field("mandor", "Mandor", "nama mandor pasien")}
          {field("diagnosa", "Diagnosa")}
          {field("obat", "Nama dan jumlah obat", "mis. Paracetamol 10 tab, Amoxicillin 15 kapsul")}
          <div className="grid grid-cols-2 gap-3">
            {field("pemeriksa", "Pemeriksa")}
            {field("jabatan", "Jabatan pemeriksa")}
            {field("mengetahui", "Mengetahui", "mis. nama HR estate")}
            {field("jabatanMengetahui", "Jabatan yang mengetahui")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("perusahaan", "Perusahaan (kop surat)")}
            {field("unit", "Baris kedua kop")}
          </div>
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
              Batal
            </button>
            <button onClick={cetak} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90">
              <FileText size={15} /> Cetak surat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
