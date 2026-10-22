import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { api, errorText, type KlinikTarik, type KopTx } from "../lib/api";
import { printDocument } from "../lib/printTable";
import { isoDisplay, localToday } from "../lib/opname";

// Berita Acara Pemusnahan: a formal letter of what was approved (Klinik obat / BHP, Koperasi barang) - kop,
// nomor, the day / date / place written out, the people involved, how it was destroyed, the list and the
// signatures. The form is filled first; names, positions, company and cara are remembered in this
// browser for the next one (per unit).

export type BaItem = {
  id: number;
  nama: string;
  kode: string;
  tgl: string; // tanggal expired (batch) or the date it was recorded
  qty: number;
  satuan: string;
  alasan: string;
  keterangan: string;
  info: string; // small print under the keterangan
  nilai?: number; // Rp (harga beli), Koperasi
  pilih: boolean; // ticked at the start
};
type Orang = { nama: string; jabatan: string };
type Peran = "pj" | "pelaksana" | "saksi1" | "saksi2" | "mengetahui";
type Isian = { perusahaan: string; nomor: string; tanggal: string; tempat: string; cara: string; pihakKetiga: string } & Record<Peran, Orang>;
export type BaJenis = {
  storageKey: string;
  unit: string; // under the company name in the kop, e.g. "Klinik Estate NILAM"
  judul: string; // BERITA ACARA PEMUSNAHAN ...
  barang: string; // "obat dan bahan medis habis pakai (BHP)" / "barang koperasi"
  kolomTgl: string;
  nomor: string;
  tempat: string;
  kota: string;
  cara: string[];
  peran: Record<Peran, { label: string; jabatan: string }>;
  catatanPilih?: string;
};

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
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const PERAN: Peran[] = ["pj", "pelaksana", "saksi1", "saksi2", "mengetahui"];

