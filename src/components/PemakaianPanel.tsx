import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Search, X } from "lucide-react";
import { api, errorText, type PakaiModule } from "../lib/api";
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

type Preset = "6" | "12" | "tahun" | "tahun-lalu" | "semua" | "custom";
function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  if (p === "6" || p === "12") return { from: localIso(new Date(y, now.getMonth() - (Number(p) - 1), 1)), to: localIso(now) };
  if (p === "tahun") return { from: `${y}-01-01`, to: localIso(now) };
  if (p === "tahun-lalu") return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  return { from: "", to: "" };
}
const lastDay = (ym: string) => localIso(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0));

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
        title="Pemakaian per bulan dan rata-ratanya"
        className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[#f1f5f9]"
      >
        <BarChart3 size={16} /> Pemakaian / Bulan
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

  const range =
    preset === "custom"
      ? { from: custom.from ? `${custom.from}-01` : "", to: custom.to ? lastDay(custom.to) : "" }
      : presetRange(preset);
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
      .pemakaian({ module, estate, dateFrom, dateTo, group })
      .then((d) => !stale && setData(d))
      .catch((e) => !stale && setError(errorText(e, "Gagal memuat pemakaian")));
    return () => {
      stale = true;
    };
  }, [module, estate, dateFrom, dateTo, group]);
  // Another period / grouping: the list closes (its month may not be in it).
  useEffect(() => setBulan(null), [dateFrom, dateTo, group]);
  useEffect(() => setPickText(""), [group]);

  // Months shown: the period's, from the first month the estate has any pemakaian.
  const months = useMemo(() => {
    if (!data) return [];
    const start = data.mulai ? `${data.mulai}-01` : localIso(new Date());
    return monthsBetween(dateFrom && dateFrom > start ? dateFrom : start, dateTo || localIso(new Date()));
  }, [data, dateFrom, dateTo]);

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
  const cukup = (o: ItemRow) => (o.stok === null ? null : o.avg > 0 ? Math.max(o.stok, 0) / o.avg : null);
  const showStok = !alat;

  useEffect(() => {
    if (!one || bulan === null) return;
    let stale = false;
    setDetail(null);
    api
      .pemakaianDetail({ module, estate, dateFrom, dateTo, group, kode: one.kode, bulan })
      .then((d) => !stale && setDetail(d.data))
      .catch(() => !stale && setDetail([]));
    return () => {
      stale = true;
    };
  }, [module, estate, dateFrom, dateTo, group, one?.kode, bulan]);

  const showDetail = (o: ItemRow, m: string) => {
    setPickText(pickLabel(o));
    setBulan(m);
    setTimeout(() => document.getElementById("pemakaian-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 300);
  };

  const chart = one ? months.map((m) => ({ bulan: bulanLabel(m), qty: one.per.get(m) ?? 0 })) : [];
  const openMonth = months.at(-1) === localIso(new Date()).slice(0, 7);
  const fileBase = `pemakaian-${module.toLowerCase()}${alat ? "-alat" : ""}-${estate.toLowerCase()}`;

  const buildReport = async (): Promise<SectionReport> => ({
    title: `${cfg.judul} per Bulan - ${estate}`,
    subtitle: [
      `Periode: ${periodText}${alat ? " · per alat / kendaraan" : ""}`,
      "Pemakaian = Stok Keluar, tanpa koreksi, pinjaman / transfer antar estate. Rata-rata = total dibagi jumlah bulan; stok cukup = stok sekarang dibagi rata-rata per bulan.",
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
          ...months.map((m) => ({ label: bulanLabel(m), align: "right" as const })),
          { label: "Total", align: "right" },
          { label: "Rata-rata / bulan", align: "right" },
          { label: "Transaksi", align: "right" },
          ...(showStok ? [{ label: "Stok sekarang", align: "right" as const }, { label: "Stok cukup (bulan)", align: "right" as const }] : []),
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
            {cfg.judul} per Bulan - {estate}
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">Total Stok Keluar tiap bulan, rata-rata per bulan, dan perkiraan stok cukup untuk berapa bulan</p>
        </div>
        {onClose && (
          <button onClick={onClose} title="Tutup" className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white">
            <X size={18} />
          </button>
        )}
      </div>

      <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
          <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={selectCls} aria-label="Periode">
            <option value="6">6 bulan terakhir</option>
            <option value="12">12 bulan terakhir</option>
            <option value="tahun">Tahun ini</option>
            <option value="tahun-lalu">Tahun lalu</option>
            <option value="semua">Semua data</option>
            <option value="custom">Pilih bulan...</option>
          </select>
          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="month" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={selectCls} aria-label="Dari bulan" />
              <span className="text-[var(--text-muted)] text-sm">-</span>
              <input type="month" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={selectCls} aria-label="Sampai bulan" />
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
          <span className="text-xs text-[var(--text-muted)]">{data ? `${fmt(shown.length)} ${itemLabel.toLowerCase()} · ${months.length} bulan` : ""}</span>
          <div className="ml-auto flex gap-2">{data && <ExportButtons total={0} buildReport={buildReport} fileName={fileBase} />}</div>
        </div>

        {error ? (
          <p className="p-4 text-sm text-[var(--accent-red)]">{error}</p>
        ) : !data ? (
          <p className="p-4 text-sm text-[var(--text-muted)]">Memuat...</p>
        ) : (
          <>
            {one && (
              <div className="p-4 border-b border-[var(--border)]">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    {pickLabel(one)} per bulan <span className="text-xs font-normal text-[var(--text-muted)]">({one.satuan || "-"}) · klik batang untuk daftar transaksinya</span>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    Total <b>{fmt(one.total)}</b> · rata-rata <b>{fmt(one.avg)}</b>/bulan · {fmt(one.trx)} transaksi
                    {showStok && (
                      <>
                        {" "}
                        · stok sekarang <b>{one.stok === null ? "-" : fmt(one.stok)}</b>
                        {cukup(one) !== null && ` (± ${fmt(cukup(one)!)} bulan)`}
                      </>
                    )}
                  </div>
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e8edf3" />
                      <XAxis dataKey="bulan" tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={{ stroke: "#d5dde6" }} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={false} tickLine={false} width={52} />
                      <Tooltip formatter={(v) => [`${fmt(Number(v))} ${one.satuan}`, "Pemakaian"]} cursor={{ fill: "#f1f5f9" }} />
                      <Bar dataKey="qty" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={40} cursor="pointer" isAnimationActive={false} onClick={(_, i) => showDetail(one, months[i])}>
                        {chart.map((c, i) => (
                          <Cell key={c.bulan} fill={bulan === months[i] ? "#16448a" : "#2a78d6"} />
                        ))}
                        <LabelList dataKey="qty" position="top" formatter={(v: unknown) => (Number(v) ? fmt(Number(v)) : "")} style={{ fontSize: 10, fill: "#1a2634" }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {openMonth && <p className="text-[10px] text-[var(--text-muted)] mt-1">Bulan {bulanLabel(months.at(-1)!)} masih berjalan, belum penuh.</p>}
              </div>
            )}

            {one && bulan !== null && (
              <DetailList
                module={module}
                estate={estate}
                item={{ ...one, label: pickLabel(one) }}
                bulan={bulan}
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
                        {bulanLabel(m)}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-right">Rata-rata / bln</th>
                    <th className="px-3 py-2.5 text-right" title="Jumlah transaksi Stok Keluar">
                      Trx
                    </th>
                    {showStok && (
                      <>
                        <th className="px-3 py-2.5 text-right">Stok skrg</th>
                        <th className="px-3 py-2.5 text-right" title="Stok sekarang dibagi rata-rata per bulan">
                          Cukup (bln)
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
                        <tr key={o.kode} className={`align-top cursor-pointer ${picked ? "bg-[var(--accent-blue-bg)]" : ""}`} onClick={() => setPickText(pickLabel(o))} title="Lihat grafik per bulan">
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
                              title={o.per.get(m) ? `Transaksi ${o.nama} di ${bulanLabel(m)}` : undefined}
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
                                  c === null ? "text-[var(--text-muted)]" : c < 1 ? "text-[var(--accent-red)]" : c < 2 ? "text-[var(--accent-amber)]" : "text-[var(--accent-green)]"
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
                {module === "GUDANG" && estate === "NILAM" && " (barang yang dikirim ke gudang estate lain dihitung di gudang itu saat keluar)"}. Rata-rata = total ÷ {months.length} bulan
                {openMonth && " (bulan berjalan dihitung penuh)"}.
                {showStok && " Cukup = stok sekarang ÷ rata-rata per bulan: merah < 1 bulan, kuning < 2 bulan."} Klik baris untuk grafiknya, klik angka bulan / total untuk daftar transaksinya.
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
  periodText,
  rows,
  onAll,
  onClose,
}: {
  module: PakaiModule;
  estate: string;
  item: { kode: string; label: string; satuan: string };
  bulan: string;
  periodText: string;
  rows: Detail | null;
  onAll: () => void;
  onClose: () => void;
}) {
  const cfg = CFG[module];
  const when = bulan ? bulanLabelPanjang(bulan) : `periode ${periodText}`;
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
            Lihat semua bulan
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
