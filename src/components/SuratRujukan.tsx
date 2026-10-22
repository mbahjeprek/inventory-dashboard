import { useState } from "react";
import { FileText, X } from "lucide-react";
import type { Kunjungan } from "../lib/api";
import { printDocument } from "../lib/printTable";
import { isoDisplay } from "../lib/opname";
import { escHtml as esc, tanggalPanjang } from "../lib/surat";

// Surat Rujukan from a kunjungan, in the clinics' own format: kop "PT. ANUGRAH KEMBANG SAWIT SEJAHTERA /
// DEPARTEMEN KLINIK ESTATE <estate>", nomor <visit>/AKSS-<kode estate>/<bulan romawi>/<tahun>, Kepada Yth.
// Dokter Jaga di <tujuan>, the patient, anamnesa, riwayat penyakit, TTV, KU, diagnosa, penunjang, terapi
// and the Medis Perusahaan signature. The tujuan list, the signer and the company line are remembered per
// klinik in this browser; the clinical fields are typed for this letter only.

const KODE_ESTATE: Record<string, string> = { NILAM: "NLM", ZAMRUD: "ZMD", FIRUS: "FRS", KNS: "KNS", WJA: "WJA" };
const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
export const nomorRujukan = (k: Pick<Kunjungan, "id" | "klinik" | "tanggal_iso">) =>
  `${String(k.id).padStart(5, "0")}/AKSS-${KODE_ESTATE[k.klinik] ?? k.klinik}/${ROMAWI[Number(k.tanggal_iso.slice(5, 7)) - 1]}/${k.tanggal_iso.slice(0, 4)}`;
const kotaOf = (klinik: string) => klinik.charAt(0) + klinik.slice(1).toLowerCase();

type Isian = {
  perusahaan: string;
  tujuan: string;
  kepada: string;
  alamat: string;
  jaminan: string;
  anamnesa: string;
  riwayat: string;
  td: string;
  nadi: string;
  suhu: string;
  rr: string;
  spo2: string;
  ku: string;
  diagnosa: string;
  penunjang: string;
  terapi: string;
  petugas: string;
  gelar: string;
  tanggal: string;
};

