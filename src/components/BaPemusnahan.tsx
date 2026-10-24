import { useEffect, useState } from "react";
import { Check, CheckCircle2, CircleDashed, FileText, PenLine, Printer, ShieldCheck, UserCheck, X } from "lucide-react";
import { api, errorText, type BaPeran, type BaTtd, type BeritaAcara, type KlinikTarik, type KopTx } from "../lib/api";
import { SignaturePad } from "./SignaturePad";
import { printDocument } from "../lib/printTable";
import { isoDisplay, localToday } from "../lib/opname";
import { BULAN, HARI, KOP_CSS, escHtml, jabatanDariGelar, kopHtml, namaLama, perusahaanEstate, perusahaanIngat, terbilang } from "../lib/surat";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { EvidenceInput, EvidenceLink, useEvidenceEnabled } from "./EvidenceInput";

// Berita Acara Pemusnahan (Klinik obat / BHP, Koperasi barang rusak): a stored document with an automatic
// nomor. Made from the approved rows (each row on one active BA only) and printed as a formal letter, signed
// in the app: yang menyerahkan by making it, the Estate Manager / Ketua (Setujui Berita Acara) approves or
// refuses it from Persetujuan, then at the destruction the pelaksana and both saksi sign - with their account
// or drawn on the screen - and it is closed. (A BA made before this keeps its WhatsApp-capture approval.)
// Names, positions, company and cara are remembered per unit.

export type BaItem = BeritaAcara["items"][number] & { pilih: boolean };
type Orang = { nama: string; jabatan: string };
type Peran = "pj" | "pelaksana" | "saksi1" | "saksi2" | "mengetahui";
type Isian = { perusahaan: string; tempat: string; cara: string; pihakKetiga: string } & Record<Peran, Orang>;
export type BaJenis = {
  modul: "KLINIK" | "KOPERASI";
  unit: string; // klinik estate / NILAM
  storageKey: string;
  unitLabel: string; // under the company name in the kop, e.g. "Klinik Estate NILAM"
  judul: string;
  barang: string;
  kolomTgl: string;
  contohNomor: string;
  tempat: string;
  kota: string;
  cara: string[];
  peran: Record<Peran, { label: string; jabatan: string }>;
  catatanPilih?: string;
};

const esc = escHtml;
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const PERAN: Peran[] = ["pj", "pelaksana", "saksi1", "saksi2", "mengetahui"];
const waktuJam = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).replace(",", "");
const TTD_MUSNAH: BaPeran[] = ["pelaksana", "saksi1", "saksi2"];
const digital = (ba: Pick<BeritaAcara, "ttd">) => !!ba.ttd?.pj;
const waktu = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jakarta" });

