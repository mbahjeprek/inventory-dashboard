import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Search, X } from "lucide-react";
import { api, errorText, type PakaiModule, type PakaiPer } from "../lib/api";
import { ExportButtons } from "./ExportButtons";
import type { SectionReport, TableReport } from "../lib/printTable";

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const BULAN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
const bulanLabel = (ym: string) => `${BULAN[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`;
const bulanLabelPanjang = (ym: string) => `${BULAN_PANJANG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
const tgl = (iso: string) => iso.split("-").reverse().join("/");
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Data = Awaited<ReturnType<typeof api.pemakaian>>;
type Detail = Awaited<ReturnType<typeof api.pemakaianDetail>>["data"];
type ItemRow = { kode: string; nama: string; satuan: string; info: string; per: Map<string, number>; total: number; trx: number; avg: number; stok: number | null };

// What each module calls its things, and the detail list's columns (null = not shown).
const CFG: Record<PakaiModule, { judul: string; item: string; ref: string; tujuan: string | null; penerima: string | null }> = {
  GUDANG: { judul: "Pemakaian Barang", item: "Barang", ref: "No. Dokumen", tujuan: "Tujuan / Divisi", penerima: "Penerima" },
  BBM: { judul: "Pemakaian BBM", item: "Jenis BBM", ref: "No. SPB", tujuan: "Kendaraan · Estate", penerima: "HM" },
  PUPUK: { judul: "Pemakaian Pupuk", item: "Jenis Pupuk", ref: "No. Embrace", tujuan: "Divisi · Blok", penerima: null },
  OLI: { judul: "Pemakaian Oli", item: "Jenis Oli", ref: "No. BPB", tujuan: null, penerima: null },
};

// Every month from `from` to `to` (to capped at today), as YYYY-MM.
function monthsBetween(from: string, to: string) {
  const end = (to > localIso(new Date()) ? localIso(new Date()) : to).slice(0, 7);
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  while (`${y}-${String(m).padStart(2, "0")}` <= end && out.length < 120) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// Harian / Mingguan / Bulanan: a period's key is the day (YYYY-MM-DD), the week's Monday (YYYY-MM-DD) or the month (YYYY-MM).
const PER: Record<PakaiPer, { label: string; kata: string; singkat: string; hari: number }> = {
  hari: { label: "Hari", kata: "hari", singkat: "hr", hari: 1 },
  minggu: { label: "Minggu", kata: "minggu", singkat: "mgg", hari: 7 },
  bulan: { label: "Bulan", kata: "bulan", singkat: "bln", hari: 30.4 },
};
const HARI_SINGKAT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localIso(d);
};
const senin = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00`).getDay() + 6) % 7));
const dm = (iso: string) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
const periodeKey = (per: PakaiPer, iso: string) => (per === "bulan" ? iso.slice(0, 7) : per === "minggu" ? senin(iso) : iso);
const periodeLabel = (per: PakaiPer, k: string) =>
  per === "bulan" ? bulanLabel(k) : per === "minggu" ? `${dm(k)}-${dm(addDays(k, 6))}` : `${HARI_SINGKAT[new Date(`${k}T00:00:00`).getDay()]} ${dm(k)}`;
const periodeLabelPanjang = (per: PakaiPer, k: string) =>
  per === "bulan" ? bulanLabelPanjang(k) : per === "minggu" ? `minggu ${tgl(k)} - ${tgl(addDays(k, 6))}` : tgl(k);
// Every period from `from` to `to` (to capped at today).
function periodsBetween(per: PakaiPer, from: string, to: string) {
  const today = localIso(new Date());
  const end = to > today ? today : to;
  if (per === "bulan") return monthsBetween(from, end);
  const out: string[] = [];
  for (let k = periodeKey(per, from); k <= end && out.length < 400; k = addDays(k, PER[per].hari)) out.push(k);
  return out;
}

