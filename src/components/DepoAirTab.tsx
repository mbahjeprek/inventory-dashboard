import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Droplets, FileText, Plus, Receipt, Trash2, TrendingUp, Users, Wallet, X } from "lucide-react";
import { api, errorText, type DepoLaporan } from "../lib/api";
import { StatCard } from "./StatCard";
import { ExportButtons } from "./ExportButtons";
import { Panel, Tip } from "./KoperasiDashboard";
import { EvidenceInput, EvidenceLink } from "./EvidenceInput";
import { ConfirmDialog } from "./ConfirmDialog";
import { printDocument } from "../lib/printTable";
import { isoDisplay, localToday } from "../lib/opname";
import { KOP_CSS, PERUSAHAAN, escHtml as esc, kopHtml } from "../lib/surat";

// Koperasi > Depo Air: the water depots at Nilam and Firus. Sales are the koperasi's Stock Out of the
// depot barang (each row carries its depo, from the buyer's estate unless moved); running costs are
// entered here; per month the galon, pendapatan per cara bayar, pelanggan per divisi, biaya and laba /
// rugi, with a 12-month trend and an official monthly report.

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const bulanLabel = (p: string) => `${BULAN[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const bulanPendek = (p: string) => `${BLN[Number(p.slice(5, 7)) - 1]} ${p.slice(2, 4)}`;
// "Oktober 2026" / "Januari - Oktober 2026" / "November 2025 - Oktober 2026".
const rentangLabel = (dari: string, sampai: string) =>
  dari === sampai ? bulanLabel(dari) : dari.slice(0, 4) === sampai.slice(0, 4) ? `${BULAN[Number(dari.slice(5, 7)) - 1]} - ${bulanLabel(sampai)}` : `${bulanLabel(dari)} - ${bulanLabel(sampai)}`;
const geser = (per: string, n: number) => {
  const d = new Date(Number(per.slice(0, 4)), Number(per.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
// Change against the period before: "▲ 12%" / "▼ 5%" / "sama".
const banding = (kini: number, lalu: number) => (!lalu ? (kini ? "baru" : "-") : kini === lalu ? "sama" : `${kini > lalu ? "▲" : "▼"} ${Math.abs(Math.round(((kini - lalu) / lalu) * 100))}%`);
type Rentang = "bulan" | "3" | "6" | "tahun" | "custom";
const RENTANG: { k: Rentang; label: string }[] = [
  { k: "bulan", label: "Bulan ini" },
  { k: "3", label: "3 bulan" },
  { k: "6", label: "6 bulan" },
  { k: "tahun", label: "Tahun ini" },
  { k: "custom", label: "Custom" },
];
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const rpShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)} rb` : String(Math.round(n)));
const angka = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
const BAYAR: Record<string, string> = { POTONG_GAJI: "Potong gaji", TUNAI: "Tunai", INSTANSI: "Instansi" };
const DEPO_LABEL: Record<string, string> = { NILAM: "Depo Nilam", FIRUS: "Depo Firus", "": "Gabungan (Nilam + Firus)" };
// Pendapatan blue, biaya amber (validated pair: ΔE 23 for colour-blind readers); the daily bars blue.
const C_PENDAPATAN = "#2a78d6";
const C_BIAYA = "#d97706";
const GRID = "#e8edf3";
const TICK = { fontSize: 11, fill: "#5b6b7c" };
const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";