// The letter of a stored BA (also reprinted later, with its approval / closing when there is one).
export function baHtml(
  j: BaJenis,
  ba: Pick<BeritaAcara, "nomor" | "tanggal" | "items" | "status" | "disetujui_nama" | "disetujui_jabatan" | "disetujui_tgl" | "selesai_tgl" | "ttd">,
  f: Isian
) {
  const rows = ba.items;
  const d = new Date(`${ba.tanggal}T00:00:00`);
  const tgl = `${HARI[d.getDay()]} tanggal ${terbilang(d.getDate())} bulan ${BULAN[d.getMonth()]} tahun ${terbilang(d.getFullYear())} (${isoDisplay(ba.tanggal)})`;
  const cara = f.cara + (f.pihakKetiga?.trim() ? `: ${f.pihakKetiga.trim()}` : "");
  const nilai = rows.some((r) => r.nilai !== undefined && r.nilai !== null);
  const total = rows.reduce((s, r) => s + (r.nilai ?? 0), 0);
  const orang = PERAN.filter((k) => k !== "mengetahui" && f[k]?.nama?.trim());
  // A box signed in the app: the drawn signature, or an electronic stamp for one signed with an account.
  const ttd = (judul: string, k: Peran, style = "") => {
    const o = f[k];
    const t = ba.ttd?.[k];
    const ruang = !t
      ? `<div class="ruang"></div>`
      : t.cara === "LAYAR" && t.gambar
        ? `<div class="ruang el"><img src="${t.gambar}" alt="tanda tangan"></div>`
        : `<div class="ruang el"><div class="cap">DITANDATANGANI SECARA ELEKTRONIK<br>${esc(waktuJam(t.at))}</div></div>`;
    return `<div class="ttd" ${style}><div>${esc(judul)}</div>${ruang}<div class="nama">${esc(t?.nama || o?.nama || "(................................)")}</div><div>${esc(t?.jabatan || o?.jabatan || "")}</div></div>`;
  };
  const body = rows
    .map(
      (t, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(t.nama)}<div class="kecil">${esc(t.kode)}</div></td><td class="c">${esc(t.tgl)}</td><td class="r">${t.qty.toLocaleString("id-ID")}</td><td>${esc(t.satuan)}</td><td>${esc(t.alasan)}</td><td>${esc(t.keterangan)}<div class="kecil">${esc(t.info)}</div></td>${nilai ? `<td class="r">${esc(rp(t.nilai ?? 0))}</td>` : ""}</tr>`
    )
    .join("");
  const m = ba.ttd?.mengetahui;
  const setuju = m
    ? `<p class="setuju">Persetujuan: disetujui oleh <b>${esc(m.nama)}</b>${m.jabatan ? ` (${esc(m.jabatan)})` : ""} secara elektronik di sistem pada ${esc(waktuJam(m.at))}.${
        ba.status === "SELESAI" && ba.selesai_tgl ? ` Barang telah dimusnahkan pada ${esc(isoDisplay(ba.selesai_tgl))}.` : ""
      }</p>`
    : ba.status === "DISETUJUI" || ba.status === "SELESAI"
      ? `<p class="setuju">Persetujuan: disetujui oleh <b>${esc(ba.disetujui_nama)}</b>${ba.disetujui_jabatan ? ` (${esc(ba.disetujui_jabatan)})` : ""} pada ${esc(isoDisplay(ba.disetujui_tgl ?? ""))} melalui WhatsApp; bukti tersimpan di sistem.${ba.status === "SELESAI" && ba.selesai_tgl ? ` Barang telah dimusnahkan pada ${esc(isoDisplay(ba.selesai_tgl))}.` : ""}</p>`
      : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(j.judul)} ${esc(ba.nomor)}</title><style>
    @page { size: A4 portrait; margin: 15mm 15mm 15mm 18mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: "Times New Roman", Times, serif; color: #000; font-size: 11pt; line-height: 1.45; margin: 0; }
    ${KOP_CSS}
    h1 { text-align: center; font-size: 13pt; margin: 16px 0 0; text-decoration: underline; text-transform: uppercase; }
    .nomor { text-align: center; margin: 2px 0 14px; }
    p { margin: 0 0 8px; text-align: justify; }
    p.setuju { font-size: 9.5pt; border: 1px solid #000; padding: 4px 8px; margin-top: 10px; }
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
    .ttd .ruang.el { display: flex; align-items: center; justify-content: center; }
    .ttd .ruang.el img { max-height: 62px; max-width: 90%; }
    .ttd .cap { border: 1.5px solid #1f4e9c; color: #1f4e9c; border-radius: 4px; padding: 3px 6px; font-size: 7.5pt; font-weight: bold; line-height: 1.35; font-family: Arial, sans-serif; }
    .ttd .nama { font-weight: bold; text-decoration: underline; }
  </style></head><body>
    ${kopHtml(f.perusahaan, j.unitLabel)}
    <h1>${esc(j.judul)}</h1>
    <div class="nomor">Nomor: ${esc(ba.nomor)}</div>
    <p>Pada hari ini, ${esc(tgl)}, bertempat di ${esc(f.tempat)}, kami yang bertanda tangan di bawah ini:</p>
    <table class="orang">${orang
      .map((k, i) => `<tr><td>${i + 1}.</td><td>Nama</td><td>: ${esc(f[k].nama)}</td></tr><tr><td></td><td>Jabatan</td><td>: ${esc(f[k].jabatan || "-")}</td></tr><tr><td></td><td>Selaku</td><td>: ${esc(j.peran[k].label.replace(/ \(.*\)$/, ""))}</td></tr>`)
      .join("")}</table>
    <p>akan / telah melakukan pemusnahan ${esc(j.barang)} milik ${esc(j.unitLabel)} yang telah kedaluwarsa / rusak, sebanyak <b>${rows.length}</b> item${nilai ? ` dengan nilai (harga beli) <b>${esc(rp(total))}</b>` : ""}, sebagaimana daftar berikut. Seluruh barang telah diperiksa dan dicocokkan jumlah fisiknya dengan catatan di sistem.</p>
    <table class="daftar"><thead><tr><th>No</th><th>Nama Barang</th><th>${esc(j.kolomTgl)}</th><th>Jumlah</th><th>Satuan</th><th>Alasan</th><th>Keterangan</th>${nilai ? "<th>Nilai</th>" : ""}</tr></thead><tbody>${body}${
      nilai ? `<tr><td colspan="7" class="r"><b>Total</b></td><td class="r"><b>${esc(rp(total))}</b></td></tr>` : ""
    }</tbody></table>
    <p>Pemusnahan dilakukan dengan cara <b>${esc(cara)}</b> setelah mendapat persetujuan manager / perwakilan, sehingga barang tersebut tidak dapat digunakan / dijual kembali, serta disaksikan oleh para saksi yang namanya tercantum dalam berita acara ini.</p>
    <p>Demikian Berita Acara Pemusnahan ini dibuat dengan sebenarnya dalam rangkap secukupnya untuk dapat dipergunakan sebagaimana mestinya.</p>
    <p style="text-align:right;margin-top:10px">${esc(j.kota)}, ${esc(`${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`)}</p>
    <div class="ttds">
      ${ttd("Yang Menyerahkan,", "pj")}${ttd("Pelaksana Pemusnahan,", "pelaksana")}
      ${ttd("Saksi 1,", "saksi1")}${ttd("Saksi 2,", "saksi2")}
      ${ttd("Mengetahui / Menyetujui,", "mengetahui", 'style="margin:0 auto"')}
    </div>
    ${setuju}
  </body></html>`;
}
export const cetakBa = (j: BaJenis, ba: BeritaAcara) => printDocument(baHtml(j, ba, ba.isian as Isian));

const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";
const btnPrimary = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50";
const btnOutline = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-[#f1f5f9]";

function Shell({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className={`bg-[var(--bg-card)] rounded-lg shadow-xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} mt-6`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">{title}</h3>
            {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} title="Tutup" className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// The form of a new BA: saved with its automatic nomor, then printed.
export function BaForm({ jenis: j, items, onClose, onSaved }: { jenis: BaJenis; items: BaItem[] | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const awal = (): Isian => {
    const kosong = {
      perusahaan: perusahaanEstate(j.modul === "KLINIK" ? j.unit : null),
      tempat: j.tempat,
      cara: j.cara[0],
      pihakKetiga: "",
      ...Object.fromEntries(PERAN.map((k) => [k, { nama: "", jabatan: j.peran[k].jabatan }])),
    } as Isian;
    let isian = kosong;
    try {
      const s = JSON.parse(localStorage.getItem(j.storageKey) ?? "null");
      if (s) isian = { ...kosong, ...s, perusahaan: perusahaanIngat(s.perusahaan, j.modul === "KLINIK" ? j.unit : null) };
    } catch {
      /* no storage */
    }
    // Yang menyerahkan (the bidan / mantri jaga): the clinic account by its full name and title when
    // nothing (or only an old-style name) was remembered.
    if (user?.nama && user.role !== "superuser" && (!isian.pj?.nama || namaLama(isian.pj.nama)))
      isian = { ...isian, pj: { nama: user.nama, jabatan: jabatanDariGelar(user.nama) || isian.pj?.jabatan || "" } };
    return isian;
  };
  const [f, setF] = useState<Isian>(awal);
  const [tanggal, setTanggal] = useState(localToday());
  const [pilih, setPilih] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (items) setPilih(new Set(items.filter((t) => t.pilih).map((t) => t.id)));
  }, [items]);
  const set = <K extends keyof Isian>(k: K, v: Isian[K]) => setF((x) => ({ ...x, [k]: v }));
  const setOrang = (k: Peran, field: keyof Orang, v: string) => setF((x) => ({ ...x, [k]: { ...x[k], [field]: v } }));
  const simpan = async () => {
    const dipilih = (items ?? []).filter((t) => pilih.has(t.id));
    if (!dipilih.length) return setError("Pilih minimal satu barang");
    if (!f.pj.nama.trim() || !f.saksi1.nama.trim() || !f.saksi2.nama.trim()) return setError("Isi nama yang menyerahkan dan kedua saksi");
    setBusy(true);
    setError("");
    try {
      const r = await api.baBuat({ modul: j.modul, unit: j.unit, tanggal, isian: f, ref_ids: dipilih.map((t) => t.id) });
      try {
        localStorage.setItem(j.storageKey, JSON.stringify(f));
      } catch {
        /* no storage */
      }
      printDocument(
        baHtml(
          j,
          {
            nomor: r.nomor,
            tanggal,
            items: dipilih,
            status: "MENUNGGU",
            disetujui_nama: "",
            disetujui_jabatan: "",
            disetujui_tgl: null,
            selesai_tgl: null,
            ttd: { pj: { cara: "AKUN", nama: user?.nama ?? f.pj.nama, jabatan: f.pj.jabatan, at: new Date().toISOString() } },
          },
          f
        )
      );
      onSaved();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan berita acara"));
    } finally {
      setBusy(false);
    }
  };
  const semua = !!items?.length && items.every((t) => pilih.has(t.id));
  return (
    <Shell title="Buat Berita Acara Pemusnahan" subtitle={`${j.unitLabel} · barang yang sudah disetujui pemeriksa`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Perusahaan (kop surat)</label>
            <input value={f.perusahaan} onChange={(e) => set("perusahaan", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Nomor berita acara</label>
            <div className="text-sm rounded-md border border-dashed border-[var(--border)] px-3 py-1.5 text-[var(--text-muted)] bg-[#f8fafc]">Otomatis saat disimpan, mis. {j.contohNomor}</div>
          </div>
          <div>
            <label className={labelCls}>Rencana tanggal pemusnahan</label>
            <input type="date" value={tanggal} onChange={(e) => e.target.value && setTanggal(e.target.value)} className={inputCls} />
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
              <p className="p-3 text-xs text-[var(--text-muted)]">Tidak ada barang disetujui yang belum masuk berita acara.</p>
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
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Barang yang sudah masuk berita acara lain tidak ditampilkan.{j.catatanPilih ? ` ${j.catatanPilih}` : ""}
          </p>
        </div>

        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnOutline}>
            Batal
          </button>
          <button onClick={simpan} disabled={busy} className={btnPrimary}>
            <FileText size={15} /> {busy ? "Menyimpan..." : `Simpan & Cetak (${pilih.size} item)`}
          </button>
        </div>
      </div>
    </Shell>
  );
}

const STATUS: Record<BeritaAcara["status"], { label: string; cls: string }> = {
  MENUNGGU: { label: "Menunggu persetujuan", cls: "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]" },
  DISETUJUI: { label: "Disetujui, siap dimusnahkan", cls: "bg-[var(--accent-blue-bg)] border-[var(--accent-blue-border)] text-[var(--accent-blue)]" },
  SELESAI: { label: "Selesai, sudah dimusnahkan", cls: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]" },
  BATAL: { label: "Batal", cls: "bg-[#f1f5f9] border-[var(--border)] text-[var(--text-muted)]" },
};

function SetujuModal({ ba, onClose, onDone }: { ba: BeritaAcara; onClose: () => void; onDone: () => void }) {
  const fotoAktif = useEvidenceEnabled();
  const m = (ba.isian as Isian).mengetahui;
  const [nama, setNama] = useState(m?.nama ?? "");
  const [jabatan, setJabatan] = useState(m?.jabatan ?? "");
  const [tgl, setTgl] = useState(localToday());
  const [ev, setEv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!nama.trim()) return setError("Isi nama manager / perwakilan");
    if (fotoAktif && !ev) return setError("Lampirkan capture balasan WhatsApp persetujuannya");
    setBusy(true);
    setError("");
    try {
      await api.baSetuju(ba.id, { nama: nama.trim(), jabatan: jabatan.trim(), tanggal: tgl, evidence_id: ev });
      onDone();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title={`Persetujuan ${ba.nomor}`} subtitle="Catat persetujuan manager / perwakilan dengan bukti capture WhatsApp" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Disetujui oleh</label>
            <input value={nama} onChange={(e) => setNama(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Jabatan</label>
            <input value={jabatan} onChange={(e) => setJabatan(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tanggal persetujuan</label>
            <input type="date" value={tgl} max={localToday()} onChange={(e) => e.target.value && setTgl(e.target.value)} className={inputCls} />
          </div>
        </div>
        <EvidenceInput value={ev} onChange={setEv} label="Capture balasan WhatsApp persetujuan (wajib)" />
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnOutline}>
            Batal
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            <ShieldCheck size={15} /> {busy ? "Menyimpan..." : "Simpan persetujuan"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

function SelesaiModal({ ba, onClose, onDone }: { ba: BeritaAcara; onClose: () => void; onDone: () => void }) {
  const [tgl, setTgl] = useState(localToday());
  const [catatan, setCatatan] = useState("");
  const [ev, setEv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api.baSelesai(ba.id, { tanggal: tgl, catatan: catatan.trim(), evidence_id: ev });
      onDone();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title={`Tutup ${ba.nomor}`} subtitle="Barang sudah dimusnahkan sesuai SOP, disaksikan 2 orang" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Tanggal pemusnahan</label>
          <input type="date" value={tgl} max={localToday()} onChange={(e) => e.target.value && setTgl(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Catatan (opsional, mis. diserahkan ke ..., no. manifest)</label>
          <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputCls} />
        </div>
        <EvidenceInput value={ev} onChange={setEv} label="Foto pemusnahan (opsional)" />
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnOutline}>
            Batal
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            <CheckCircle2 size={15} /> {busy ? "Menyimpan..." : "Tutup berita acara"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

// The BAs of a unit with their steps: Cetak · Catat persetujuan (capture WA) · Tutup (dimusnahkan) · Batal.
export function BaDaftar({ jenis: j, items, reload, onChanged }: { jenis: BaJenis; items: () => Promise<BaItem[]>; reload: number; onChanged?: () => void }) {
  const { user } = useAuth();
  const mod = j.modul.toLowerCase();
  const canInput = can(user, `${mod}.input`);
  const canEdit = can(user, `${mod}.edit`);
  const [list, setList] = useState<{ data: BeritaAcara[]; terpakai: number[] } | null>(null);
  const [muat, setMuat] = useState(0);
  const [buat, setBuat] = useState<BaItem[] | null | false>(false);
  const [setuju, setSetuju] = useState<BeritaAcara | null>(null);
  const [selesai, setSelesai] = useState<BeritaAcara | null>(null);
  const [periksa, setPeriksa] = useState<BeritaAcara | null>(null);
  const [tandaTangan, setTandaTangan] = useState<BeritaAcara | null>(null);
  const [error, setError] = useState("");
  const canSetujui = can(user, "ba.setujui");
  useEffect(() => {
    api
      .baList(j.modul, j.unit)
      .then(setList)
      .catch(() => setList({ data: [], terpakai: [] }));
  }, [j.modul, j.unit, reload, muat]);
  const done = () => {
    setBuat(false);
    setSetuju(null);
    setSelesai(null);
    setPeriksa(null);
    setTandaTangan(null);
    setMuat((n) => n + 1);
    onChanged?.();
  };
  const bukaBuat = async () => {
    setError("");
    setBuat(null);
    try {
      const terpakai = new Set(list?.terpakai ?? []);
      setBuat((await items()).filter((t) => !terpakai.has(t.id)));
    } catch (e) {
      setBuat(false);
      setError(errorText(e, "Gagal memuat"));
    }
  };
  const batal = async (ba: BeritaAcara) => {
    const alasan = window.prompt(`Batalkan ${ba.nomor}? Tulis alasannya:`);
    if (!alasan?.trim()) return;
    try {
      await api.baBatal(ba.id, alasan.trim());
      done();
    } catch (e) {
      setError(errorText(e, "Gagal membatalkan"));
    }
  };
  const aktif = (list?.data ?? []).filter((b) => b.status === "MENUNGGU" || b.status === "DISETUJUI").length;
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Berita Acara Pemusnahan</h2>
        {aktif > 0 && <span className="text-xs text-[var(--accent-amber)]">{aktif} belum selesai</span>}
        <span className="text-xs text-[var(--text-muted)]">Buat → disetujui Estate Manager di aplikasi → musnahkan, pelaksana & saksi tanda tangan → tutup</span>
        {error && <span className="text-xs text-[var(--accent-red)]">{error}</span>}
        {canInput && (
          <button onClick={bukaBuat} className={`${btnPrimary} ml-auto`}>
            <FileText size={15} /> Buat Berita Acara
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table className="data-table text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-secondary)]">
              <th className="px-3 py-2">Nomor</th>
              <th className="px-3 py-2">Rencana tgl</th>
              <th className="px-3 py-2 text-right">Barang</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Persetujuan / pemusnahan</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {list === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Memuat...
                </td>
              </tr>
            ) : !list.data.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Belum ada berita acara.
                </td>
              </tr>
            ) : (
              list.data.map((b) => (
                <tr key={b.id} className={`align-top ${b.status === "BATAL" ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="font-medium text-[var(--text-primary)]">{b.nomor}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      dibuat {waktu(b.created_at)} · {b.dibuat_nama || "-"}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{isoDisplay(b.tanggal)}</td>
                  <td className="px-3 py-2 text-right">{b.items.length}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS[b.status].cls}`}>{STATUS[b.status].label}</span>
                  </td>
                  <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">
                    {b.status === "BATAL" ? (
                      <span>Dibatalkan: {b.batal_alasan}</span>
                    ) : b.status === "MENUNGGU" ? (
                      <span className="text-[var(--text-muted)]">
                        {digital(b)
                          ? `Menunggu persetujuan ${(b.isian as Isian).mengetahui?.jabatan || "Estate Manager"} di menu Persetujuan.`
                          : "Kirim BA ke manager / perwakilan, lalu catat persetujuannya dengan capture WA."}
                      </span>
                    ) : (
                      <>
                        <div>
                          Disetujui <b>{b.disetujui_nama}</b>
                          {b.disetujui_jabatan ? ` (${b.disetujui_jabatan})` : ""} ·{" "}
                          {b.ttd?.mengetahui ? (
                            `${waktuJam(b.ttd.mengetahui.at)} di aplikasi`
                          ) : (
                            <>
                              {isoDisplay(b.disetujui_tgl ?? "")} <EvidenceLink id={b.evidence_id} label="capture WA" />
                            </>
                          )}
                        </div>
                        {digital(b) && (
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                            {TTD_MUSNAH.map((k) => (
                              <span key={k} className={`inline-flex items-center gap-1 ${b.ttd?.[k] ? "text-[var(--accent-green)]" : "text-[var(--text-muted)]"}`}>
                                {b.ttd?.[k] ? <Check size={12} /> : <CircleDashed size={12} />}
                                {j.peran[k].label.replace(/ \(.*\)$/, "")}
                                {b.ttd?.[k] ? `: ${b.ttd[k]!.nama}` : ""}
                              </span>
                            ))}
                          </div>
                        )}
                        {b.status === "SELESAI" && (
                          <div>
                            Dimusnahkan {isoDisplay(b.selesai_tgl ?? "")}
                            {b.selesai_catatan ? ` · ${b.selesai_catatan}` : ""} <EvidenceLink id={b.foto_musnah} label="foto" />
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                    <button onClick={() => cetakBa(j, b)} title="Cetak berita acara" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[#f1f5f9]">
                      <Printer size={13} /> Cetak
                    </button>
                    {b.status === "MENUNGGU" && digital(b) && canSetujui && (user?.role === "superuser" || b.ttd?.pj?.user_id !== user?.id) && (
                      <button onClick={() => setPeriksa(b)} className="text-xs px-2 py-1 rounded bg-[var(--accent-blue)] text-white hover:opacity-90">
                        Setujui / Tolak
                      </button>
                    )}
                    {canInput && b.status === "MENUNGGU" && (!digital(b) || user?.role === "superuser") && (
                      <button
                        onClick={() => setSetuju(b)}
                        title={digital(b) ? "Bila Estate Manager tidak bisa menandatangani di aplikasi: catat persetujuan WA (Super User)" : undefined}
                        className={digital(b) ? "text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[#f1f5f9]" : "text-xs px-2 py-1 rounded bg-[var(--accent-blue)] text-white hover:opacity-90"}
                      >
                        {digital(b) ? "Catat manual (WA)" : "Catat persetujuan"}
                      </button>
                    )}
                    {canInput && b.status === "DISETUJUI" && digital(b) && (
                      <button onClick={() => setTandaTangan(b)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--accent-blue)] text-white hover:opacity-90">
                        <PenLine size={13} /> Tanda tangan
                      </button>
                    )}
                    {canInput && b.status === "DISETUJUI" && (
                      <button
                        onClick={() => setSelesai(b)}
                        disabled={digital(b) && TTD_MUSNAH.some((k) => !b.ttd?.[k])}
                        title={digital(b) && TTD_MUSNAH.some((k) => !b.ttd?.[k]) ? "Pelaksana dan kedua saksi tanda tangan dulu" : undefined}
                        className="text-xs px-2 py-1 rounded bg-[var(--accent-green)] text-white hover:opacity-90 disabled:opacity-40"
                      >
                        Tutup: sudah dimusnahkan
                      </button>
                    )}
                    {canEdit && (b.status === "MENUNGGU" || b.status === "DISETUJUI") && (
                      <button onClick={() => batal(b)} className="text-xs px-2 py-1 rounded border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                        Batal
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {buat !== false && <BaForm jenis={j} items={buat} onClose={() => setBuat(false)} onSaved={done} />}
      {setuju && <SetujuModal ba={setuju} onClose={() => setSetuju(null)} onDone={done} />}
      {selesai && <SelesaiModal ba={selesai} onClose={() => setSelesai(null)} onDone={done} />}
      {periksa && <BaPeriksaModal jenis={j} ba={periksa} onClose={() => setPeriksa(null)} onDone={done} />}
      {tandaTangan && <BaTtdModal jenis={j} ba={tandaTangan} onClose={() => setTandaTangan(null)} onDone={done} />}
    </div>
  );
}

const kota = (estate: string) => estate.charAt(0) + estate.slice(1).toLowerCase();
const bulanIni = () => localToday().slice(5, 7) + "/" + localToday().slice(0, 4);

export const jenisKlinik = (klinik: string): BaJenis => ({
  modul: "KLINIK",
  unit: klinik,
  storageKey: `ba-pemusnahan-${klinik}`,
  unitLabel: `Klinik Estate ${klinik}`,
  judul: "Berita Acara Pemusnahan Obat dan Bahan Medis Habis Pakai",
  barang: "obat dan bahan medis habis pakai (BHP)",
  kolomTgl: "Tgl Expired (Batch)",
  contohNomor: `001/BA-PMS/KLINIK-${klinik}/${bulanIni()}`,
  tempat: `Klinik Estate ${klinik}`,
  kota: kota(klinik),
  cara: ["Diserahkan ke pihak ketiga pengelola limbah B3 berizin", "Dibakar dengan insinerator", "Dihancurkan / dirusak kemasannya lalu ditimbun", "Dikembalikan (retur) ke supplier / PBF"],
  peran: {
    pj: { label: "Bidan / Mantri jaga (yang menyerahkan)", jabatan: "Bidan / Mantri Jaga" },
    pelaksana: { label: "Pelaksana pemusnahan", jabatan: "Petugas Klinik" },
    saksi1: { label: "Saksi 1", jabatan: "" },
    saksi2: { label: "Saksi 2", jabatan: "" },
    mengetahui: { label: "Mengetahui / menyetujui", jabatan: "Estate Manager" },
  },
  catatanPilih: "Yang diretur ke supplier tidak dipilih otomatis (bukan pemusnahan).",
});
export const jenisKoperasi = (): BaJenis => ({
  modul: "KOPERASI",
  unit: "NILAM",
  storageKey: "ba-pemusnahan-koperasi",
  unitLabel: "Koperasi Karyawan PT.AKSS",
  judul: "Berita Acara Pemusnahan Barang Rusak / Kedaluwarsa",
  barang: "barang dagangan",
  kolomTgl: "Tgl Dicatat",
  contohNomor: `001/BA-PMS/KOPERASI/${bulanIni()}`,
  tempat: "Koperasi Karyawan Estate NILAM",
  kota: "Nilam",
  cara: ["Dihancurkan / dirusak kemasannya lalu dibuang", "Dibakar", "Dikembalikan (retur) ke supplier", "Diserahkan ke pihak ketiga pengelola sampah"],
  peran: {
    pj: { label: "Petugas Koperasi (yang menyerahkan)", jabatan: "Petugas Koperasi" },
    pelaksana: { label: "Pemeriksa / pelaksana pemusnahan", jabatan: "" },
    saksi1: { label: "Saksi 1", jabatan: "" },
    saksi2: { label: "Saksi 2", jabatan: "" },
    mengetahui: { label: "Mengetahui / menyetujui", jabatan: "Ketua Koperasi / Estate Manager" },
  },
});

const ALASAN_KLINIK: Record<string, string> = { EXPIRED: "Kedaluwarsa", RUSAK: "Rusak", RETUR: "Retur ke supplier" };
// The approved rows a new BA can take (all months: what was approved and not yet on a BA).
export const itemsKlinik = (klinik: string) => async (): Promise<BaItem[]> =>
  (await api.klinikTarikList({ klinik, status: "DISETUJUI" })).map((t: KlinikTarik) => ({
    id: t.id,
    nama: t.nama,
    kode: t.kode,
    tgl: (t.alloc ?? []).map((a) => (a.exp ? isoDisplay(a.exp) : "-")).join(", ") || "-",
    qty: t.qty,
    satuan: t.satuan,
    alasan: ALASAN_KLINIK[t.alasan ?? ""] ?? "Kedaluwarsa",
    keterangan: t.note ?? "",
    info: `ditarik ${waktu(t.created_at)}${t.diperiksa_nama ? ` · diperiksa ${t.diperiksa_nama}` : ""}`,
    pilih: t.alasan !== "RETUR",
  }));
export const itemsKoperasi = async (): Promise<BaItem[]> => {
  const first = await api.kopTx({ jenis: "RUSAK", status: "DISETUJUI", page: 1, pageSize: 500 });
  let rows: KopTx[] = first.data;
  for (let p = 2; rows.length < first.total && p <= 40; p++) rows = rows.concat((await api.kopTx({ jenis: "RUSAK", status: "DISETUJUI", page: p, pageSize: 500 })).data);
  return rows.map((t) => ({
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
  }));
};

// Mengetahui / menyetujui: the BA as it prints, then Setujui (signed with the account) or Tolak with an alasan
// (the BA is cancelled). Also opened from Persetujuan.
export function BaPeriksaModal({ jenis: j, ba, onClose, onDone }: { jenis: BaJenis; ba: BeritaAcara; onClose: () => void; onDone: () => void }) {
  const [tolak, setTolak] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kirim = async (aksi: "SETUJU" | "TOLAK") => {
    if (aksi === "TOLAK" && alasan.trim().length < 3) return setError("Isi alasan penolakan");
    setBusy(true);
    setError("");
    try {
      await api.baPersetujuan(ba.id, { aksi, alasan: alasan.trim() });
      onDone();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title={`Persetujuan ${ba.nomor}`} subtitle={`${j.unitLabel} · ${ba.items.length} barang · dibuat ${ba.dibuat_nama || "-"}`} onClose={onClose} wide>
      <div className="space-y-3">
        <iframe title="Berita acara" srcDoc={baHtml(j, ba, ba.isian as Isian).replace("<body>", '<body style="padding:14px 18px">')} className="w-full h-[55vh] rounded-md border border-[var(--border)] bg-white" />
        {tolak ? (
          <div className="space-y-2">
            <input autoFocus value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500} placeholder="Alasan penolakan (wajib); berita acara dibatalkan" className={inputCls} />
            {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => (setTolak(false), setError(""))} disabled={busy} className={btnOutline}>
                Kembali
              </button>
              <button onClick={() => kirim("TOLAK")} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-red)] text-white hover:opacity-90 disabled:opacity-50">
                Tolak & batalkan
              </button>
            </div>
          </div>
        ) : (
          <>
            {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => cetakBa(j, ba)} className={`${btnOutline} mr-auto`}>
                <Printer size={15} /> Cetak
              </button>
              <button onClick={() => setTolak(true)} disabled={busy} className={btnOutline}>
                Tolak
              </button>
              <button onClick={() => kirim("SETUJU")} disabled={busy} className={btnPrimary}>
                <ShieldCheck size={15} /> {busy ? "Menyimpan..." : "Setujui & tandatangani"}
              </button>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

// At the destruction: the pelaksana and both saksi sign, each drawn on the screen (its name as on the BA, can be
// corrected) or with the account of whoever signs; a box signed already can be signed again.
function BaTtdModal({ jenis: j, ba, onClose, onDone }: { jenis: BaJenis; ba: BeritaAcara; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const [ttd, setTtd] = useState(ba.ttd ?? {});
  const [aktif, setAktif] = useState<BaPeran | null>(TTD_MUSNAH.find((k) => !ba.ttd?.[k]) ?? null);
  const [diubah, setDiubah] = useState(false);
  const isian = ba.isian as Isian;
  const tutup = () => (diubah ? onDone() : onClose());
  return (
    <Shell title={`Tanda tangan ${ba.nomor}`} subtitle="Pelaksana dan kedua saksi menandatangani saat pemusnahan" onClose={tutup} wide>
      <div className="space-y-3">
        {TTD_MUSNAH.map((k) => (
          <TtdKotak
            key={k}
            label={j.peran[k].label}
            orang={isian[k]}
            ttd={ttd[k]}
            buka={aktif === k}
            onBuka={() => setAktif(aktif === k ? null : k)}
            akunSaya={user?.nama ?? ""}
            simpan={async (body) => {
              await api.baTtd(ba.id, { peran: k, ...body });
              const t: BaTtd = { cara: body.cara, nama: body.cara === "AKUN" ? user?.nama ?? "" : body.nama ?? "", jabatan: body.jabatan ?? "", at: new Date().toISOString(), gambar: body.gambar };
              const next = { ...ttd, [k]: t };
              setTtd(next);
              setDiubah(true);
              setAktif(TTD_MUSNAH.find((x) => !next[x]) ?? null);
            }}
          />
        ))}
        <div className="flex justify-end">
          <button onClick={tutup} className={btnPrimary}>
            Selesai
          </button>
        </div>
      </div>
    </Shell>
  );
}

function TtdKotak({
  label,
  orang,
  ttd,
  buka,
  onBuka,
  akunSaya,
  simpan,
}: {
  label: string;
  orang: Orang | undefined;
  ttd: BaTtd | undefined;
  buka: boolean;
  onBuka: () => void;
  akunSaya: string;
  simpan: (b: { cara: "AKUN" | "LAYAR"; nama?: string; jabatan?: string; gambar?: string }) => Promise<void>;
}) {
  const [nama, setNama] = useState(orang?.nama ?? "");
  const [jabatan, setJabatan] = useState(orang?.jabatan ?? "");
  const [gambar, setGambar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kirim = async (cara: "AKUN" | "LAYAR") => {
    if (cara === "LAYAR" && !nama.trim()) return setError("Isi nama yang menandatangani");
    if (cara === "LAYAR" && !gambar) return setError("Tanda tangan dulu di kotak");
    setBusy(true);
    setError("");
    try {
      await simpan({ cara, nama: nama.trim(), jabatan: jabatan.trim(), gambar: gambar ?? undefined });
      setGambar(null);
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan tanda tangan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`rounded-md border ${ttd ? "border-[var(--accent-green-border)]" : "border-[var(--border)]"}`}>
      <button onClick={onBuka} className="w-full flex items-center gap-3 px-3 py-2 text-left">
        {ttd ? <Check size={16} className="text-[var(--accent-green)] shrink-0" /> : <CircleDashed size={16} className="text-[var(--text-muted)] shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-[var(--text-primary)]">{label}</span>
          <span className="block text-xs text-[var(--text-secondary)] truncate">
            {ttd ? `${ttd.nama}${ttd.jabatan ? ` · ${ttd.jabatan}` : ""} · ${ttd.cara === "AKUN" ? "dengan akun" : "di layar"} · ${waktuJam(ttd.at)}` : orang?.nama || "Belum ada nama"}
          </span>
        </span>
        {ttd?.gambar && <img src={ttd.gambar} alt="" className="h-9 max-w-[120px] object-contain" />}
        <span className="text-xs text-[var(--accent-blue)]">{buka ? "Tutup" : ttd ? "Ulangi" : "Tanda tangan"}</span>
      </button>
      {buka && (
        <div className="border-t border-[var(--border)] p-3 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama" className={inputCls} />
            <input value={jabatan} onChange={(e) => setJabatan(e.target.value)} placeholder="Jabatan" className={inputCls} />
          </div>
          <SignaturePad onChange={setGambar} />
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={() => kirim("AKUN")} disabled={busy} title={`Ditandatangani sebagai ${akunSaya} (akun yang sedang login)`} className={`${btnOutline} mr-auto`}>
              <UserCheck size={15} /> Dengan akun saya ({akunSaya})
            </button>
            <button onClick={() => kirim("LAYAR")} disabled={busy || !gambar} className={btnPrimary}>
              <PenLine size={15} /> {busy ? "Menyimpan..." : "Simpan tanda tangan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