export function rujukanHtml(k: Kunjungan, f: Isian) {
  const baris = (l: string, v: string, tebal = false) => `<tr><td class="l${tebal ? " b" : ""}">${esc(l)}</td><td>:</td><td>${esc(v) || "&nbsp;"}</td></tr>`;
  const blok = (l: string, v: string) =>
    `<div class="blok"><div class="b">${esc(l)} :</div><div class="isi">${v.trim() ? esc(v).replace(/\n/g, "<br>") : '<div class="titik"></div><div class="titik"></div>'}</div></div>`;
  const tglLahir = [k.tanggal_lahir_iso ? isoDisplay(k.tanggal_lahir_iso) : "", k.usia !== null && k.usia !== undefined ? `${k.usia} tahun` : ""].filter(Boolean).join(" / ");
  const jk = k.jenis_kelamin === "L" ? "Laki-laki" : k.jenis_kelamin === "P" ? "Perempuan" : k.jenis_kelamin;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Surat Rujukan ${esc(k.nama_pasien)}</title><style>
    @page { size: A4 portrait; margin: 16mm 18mm 16mm 20mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #000; font-size: 11.5pt; line-height: 1.5; margin: 0; }
    .kop { text-align: center; font-weight: bold; font-size: 12.5pt; line-height: 1.35; border-bottom: 2px solid #000; padding-bottom: 8px; }
    h1 { text-align: center; font-size: 12.5pt; margin: 16px 0 0; text-decoration: underline; }
    .nomor { text-align: center; font-weight: bold; margin: 0 0 14px; }
    p { margin: 0 0 6px; }
    table.data { border-collapse: collapse; margin: 2px 0 6px; }
    table.data td { padding: 1px 6px 1px 0; vertical-align: top; }
    table.data td.l { width: 165px; }
    .b { font-weight: bold; }
    .blok { margin: 8px 0; }
    .blok .isi { margin-left: 0; min-height: 18px; }
    .titik { border-bottom: 1px dotted #000; height: 22px; }
    .ttv span { margin-right: 22px; white-space: nowrap; }
    .ttd { width: 45%; margin: 22px 0 0 auto; text-align: center; }
    .ttd .ruang { height: 66px; }
    .ttd .nama { font-weight: bold; text-decoration: underline; }
  </style></head><body>
    <div class="kop">${esc(f.perusahaan.toUpperCase())}<br>DEPARTEMEN KLINIK ESTATE ${esc(k.klinik)}</div>
    <h1>SURAT RUJUKAN</h1>
    <div class="nomor">Nomor : ${esc(nomorRujukan(k))}</div>
    <p>Kepada<br>Yth. ${esc(f.kepada || "Dokter Jaga")}<br>Di ${esc(f.tujuan || "......................................")}</p>
    <p style="margin-top:12px">Dengan hormat,<br>Mohon pemeriksaan dan perawatan lebih lanjut terhadap pasien :</p>
    <table class="data">
      ${baris("Nama", k.nama_pasien)}
      ${baris("Jenis Kelamin", jk)}
      ${baris("Tanggal Lahir / Usia", tglLahir)}
      ${k.jabatan || k.divisi ? baris("Jabatan / Divisi", [k.jabatan, k.divisi].filter(Boolean).join(" / ")) : ""}
      ${baris("Alamat", f.alamat)}
      ${baris("Jaminan", f.jaminan)}
    </table>
    ${blok("Anamnesa", f.anamnesa)}
    ${blok("Riwayat Penyakit", f.riwayat)}
    <div class="blok"><div class="b">Pemeriksaan TTV</div>
      <div class="ttv"><span>TD : ${esc(f.td) || "&nbsp;&nbsp;&nbsp;&nbsp;"} mmHg</span><span>N : ${esc(f.nadi) || "&nbsp;&nbsp;&nbsp;"} x/m</span><span>S : ${esc(f.suhu) || "&nbsp;&nbsp;&nbsp;"} °C</span><span>RR : ${esc(f.rr) || "&nbsp;&nbsp;&nbsp;"} x/i</span><span>SpO2 : ${esc(f.spo2) || "&nbsp;&nbsp;&nbsp;"} %</span></div>
      <div><span class="b">KU</span> : ${esc(f.ku)}</div>
    </div>
    ${blok("Diagnosa", f.diagnosa)}
    ${blok("Pemeriksaan Penunjang", f.penunjang)}
    ${blok("Terapi dan Jam Pemberian", f.terapi)}
    <p style="margin-top:12px">Demikian surat rujukan ini dibuat, atas perhatiannya kami ucapkan terima kasih.</p>
    <div class="ttd">
      <div>${esc(kotaOf(k.klinik))}, ${esc(tanggalPanjang(f.tanggal))}</div>
      <div>Medis Perusahaan</div>
      <div class="ruang"></div>
      <div class="nama">${esc([f.petugas, f.gelar].filter((x) => x.trim()).join(" ") || "(................................)")}</div>
    </div>
  </body></html>`;
}

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";

export function SuratRujukanModal({ k, onClose }: { k: Kunjungan; onClose: () => void }) {
  const key = `surat-rujukan-${k.klinik}`;
  let ingat: { perusahaan?: string; petugas?: string; gelar?: string; tujuanList?: string[] } = {};
  try {
    ingat = JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    /* no storage */
  }
  const tujuanList = [...new Set([k.provider, ...(ingat.tujuanList ?? [])].filter(Boolean))] as string[];
  const terapiAwal = (k.obat ?? [])
    .filter((o) => o.nama_obat.trim())
    .map((o) => `- ${o.nama_obat}${o.qty !== null && o.qty !== undefined ? ` ${o.qty}${o.satuan ? ` ${o.satuan.toLowerCase()}` : ""}` : ""} (jam ......)`)
    .join("\n");
  const [f, setF] = useState<Isian>({
    perusahaan: ingat.perusahaan || "PT. Anugrah Kembang Sawit Sejahtera",
    tujuan: k.provider || tujuanList[0] || "",
    kepada: "Dokter Jaga",
    alamat: k.tempat_tinggal || `Camp PT. AKSS Estate ${kotaOf(k.klinik)}`,
    jaminan: "BPJS",
    anamnesa: k.detail_kejadian || "",
    riwayat: "",
    td: "",
    nadi: "",
    suhu: "",
    rr: "",
    spo2: "",
    ku: "",
    diagnosa: k.diagnosis || "",
    penunjang: "",
    terapi: terapiAwal,
    petugas: ingat.petugas || k.created_by || "",
    gelar: ingat.gelar || "",
    tanggal: k.tanggal_iso,
  });
  const [error, setError] = useState("");
  const set = <K extends keyof Isian>(n: K, v: Isian[K]) => setF((x) => ({ ...x, [n]: v }));
  const cetak = () => {
    if (!f.tujuan.trim()) return setError("Isi tujuan rujukan (rumah sakit / puskesmas)");
    if (!f.petugas.trim()) return setError("Isi nama petugas medis");
    setError("");
    try {
      localStorage.setItem(key, JSON.stringify({ perusahaan: f.perusahaan, petugas: f.petugas, gelar: f.gelar, tujuanList: [f.tujuan.trim(), ...tujuanList.filter((t) => t !== f.tujuan.trim())].slice(0, 10) }));
    } catch {
      /* no storage */
    }
    printDocument(rujukanHtml(k, f));
  };
  const area = (n: keyof Isian, label: string, rows = 2, ph = "") => (
    <div className="col-span-2">
      <label className={labelCls}>{label}</label>
      <textarea value={f[n]} onChange={(e) => set(n, e.target.value)} rows={rows} placeholder={ph} className={inputCls} />
    </div>
  );
  const kecil = (n: keyof Isian, label: string, satuan: string) => (
    <div>
      <label className={labelCls}>
        {label} <span className="text-[var(--text-muted)]">({satuan})</span>
      </label>
      <input value={f[n]} onChange={(e) => set(n, e.target.value)} className={inputCls} />
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-2xl mt-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">Surat Rujukan</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {k.nama_pasien} · Klinik {k.klinik} · kunjungan {isoDisplay(k.tanggal_iso)} · No. {nomorRujukan(k)}
            </p>
          </div>
          <button onClick={onClose} title="Tutup" className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Tujuan rujukan (rumah sakit / puskesmas)</label>
            <input value={f.tujuan} onChange={(e) => set("tujuan", e.target.value)} list="rujukan-tujuan" placeholder="mis. IGD RSUD Akhmad Berahim" className={inputCls} />
            <datalist id="rujukan-tujuan">
              {tujuanList.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Kepada Yth.</label>
            <input value={f.kepada} onChange={(e) => set("kepada", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Alamat pasien</label>
            <input value={f.alamat} onChange={(e) => set("alamat", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Jaminan</label>
            <input value={f.jaminan} onChange={(e) => set("jaminan", e.target.value)} list="rujukan-jaminan" className={inputCls} />
            <datalist id="rujukan-jaminan">
              {["BPJS", "BPJS Ketenagakerjaan", "Perusahaan", "Umum / pribadi"].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          {area("anamnesa", "Anamnesa (keluhan, kronologi)", 3)}
          {area("riwayat", "Riwayat penyakit", 2)}
          <div className="col-span-2 grid grid-cols-3 sm:grid-cols-5 gap-2">
            {kecil("td", "TD", "mmHg")}
            {kecil("nadi", "Nadi", "x/m")}
            {kecil("suhu", "Suhu", "°C")}
            {kecil("rr", "RR", "x/i")}
            {kecil("spo2", "SpO2", "%")}
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Keadaan umum (KU)</label>
            <input value={f.ku} onChange={(e) => set("ku", e.target.value)} placeholder="mis. lemah, compos mentis" className={inputCls} />
          </div>
          {area("diagnosa", "Diagnosa", 2)}
          {area("penunjang", "Pemeriksaan penunjang", 2, "mis. GDS 180 mg/dl")}
          {area("terapi", "Terapi dan jam pemberian", 3)}
          <div>
            <label className={labelCls}>Nama petugas medis</label>
            <input value={f.petugas} onChange={(e) => set("petugas", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Gelar</label>
            <input value={f.gelar} onChange={(e) => set("gelar", e.target.value)} placeholder="mis. A.Md.Keb" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tanggal surat</label>
            <input type="date" value={f.tanggal} onChange={(e) => e.target.value && set("tanggal", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Perusahaan (kop)</label>
            <input value={f.perusahaan} onChange={(e) => set("perusahaan", e.target.value)} className={inputCls} />
          </div>
          {error && <p className="col-span-2 text-xs text-[var(--accent-red)]">{error}</p>}
          <div className="col-span-2 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
              Batal
            </button>
            <button onClick={cetak} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90">
              <FileText size={15} /> Cetak surat rujukan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