type Preset = "6" | "12" | "tahun" | "tahun-lalu" | "semua" | "custom" | "d7" | "d14" | "d30" | "bulan-ini" | "bulan-lalu" | "w8" | "w13" | "w26";
const PRESETS: Record<PakaiPer, { value: Preset; label: string }[]> = {
  hari: [
    { value: "d7", label: "7 hari terakhir" },
    { value: "d14", label: "14 hari terakhir" },
    { value: "d30", label: "30 hari terakhir" },
    { value: "bulan-ini", label: "Bulan ini" },
    { value: "bulan-lalu", label: "Bulan lalu" },
    { value: "custom", label: "Pilih tanggal..." },
  ],
  minggu: [
    { value: "w8", label: "8 minggu terakhir" },
    { value: "w13", label: "13 minggu terakhir" },
    { value: "w26", label: "26 minggu terakhir" },
    { value: "tahun", label: "Tahun ini" },
    { value: "custom", label: "Pilih tanggal..." },
  ],
  bulan: [
    { value: "6", label: "6 bulan terakhir" },
    { value: "12", label: "12 bulan terakhir" },
    { value: "tahun", label: "Tahun ini" },
    { value: "tahun-lalu", label: "Tahun lalu" },
    { value: "semua", label: "Semua data" },
    { value: "custom", label: "Pilih bulan..." },
  ],
};
const PRESET_AWAL: Record<PakaiPer, Preset> = { hari: "d30", minggu: "w13", bulan: "12" };
function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const today = localIso(now);
  if (p === "6" || p === "12") return { from: localIso(new Date(y, now.getMonth() - (Number(p) - 1), 1)), to: today };
  if (p === "tahun") return { from: `${y}-01-01`, to: today };
  if (p === "tahun-lalu") return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  if (p === "d7" || p === "d14" || p === "d30") return { from: addDays(today, -(Number(p.slice(1)) - 1)), to: today };
  if (p === "w8" || p === "w13" || p === "w26") return { from: addDays(senin(today), -7 * (Number(p.slice(1)) - 1)), to: today };
  if (p === "bulan-ini") return { from: localIso(new Date(y, now.getMonth(), 1)), to: today };
  if (p === "bulan-lalu") return { from: localIso(new Date(y, now.getMonth() - 1, 1)), to: localIso(new Date(y, now.getMonth(), 0)) };
  return { from: "", to: "" };
}
const lastDay = (ym: string) => localIso(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0));
// The stacked chart of all items: the biggest few, the rest as Lainnya.
const WARNA = ["#2a78d6", "#e8833a", "#2f9e6e", "#8b5cf6", "#d6455d"];
const WARNA_LAIN = "#94a3b8";

