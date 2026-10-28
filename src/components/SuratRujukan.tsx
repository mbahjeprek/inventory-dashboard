import { useState } from "react";
import { AlertTriangle, FileText, X } from "lucide-react";
import type { Kunjungan } from "../lib/api";
import { printDocument } from "../lib/printTable";
import { isoDisplay } from "../lib/opname";
import { KOP_CSS, escHtml as esc, kopHtml, penandatangan, perusahaanIngat } from "../lib/surat";
import { useAuth } from "../context/AuthContext";

// Surat Rujukan Berobat from a kunjungan, laid out like the klinik's paper form (kop with the estate's company, NO,
// Tempat Tujuan Rujukan, the patient, Keluhan, Tanda-tanda Vital, Alasan Rujukan, Dikeluarkan di / Pada tanggal,
// Yang Merujuk and the two catatan), with what the perawat must check before referring: the anamnesa (keluhan utama
// and since when, riwayat penyakit, alergi obat), the vital signs, kesadaran and keadaan umum, the diagnosa sementara,
// what was already given, and the reason. Those are required before it prints; a vital sign out of the usual range is
// flagged. Name, age, sex, keluhan, diagnosa and the obat given come from the visit. The tujuan list, the signer's
// jabatan and the company are remembered per klinik in this browser; the clinical fields are for this letter only.

const KODE_ESTATE: Record<string, string> = { NILAM: "NLM", ZAMRUD: "ZMD", FIRUS: "FRS", KNS: "KNS", WJA: "WJA" };
const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
export const nomorRujukan = (k: Pick<Kunjungan, "id" | "klinik" | "tanggal_iso">) =>
  `${String(k.id).padStart(5, "0")}/AKSS-${KODE_ESTATE[k.klinik] ?? k.klinik}/${ROMAWI[Number(k.tanggal_iso.slice(5, 7)) - 1]}/${k.tanggal_iso.slice(0, 4)}`;
const namaEstate = (klinik: string) => (klinik === "KNS" || klinik === "WJA" ? klinik : klinik.charAt(0) + klinik.slice(1).toLowerCase());

const KESADARAN = ["Compos mentis", "Apatis", "Somnolen", "Sopor", "Koma"];
const KEADAAN = ["Baik", "Sedang", "Lemah", "Buruk"];
const ALASAN = [
  "Perlu observasi dan tindakan lanjutan",
  "Perlu pemeriksaan penunjang (laboratorium / rontgen)",
  "Perlu penanganan dokter / dokter spesialis",
  "Kondisi gawat darurat",
  "Obat / alat di klinik tidak tersedia",
];

type Isian = {
  perusahaan: string;
  tujuan: string;
  keluhan: string;
  sejak: string;
  riwayat: string;
  alergi: string;
  td: string;
  nadi: string;
  napas: string;
  suhu: string;
  spo2: string;
  kesadaran: string;
  keadaan: string;
  diagnosa: string;
  tindakan: string;
  alasan: string;
  petugas: string;
  jabatan: string;
  tanggal: string;
};

// The checks that must be done before referring (label for the "belum lengkap" list).
const WAJIB: [keyof Isian, string][] = [
  ["tujuan", "Tempat tujuan rujukan"],
  ["keluhan", "Keluhan utama"],
  ["sejak", "Sejak kapan"],
  ["alergi", "Riwayat alergi obat"],
  ["td", "Tekanan darah (TD)"],
  ["nadi", "Nadi (N)"],
  ["napas", "Pernapasan (P)"],
  ["suhu", "Suhu (S)"],
  ["kesadaran", "Kesadaran"],
  ["keadaan", "Keadaan umum"],
  ["diagnosa", "Diagnosa sementara"],
  ["tindakan", "Tindakan / obat yang sudah diberikan"],
  ["alasan", "Alasan rujukan"],
  ["petugas", "Nama yang merujuk"],
];

