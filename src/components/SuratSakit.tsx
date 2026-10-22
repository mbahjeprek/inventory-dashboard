import { useState } from "react";
import { FileText, X } from "lucide-react";
import type { Kunjungan } from "../lib/api";
import { printDocument } from "../lib/printTable";
import { isoDisplay } from "../lib/opname";
import { escHtml as esc, tanggalPanjang, terbilang } from "../lib/surat";

// Surat Keterangan Sakit from a kunjungan: the patient's data, the rest days from the visit and the
// examiner's signature, as a formal letter. The nomor follows from the visit (same nomor on a reprint);
// the examiner and company are remembered per klinik in this browser.

const tambahHari = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const nomorSks = (k: Pick<Kunjungan, "id" | "klinik" | "tanggal_iso">) =>
  `${String(k.id).padStart(5, "0")}/SKS/KLINIK-${k.klinik}/${k.tanggal_iso.slice(5, 7)}/${k.tanggal_iso.slice(0, 4)}`;

type Isian = { perusahaan: string; pemeriksa: string; jabatan: string; hari: number; mulai: string; diagnosis: boolean; catatan: string };

export function suratHtml(k: Kunjungan, f: Isian) {
  const sampai = tambahHari(f.mulai, f.hari - 1);
  const umur = k.usia !== null && k.usia !== undefined ? `${k.usia} tahun` : "-";
  const jk = k.jenis_kelamin === "L" ? "Laki-laki" : k.jenis_kelamin === "P" ? "Perempuan" : k.jenis_kelamin || "-";
  const baris = (l: string, v: string) => `<tr><td class="l">${esc(l)}</td><td>:</td><td>${esc(v || "-")}</td></tr>`;
  const kota = k.klinik.charAt(0) + k.klinik.slice(1).toLowerCase();
  return `<!doctype html><html><head><meta charset="utf-8"><title>Surat Keterangan Sakit ${esc(k.nama_pasien)}</title><style>
    @page { size: A4 portrait; margin: 18mm 18mm 18mm 20mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: "Times New Roman", Times, serif; color: #000; font-size: 12pt; line-height: 1.6; margin: 0; }
    .kop { display: flex; align-items: center; gap: 12px; border-bottom: 3px double #000; padding-bottom: 6px; }
    .kop img { width: 60px; height: 60px; object-fit: contain; }
    .kop .pt { font-size: 14pt; font-weight: bold; text-transform: uppercase; }
    h1 { text-align: center; font-size: 14pt; margin: 22px 0 0; text-decoration: underline; }
    .nomor { text-align: center; margin: 0 0 20px; }
    p { margin: 0 0 10px; text-align: justify; }
    table.data { margin: 4px 0 12px 24px; border-collapse: collapse; }
    table.data td { padding: 1px 8px 1px 0; vertical-align: top; }
    table.data td.l { width: 190px; }
    .ttd { width: 45%; margin: 28px 0 0 auto; text-align: center; }
    .ttd .ruang { height: 72px; }
    .ttd .nama { font-weight: bold; text-decoration: underline; }
    .kecil { font-size: 9pt; color: #333; margin-top: 30px; }
  </style></head><body>
    <div class="kop"><img src="${esc(location.origin)}/logo-agro.png" alt=""><div><div class="pt">${esc(f.perusahaan)}</div><div>Klinik Estate ${esc(k.klinik)}</div></div></div>
    <h1>SURAT KETERANGAN SAKIT</h1>
    <div class="nomor">Nomor: ${esc(nomorSks(k))}</div>
    <p>Yang bertanda tangan di bawah ini, ${esc(f.jabatan || "petugas kesehatan")} Klinik Estate ${esc(k.klinik)}, menerangkan bahwa:</p>
    <table class="data">
      ${baris("Nama", k.nama_pasien)}
      ${k.nik ? baris("NIK", k.nik) : ""}
      ${baris("Umur / Jenis kelamin", `${umur} / ${jk}`)}
      ${baris("Jabatan / Divisi", [k.jabatan, k.divisi].filter(Boolean).join(" / "))}
      ${baris("Alamat / tempat tinggal", k.tempat_tinggal)}
      ${f.diagnosis && k.diagnosis ? baris("Diagnosis", k.diagnosis) : ""}
    </table>
    <p>telah diperiksa pada tanggal ${esc(tanggalPanjang(k.tanggal_iso))} dan berdasarkan hasil pemeriksaan dalam keadaan sakit, sehingga perlu beristirahat selama <b>${f.hari} (${esc(terbilang(f.hari))}) hari</b>, terhitung mulai tanggal <b>${esc(tanggalPanjang(f.mulai))}</b> sampai dengan <b>${esc(tanggalPanjang(sampai))}</b>.</p>
    ${f.catatan.trim() ? `<p>${esc(f.catatan.trim())}</p>` : ""}
    <p>Demikian surat keterangan ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.</p>
    <div class="ttd">
      <div>${esc(kota)}, ${esc(tanggalPanjang(k.tanggal_iso))}</div>
      <div>Pemeriksa,</div>
      <div class="ruang"></div>
      <div class="nama">${esc(f.pemeriksa || "(................................)")}</div>
      <div>${esc(f.jabatan)}</div>
    </div>
    <div class="kecil">Dibuat dari data kunjungan Klinik Estate ${esc(k.klinik)} tanggal ${esc(isoDisplay(k.tanggal_iso))}.</div>
  </body></html>`;
}

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";