// The printed report of the chosen period only: one month (with its weeks) or a range (with its months),
// each figure next to the period of the same length before.
export function laporanHtml(d: DepoLaporan, ttd: { operator: string; petugas: string; mengetahui: string }) {
  const satu = d.dari === d.sampai;
  const biaya = d.biaya.reduce((s, b) => s + b.jumlah, 0);
  const laba = d.ringkas.pendapatan - biaya;
  const labaLalu = d.sebelum.pendapatan - d.sebelum.biaya;
  const label = rentangLabel(d.dari, d.sampai);
  const labelLalu = rentangLabel(d.sebelum.dari, d.sebelum.sampai);
  // The current month isn't over: its figures run to today, against a full period before.
  const berjalan = d.sampai === localToday().slice(0, 7);
  const tabel = (head: string[], rows: (string | number)[][], kanan: number[] = []) =>
    `<table class="t"><thead><tr>${head.map((h, i) => `<th${kanan.includes(i) ? ' class="r"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td${kanan.includes(i) ? ' class="r"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="c">-</td></tr>`
    }</tbody></table>`;
  const perKat = Object.entries(d.kategori)
    .map(([k, l]) => [l, d.biaya.filter((b) => b.kategori === k).reduce((s, b) => s + b.jumlah, 0)] as const)
    .filter(([, v]) => v > 0);
  const rinci = satu
    ? tabel(["Minggu", "Tanggal", "Hari ada penjualan", "Galon"], d.perMinggu.map((w) => [`Minggu ${w.minggu}`, `${w.dari} - ${w.sampai}`, w.hari, angka(w.galon)]), [2, 3])
    : tabel(
        ["Bulan", "Galon", "Pelanggan", "Pendapatan", "Biaya", "Laba / Rugi"],
        d.perBulan.map((b) => [bulanLabel(b.periode), angka(b.galon), b.pelanggan, rp(b.pendapatan), rp(b.biaya), rp(b.pendapatan - b.biaya)]),
        [1, 2, 3, 4, 5]
      );
  return `<!doctype html><html><head><meta charset="utf-8"><title>Laporan Depo Air ${esc(label)}</title><style>
    @page { size: A4 portrait; margin: 14mm 15mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: "Times New Roman", Times, serif; color: #000; font-size: 10.5pt; line-height: 1.4; margin: 0; }
    ${KOP_CSS}
    h1 { text-align: center; font-size: 13pt; margin: 12px 0 0; text-decoration: underline; }
    .sub { text-align: center; margin: 0 0 10px; }
    h2 { font-size: 11pt; margin: 12px 0 4px; }
    table.t { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    table.t th, table.t td { border: 1px solid #000; padding: 2px 6px; vertical-align: top; }
    table.t th { background: #e8e8e8; }
    .r { text-align: right; } .c { text-align: center; }
    .ttds { display: flex; justify-content: space-between; margin-top: 22px; page-break-inside: avoid; }
    .ttd { width: 31%; text-align: center; }
    .ttd .ruang { height: 58px; }
    .ttd .nama { font-weight: bold; text-decoration: underline; }
  </style></head><body>
    ${kopHtml(PERUSAHAAN, `Koperasi Karyawan · ${DEPO_LABEL[d.depo]}`)}
    <h1>${satu ? "LAPORAN BULANAN DEPO AIR" : "LAPORAN DEPO AIR"}</h1>
    <div class="sub">${esc(DEPO_LABEL[d.depo])} · Periode ${esc(label)}${berjalan ? ` (bulan berjalan, data s/d ${esc(isoDisplay(localToday()))})` : ""}</div>
    <h2>1. Ringkasan</h2>
    ${tabel(
      ["Uraian", label, `Sebelumnya (${labelLalu})`, berjalan ? "Perubahan*" : "Perubahan"],
      [
        ["Galon terjual", angka(d.ringkas.galon), angka(d.sebelum.galon), banding(d.ringkas.galon, d.sebelum.galon)],
        ["Transaksi / pelanggan", `${d.ringkas.transaksi} / ${d.ringkas.pelanggan}`, `- / ${d.sebelum.pelanggan}`, banding(d.ringkas.pelanggan, d.sebelum.pelanggan)],
        ["Pendapatan", rp(d.ringkas.pendapatan), rp(d.sebelum.pendapatan), banding(d.ringkas.pendapatan, d.sebelum.pendapatan)],
        ["Biaya operasional", rp(biaya), rp(d.sebelum.biaya), banding(biaya, d.sebelum.biaya)],
        [laba >= 0 ? "Laba bersih" : "Rugi bersih", rp(laba), rp(labaLalu), banding(laba, labaLalu)],
      ],
      [1, 2, 3]
    )}
    ${berjalan ? `<p style="margin:3px 0 0;font-size:9pt">* ${esc(bulanLabel(d.sampai))} belum selesai: angkanya sampai ${esc(isoDisplay(localToday()))}, dibandingkan dengan periode sebelumnya yang penuh.</p>` : ""}
    <h2>2. Pendapatan per cara bayar</h2>
    ${tabel(["Cara bayar", "Galon", "Jumlah"], d.perBayar.map((b) => [BAYAR[b.bayar] ?? b.bayar, angka(b.galon), rp(b.total)]), [1, 2])}
    <h2>3. Penjualan per divisi</h2>
    ${tabel(["Divisi", "Pelanggan", "Galon", "Jumlah", "%"], d.perDivisi.map((x) => [x.divisi, x.orang, angka(x.galon), rp(x.total), d.ringkas.galon ? `${Math.round((x.galon / d.ringkas.galon) * 100)}%` : "-"]), [1, 2, 3, 4])}
    <h2>4. ${satu ? "Rekap per minggu" : "Rekap per bulan"}</h2>
    ${rinci}
    <h2>5. Biaya operasional</h2>
    ${tabel(["Tanggal", "Jenis", "Keterangan", "Jumlah"], d.biaya.map((b) => [isoDisplay(b.tanggal_iso), d.kategori[b.kategori] ?? b.kategori, `${d.depo ? "" : `[${b.depo}] `}${b.keterangan}`, rp(b.jumlah)]), [3])}
    ${perKat.length ? `<p style="margin:4px 0 0;font-size:9pt">Per jenis: ${perKat.map(([l, v]) => `${esc(l)} ${esc(rp(v))}`).join(" · ")}</p>` : ""}
    <div class="ttds">
      <div class="ttd"><div>Dibuat oleh,</div><div class="ruang"></div><div class="nama">${esc(ttd.operator || "(....................)")}</div><div>Operator Depo</div></div>
      <div class="ttd"><div>Diperiksa oleh,</div><div class="ruang"></div><div class="nama">${esc(ttd.petugas || "(....................)")}</div><div>Petugas Koperasi</div></div>
      <div class="ttd"><div>Mengetahui,</div><div class="ruang"></div><div class="nama">${esc(ttd.mengetahui || "(....................)")}</div><div>Estate Manager</div></div>
    </div>
  </body></html>`;
}

function BiayaModal({ depoAwal, kategori, onClose, onSaved }: { depoAwal: string; kategori: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [depo, setDepo] = useState(depoAwal || "NILAM");
  const [tanggal, setTanggal] = useState(localToday());
  const [kat, setKat] = useState("LISTRIK");
  const [jumlah, setJumlah] = useState("");
  const [ket, setKet] = useState("");
  const [ev, setEv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    const n = Number(jumlah.replace(/\./g, "").replace(",", "."));
    if (!(n > 0)) return setError("Isi jumlah biaya");
    setBusy(true);
    setError("");
    try {
      await api.depoBiaya({ depo, tanggal, kategori: kat, jumlah: n, keterangan: ket.trim(), evidence_id: ev });
      onSaved();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-md mt-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold text-[var(--text-primary)]">Biaya operasional depo</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]" title="Tutup">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Depo</label>
              <select value={depo} onChange={(e) => setDepo(e.target.value)} className={inputCls}>
                <option value="NILAM">Depo Nilam</option>
                <option value="FIRUS">Depo Firus</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Tanggal</label>
              <input type="date" value={tanggal} max={localToday()} onChange={(e) => e.target.value && setTanggal(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Jenis biaya</label>
              <select value={kat} onChange={(e) => setKat(e.target.value)} className={inputCls}>
                {Object.entries(kategori).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Jumlah (Rp)</label>
              <input value={jumlah} onChange={(e) => setJumlah(e.target.value)} inputMode="numeric" className={`${inputCls} text-right`} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Keterangan</label>
            <input value={ket} onChange={(e) => setKet(e.target.value)} placeholder="mis. ganti filter cartridge 2 buah" className={inputCls} />
          </div>
          <EvidenceInput value={ev} onChange={setEv} label="Foto nota (opsional)" />
          {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
              Batal
            </button>
            <button onClick={save} disabled={busy} className="px-4 py-2 text-sm rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50">
              {busy ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DepoAirTab({ periode, reload, canInput, canEdit }: { periode: string; reload: number; canInput: boolean; canEdit: boolean }) {
  const [depo, setDepo] = useState("NILAM");
  // The period: one month (the page's periode) by default, or a range of months.
  const [rentang, setRentang] = useState<Rentang>("bulan");
  const [custom, setCustom] = useState({ dari: geser(periode, -2), sampai: periode });
  const dari = rentang === "bulan" ? periode : rentang === "3" ? geser(periode, -2) : rentang === "6" ? geser(periode, -5) : rentang === "tahun" ? `${periode.slice(0, 4)}-01` : custom.dari;
  const sampai = rentang === "custom" ? custom.sampai : periode;
  const satuBulan = dari === sampai;
  const berjalan = sampai === localToday().slice(0, 7);
  const label = rentangLabel(dari, sampai);
  const [d, setD] = useState<DepoLaporan | null>(null);
  const [muat, setMuat] = useState(0);
  const [error, setError] = useState("");
  const [biayaBaru, setBiayaBaru] = useState(false);
  const [hapus, setHapus] = useState<DepoLaporan["biaya"][number] | null>(null);
  const [tx, setTx] = useState<Awaited<ReturnType<typeof api.depoTx>> | null>(null);
  const [lihatTx, setLihatTx] = useState(false);
  const [cetak, setCetak] = useState(false);
  const [ttd, setTtd] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("depo-air-ttd") ?? "") as { operator: string; petugas: string; mengetahui: string };
    } catch {
      return { operator: "", petugas: "", mengetahui: "" };
    }
  });
  useEffect(() => {
    setD(null);
    setError("");
    if (dari > sampai) return setError("Bulan awal setelah bulan akhir");
    api
      .depoLaporan(depo, dari, sampai)
      .then(setD)
      .catch((e) => setError(errorText(e, "Gagal memuat laporan depo")));
  }, [depo, dari, sampai, reload, muat]);
  useEffect(() => {
    if (!lihatTx) return;
    setTx(null);
    api
      .depoTx(depo, dari, sampai)
      .then(setTx)
      .catch(() => setTx([]));
  }, [lihatTx, depo, dari, sampai, reload, muat]);

  const biaya = d ? d.biaya.reduce((s, b) => s + b.jumlah, 0) : 0;
  const laba = d ? d.ringkas.pendapatan - biaya : 0;
  const buildReport = async () => ({
    title: `Laporan Depo Air - ${DEPO_LABEL[depo]}`,
    subtitle: [`Periode ${label}`, d ? `Dibandingkan ${rentangLabel(d.sebelum.dari, d.sebelum.sampai)}` : ""],
    sections: d
      ? [
          {
            heading: "Ringkasan",
            columns: [{ label: "Uraian" }, { label: "Periode ini", align: "right" as const }, { label: "Periode sebelumnya", align: "right" as const }, { label: "Perubahan", align: "right" as const }],
            rows: [
              ["Galon terjual", d.ringkas.galon, d.sebelum.galon, banding(d.ringkas.galon, d.sebelum.galon)],
              ["Pelanggan", d.ringkas.pelanggan, d.sebelum.pelanggan, banding(d.ringkas.pelanggan, d.sebelum.pelanggan)],
              ["Pendapatan (Rp)", d.ringkas.pendapatan, d.sebelum.pendapatan, banding(d.ringkas.pendapatan, d.sebelum.pendapatan)],
              ["Biaya operasional (Rp)", biaya, d.sebelum.biaya, banding(biaya, d.sebelum.biaya)],
              ["Laba / rugi (Rp)", laba, d.sebelum.pendapatan - d.sebelum.biaya, banding(laba, d.sebelum.pendapatan - d.sebelum.biaya)],
            ],
          },
          { heading: "Per divisi", columns: [{ label: "Divisi" }, { label: "Pelanggan", align: "right" as const }, { label: "Galon", align: "right" as const }, { label: "Jumlah (Rp)", align: "right" as const }], rows: d.perDivisi.map((x) => [x.divisi, x.orang, x.galon, x.total]) },
          { heading: "Biaya operasional", columns: [{ label: "Tanggal" }, { label: "Depo" }, { label: "Jenis" }, { label: "Keterangan" }, { label: "Jumlah (Rp)", align: "right" as const }], rows: d.biaya.map((b) => [isoDisplay(b.tanggal_iso), b.depo, d.kategori[b.kategori] ?? b.kategori, b.keterangan, b.jumlah]) },
          satuBulan
            ? { heading: "Rekap per minggu", columns: [{ label: "Minggu" }, { label: "Tanggal" }, { label: "Hari ada penjualan", align: "right" as const }, { label: "Galon", align: "right" as const }], rows: d.perMinggu.map((w) => [`Minggu ${w.minggu}`, `${w.dari}-${w.sampai}`, w.hari, w.galon]) }
            : { heading: "Rekap per bulan", columns: [{ label: "Bulan" }, { label: "Galon", align: "right" as const }, { label: "Pelanggan", align: "right" as const }, { label: "Pendapatan (Rp)", align: "right" as const }, { label: "Biaya (Rp)", align: "right" as const }, { label: "Laba / rugi (Rp)", align: "right" as const }], rows: d.perBulan.map((b) => [bulanLabel(b.periode), b.galon, b.pelanggan, b.pendapatan, b.biaya, b.pendapatan - b.biaya]) },
        ]
      : [],
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden bg-white">
          {["NILAM", "FIRUS", ""].map((k) => (
            <button key={k || "all"} onClick={() => setDepo(k)} className={`px-3.5 py-1.5 text-sm ${depo === k ? "bg-[var(--accent-blue)] text-white font-medium" : "text-[var(--text-secondary)] hover:bg-[#f1f5f9]"}`}>
              {k ? DEPO_LABEL[k] : "Gabungan"}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden bg-white">
          {RENTANG.map((r) => (
            <button key={r.k} onClick={() => setRentang(r.k)} className={`px-3 py-1.5 text-sm ${rentang === r.k ? "bg-[#eef4ff] text-[var(--accent-blue)] font-medium" : "text-[var(--text-secondary)] hover:bg-[#f1f5f9]"}`}>
              {r.label}
            </button>
          ))}
        </div>
        {rentang === "custom" && (
          <span className="inline-flex items-center gap-1 text-sm">
            <input type="month" value={custom.dari} max={custom.sampai} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, dari: e.target.value }))} className="rounded-md border border-[var(--border)] px-2 py-1 bg-white" aria-label="Dari bulan" />
            <span className="text-[var(--text-muted)]">s/d</span>
            <input type="month" value={custom.sampai} min={custom.dari} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, sampai: e.target.value }))} className="rounded-md border border-[var(--border)] px-2 py-1 bg-white" aria-label="Sampai bulan" />
          </span>
        )}
        <span className="text-xs text-[var(--text-muted)]">
          {label} · harga {d ? rp(d.harga) : "-"} / galon{rentang !== "custom" ? " · ikut periode gaji di atas" : ""}
        </span>
        {error && <span className="text-xs text-[var(--accent-red)]">{error}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => setCetak(true)} disabled={!d} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-[#f1f5f9] disabled:opacity-50">
            <FileText size={15} /> {satuBulan ? "Laporan bulanan" : "Laporan periode"}
          </button>
          <ExportButtons total={d ? 1 : 0} buildReport={buildReport} fileName={`depo-air-${(depo || "gabungan").toLowerCase()}-${satuBulan ? dari : `${dari}_${sampai}`}`} />
          {canInput && (
            <button onClick={() => setBiayaBaru(true)} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90">
              <Plus size={15} /> Biaya
            </button>
          )}
        </div>
      </div>

      {!d ? (
        <p className="text-sm text-[var(--text-muted)]">{error || "Memuat..."}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Galon terjual" value={angka(d.ringkas.galon)} icon={Droplets} tone="blue" footer={<span className="text-[11px] text-[var(--text-muted)]">{d.ringkas.transaksi} transaksi · {d.ringkas.pelanggan} pelanggan{d.sebelum ? ` · ${banding(d.ringkas.galon, d.sebelum.galon)} vs ${satuBulan ? "bulan lalu" : "periode sebelumnya"}${berjalan ? " (bulan ini belum selesai)" : ""}` : ""}</span>} />
            <StatCard
              label="Pendapatan"
              value={rp(d.ringkas.pendapatan)}
              icon={Wallet}
              tone="green"
              footer={
                <span className="text-[11px] text-[var(--text-muted)]">
                  {d.perBayar.map((b) => `${BAYAR[b.bayar] ?? b.bayar} ${rp(b.total)}`).join(" · ") || "-"}
                  {d.sebelum ? ` · ${banding(d.ringkas.pendapatan, d.sebelum.pendapatan)} vs ${satuBulan ? "bulan lalu" : "periode sebelumnya"}${berjalan ? " (bulan ini belum selesai)" : ""}` : ""}
                </span>
              }
            />
            <StatCard label="Biaya operasional" value={rp(biaya)} icon={Receipt} tone="amber" footer={<span className="text-[11px] text-[var(--text-muted)]">{d.biaya.length ? `${d.biaya.length} catatan biaya` : "belum ada biaya dicatat"}</span>} />
            <StatCard
              label={laba >= 0 ? "Laba" : "Rugi"}
              value={rp(Math.abs(laba))}
              icon={TrendingUp}
              tone={laba >= 0 ? "green" : "red"}
              footer={<span className="text-[11px] text-[var(--text-muted)]">{d.ringkas.pendapatan ? `${Math.round((laba / d.ringkas.pendapatan) * 100)}% dari pendapatan` : "-"}</span>}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title={satuBulan ? `Galon per hari - ${label}` : `Galon per bulan - ${label}`} note="Arahkan ke batang untuk jumlah pelanggan">
              <div className="h-60">
                {(satuBulan ? d.perHari.length : d.perBulan.some((b) => b.galon)) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={satuBulan ? d.perHari.map((h) => ({ x: h.tanggal, galon: h.galon, orang: h.orang })) : d.perBulan.map((b) => ({ x: b.periode, galon: b.galon, orang: b.pelanggan }))}
                      margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="x" tickFormatter={(t: string) => (satuBulan ? String(Number(t.slice(8))) : bulanPendek(t))} tick={TICK} axisLine={{ stroke: "#d5dde6" }} tickLine={false} minTickGap={2} />
                      <YAxis tick={TICK} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: "#f1f5f9" }}
                        content={({ active, payload }) => {
                          const r = active && (payload?.[0]?.payload as { x: string; galon: number; orang: number } | undefined);
                          return r ? (
                            <Tip
                              lines={[
                                <div key="t" className="font-medium text-[var(--text-primary)]">{satuBulan ? isoDisplay(r.x) : bulanLabel(r.x)}</div>,
                                <div key="g">
                                  <b>{angka(r.galon)}</b> galon
                                </div>,
                                <div key="o">{r.orang} pelanggan</div>,
                              ]}
                            />
                          ) : null;
                        }}
                      />
                      <Bar dataKey="galon" fill={C_PENDAPATAN} radius={[4, 4, 0, 0]} maxBarSize={satuBulan ? 24 : 36} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-[var(--text-muted)] pt-10 text-center">Belum ada penjualan di periode ini.</p>
                )}
              </div>
            </Panel>
            <Panel title="Pendapatan & biaya per bulan" note={`12 bulan sampai ${bulanLabel(sampai)} (gambaran tren, tidak ikut laporan) · arahkan untuk laba / rugi`}>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.tren12} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barGap={2}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="periode" tickFormatter={bulanPendek} tick={TICK} axisLine={{ stroke: "#d5dde6" }} tickLine={false} minTickGap={4} />
                    <YAxis tickFormatter={rpShort} tick={TICK} axisLine={false} tickLine={false} width={44} />
                    <Tooltip
                      cursor={{ fill: "#f1f5f9" }}
                      content={({ active, payload }) => {
                        const r = active && (payload?.[0]?.payload as DepoLaporan["tren12"][number] | undefined);
                        return r ? (
                          <Tip
                            lines={[
                              <div key="b" className="font-medium text-[var(--text-primary)]">{bulanLabel(r.periode)}</div>,
                              <div key="g">{angka(r.galon)} galon</div>,
                              <div key="p">
                                Pendapatan <b>{rp(r.pendapatan)}</b>
                              </div>,
                              <div key="c">
                                Biaya <b>{rp(r.biaya)}</b>
                              </div>,
                              <div key="l">
                                {r.pendapatan - r.biaya >= 0 ? "Laba" : "Rugi"} <b>{rp(Math.abs(r.pendapatan - r.biaya))}</b>
                              </div>,
                            ]}
                          />
                        ) : null;
                      }}
                    />
                    <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: "#5b6b7c" }} />
                    <Bar dataKey="pendapatan" name="Pendapatan" fill={C_PENDAPATAN} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                    <Bar dataKey="biaya" name="Biaya" fill={C_BIAYA} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title="Penjualan per divisi" note={label}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-secondary)] border-b border-[var(--border)]">
                    <th className="py-1.5">Divisi</th>
                    <th className="py-1.5 text-right">Pelanggan</th>
                    <th className="py-1.5 text-right">Galon</th>
                    <th className="py-1.5 text-right">Jumlah</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {d.perDivisi.map((x) => (
                    <tr key={x.divisi}>
                      <td className="py-1.5">{x.divisi}</td>
                      <td className="py-1.5 text-right">{x.orang}</td>
                      <td className="py-1.5 text-right font-medium">
                        {angka(x.galon)} <span className="text-[11px] text-[var(--text-muted)]">{d.ringkas.galon ? `${Math.round((x.galon / d.ringkas.galon) * 100)}%` : ""}</span>
                      </td>
                      <td className="py-1.5 text-right">{rp(x.total)}</td>
                    </tr>
                  ))}
                  {!d.perDivisi.length && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-[var(--text-muted)]">
                        -
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>
            <Panel title="10 pelanggan terbanyak" note={label}>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[var(--border)]">
                  {d.top.map((t, i) => (
                    <tr key={t.kode}>
                      <td className="py-1.5 w-6 text-[var(--text-muted)]">{i + 1}</td>
                      <td className="py-1.5">
                        <div className="text-[var(--text-primary)]">{t.nama || t.kode}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {t.kode}
                          {t.divisi ? ` · ${t.divisi}` : ""}
                        </div>
                      </td>
                      <td className="py-1.5 text-right font-medium">{angka(t.galon)} galon</td>
                      <td className="py-1.5 text-right text-[var(--text-secondary)]">{rp(t.total)}</td>
                    </tr>
                  ))}
                  {!d.top.length && (
                    <tr>
                      <td className="py-4 text-center text-[var(--text-muted)]">-</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>
          </div>

          <Panel title="Biaya operasional" note={`${label} · listrik, filter / media, galon & tutup, operator, perawatan, uji air`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-secondary)] border-b border-[var(--border)]">
                  <th className="py-1.5">Tanggal</th>
                  {!depo && <th className="py-1.5">Depo</th>}
                  <th className="py-1.5">Jenis</th>
                  <th className="py-1.5">Keterangan</th>
                  <th className="py-1.5 text-right">Jumlah</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {d.biaya.map((b) => (
                  <tr key={b.id}>
                    <td className="py-1.5 whitespace-nowrap">{isoDisplay(b.tanggal_iso)}</td>
                    {!depo && <td className="py-1.5">{b.depo === "FIRUS" ? "Firus" : "Nilam"}</td>}
                    <td className="py-1.5">{d.kategori[b.kategori] ?? b.kategori}</td>
                    <td className="py-1.5 text-xs text-[var(--text-secondary)]">
                      {b.keterangan || "-"} <EvidenceLink id={b.evidence_id} label="nota" />
                      <div className="text-[var(--text-muted)]">oleh {b.oleh || "-"}</div>
                    </td>
                    <td className="py-1.5 text-right font-medium whitespace-nowrap">{rp(b.jumlah)}</td>
                    <td className="py-1.5 text-right">
                      {canEdit && (
                        <button onClick={() => setHapus(b)} title="Hapus" className="p-1 rounded text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!d.biaya.length && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-[var(--text-muted)]">
                      Belum ada biaya di periode ini.{canInput ? " Klik + Biaya untuk mencatat." : ""}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Panel>

          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
            <button onClick={() => setLihatTx((v) => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
              <Users size={15} /> Transaksi {DEPO_LABEL[depo]} - {label} ({d.ringkas.transaksi})
              <span className="ml-auto text-xs font-normal text-[var(--accent-blue)]">{lihatTx ? "Sembunyikan" : "Lihat"}</span>
            </button>
            {lihatTx && (
              <div className="table-scroll border-t border-[var(--border)]">
                <table className="data-table text-sm">
                  <thead>
                    <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
                      <th className="px-3 py-2">Tanggal</th>
                      <th className="px-3 py-2">Pelanggan</th>
                      <th className="px-3 py-2 text-right">Galon</th>
                      <th className="px-3 py-2 text-right">Jumlah</th>
                      <th className="px-3 py-2">Bayar</th>
                      <th className="px-3 py-2">Depo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {tx === null ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">
                          Memuat...
                        </td>
                      </tr>
                    ) : (
                      tx.map((t) => (
                        <tr key={t.id}>
                          <td className="px-3 py-1.5 whitespace-nowrap">{isoDisplay(t.tanggal_iso)}</td>
                          <td className="col-grow px-3 py-1.5">
                            <div>{t.nama || t.anggota_kode}</div>
                            <div className="text-[11px] text-[var(--text-muted)]">
                              {t.anggota_kode}
                              {t.divisi ? ` · ${t.divisi}` : ""}
                              {t.estate ? ` · ${t.estate}` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-right">{angka(t.qty)}</td>
                          <td className="px-3 py-1.5 text-right">{rp(t.total)}</td>
                          <td className="px-3 py-1.5 text-xs">{BAYAR[t.bayar] ?? t.bayar}</td>
                          <td className="px-3 py-1.5">
                            {canEdit ? (
                              <select
                                value={t.depo}
                                onChange={(e) =>
                                  api
                                    .depoPindah(t.id, e.target.value)
                                    .then(() => setMuat((n) => n + 1))
                                    .catch((er) => setError(errorText(er, "Gagal memindah depo")))
                                }
                                className="text-xs rounded border border-[var(--border)] px-1.5 py-1 bg-white"
                                title="Depo yang melayani"
                              >
                                <option value="NILAM">Nilam</option>
                                <option value="FIRUS">Firus</option>
                              </select>
                            ) : (
                              <span className="text-xs">{t.depo === "FIRUS" ? "Firus" : "Nilam"}</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {biayaBaru && d && <BiayaModal depoAwal={depo} kategori={d.kategori} onClose={() => setBiayaBaru(false)} onSaved={() => (setBiayaBaru(false), setMuat((n) => n + 1))} />}
      {hapus && (
        <ConfirmDialog
          message={`Hapus biaya ${d?.kategori[hapus.kategori] ?? hapus.kategori} ${rp(hapus.jumlah)} (${isoDisplay(hapus.tanggal_iso)})?`}
          onConfirm={() =>
            api
              .depoHapusBiaya(hapus.id)
              .then(() => (setHapus(null), setMuat((n) => n + 1)))
              .catch((e) => (setHapus(null), setError(errorText(e, "Gagal menghapus"))))
          }
          onCancel={() => setHapus(null)}
        />
      )}
      {cetak && d && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6" onClick={() => setCetak(false)}>
          <div className="bg-[var(--bg-card)] rounded-lg shadow-xl w-full max-w-md mt-10 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--text-primary)]">
              {satuBulan ? "Laporan bulanan" : "Laporan periode"} {DEPO_LABEL[depo]}
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              {label} · dibandingkan {d ? rentangLabel(d.sebelum.dari, d.sebelum.sampai) : "-"} · nama penanda tangan diingat di browser ini
            </p>
            {(
              [
                ["operator", "Operator depo (dibuat oleh)"],
                ["petugas", "Petugas koperasi (diperiksa oleh)"],
                ["mengetahui", "Estate Manager (mengetahui)"],
              ] as const
            ).map(([k, l]) => (
              <div key={k}>
                <label className={labelCls}>{l}</label>
                <input value={ttd[k]} onChange={(e) => setTtd((x) => ({ ...x, [k]: e.target.value }))} className={inputCls} />
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button onClick={() => setCetak(false)} className="px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
                Batal
              </button>
              <button
                onClick={() => {
                  try {
                    localStorage.setItem("depo-air-ttd", JSON.stringify(ttd));
                  } catch {
                    /* no storage */
                  }
                  printDocument(laporanHtml(d, ttd));
                  setCetak(false);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-[var(--accent-blue)] text-white"
              >
                <FileText size={15} /> Cetak
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