const angka = (v: string) => Number(v.replace(",", "."));
// A vital sign typed wrongly (blocks printing) or out of the usual adult range (only flagged).
function cekVital(f: Isian): { salah: string[]; perhatian: string[] } {
  const salah: string[] = [];
  const perhatian: string[] = [];
  const td = f.td.trim().match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (f.td.trim() && !td) salah.push("TD ditulis sistol/diastol, mis. 120/80");
  if (td) {
    const [s, d] = [Number(td[1]), Number(td[2])];
    if (s >= 140 || d >= 90) perhatian.push(`TD ${s}/${d} tinggi`);
    if (s < 90 || d < 60) perhatian.push(`TD ${s}/${d} rendah`);
  }
  const cek = (v: string, nama: string, min: number, max: number, lo: number, hi: number) => {
    if (!v.trim()) return;
    const n = angka(v);
    if (!Number.isFinite(n) || n < min || n > max) return void salah.push(`${nama} tidak masuk akal (${v})`);
    if (n < lo) perhatian.push(`${nama} ${v} rendah`);
    if (n > hi) perhatian.push(`${nama} ${v} tinggi`);
  };
  cek(f.nadi, "Nadi", 20, 250, 60, 100);
  cek(f.napas, "Pernapasan", 4, 70, 12, 20);
  cek(f.suhu, "Suhu", 30, 45, 36, 37.5);
  cek(f.spo2, "SpO2", 40, 100, 95, 100);
  return { salah, perhatian };
}