export function SuratSakitModal({ k, onClose }: { k: Kunjungan; onClose: () => void }) {
  const key = `surat-sakit-${k.klinik}`;
  const [f, setF] = useState<Isian>(() => {
    let ingat: Partial<Isian> = {};
    try {
      ingat = JSON.parse(localStorage.getItem(key) ?? "{}");
    } catch {
      /* no storage */
    }
    return {
      perusahaan: ingat.perusahaan || "PT. Anugerah Kembang Sawit Sejahtera",
      pemeriksa: ingat.pemeriksa || k.created_by || "",
      jabatan: ingat.jabatan || "Bidan / Mantri Jaga",
      hari: k.istirahat && k.hari_istirahat > 0 ? k.hari_istirahat : 1,
      mulai: k.tanggal_iso,
      diagnosis: false,
      catatan: "",
    };
  });
  const [error, setError] = useState("");
  const set = <K extends keyof Isian>(n: K, v: Isian[K]) => setF((x) => ({ ...x, [n]: v }));
  const cetak = () => {
    if (!(f.hari > 0)) return setError("Isi jumlah hari istirahat");
    if (!f.pemeriksa.trim()) return setError("Isi nama pemeriksa");
    setError("");
    try {
      localStorage.setItem(key, JSON.stringify({ perusahaan: f.perusahaan, pemeriksa: f.pemeriksa, jabatan: f.jabatan }));
    } catch {
      /* no storage */
    }
    printDocument(suratHtml(k, f));
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-lg mt-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">Surat Keterangan Sakit</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {k.nama_pasien} · kunjungan {isoDisplay(k.tanggal_iso)} · No. {nomorSks(k)}
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Istirahat (hari)</label>
              <input type="number" min={1} value={f.hari} onChange={(e) => set("hari", Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Mulai tanggal</label>
              <input type="date" value={f.mulai} onChange={(e) => e.target.value && set("mulai", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nama pemeriksa</label>
              <input value={f.pemeriksa} onChange={(e) => set("pemeriksa", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Jabatan pemeriksa</label>
              <input value={f.jabatan} onChange={(e) => set("jabatan", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Perusahaan (kop surat)</label>
            <input value={f.perusahaan} onChange={(e) => set("perusahaan", e.target.value)} className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={f.diagnosis} onChange={(e) => set("diagnosis", e.target.checked)} disabled={!k.diagnosis} />
            Cantumkan diagnosis{k.diagnosis ? ` (${k.diagnosis})` : " (tidak ada di kunjungan)"} - biasanya tidak, karena rahasia medis
          </label>
          <div>
            <label className={labelCls}>Catatan tambahan (opsional)</label>
            <input value={f.catatan} onChange={(e) => set("catatan", e.target.value)} placeholder="mis. kontrol kembali bila belum membaik" className={inputCls} />
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
