import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { api, errorText, type KlinikTarik } from "../lib/api";
import { printDocument } from "../lib/printTable";
import { isoDisplay, localToday } from "../lib/opname";

// Berita Acara Pemusnahan / Retur Obat & BHP (Klinik): a formal letter of what was approved in Expired &
// Rusak - kop, nomor, the day / date / place written out, the people involved, how it was destroyed,
// the list (batch / tanggal expired, jumlah, alasan) and the signatures. The form is filled first; the
// names, positions and company are remembered in this browser for the next one.

const ALASAN: Record<string, string> = { EXPIRED: "Kedaluwarsa", RUSAK: "Rusak", RETUR: "Retur ke supplier" };
const CARA = [
  "Diserahkan ke pihak ketiga pengelola limbah B3 berizin",
  "Dibakar dengan insinerator",
  "Dihancurkan / dirusak kemasannya lalu ditimbun",
  "Dikembalikan (retur) ke supplier / PBF",
];
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
// Terbilang for the written-out date (up to the thousands of a year).
function terbilang(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${terbilang(n - 10)} belas`;
  if (n < 100) return `${terbilang(Math.floor(n / 10))} puluh${n % 10 ? ` ${terbilang(n % 10)}` : ""}`;
  if (n < 200) return `seratus${n - 100 ? ` ${terbilang(n - 100)}` : ""}`;
  if (n < 1000) return `${terbilang(Math.floor(n / 100))} ratus${n % 100 ? ` ${terbilang(n % 100)}` : ""}`;
  if (n < 2000) return `seribu${n - 1000 ? ` ${terbilang(n - 1000)}` : ""}`;
  return `${terbilang(Math.floor(n / 1000))} ribu${n % 1000 ? ` ${terbilang(n % 1000)}` : ""}`;
}
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const batchText = (t: KlinikTarik) => (t.alloc ?? []).map((a) => (a.exp ? isoDisplay(a.exp) : "-")).join(", ") || "-";
const waktu = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jakarta" });

type Orang = { nama: string; jabatan: string };
type Isian = {
  perusahaan: string;
  nomor: string;
  tanggal: string;
  tempat: string;
  cara: string;
  pihakKetiga: string;
  pj: Orang;
  pelaksana: Orang;
  saksi1: Orang;
  saksi2: Orang;
  mengetahui: Orang;
};
const ORANG: { key: "pj" | "pelaksana" | "saksi1" | "saksi2" | "mengetahui"; label: string; jabatan: string }[] = [
  { key: "pj", label: "Penanggung Jawab Klinik (yang menyerahkan)", jabatan: "Dokter / Penanggung Jawab Klinik" },
  { key: "pelaksana", label: "Pelaksana pemusnahan", jabatan: "Petugas Klinik" },
  { key: "saksi1", label: "Saksi 1", jabatan: "" },
  { key: "saksi2", label: "Saksi 2", jabatan: "" },
  { key: "mengetahui", label: "Mengetahui", jabatan: "Estate Manager" },
];

function baHtml(klinik: string, f: Isian, rows: KlinikTarik[]) {
  const d = new Date(`${f.tanggal}T00:00:00`);
  const tgl = `${HARI[d.getDay()]} tanggal ${terbilang(d.getDate())} bulan ${BULAN[d.getMonth()]} tahun ${terbilang(d.getFullYear())} (${isoDisplay(f.tanggal)})`;
  const cara = f.cara + (f.pihakKetiga.trim() ? `: ${f.pihakKetiga.trim()}` : "");
  const orang = ORANG.filter((o) => o.key !== "mengetahui" && f[o.key].nama.trim());
  const ttd = (judul: string, o: Orang) =>
    `<div class="ttd"><div>${esc(judul)}</div><div class="ruang"></div><div class="nama">${esc(o.nama || "(................................)")}</div><div>${esc(o.jabatan)}</div></div>`;
  const body = rows
    .map(
      (t, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(t.nama)}<div class="kecil">${esc(t.kode)}</div></td><td class="c">${esc(batchText(t))}</td><td class="r">${t.qty.toLocaleString("id-ID")}</td><td>${esc(t.satuan)}</td><td>${esc(ALASAN[t.alasan ?? ""] ?? "Kedaluwarsa")}</td><td>${esc(t.note ?? "")}<div class="kecil">ditarik ${esc(waktu(t.created_at))}${t.diperiksa_nama ? ` · diperiksa ${esc(t.diperiksa_nama)}` : ""}</div></td></tr>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Berita Acara Pemusnahan ${esc(f.nomor)}</title><style>
    @page { size: A4 portrait; margin: 15mm 15mm 15mm 18mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: "Times New Roman", Times, serif; color: #000; font-size: 11pt; line-height: 1.45; margin: 0; }
    .kop { display: flex; align-items: center; gap: 12px; border-bottom: 3px double #000; padding-bottom: 6px; }
    .kop img { width: 58px; height: 58px; object-fit: contain; }
    .kop .pt { font-size: 14pt; font-weight: bold; text-transform: uppercase; }
    .kop .unit { font-size: 11pt; }
    h1 { text-align: center; font-size: 13pt; margin: 16px 0 0; text-decoration: underline; text-transform: uppercase; }
    .nomor { text-align: center; margin: 2px 0 14px; }
    p { margin: 0 0 8px; text-align: justify; }
    table.orang { margin: 0 0 8px 18px; border-collapse: collapse; }
    table.orang td { padding: 1px 6px 1px 0; vertical-align: top; }
    table.daftar { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 10pt; }
    table.daftar th, table.daftar td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
    table.daftar th { background: #e8e8e8; text-align: center; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .c { text-align: center; } .r { text-align: right; }
    .kecil { font-size: 8.5pt; color: #333; }
    .ttds { display: flex; flex-wrap: wrap; justify-content: space-between; row-gap: 14px; margin-top: 14px; page-break-inside: avoid; }
    .ttd { width: 46%; text-align: center; }
    .ttd.tengah { width: 100%; }
    .ttd .ruang { height: 64px; }
    .ttd .nama { font-weight: bold; text-decoration: underline; }
  </style></head><body>
    <div class="kop"><img src="${esc(location.origin)}/logo-agro.png" alt=""><div><div class="pt">${esc(f.perusahaan)}</div><div class="unit">Klinik Estate ${esc(klinik)}</div></div></div>
    <h1>Berita Acara Pemusnahan Obat dan Bahan Medis Habis Pakai</h1>
    <div class="nomor">Nomor: ${esc(f.nomor)}</div>
    <p>Pada hari ini, ${esc(tgl)}, bertempat di ${esc(f.tempat)}, kami yang bertanda tangan di bawah ini:</p>
    <table class="orang">${orang
      .map((o, i) => `<tr><td>${i + 1}.</td><td>Nama</td><td>: ${esc(f[o.key].nama)}</td></tr><tr><td></td><td>Jabatan</td><td>: ${esc(f[o.key].jabatan || "-")}</td></tr><tr><td></td><td>Selaku</td><td>: ${esc(o.label.replace(/ \(.*\)$/, ""))}</td></tr>`)
      .join("")}</table>
    <p>telah melakukan pemusnahan obat dan bahan medis habis pakai (BHP) milik Klinik Estate ${esc(klinik)} yang telah kedaluwarsa / rusak, sebanyak <b>${rows.length}</b> item sebagaimana daftar berikut. Seluruh barang telah diperiksa dan dicocokkan jumlah fisiknya dengan catatan di sistem inventory sebelum dimusnahkan.</p>
    <table class="daftar"><thead><tr><th>No</th><th>Nama Obat / BHP</th><th>Tgl Expired (Batch)</th><th>Jumlah</th><th>Satuan</th><th>Alasan</th><th>Keterangan</th></tr></thead><tbody>${body}</tbody></table>
    <p>Pemusnahan dilakukan dengan cara <b>${esc(cara)}</b>, sehingga obat dan BHP tersebut tidak dapat digunakan kembali, serta disaksikan oleh para saksi yang namanya tercantum dalam berita acara ini.</p>
    <p>Demikian Berita Acara Pemusnahan ini dibuat dengan sebenarnya dalam rangkap secukupnya untuk dapat dipergunakan sebagaimana mestinya.</p>
    <p style="text-align:right;margin-top:10px">${esc(klinik.charAt(0) + klinik.slice(1).toLowerCase())}, ${esc(`${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`)}</p>
    <div class="ttds">
      ${ttd("Yang Menyerahkan,", f.pj)}${ttd("Pelaksana Pemusnahan,", f.pelaksana)}
      ${ttd("Saksi 1,", f.saksi1)}${ttd("Saksi 2,", f.saksi2)}
      <div class="ttd tengah">${ttd("Mengetahui,", f.mengetahui).replace('class="ttd"', 'style="width:46%;margin:0 auto"')}</div>
    </div>
  </body></html>`;
}

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";

export function BaPemusnahanModal({ klinik, periode, onClose }: { klinik: string; periode: string; onClose: () => void }) {
  const simpanKey = `ba-pemusnahan-${klinik}`;
  const awal = (): Isian => {
    const kosong: Isian = {
      perusahaan: "PT. Anugerah Kembang Sawit Sejahtera",
      nomor: `     /BA-PMS/KLINIK-${klinik}/${periode.slice(5, 7)}/${periode.slice(0, 4)}`,
      tanggal: localToday(),
      tempat: `Klinik Estate ${klinik}`,
      cara: CARA[0],
      pihakKetiga: "",
      ...(Object.fromEntries(ORANG.map((o) => [o.key, { nama: "", jabatan: o.jabatan }])) as Pick<Isian, "pj" | "pelaksana" | "saksi1" | "saksi2" | "mengetahui">),
    };
    try {
      const s = JSON.parse(localStorage.getItem(simpanKey) ?? "null");
      // Names, positions, company and cara come back; nomor and tanggal are new for every BA.
      if (s) return { ...kosong, ...s, nomor: kosong.nomor, tanggal: kosong.tanggal };
    } catch {
      /* no storage */
    }
    return kosong;
  };
  const [f, setF] = useState<Isian>(awal);
  const [rows, setRows] = useState<KlinikTarik[] | null>(null);
  const [pilih, setPilih] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .klinikTarikList({ klinik, status: "DISETUJUI", periode })
      .then((r) => {
        setRows(r);
        setPilih(new Set(r.filter((t) => t.alasan !== "RETUR").map((t) => t.id)));
      })
      .catch((e) => setError(errorText(e, "Gagal memuat")));
  }, [klinik, periode]);
  const set = <K extends keyof Isian>(k: K, v: Isian[K]) => setF((x) => ({ ...x, [k]: v }));
  const setOrang = (k: (typeof ORANG)[number]["key"], field: keyof Orang, v: string) => setF((x) => ({ ...x, [k]: { ...x[k], [field]: v } }));
  const cetak = () => {
    const dipilih = (rows ?? []).filter((t) => pilih.has(t.id));
    if (!dipilih.length) return setError("Pilih minimal satu obat / BHP");
    if (!f.nomor.trim()) return setError("Isi nomor berita acara");
    if (!f.pj.nama.trim() || !f.saksi1.nama.trim() || !f.saksi2.nama.trim()) return setError("Isi nama penanggung jawab dan kedua saksi");
    setError("");
    try {
      const { nomor: _n, tanggal: _t, ...ingat } = f;
      localStorage.setItem(simpanKey, JSON.stringify(ingat));
    } catch {
      /* no storage */
    }
    printDocument(baHtml(klinik, f, dipilih));
  };
  const semua = rows && rows.length > 0 && rows.every((t) => pilih.has(t.id));
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-3xl mt-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">Berita Acara Pemusnahan Obat & BHP</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Klinik {klinik} · yang sudah disetujui pemeriksa</p>
          </div>
          <button onClick={onClose} title="Tutup" className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Perusahaan (kop surat)</label>
              <input value={f.perusahaan} onChange={(e) => set("perusahaan", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nomor berita acara</label>
              <input value={f.nomor} onChange={(e) => set("nomor", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Tanggal pemusnahan</label>
              <input type="date" value={f.tanggal} onChange={(e) => e.target.value && set("tanggal", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Tempat</label>
              <input value={f.tempat} onChange={(e) => set("tempat", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cara pemusnahan</label>
              <select value={f.cara} onChange={(e) => set("cara", e.target.value)} className={inputCls}>
                {CARA.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Nama pihak ketiga / supplier / lokasi (opsional)</label>
              <input value={f.pihakKetiga} onChange={(e) => set("pihakKetiga", e.target.value)} placeholder="mis. PT ... (no. manifest ...)" className={inputCls} />
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-[var(--text-primary)] mb-2">Yang bertanda tangan</div>
            <div className="space-y-2">
              {ORANG.map((o) => (
                <div key={o.key} className="grid sm:grid-cols-[200px_1fr_1fr] gap-2 items-center">
                  <span className="text-xs text-[var(--text-secondary)]">{o.label}</span>
                  <input value={f[o.key].nama} onChange={(e) => setOrang(o.key, "nama", e.target.value)} placeholder="Nama" className={inputCls} />
                  <input value={f[o.key].jabatan} onChange={(e) => setOrang(o.key, "jabatan", e.target.value)} placeholder="Jabatan" className={inputCls} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">Obat / BHP yang dimusnahkan</span>
              {rows && rows.length > 0 && (
                <button onClick={() => setPilih(semua ? new Set() : new Set(rows.map((t) => t.id)))} className="text-xs text-[var(--accent-blue)] hover:underline">
                  {semua ? "Kosongkan pilihan" : "Pilih semua"}
                </button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
              {rows === null ? (
                <p className="p-3 text-xs text-[var(--text-muted)]">Memuat...</p>
              ) : !rows.length ? (
                <p className="p-3 text-xs text-[var(--text-muted)]">Belum ada obat / BHP ditarik yang disetujui di periode ini.</p>
              ) : (
                rows.map((t) => (
                  <label key={t.id} className="flex items-start gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-[#f8fafc]">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={pilih.has(t.id)}
                      onChange={() =>
                        setPilih((s) => {
                          const n = new Set(s);
                          if (!n.delete(t.id)) n.add(t.id);
                          return n;
                        })
                      }
                    />
                    <span className="flex-1">
                      {t.nama}{" "}
                      <span className="text-xs text-[var(--text-muted)]">
                        · {t.qty.toLocaleString("id-ID")} {t.satuan} · exp {batchText(t)} · {ALASAN[t.alasan ?? ""] ?? "Kedaluwarsa"}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">Yang diretur ke supplier tidak dipilih otomatis (bukan pemusnahan); centang bila ingin dimasukkan.</p>
          </div>

          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
              Batal
            </button>
            <button onClick={cetak} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90">
              <FileText size={15} /> Cetak Berita Acara ({pilih.size} item)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