export function rujukanHtml(k: Kunjungan, f: Isian) {
  const umur = k.usia !== null && k.usia !== undefined ? `${k.usia} tahun` : "";
  const jk = k.jenis_kelamin === "L" ? "Laki-laki" : k.jenis_kelamin === "P" ? "Perempuan" : k.jenis_kelamin || "L/P";
  const baris = (l: string, v: string) => `<tr><td class="l">${esc(l)}</td><td class="t">:</td><td>${v.trim() ? esc(v).replace(/\n/g, "<br>") : "&nbsp;"}</td></tr>`;
  const vital = [
    `TD: ${esc(f.td)} mmHg`,
    `N: ${esc(f.nadi)} x/menit`,
    `P: ${esc(f.napas)} x/menit`,
    `S: ${esc(f.suhu)} °C`,
    f.spo2.trim() ? `SpO2: ${esc(f.spo2)} %` : "",
  ]
    .filter(Boolean)
    .map((x) => `<span>${x}</span>`)
    .join("");
  const estate = namaEstate(k.klinik);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Surat Rujukan ${esc(k.nama_pasien)}</title><style>
    @page { size: A4 portrait; margin: 16mm 18mm 16mm 20mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: "Times New Roman", Times, serif; color: #000; font-size: 11.5pt; line-height: 1.5; margin: 0; }
    ${KOP_CSS}
    .kop-unit:empty { display: none; }
    h1 { text-align: center; font-size: 12.5pt; margin: 18px 0 0; text-decoration: underline; }
    .nomor { text-align: center; margin: 0 0 16px; }
    p { margin: 0 0 6px; }
    table.data { border-collapse: collapse; margin: 6px 0 8px; width: 100%; }
    table.data td { padding: 2px 6px 2px 0; vertical-align: top; }
    table.data td.l { width: 200px; }
    table.data td.t { width: 12px; }
    .vital span { display: inline-block; margin-right: 22px; white-space: nowrap; }
    .keluar td { padding: 2px 6px 2px 0; }
    .keluar td.l { width: 200px; }
    .ttd { width: 45%; margin: 6px 0 0 auto; text-align: center; }
    .ttd .ruang { height: 66px; }
    .ttd .nama { font-weight: bold; text-decoration: underline; }
    .catatan { margin-top: 22px; font-size: 10.5pt; }
    .catatan ol { margin: 4px 0 0 0; padding-left: 22px; }
    .catatan li { margin-bottom: 4px; }
  </style></head><body>
    ${kopHtml(f.perusahaan, "")}
    <h1>SURAT RUJUKAN BEROBAT</h1>
    <div class="nomor">NO: ${esc(nomorRujukan(k))}</div>
    <p>Tempat Tujuan Rujukan: <b>${esc(f.tujuan)}</b></p>
    <p style="margin-top:10px">Dengan hormat,</p>
    <p>Mohon pemeriksaan dan pengobatan lebih lanjut terhadap penderita dibawah ini:</p>
    <table class="data">
      ${baris("Nama", k.nama_pasien)}
      ${baris("Umur", umur)}
      ${baris("Jenis Kelamin", jk)}
      ${k.jabatan || k.divisi ? baris("Jabatan / Divisi", [k.jabatan, k.divisi].filter(Boolean).join(" / ")) : ""}
      ${baris("Keluhan PX", [f.keluhan.trim(), f.sejak.trim() && `sejak ${f.sejak.trim()}`].filter(Boolean).join(", "))}
      ${baris("Riwayat Penyakit", f.riwayat.trim() || "-")}
      ${baris("Riwayat Alergi Obat", f.alergi)}
      <tr><td class="l">Tanda-tanda Vital</td><td class="t">:</td><td class="vital">${vital}</td></tr>
      ${baris("Kesadaran / Keadaan Umum", `${f.kesadaran} / ${f.keadaan}`)}
      ${baris("Diagnosa Sementara", f.diagnosa)}
      ${baris("Tindakan / Obat Diberikan", f.tindakan)}
      ${baris("Alasan Rujukan", f.alasan)}
    </table>
    <p>Demikian surat rujukan ini dibuat, atas penerimaan dan kesediaannya kami ucapkan terima kasih.</p>
    <table class="keluar">
      <tr><td class="l">Dikeluarkan di</td><td>: Klinik ${esc(estate)}</td></tr>
      <tr><td class="l">Pada tanggal</td><td>: ${esc(isoDisplay(f.tanggal))}</td></tr>
    </table>
    <div class="ttd">
      <div>Yang Merujuk</div>
      <div class="ruang"></div>
      <div class="nama">${esc(f.petugas || "(................................)")}</div>
      <div>${esc(f.jabatan)}</div>
    </div>
    <div class="catatan">Catatan:
      <ol>
        <li>Dimohon kepada pihak puskesmas/rumah sakit untuk penerbitan surat sakit/hasil pemeriksaan yang bersangkutan agar dicantumkan diagnosa penyakit yang diderita untuk memperkuat bukti.</li>
        <li>Dimohon untuk waktu istirahat karena sakit diberikan hanya 1 hari jika diagnosa penyakit yang diderita sifatnya parah.</li>
      </ol>
    </div>
  </body></html>`;
}

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";

export function SuratRujukanModal({ k, onClose }: { k: Kunjungan; onClose: () => void }) {
  const { user } = useAuth();
  const key = `surat-rujukan-${k.klinik}`;
  let ingat: { perusahaan?: string; jabatan?: string; tujuanList?: string[] } = {};
  try {
    ingat = JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    /* no storage */
  }
  const tujuanList = [...new Set([k.provider, ...(ingat.tujuanList ?? [])].filter(Boolean))] as string[];
  const obatDiberi = (k.obat ?? [])
    .filter((o) => o.nama_obat.trim())
    .map((o) => `${o.nama_obat}${o.qty !== null && o.qty !== undefined ? ` ${o.qty}${o.satuan ? ` ${o.satuan.toLowerCase()}` : ""}` : ""}`)
    .join(", ");
  const [f, setF] = useState<Isian>({
    perusahaan: perusahaanIngat(ingat.perusahaan, k.klinik),
    tujuan: k.provider || tujuanList[0] || "",
    keluhan: k.detail_kejadian || "",
    sejak: "",
    riwayat: "",
    alergi: "",
    td: "",
    nadi: "",
    napas: "",
    suhu: "",
    spo2: "",
    kesadaran: "",
    keadaan: "",
    diagnosa: k.diagnosis || "",
    tindakan: obatDiberi,
    alasan: ALASAN[0],
    // The signer by its current account name (full name + title).
    petugas: penandatangan(user, k.created_by),
    jabatan: ingat.jabatan || `Medis ${namaEstate(k.klinik)} Estate`,
    tanggal: k.tanggal_iso,
  });
  const [coba, setCoba] = useState(false);
  const set = <K extends keyof Isian>(n: K, v: Isian[K]) => setF((x) => ({ ...x, [n]: v }));
  const kurang = WAJIB.filter(([n]) => !String(f[n]).trim());
  const vital = cekVital(f);
  const siap = !kurang.length && !vital.salah.length;
  const merah = (n: keyof Isian) => (coba && WAJIB.some(([w]) => w === n) && !String(f[n]).trim() ? "border-[var(--accent-red)]" : "");

  const cetak = () => {
    setCoba(true);
    if (!siap) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ perusahaan: f.perusahaan, jabatan: f.jabatan, tujuanList: [f.tujuan.trim(), ...tujuanList.filter((t) => t !== f.tujuan.trim())].slice(0, 10) })
      );
    } catch {
      /* no storage */
    }
    printDocument(rujukanHtml(k, f));
  };

  const teks = (n: keyof Isian, label: string, ph = "", wajib = true) => (
    <div>
      <label className={labelCls}>
        {label}
        {wajib && <span className="text-[var(--accent-red)]"> *</span>}
      </label>
      <input value={f[n]} onChange={(e) => set(n, e.target.value)} placeholder={ph} className={`${inputCls} ${merah(n)}`} />
    </div>
  );
  const area = (n: keyof Isian, label: string, ph = "", wajib = true) => (
    <div className="col-span-2">
      <label className={labelCls}>
        {label}
        {wajib && <span className="text-[var(--accent-red)]"> *</span>}
      </label>
      <textarea value={f[n]} onChange={(e) => set(n, e.target.value)} rows={2} placeholder={ph} className={`${inputCls} ${merah(n)}`} />
    </div>
  );
  const vitalInput = (n: keyof Isian, label: string, satuan: string, ph: string, wajib = true) => (
    <div>
      <label className={labelCls}>
        {label} <span className="text-[var(--text-muted)]">({satuan})</span>
        {wajib && <span className="text-[var(--accent-red)]"> *</span>}
      </label>
      <input value={f[n]} onChange={(e) => set(n, e.target.value)} placeholder={ph} inputMode={n === "td" ? "text" : "decimal"} className={`${inputCls} ${merah(n)}`} />
    </div>
  );
  const pilih = (n: keyof Isian, label: string, opsi: string[]) => (
    <div>
      <label className={labelCls}>
        {label}
        <span className="text-[var(--accent-red)]"> *</span>
      </label>
      <select value={f[n]} onChange={(e) => set(n, e.target.value)} className={`${inputCls} ${merah(n)}`}>
        <option value="">-- Pilih --</option>
        {opsi.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
  const judul = (t: string) => <div className="col-span-2 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] border-t border-[var(--border)] first:border-t-0 first:pt-0">{t}</div>;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-2xl mt-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">Surat Rujukan Berobat</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {k.nama_pasien}
              {k.usia !== null && k.usia !== undefined ? ` · ${k.usia} th` : ""} · {k.jenis_kelamin === "P" ? "Perempuan" : k.jenis_kelamin === "L" ? "Laki-laki" : "-"} · kunjungan{" "}
              {isoDisplay(k.tanggal_iso)} · No. {nomorRujukan(k)}
            </p>
          </div>
          <button onClick={onClose} title="Tutup" className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          {judul("Tujuan")}
          <div className="col-span-2">
            <label className={labelCls}>
              Tempat tujuan rujukan (puskesmas / rumah sakit)<span className="text-[var(--accent-red)]"> *</span>
            </label>
            <input value={f.tujuan} onChange={(e) => set("tujuan", e.target.value)} list="rujukan-tujuan" placeholder="mis. Puskesmas Tideng Pale / RSUD Akhmad Berahim" className={`${inputCls} ${merah("tujuan")}`} />
            <datalist id="rujukan-tujuan">
              {tujuanList.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          {judul("Anamnesa")}
          {area("keluhan", "Keluhan utama", "mis. demam, pusing, mual muntah")}
          {teks("sejak", "Sejak kapan", "mis. 3 hari / tadi pagi")}
          <div>
            <label className={labelCls}>
              Riwayat alergi obat<span className="text-[var(--accent-red)]"> *</span>
            </label>
            <div className="flex gap-1.5">
              <input value={f.alergi} onChange={(e) => set("alergi", e.target.value)} placeholder="nama obatnya, atau Tidak ada" className={`${inputCls} ${merah("alergi")}`} />
              <button type="button" onClick={() => set("alergi", "Tidak ada")} className="shrink-0 text-xs px-2 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]">
                Tidak ada
              </button>
            </div>
          </div>
          {area("riwayat", "Riwayat penyakit (hipertensi, diabetes, asma ...)", "kosong = tidak ada", false)}

          {judul("Pemeriksaan (tanda-tanda vital)")}
          <div className="col-span-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
            {vitalInput("td", "TD", "mmHg", "120/80")}
            {vitalInput("nadi", "Nadi", "x/mnt", "80")}
            {vitalInput("napas", "Napas", "x/mnt", "20")}
            {vitalInput("suhu", "Suhu", "°C", "36,8")}
            {vitalInput("spo2", "SpO2", "%", "98", false)}
          </div>
          {(vital.salah.length > 0 || vital.perhatian.length > 0) && (
            <div className="col-span-2 text-xs space-y-0.5">
              {vital.salah.map((s) => (
                <div key={s} className="text-[var(--accent-red)]">
                  {s}
                </div>
              ))}
              {vital.perhatian.length > 0 && (
                <div className="inline-flex items-center gap-1 text-[var(--accent-amber)]">
                  <AlertTriangle size={13} /> Di luar batas normal: {vital.perhatian.join(", ")}. Pastikan angkanya benar.
                </div>
              )}
            </div>
          )}
          {pilih("kesadaran", "Kesadaran", KESADARAN)}
          {pilih("keadaan", "Keadaan umum", KEADAAN)}

          {judul("Diagnosa & tindakan")}
          {area("diagnosa", "Diagnosa sementara")}
          {area("tindakan", "Tindakan / obat yang sudah diberikan di klinik", "isi - bila belum ada")}
          <div className="col-span-2">
            <label className={labelCls}>
              Alasan rujukan<span className="text-[var(--accent-red)]"> *</span>
            </label>
            <input value={f.alasan} onChange={(e) => set("alasan", e.target.value)} list="rujukan-alasan" className={`${inputCls} ${merah("alasan")}`} />
            <datalist id="rujukan-alasan">
              {ALASAN.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>

          {judul("Yang merujuk")}
          {teks("petugas", "Nama")}
          {teks("jabatan", "Jabatan", "", false)}
          <div>
            <label className={labelCls}>Pada tanggal</label>
            <input type="date" value={f.tanggal} onChange={(e) => e.target.value && set("tanggal", e.target.value)} className={inputCls} />
          </div>
          {teks("perusahaan", "Perusahaan (kop)", "", false)}

          {coba && !siap && (
            <div className="col-span-2 text-xs rounded-md border border-[var(--accent-red-border)] bg-[var(--accent-red-bg)] text-[var(--accent-red)] px-3 py-2">
              {kurang.length > 0 && <div>Belum lengkap: {kurang.map(([, l]) => l).join(", ")}.</div>}
              {vital.salah.length > 0 && <div>Perbaiki: {vital.salah.join("; ")}.</div>}
            </div>
          )}
          <div className="col-span-2 flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-[var(--text-muted)]">{kurang.length ? `${WAJIB.length - kurang.length} dari ${WAJIB.length} pemeriksaan wajib terisi` : "Semua pemeriksaan wajib terisi"}</span>
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
