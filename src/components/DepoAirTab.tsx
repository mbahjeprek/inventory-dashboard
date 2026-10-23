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

export function laporanHtml(d: DepoLaporan, ttd: { operator: string; petugas: string; mengetahui: string }) {
  const biaya = d.biaya.reduce((s, b) => s + b.jumlah, 0);
  const laba = d.ringkas.pendapatan - biaya;
  const tabel = (head: string[], rows: (string | number)[][], kanan: number[] = []) =>
    `<table class="t"><thead><tr>${head.map((h, i) => `<th${kanan.includes(i) ? ' class="r"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td${kanan.includes(i) ? ' class="r"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="c">-</td></tr>`
    }</tbody></table>`;
  const perKat = Object.entries(d.kategori)
    .map(([k, label]) => [label, d.biaya.filter((b) => b.kategori === k).reduce((s, b) => s + b.jumlah, 0)] as const)
    .filter(([, v]) => v > 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Laporan Depo Air ${esc(bulanLabel(d.periode))}</title><style>
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
    table.ring td { padding: 2px 10px 2px 0; }
    .ttds { display: flex; justify-content: space-between; margin-top: 22px; page-break-inside: avoid; }
    .ttd { width: 31%; text-align: center; }
    .ttd .ruang { height: 58px; }
    .ttd .nama { font-weight: bold; text-decoration: underline; }
  </style></head><body>
    ${kopHtml(PERUSAHAAN, `Koperasi Karyawan · ${DEPO_LABEL[d.depo]}`)}
    <h1>LAPORAN BULANAN DEPO AIR</h1>
    <div class="sub">${esc(DEPO_LABEL[d.depo])} · Periode ${esc(bulanLabel(d.periode))}</div>
    <h2>1. Ringkasan</h2>
    <table class="ring">
      <tr><td>Galon terjual</td><td>:</td><td><b>${angka(d.ringkas.galon)}</b> galon (${d.ringkas.transaksi} transaksi, ${d.ringkas.pelanggan} pelanggan)</td></tr>
      <tr><td>Pendapatan</td><td>:</td><td><b>${esc(rp(d.ringkas.pendapatan))}</b></td></tr>
      <tr><td>Biaya operasional</td><td>:</td><td><b>${esc(rp(biaya))}</b></td></tr>
      <tr><td>${laba >= 0 ? "Laba" : "Rugi"} bersih</td><td>:</td><td><b>${esc(rp(Math.abs(laba)))}</b>${d.ringkas.pendapatan ? ` (${Math.round((laba / d.ringkas.pendapatan) * 100)}% dari pendapatan)` : ""}</td></tr>
    </table>
    <h2>2. Pendapatan per cara bayar</h2>
    ${tabel(["Cara bayar", "Galon", "Jumlah"], d.perBayar.map((b) => [BAYAR[b.bayar] ?? b.bayar, angka(b.galon), rp(b.total)]), [1, 2])}
    <h2>3. Penjualan per divisi</h2>
    ${tabel(["Divisi", "Pelanggan", "Galon", "Jumlah", "%"], d.perDivisi.map((x) => [x.divisi, x.orang, angka(x.galon), rp(x.total), d.ringkas.galon ? `${Math.round((x.galon / d.ringkas.galon) * 100)}%` : "-"]), [1, 2, 3, 4])}
    <h2>4. Biaya operasional</h2>
    ${tabel(["Tanggal", "Jenis", "Keterangan", "Jumlah"], d.biaya.map((b) => [isoDisplay(b.tanggal_iso), d.kategori[b.kategori] ?? b.kategori, `${d.depo ? "" : `[${b.depo}] `}${b.keterangan}`, rp(b.jumlah)]), [3])}
    ${perKat.length ? `<p style="margin:4px 0 0;font-size:9pt">Per jenis: ${perKat.map(([l, v]) => `${esc(l)} ${esc(rp(v))}`).join(" · ")}</p>` : ""}
    <h2>5. Tren 12 bulan</h2>
    ${tabel(["Bulan", "Galon", "Pendapatan", "Biaya", "Laba / Rugi"], d.perBulan.map((b) => [bulanLabel(b.periode), angka(b.galon), rp(b.pendapatan), rp(b.biaya), rp(b.pendapatan - b.biaya)]), [1, 2, 3, 4])}
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
    api
      .depoLaporan(depo, periode)
      .then(setD)
      .catch((e) => setError(errorText(e, "Gagal memuat laporan depo")));
  }, [depo, periode, reload, muat]);
  useEffect(() => {
    if (!lihatTx) return;
    setTx(null);
    api
      .depoTx(depo, periode)
      .then(setTx)
      .catch(() => setTx([]));
  }, [lihatTx, depo, periode, reload, muat]);

  const biaya = d ? d.biaya.reduce((s, b) => s + b.jumlah, 0) : 0;
  const laba = d ? d.ringkas.pendapatan - biaya : 0;
  const buildReport = async () => ({
    title: `Laporan Depo Air - ${DEPO_LABEL[depo]}`,
    subtitle: [`Periode ${bulanLabel(periode)}`],
    sections: d
      ? [
          { heading: "Ringkasan", columns: [{ label: "Uraian" }, { label: "Nilai", align: "right" as const }], rows: [["Galon terjual", d.ringkas.galon], ["Pelanggan", d.ringkas.pelanggan], ["Pendapatan (Rp)", d.ringkas.pendapatan], ["Biaya operasional (Rp)", biaya], ["Laba / rugi (Rp)", laba]] },
          { heading: "Per divisi", columns: [{ label: "Divisi" }, { label: "Pelanggan", align: "right" as const }, { label: "Galon", align: "right" as const }, { label: "Jumlah (Rp)", align: "right" as const }], rows: d.perDivisi.map((x) => [x.divisi, x.orang, x.galon, x.total]) },
          { heading: "Biaya operasional", columns: [{ label: "Tanggal" }, { label: "Depo" }, { label: "Jenis" }, { label: "Keterangan" }, { label: "Jumlah (Rp)", align: "right" as const }], rows: d.biaya.map((b) => [isoDisplay(b.tanggal_iso), b.depo, d.kategori[b.kategori] ?? b.kategori, b.keterangan, b.jumlah]) },
          { heading: "Tren 12 bulan", columns: [{ label: "Bulan" }, { label: "Galon", align: "right" as const }, { label: "Pendapatan (Rp)", align: "right" as const }, { label: "Biaya (Rp)", align: "right" as const }, { label: "Laba / rugi (Rp)", align: "right" as const }], rows: d.perBulan.map((b) => [bulanLabel(b.periode), b.galon, b.pendapatan, b.biaya, b.pendapatan - b.biaya]) },
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
        <span className="text-xs text-[var(--text-muted)]">Periode {bulanLabel(periode)} · harga {d ? rp(d.harga) : "-"} / galon</span>
        {error && <span className="text-xs text-[var(--accent-red)]">{error}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => setCetak(true)} disabled={!d} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-[#f1f5f9] disabled:opacity-50">
            <FileText size={15} /> Laporan bulanan
          </button>
          <ExportButtons total={d ? 1 : 0} buildReport={buildReport} fileName={`depo-air-${(depo || "gabungan").toLowerCase()}-${periode}`} />
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
            <StatCard label="Galon terjual" value={angka(d.ringkas.galon)} icon={Droplets} tone="blue" footer={<span className="text-[11px] text-[var(--text-muted)]">{d.ringkas.transaksi} transaksi · {d.ringkas.pelanggan} pelanggan</span>} />
            <StatCard
              label="Pendapatan"
              value={rp(d.ringkas.pendapatan)}
              icon={Wallet}
              tone="green"
              footer={<span className="text-[11px] text-[var(--text-muted)]">{d.perBayar.map((b) => `${BAYAR[b.bayar] ?? b.bayar} ${rp(b.total)}`).join(" · ") || "-"}</span>}
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
            <Panel title={`Galon per hari - ${bulanLabel(periode)}`} note="Arahkan ke batang untuk jumlah pelanggan">
              <div className="h-60">
                {d.perHari.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.perHari} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="tanggal" tickFormatter={(t: string) => String(Number(t.slice(8)))} tick={TICK} axisLine={{ stroke: "#d5dde6" }} tickLine={false} />
                      <YAxis tick={TICK} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: "#f1f5f9" }}
                        content={({ active, payload }) => {
                          const r = active && (payload?.[0]?.payload as DepoLaporan["perHari"][number] | undefined);
                          return r ? (
                            <Tip
                              lines={[
                                <div key="t" className="font-medium text-[var(--text-primary)]">{isoDisplay(r.tanggal)}</div>,
                                <div key="g">
                                  <b>{angka(r.galon)}</b> galon
                                </div>,
                                <div key="o">{r.orang} pelanggan</div>,
                              ]}
                            />
                          ) : null;
                        }}
                      />
                      <Bar dataKey="galon" fill={C_PENDAPATAN} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-[var(--text-muted)] pt-10 text-center">Belum ada penjualan di bulan ini.</p>
                )}
              </div>
            </Panel>
            <Panel title="Pendapatan & biaya per bulan" note="12 bulan sampai periode ini · arahkan untuk laba / rugi">
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.perBulan} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barGap={2}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="periode" tickFormatter={bulanPendek} tick={TICK} axisLine={{ stroke: "#d5dde6" }} tickLine={false} minTickGap={4} />
                    <YAxis tickFormatter={rpShort} tick={TICK} axisLine={false} tickLine={false} width={44} />
                    <Tooltip
                      cursor={{ fill: "#f1f5f9" }}
                      content={({ active, payload }) => {
                        const r = active && (payload?.[0]?.payload as DepoLaporan["perBulan"][number] | undefined);
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
            <Panel title="Penjualan per divisi" note={bulanLabel(periode)}>
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
            <Panel title="10 pelanggan terbanyak" note={bulanLabel(periode)}>
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

          <Panel title="Biaya operasional" note={`${bulanLabel(periode)} · listrik, filter / media, galon & tutup, operator, perawatan, uji air`}>
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
                      Belum ada biaya di bulan ini.{canInput ? " Klik + Biaya untuk mencatat." : ""}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Panel>

          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
            <button onClick={() => setLihatTx((v) => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
              <Users size={15} /> Transaksi {DEPO_LABEL[depo]} - {bulanLabel(periode)} ({d.ringkas.transaksi})
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
            <h3 className="font-semibold text-[var(--text-primary)]">Laporan bulanan {DEPO_LABEL[depo]}</h3>
            <p className="text-xs text-[var(--text-muted)]">{bulanLabel(periode)} · nama penanda tangan diingat di browser ini</p>
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