function baHtml(j: BaJenis, f: Isian, rows: BaItem[]) {
  const d = new Date(`${f.tanggal}T00:00:00`);
  const tgl = `${HARI[d.getDay()]} tanggal ${terbilang(d.getDate())} bulan ${BULAN[d.getMonth()]} tahun ${terbilang(d.getFullYear())} (${isoDisplay(f.tanggal)})`;
  const cara = f.cara + (f.pihakKetiga.trim() ? `: ${f.pihakKetiga.trim()}` : "");
  const nilai = rows.some((r) => r.nilai !== undefined);
  const total = rows.reduce((s, r) => s + (r.nilai ?? 0), 0);
  const orang = PERAN.filter((k) => k !== "mengetahui" && f[k].nama.trim());
  const ttd = (judul: string, o: Orang, style = "") =>
    `<div class="ttd" ${style}><div>${esc(judul)}</div><div class="ruang"></div><div class="nama">${esc(o.nama || "(................................)")}</div><div>${esc(o.jabatan)}</div></div>`;
  const body = rows
    .map(
      (t, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(t.nama)}<div class="kecil">${esc(t.kode)}</div></td><td class="c">${esc(t.tgl)}</td><td class="r">${t.qty.toLocaleString("id-ID")}</td><td>${esc(t.satuan)}</td><td>${esc(t.alasan)}</td><td>${esc(t.keterangan)}<div class="kecil">${esc(t.info)}</div></td>${nilai ? `<td class="r">${esc(rp(t.nilai ?? 0))}</td>` : ""}</tr>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(j.judul)} ${esc(f.nomor)}</title><style>
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
    .ttd .ruang { height: 64px; }
    .ttd .nama { font-weight: bold; text-decoration: underline; }
  </style></head><body>
    <div class="kop"><img src="${esc(location.origin)}/logo-agro.png" alt=""><div><div class="pt">${esc(f.perusahaan)}</div><div class="unit">${esc(j.unit)}</div></div></div>
    <h1>${esc(j.judul)}</h1>
    <div class="nomor">Nomor: ${esc(f.nomor)}</div>
    <p>Pada hari ini, ${esc(tgl)}, bertempat di ${esc(f.tempat)}, kami yang bertanda tangan di bawah ini:</p>
    <table class="orang">${orang
      .map((k, i) => `<tr><td>${i + 1}.</td><td>Nama</td><td>: ${esc(f[k].nama)}</td></tr><tr><td></td><td>Jabatan</td><td>: ${esc(f[k].jabatan || "-")}</td></tr><tr><td></td><td>Selaku</td><td>: ${esc(j.peran[k].label.replace(/ \(.*\)$/, ""))}</td></tr>`)
      .join("")}</table>
    <p>telah melakukan pemusnahan ${esc(j.barang)} milik ${esc(j.unit)} yang telah kedaluwarsa / rusak, sebanyak <b>${rows.length}</b> item${nilai ? ` dengan nilai (harga beli) <b>${esc(rp(total))}</b>` : ""}, sebagaimana daftar berikut. Seluruh barang telah diperiksa dan dicocokkan jumlah fisiknya dengan catatan di sistem sebelum dimusnahkan.</p>
    <table class="daftar"><thead><tr><th>No</th><th>Nama Barang</th><th>${esc(j.kolomTgl)}</th><th>Jumlah</th><th>Satuan</th><th>Alasan</th><th>Keterangan</th>${nilai ? "<th>Nilai</th>" : ""}</tr></thead><tbody>${body}${
      nilai ? `<tr><td colspan="7" class="r"><b>Total</b></td><td class="r"><b>${esc(rp(total))}</b></td></tr>` : ""
    }</tbody></table>
    <p>Pemusnahan dilakukan dengan cara <b>${esc(cara)}</b>, sehingga barang tersebut tidak dapat digunakan / dijual kembali, serta disaksikan oleh para saksi yang namanya tercantum dalam berita acara ini.</p>
    <p>Demikian Berita Acara Pemusnahan ini dibuat dengan sebenarnya dalam rangkap secukupnya untuk dapat dipergunakan sebagaimana mestinya.</p>
    <p style="text-align:right;margin-top:10px">${esc(j.kota)}, ${esc(`${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`)}</p>
    <div class="ttds">
      ${ttd("Yang Menyerahkan,", f.pj)}${ttd("Pelaksana Pemusnahan,", f.pelaksana)}
      ${ttd("Saksi 1,", f.saksi1)}${ttd("Saksi 2,", f.saksi2)}
      ${ttd("Mengetahui,", f.mengetahui, 'style="margin:0 auto"')}
    </div>
  </body></html>`;
}

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";

export function BaForm({ jenis: j, items, onClose }: { jenis: BaJenis; items: BaItem[] | null; onClose: () => void }) {
  const awal = (): Isian => {
    const kosong = {
      perusahaan: "PT. Anugerah Kembang Sawit Sejahtera",
      nomor: j.nomor,
      tanggal: localToday(),
      tempat: j.tempat,
      cara: j.cara[0],
      pihakKetiga: "",
      ...Object.fromEntries(PERAN.map((k) => [k, { nama: "", jabatan: j.peran[k].jabatan }])),
    } as Isian;
    try {
      const s = JSON.parse(localStorage.getItem(j.storageKey) ?? "null");
      // Names, positions, company and cara come back; nomor and tanggal are new for every BA.
      if (s) return { ...kosong, ...s, nomor: kosong.nomor, tanggal: kosong.tanggal };
    } catch {
      /* no storage */
    }
    return kosong;
  };
  const [f, setF] = useState<Isian>(awal);
  const [pilih, setPilih] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  useEffect(() => {
    if (items) setPilih(new Set(items.filter((t) => t.pilih).map((t) => t.id)));
  }, [items]);
  const set = <K extends keyof Isian>(k: K, v: Isian[K]) => setF((x) => ({ ...x, [k]: v }));
  const setOrang = (k: Peran, field: keyof Orang, v: string) => setF((x) => ({ ...x, [k]: { ...x[k], [field]: v } }));
  const cetak = () => {
    const dipilih = (items ?? []).filter((t) => pilih.has(t.id));
    if (!dipilih.length) return setError("Pilih minimal satu barang");
    if (!f.nomor.trim()) return setError("Isi nomor berita acara");
    if (!f.pj.nama.trim() || !f.saksi1.nama.trim() || !f.saksi2.nama.trim()) return setError("Isi nama yang menyerahkan dan kedua saksi");
    setError("");
    try {
      const { nomor: _n, tanggal: _t, ...ingat } = f;
      localStorage.setItem(j.storageKey, JSON.stringify(ingat));
    } catch {
      /* no storage */
    }
    printDocument(baHtml(j, f, dipilih));
  };
  const semua = !!items?.length && items.every((t) => pilih.has(t.id));
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-3xl mt-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">Berita Acara Pemusnahan</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{j.unit} · yang sudah disetujui pemeriksa</p>
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
                {[...j.cara, ...(j.cara.includes(f.cara) ? [] : [f.cara])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Pihak ketiga / supplier / lokasi (opsional)</label>
              <input value={f.pihakKetiga} onChange={(e) => set("pihakKetiga", e.target.value)} placeholder="mis. PT ... (no. manifest ...)" className={inputCls} />
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-[var(--text-primary)] mb-2">Yang bertanda tangan</div>
            <div className="space-y-2">
              {PERAN.map((k) => (
                <div key={k} className="grid sm:grid-cols-[200px_1fr_1fr] gap-2 items-center">
                  <span className="text-xs text-[var(--text-secondary)]">{j.peran[k].label}</span>
                  <input value={f[k].nama} onChange={(e) => setOrang(k, "nama", e.target.value)} placeholder="Nama" className={inputCls} />
                  <input value={f[k].jabatan} onChange={(e) => setOrang(k, "jabatan", e.target.value)} placeholder="Jabatan" className={inputCls} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">Barang yang dimusnahkan</span>
              {!!items?.length && (
                <button onClick={() => setPilih(semua ? new Set() : new Set(items.map((t) => t.id)))} className="text-xs text-[var(--accent-blue)] hover:underline">
                  {semua ? "Kosongkan pilihan" : "Pilih semua"}
                </button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
              {items === null ? (
                <p className="p-3 text-xs text-[var(--text-muted)]">Memuat...</p>
              ) : !items.length ? (
                <p className="p-3 text-xs text-[var(--text-muted)]">Belum ada yang disetujui di periode ini.</p>
              ) : (
                items.map((t) => (
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
                        · {t.qty.toLocaleString("id-ID")} {t.satuan} · {t.tgl} · {t.alasan}
                        {t.nilai !== undefined ? ` · ${rp(t.nilai)}` : ""}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            {j.catatanPilih && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{j.catatanPilih}</p>}
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

const nomorDefault = (kode: string, periode: string) => `     /BA-PMS/${kode}/${periode.slice(5, 7)}/${periode.slice(0, 4)}`;
const waktu = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jakarta" });
const kota = (estate: string) => estate.charAt(0) + estate.slice(1).toLowerCase();

// Klinik: obat / BHP approved in Expired & Rusak (retur not ticked at the start: it isn't destroyed).
export function BaPemusnahanModal({ klinik, periode, onClose }: { klinik: string; periode: string; onClose: () => void }) {
  const [items, setItems] = useState<BaItem[] | null>(null);
  const ALASAN: Record<string, string> = { EXPIRED: "Kedaluwarsa", RUSAK: "Rusak", RETUR: "Retur ke supplier" };
  useEffect(() => {
    api
      .klinikTarikList({ klinik, status: "DISETUJUI", periode })
      .then((r: KlinikTarik[]) =>
        setItems(
          r.map((t) => ({
            id: t.id,
            nama: t.nama,
            kode: t.kode,
            tgl: (t.alloc ?? []).map((a) => (a.exp ? isoDisplay(a.exp) : "-")).join(", ") || "-",
            qty: t.qty,
            satuan: t.satuan,
            alasan: ALASAN[t.alasan ?? ""] ?? "Kedaluwarsa",
            keterangan: t.note ?? "",
            info: `ditarik ${waktu(t.created_at)}${t.diperiksa_nama ? ` · diperiksa ${t.diperiksa_nama}` : ""}`,
            pilih: t.alasan !== "RETUR",
          }))
        )
      )
      .catch((e) => (setItems([]), alert(errorText(e, "Gagal memuat"))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klinik, periode]);
  return (
    <BaForm
      items={items}
      onClose={onClose}
      jenis={{
        storageKey: `ba-pemusnahan-${klinik}`,
        unit: `Klinik Estate ${klinik}`,
        judul: "Berita Acara Pemusnahan Obat dan Bahan Medis Habis Pakai",
        barang: "obat dan bahan medis habis pakai (BHP)",
        kolomTgl: "Tgl Expired (Batch)",
        nomor: nomorDefault(`KLINIK-${klinik}`, periode),
        tempat: `Klinik Estate ${klinik}`,
        kota: kota(klinik),
        cara: ["Diserahkan ke pihak ketiga pengelola limbah B3 berizin", "Dibakar dengan insinerator", "Dihancurkan / dirusak kemasannya lalu ditimbun", "Dikembalikan (retur) ke supplier / PBF"],
        peran: {
          pj: { label: "Penanggung Jawab Klinik (yang menyerahkan)", jabatan: "Dokter / Penanggung Jawab Klinik" },
          pelaksana: { label: "Pelaksana pemusnahan", jabatan: "Petugas Klinik" },
          saksi1: { label: "Saksi 1", jabatan: "" },
          saksi2: { label: "Saksi 2", jabatan: "" },
          mengetahui: { label: "Mengetahui", jabatan: "Estate Manager" },
        },
        catatanPilih: "Yang diretur ke supplier tidak dipilih otomatis (bukan pemusnahan); centang bila ingin dimasukkan.",
      }}
    />
  );
}

// Koperasi: barang rusak / expired approved in the periode, with their nilai (harga beli).
export function BaKoperasiModal({ periode, onClose }: { periode: string; onClose: () => void }) {
  const [items, setItems] = useState<BaItem[] | null>(null);
  useEffect(() => {
    (async () => {
      const first = await api.kopTx({ jenis: "RUSAK", status: "DISETUJUI", periode, page: 1, pageSize: 500 });
      let rows: KopTx[] = first.data;
      for (let p = 2; rows.length < first.total && p <= 40; p++) rows = rows.concat((await api.kopTx({ jenis: "RUSAK", status: "DISETUJUI", periode, page: p, pageSize: 500 })).data);
      setItems(
        rows.map((t) => ({
          id: t.id,
          nama: t.barang_nama,
          kode: t.barang_kode,
          tgl: isoDisplay(t.tanggal_iso),
          qty: t.qty,
          satuan: t.satuan,
          alasan: t.alasan === "EXPIRED" ? "Kedaluwarsa" : "Rusak",
          keterangan: t.keterangan,
          info: `oleh ${t.oleh || "-"}${t.diperiksa_nama ? ` · diperiksa ${t.diperiksa_nama}` : ""}`,
          nilai: t.total,
          pilih: true,
        }))
      );
    })().catch((e) => (setItems([]), alert(errorText(e, "Gagal memuat"))));
  }, [periode]);
  return (
    <BaForm
      items={items}
      onClose={onClose}
      jenis={{
        storageKey: "ba-pemusnahan-koperasi",
        unit: "Koperasi Karyawan PT.AKSS",
        judul: "Berita Acara Pemusnahan Barang Rusak / Kedaluwarsa",
        barang: "barang dagangan",
        kolomTgl: "Tgl Dicatat",
        nomor: nomorDefault("KOPERASI", periode),
        tempat: "Koperasi Karyawan Estate NILAM",
        kota: "Nilam",
        cara: ["Dihancurkan / dirusak kemasannya lalu dibuang", "Dibakar", "Dikembalikan (retur) ke supplier", "Diserahkan ke pihak ketiga pengelola sampah"],
        peran: {
          pj: { label: "Petugas Koperasi (yang menyerahkan)", jabatan: "Petugas Koperasi" },
          pelaksana: { label: "Pemeriksa / pelaksana pemusnahan", jabatan: "" },
          saksi1: { label: "Saksi 1", jabatan: "" },
          saksi2: { label: "Saksi 2", jabatan: "" },
          mengetahui: { label: "Mengetahui", jabatan: "Ketua Koperasi / Estate Manager" },
        },
      }}
    />
  );
}