// "Pemakaian / Bulan" button for an inventory page: opens the estate's pemakaian per month in a large dialog.
export function PemakaianButton({ module, estate }: { module: PakaiModule; estate: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Pemakaian per hari / minggu / bulan, rata-rata dan trennya"
        className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[#f1f5f9]"
      >
        <BarChart3 size={16} /> Analisa Pemakaian
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6" onClick={() => setOpen(false)}>
          <div className="w-full max-w-7xl max-h-full overflow-y-auto rounded-lg bg-[var(--bg-page)] shadow-2xl p-4 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <PemakaianPanel module={module} estate={estate} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

// Pemakaian per bulan of one estate's Gudang / BBM / Pupuk / Oli: each barang / jenis per month, the
// total, the monthly average and how long the stock now lasts at that rate. One picked: its bars per
// month; a month's figure lists its Stok Keluar rows.
export function PemakaianPanel({ module, estate, onClose }: { module: PakaiModule; estate: string; onClose?: () => void }) {
  const cfg = CFG[module];
  const [per, setPerState] = useState<PakaiPer>("bulan");
  const [preset, setPreset] = useState<Preset>("12");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [group, setGroup] = useState<"" | "alat">("");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [pickText, setPickText] = useState("");
  const [search, setSearch] = useState("");
  // The month whose rows are listed (YYYY-MM, "" = the whole period, null = none).
  const [bulan, setBulan] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  // Another Per: its own default range (a custom one is typed again: months vs days).
  const setPer = (v: PakaiPer) => {
    setPerState(v);
    setPreset(PRESET_AWAL[v]);
    setCustom({ from: "", to: "" });
  };
  const P = PER[per];
  const range =
    preset !== "custom"
      ? presetRange(preset)
      : per === "bulan"
        ? { from: custom.from ? `${custom.from}-01` : "", to: custom.to ? lastDay(custom.to) : "" }
        : { from: custom.from, to: custom.to };
  const dateFrom = range.from;
  const dateTo = range.to;
  const alat = module === "BBM" && group === "alat";
  const itemLabel = alat ? "Alat / Kendaraan" : cfg.item;
  const periodText = dateFrom || dateTo ? `${dateFrom ? tgl(dateFrom) : "awal"} - ${dateTo ? tgl(dateTo) : "sekarang"}` : "semua data";

  useEffect(() => {
    let stale = false;
    setData(null);
    setError("");
    api
      .pemakaian({ module, estate, dateFrom, dateTo, group, per })
      .then((d) => !stale && setData(d))
      .catch((e) => !stale && setError(errorText(e, "Gagal memuat pemakaian")));
    return () => {
      stale = true;
    };
  }, [module, estate, dateFrom, dateTo, group, per]);
  // Another period / grouping: the list closes (its period may not be in it).
  useEffect(() => setBulan(null), [dateFrom, dateTo, group, per]);
  useEffect(() => setPickText(""), [group]);

  // Periods shown (named months for history): the range's, from the first day the estate has any pemakaian.
  const months = useMemo(() => {
    if (!data) return [];
    const start = data.awal ?? (data.mulai ? `${data.mulai}-01` : localIso(new Date()));
    return periodsBetween(per, dateFrom && dateFrom > start ? dateFrom : start, dateTo || localIso(new Date()));
  }, [data, dateFrom, dateTo, per]);
  const lbl = (k: string) => periodeLabel(per, k);

  const list = useMemo<ItemRow[]>(() => {
    if (!data) return [];
    const stok = new Map(data.stok.map((s) => [s.kode, Number(s.stok)]));
    const by = new Map<string, ItemRow>();
    for (const r of data.rows) {
      const o = by.get(r.kode) ?? { kode: r.kode, nama: r.nama, satuan: r.satuan, info: r.info, per: new Map(), total: 0, trx: 0, avg: 0, stok: alat ? null : stok.get(r.kode) ?? null };
      o.per.set(r.bulan, (o.per.get(r.bulan) ?? 0) + Number(r.qty));
      o.total += Number(r.qty);
      o.trx += r.trx;
      by.set(r.kode, o);
    }
    const n = Math.max(months.length, 1);
    return [...by.values()].map((o) => ({ ...o, avg: o.total / n })).sort((a, b) => b.total - a.total || a.nama.localeCompare(b.nama));
  }, [data, months, alat]);

  const pickLabel = (o: { nama: string; info: string; kode: string }) => (o.info && o.info !== o.nama ? `${o.nama} · ${o.info}` : o.nama);
  const one = list.find((o) => pickLabel(o) === pickText || o.nama.toLowerCase() === pickText.trim().toLowerCase()) ?? null;
  // The search box is hidden while one is picked, so it doesn't narrow the table then.
  const shown = !one && search.trim() ? list.filter((o) => `${o.nama} ${o.kode} ${o.info}`.toLowerCase().includes(search.trim().toLowerCase())) : list;
  // How many periods (of Per) the stock now lasts at the average rate; its colour goes by months (< 1 red, < 2 amber).
  const cukup = (o: ItemRow) => (o.stok === null ? null : o.avg > 0 ? Math.max(o.stok, 0) / o.avg : null);
  const cukupBulan = (c: number) => (c * P.hari) / 30.4;
  const showStok = !alat;

  useEffect(() => {
    if (!one || bulan === null) return;
    let stale = false;
    setDetail(null);
    api
      .pemakaianDetail({ module, estate, dateFrom, dateTo, group, per, kode: one.kode, bulan })
      .then((d) => !stale && setDetail(d.data))
      .catch(() => !stale && setDetail([]));
    return () => {
      stale = true;
    };
  }, [module, estate, dateFrom, dateTo, group, per, one?.kode, bulan]);

  const showDetail = (o: ItemRow, m: string) => {
    setPickText(pickLabel(o));
    setBulan(m);
    setTimeout(() => document.getElementById("pemakaian-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 300);
  };

  const chart = one ? months.map((m) => ({ bulan: lbl(m), qty: one.per.get(m) ?? 0 })) : [];
  const openMonth = months.at(-1) === periodeKey(per, localIso(new Date()));
  const fileBase = `pemakaian-${module.toLowerCase()}${alat ? "-alat" : ""}-${per}-${estate.toLowerCase()}`;

  // Nothing picked: all of them per period, stacked (the biggest few, the rest as Lainnya) - only when they share one
  // satuan, else a sum means nothing. With the total, average, the busiest period and the change from the period before.
  const satuanSama = list.length > 0 && new Set(list.map((o) => o.satuan)).size === 1;
  const stack = !one && satuanSama ? list.slice(0, WARNA.length) : [];
  const sisa = !one && satuanSama ? list.slice(WARNA.length) : [];
  const chartAll = stack.length
    ? months.map((m) => {
        const row: Record<string, number | string> = { bulan: lbl(m) };
        stack.forEach((o, i) => (row[`s${i}`] = o.per.get(m) ?? 0));
        if (sisa.length) row.lain = sisa.reduce((t, o) => t + (o.per.get(m) ?? 0), 0);
        row.total = list.reduce((t, o) => t + (o.per.get(m) ?? 0), 0);
        return row;
      })
    : [];
  const totals = months.map((m) => list.reduce((t, o) => t + (o.per.get(m) ?? 0), 0));
  const grand = totals.reduce((a, b) => a + b, 0);
  const puncak = totals.length ? totals.indexOf(Math.max(...totals)) : -1;
  // The last full period against the one before it (the running one is not full yet).
  const iAkhir = totals.length - (openMonth ? 2 : 1);
  const tren = iAkhir >= 1 && totals[iAkhir - 1] > 0 ? ((totals[iAkhir] - totals[iAkhir - 1]) / totals[iAkhir - 1]) * 100 : null;

  const buildReport = async (): Promise<SectionReport> => ({
    title: `${cfg.judul} per ${P.label} - ${estate}`,
    subtitle: [
      `Periode: ${periodText}${alat ? " · per alat / kendaraan" : ""}`,
      `Pemakaian = Stok Keluar, tanpa koreksi, pinjaman / transfer antar estate. Rata-rata = total dibagi jumlah ${P.kata}; stok cukup = stok sekarang dibagi rata-rata per ${P.kata}.`,
    ],
    landscape: true,
    sections: [
      {
        heading: "",
        columns: [
          { label: "No", align: "right" },
          { label: itemLabel },
          ...(alat ? [{ label: "Jenis BBM" }] : module === "GUDANG" ? [{ label: "Kode" }] : []),
          { label: "Satuan" },
          ...months.map((m) => ({ label: lbl(m), align: "right" as const })),
          { label: "Total", align: "right" },
          { label: `Rata-rata / ${P.kata}`, align: "right" },
          { label: "Transaksi", align: "right" },
          ...(showStok ? [{ label: "Stok sekarang", align: "right" as const }, { label: `Stok cukup (${P.kata})`, align: "right" as const }] : []),
        ],
        rows: shown.map((o, i) => [
          i + 1,
          o.nama,
          ...(alat || module === "GUDANG" ? [o.info] : []),
          o.satuan,
          ...months.map((m) => o.per.get(m) ?? 0),
          o.total,
          Math.round(o.avg * 10) / 10,
          o.trx,
          ...(showStok ? [o.stok, cukup(o) === null ? "" : Math.round(cukup(o)! * 10) / 10] : []),
        ]),
      },
    ],
  });

  const selectCls = "text-sm rounded-md border border-[var(--border)] px-2.5 py-1.5 bg-white";
  const colCount = months.length + 5 + (showStok ? 2 : 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {cfg.judul} per {P.label} - {estate}
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Total Stok Keluar tiap {P.kata}, rata-rata per {P.kata}, trennya, dan perkiraan stok cukup untuk berapa {P.kata}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} title="Tutup" className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white">
            <X size={18} />
          </button>
        )}
      </div>

      <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
          <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden" role="group" aria-label="Per">
            {(["hari", "minggu", "bulan"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setPer(v)}
                className={`text-sm px-3 py-1.5 ${per === v ? "bg-[var(--accent-blue)] text-white" : "bg-white text-[var(--text-primary)] hover:bg-[#f1f5f9]"}`}
              >
                {v === "hari" ? "Harian" : v === "minggu" ? "Mingguan" : "Bulanan"}
              </button>
            ))}
          </div>
          <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={selectCls} aria-label="Periode">
            {PRESETS[per].map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type={per === "bulan" ? "month" : "date"} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={selectCls} aria-label="Dari" />
              <span className="text-[var(--text-muted)] text-sm">-</span>
              <input type={per === "bulan" ? "month" : "date"} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={selectCls} aria-label="Sampai" />
            </div>
          )}
          {module === "BBM" && (
            <select value={group} onChange={(e) => setGroup(e.target.value as "" | "alat")} className={selectCls} aria-label="Kelompokkan">
              <option value="">Per jenis BBM</option>
              <option value="alat">Per alat / kendaraan</option>
            </select>
          )}
          <div className="relative w-full sm:w-72">
            <input
              list="pemakaian-item"
              value={pickText}
              onChange={(e) => {
                setPickText(e.target.value);
                setBulan(null);
              }}
              placeholder={`Semua ${itemLabel.toLowerCase()} (pilih satu untuk grafiknya)`}
              className="w-full text-sm rounded-md border border-[var(--border)] pl-3 pr-8 py-1.5"
              aria-label={itemLabel}
            />
            {pickText && (
              <button
                onClick={() => {
                  setPickText("");
                  setBulan(null);
                }}
                title={`Semua ${itemLabel.toLowerCase()}`}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X size={14} />
              </button>
            )}
            <datalist id="pemakaian-item">
              {list.map((o) => (
                <option key={o.kode} value={pickLabel(o)} />
              ))}
            </datalist>
          </div>
          {!one && (
            <div className="relative w-full sm:w-56">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari di tabel..." className="w-full text-sm rounded-md border border-[var(--border)] pl-8 pr-3 py-1.5" />
            </div>
          )}
          <span className="text-xs text-[var(--text-muted)]">{data ? `${fmt(shown.length)} ${itemLabel.toLowerCase()} · ${months.length} ${P.kata}` : ""}</span>
          <div className="ml-auto flex gap-2">{data && <ExportButtons total={0} buildReport={buildReport} fileName={fileBase} />}</div>
        </div>

        {error ? (
          <p className="p-4 text-sm text-[var(--accent-red)]">{error}</p>
        ) : !data ? (
          <p className="p-4 text-sm text-[var(--text-muted)]">Memuat...</p>
        ) : (
          <>
            {!one && list.length > 0 && (
              <div className="p-4 border-b border-[var(--border)]">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Semua {itemLabel.toLowerCase()} per {P.kata}
                    {!satuanSama && <span className="text-xs font-normal text-[var(--text-muted)]"> · satuan berbeda, pilih satu untuk grafiknya</span>}
                  </div>
                  {satuanSama && (
                    <div className="text-xs text-[var(--text-secondary)]">
                      Total <b>{fmt(grand)}</b> {list[0].satuan} · rata-rata <b>{fmt(grand / Math.max(months.length, 1))}</b>/{P.kata}
                      {puncak >= 0 && totals[puncak] > 0 && (
                        <>
                          {" "}
                          · tertinggi <b>{fmt(totals[puncak])}</b> ({periodeLabelPanjang(per, months[puncak])})
                        </>
                      )}
                      {tren !== null && (
                        <>
                          {" "}
                          · {P.kata} terakhir{" "}
                          <b className={tren > 0 ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]"}>
                            {tren > 0 ? "naik" : "turun"} {fmt(Math.abs(tren))}%
                          </b>{" "}
                          dari sebelumnya
                        </>
                      )}
                    </div>
                  )}
                </div>
                {satuanSama && (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartAll} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="#e8edf3" />
                        <XAxis dataKey="bulan" tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={{ stroke: "#d5dde6" }} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={false} tickLine={false} width={52} />
                        <Tooltip formatter={(v, name) => [`${fmt(Number(v))} ${list[0].satuan}`, name]} cursor={{ fill: "#f1f5f9" }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {stack.map((o, i) => (
                          <Bar key={o.kode} dataKey={`s${i}`} name={pickLabel(o)} stackId="a" fill={WARNA[i]} maxBarSize={40} isAnimationActive={false}>
                            {i === stack.length - 1 && !sisa.length && months.length <= 31 && (
                              <LabelList dataKey="total" position="top" formatter={(v: unknown) => (Number(v) ? fmt(Number(v)) : "")} style={{ fontSize: 10, fill: "#1a2634" }} />
                            )}
                          </Bar>
                        ))}
                        {sisa.length > 0 && (
                          <Bar dataKey="lain" name={`Lainnya (${sisa.length})`} stackId="a" fill={WARNA_LAIN} maxBarSize={40} isAnimationActive={false}>
                            {months.length <= 31 && (
                              <LabelList dataKey="total" position="top" formatter={(v: unknown) => (Number(v) ? fmt(Number(v)) : "")} style={{ fontSize: 10, fill: "#1a2634" }} />
                            )}
                          </Bar>
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {openMonth && satuanSama && <p className="text-[10px] text-[var(--text-muted)] mt-1">{P.label} {lbl(months.at(-1)!)} masih berjalan, belum penuh.</p>}
              </div>
            )}
            {one && (
              <div className="p-4 border-b border-[var(--border)]">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    {pickLabel(one)} per {P.kata} <span className="text-xs font-normal text-[var(--text-muted)]">({one.satuan || "-"}) · klik batang untuk daftar transaksinya</span>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    Total <b>{fmt(one.total)}</b> · rata-rata <b>{fmt(one.avg)}</b>/{P.kata} · {fmt(one.trx)} transaksi
                    {showStok && (
                      <>
                        {" "}
                        · stok sekarang <b>{one.stok === null ? "-" : fmt(one.stok)}</b>
                        {cukup(one) !== null && ` (± ${fmt(cukup(one)!)} ${P.kata})`}
                      </>
                    )}
                  </div>
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e8edf3" />
                      <XAxis dataKey="bulan" tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={{ stroke: "#d5dde6" }} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={false} tickLine={false} width={52} />
                      <Tooltip formatter={(v) => [`${fmt(Number(v))} ${one.satuan}`, "Pemakaian"]} cursor={{ fill: "#f1f5f9" }} />
                      <Bar dataKey="qty" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={40} cursor="pointer" isAnimationActive={false} onClick={(_, i) => showDetail(one, months[i])}>
                        {chart.map((c, i) => (
                          <Cell key={c.bulan} fill={bulan === months[i] ? "#16448a" : "#2a78d6"} />
                        ))}
                        {months.length <= 31 && <LabelList dataKey="qty" position="top" formatter={(v: unknown) => (Number(v) ? fmt(Number(v)) : "")} style={{ fontSize: 10, fill: "#1a2634" }} />}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {openMonth && <p className="text-[10px] text-[var(--text-muted)] mt-1">{P.label} {lbl(months.at(-1)!)} masih berjalan, belum penuh.</p>}
              </div>
            )}

            {one && bulan !== null && (
              <DetailList
                module={module}
                estate={estate}
                item={{ ...one, label: pickLabel(one) }}
                bulan={bulan}
                per={per}
                periodText={periodText}
                rows={detail}
                onAll={() => setBulan("")}
                onClose={() => setBulan(null)}
              />
            )}

            <div className="table-scroll">
              <table className="grid-table data-table text-sm">
                <thead>
                  <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                    <th className="px-3 py-2.5 text-right">No</th>
                    <th className="px-3 py-2.5 text-left">{itemLabel}</th>
                    {months.map((m) => (
                      <th key={m} className="px-3 py-2.5 text-right whitespace-nowrap">
                        {lbl(m)}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-right">Rata-rata / {P.singkat}</th>
                    <th className="px-3 py-2.5 text-right" title="Jumlah transaksi Stok Keluar">
                      Trx
                    </th>
                    {showStok && (
                      <>
                        <th className="px-3 py-2.5 text-right">Stok skrg</th>
                        <th className="px-3 py-2.5 text-right" title={`Stok sekarang dibagi rata-rata per ${P.kata}`}>
                          Cukup ({P.singkat})
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={colCount} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        Tidak ada pemakaian di periode ini
                      </td>
                    </tr>
                  ) : (
                    shown.map((o, i) => {
                      const c = cukup(o);
                      const picked = one?.kode === o.kode;
                      return (
                        <tr key={o.kode} className={`align-top cursor-pointer ${picked ? "bg-[var(--accent-blue-bg)]" : ""}`} onClick={() => setPickText(pickLabel(o))} title={`Lihat grafik per ${P.kata}`}>
                          <td className="px-3 py-2 text-right text-[var(--text-muted)]">{i + 1}</td>
                          <td className="col-grow px-3 py-2">
                            <div className="font-medium text-[var(--text-primary)]">{o.nama}</div>
                            <div className="text-[11px] text-[var(--text-muted)]">{[o.info !== o.nama && o.info, o.satuan].filter(Boolean).join(" · ")}</div>
                          </td>
                          {months.map((m) => (
                            <td
                              key={m}
                              onClick={(e) => {
                                if (!o.per.get(m)) return;
                                e.stopPropagation();
                                showDetail(o, m);
                              }}
                              title={o.per.get(m) ? `Transaksi ${o.nama} di ${periodeLabelPanjang(per, m)}` : undefined}
                              className={`px-3 py-2 text-right tabular-nums ${
                                o.per.get(m)
                                  ? `hover:underline hover:text-[var(--accent-blue)] ${picked && bulan === m ? "bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] font-semibold" : ""}`
                                  : "text-[var(--text-muted)]"
                              }`}
                            >
                              {fmt(o.per.get(m) ?? 0)}
                            </td>
                          ))}
                          <td
                            onClick={(e) => {
                              e.stopPropagation();
                              showDetail(o, "");
                            }}
                            title={`Semua transaksi ${o.nama} di periode ini`}
                            className="px-3 py-2 text-right tabular-nums font-semibold hover:underline hover:text-[var(--accent-blue)]"
                          >
                            {fmt(o.total)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(o.avg)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{fmt(o.trx)}</td>
                          {showStok && (
                            <>
                              <td className="px-3 py-2 text-right tabular-nums">{o.stok === null ? "-" : fmt(o.stok)}</td>
                              <td
                                className={`px-3 py-2 text-right tabular-nums font-medium ${
                                  c === null
                                    ? "text-[var(--text-muted)]"
                                    : cukupBulan(c) < 1
                                      ? "text-[var(--accent-red)]"
                                      : cukupBulan(c) < 2
                                        ? "text-[var(--accent-amber)]"
                                        : "text-[var(--accent-green)]"
                                }`}
                              >
                                {c === null ? "-" : fmt(c)}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)] space-y-0.5">
              <div>
                Pemakaian = Stok Keluar {estate}
                {data.mulai && ` (data mulai ${bulanLabel(data.mulai)})`}, tanpa koreksi / stok opname, pinjaman dan transfer antar estate
                {module === "GUDANG" && estate === "NILAM" && " (barang yang dikirim ke gudang estate lain dihitung di gudang itu saat keluar)"}. Rata-rata = total ÷ {months.length} {P.kata}
                {openMonth && ` (${P.kata} berjalan dihitung penuh)`}
                {per === "minggu" && "; minggu = Senin - Minggu"}.
                {showStok && ` Cukup = stok sekarang ÷ rata-rata per ${P.kata}: merah < 1 bulan, kuning < 2 bulan.`} Klik baris untuk grafiknya, klik angka {P.kata} / total untuk daftar transaksinya.
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// The Stok Keluar rows behind one figure (a month, or the whole period), with Cetak / Excel.
function DetailList({
  module,
  estate,
  item,
  bulan,
  per,
  periodText,
  rows,
  onAll,
  onClose,
}: {
  module: PakaiModule;
  estate: string;
  item: { kode: string; label: string; satuan: string };
  bulan: string;
  per: PakaiPer;
  periodText: string;
  rows: Detail | null;
  onAll: () => void;
  onClose: () => void;
}) {
  const cfg = CFG[module];
  const when = bulan ? periodeLabelPanjang(per, bulan) : `periode ${periodText}`;
  const total = (rows ?? []).reduce((s, r) => s + Number(r.qty ?? 0), 0);
  const report = async (): Promise<TableReport> => ({
    title: `${item.label} - ${estate}`,
    subtitle: [`Stok Keluar ${item.label} · ${when}`, `${fmt(total)} ${item.satuan} · ${fmt((rows ?? []).length)} transaksi`],
    columns: [
      { label: "No", align: "right" },
      { label: "Tanggal", nowrap: true },
      { label: cfg.ref },
      ...(cfg.tujuan ? [{ label: cfg.tujuan }] : []),
      ...(cfg.penerima ? [{ label: cfg.penerima }] : []),
      { label: "Keterangan" },
      { label: "Qty", align: "right" },
      { label: "Satuan" },
    ],
    rows: (rows ?? []).map((r, i) => [
      i + 1,
      tgl(r.tanggal_iso),
      r.ref,
      ...(cfg.tujuan ? [r.tujuan] : []),
      ...(cfg.penerima ? [r.penerima] : []),
      r.ket,
      Number(r.qty),
      item.satuan,
    ]),
  });
  return (
    <div id="pemakaian-detail" className="border-b border-[var(--border)]">
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 bg-[var(--accent-blue-bg)]">
        <div className="text-sm text-[var(--text-primary)]">
          <b>{item.label}</b> · {when}
          {rows && (
            <span className="text-[var(--text-secondary)]">
              {" "}
              · {fmt(total)} {item.satuan} dalam {fmt(rows.length)} transaksi
            </span>
          )}
        </div>
        {bulan && (
          <button onClick={onAll} className="text-xs text-[var(--accent-blue)] hover:underline">
            Lihat semua {PER[per].kata}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {rows && rows.length > 0 && (
            <ExportButtons total={0} buildReport={report} fileName={`stok-keluar-${item.kode.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${estate.toLowerCase()}`} />
          )}
          <button onClick={onClose} title="Tutup" className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white">
            <X size={16} />
          </button>
        </div>
      </div>
      {rows === null ? (
        <p className="px-4 py-3 text-sm text-[var(--text-muted)]">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--text-muted)]">Tidak ada transaksi</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="data-table text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs text-[var(--text-secondary)] border-b border-[var(--border)]">
                <th className="px-3 py-2 text-right">No</th>
                <th className="px-3 py-2">Tanggal</th>
                <th className="px-3 py-2">{cfg.ref}</th>
                {cfg.tujuan && <th className="px-3 py-2">{cfg.tujuan}</th>}
                {cfg.penerima && <th className="px-3 py-2">{cfg.penerima}</th>}
                <th className="px-3 py-2">Keterangan</th>
                <th className="px-3 py-2 text-right">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r, i) => (
                <tr key={`${r.id}-${i}`} className="align-top">
                  <td className="px-3 py-2 text-right text-[var(--text-muted)]">{i + 1}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{tgl(r.tanggal_iso)}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{r.ref || "-"}</td>
                  {cfg.tujuan && <td className="px-3 py-2">{r.tujuan || "-"}</td>}
                  {cfg.penerima && <td className="px-3 py-2 text-[var(--text-secondary)]">{r.penerima || "-"}</td>}
                  <td className="col-grow px-3 py-2">{r.ket || "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(Number(r.qty))} <span className="text-[11px] text-[var(--text-muted)]">{item.satuan}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
