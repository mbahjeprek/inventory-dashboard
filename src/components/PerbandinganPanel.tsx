import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, X } from "lucide-react";
import { api, type OpnameModule, type Perbandingan } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { canModule } from "../lib/access";

type EstateLink = { estate: string; label: string };
type Period = "bulan" | "3bulan" | "6bulan" | "tahun" | "custom";
type Barang = { kode: string; nama: string; satuan: string };

// Each estate keeps its own color in every chart (color follows the estate, not its rank); the
// first five slots of the validated categorical palette.
export const ESTATE_COLOR: Record<string, string> = {
  NILAM: "#2a78d6",
  KNS: "#eb6834",
  WJA: "#1baf7a",
  ZAMRUD: "#eda100",
  FIRUS: "#e87ba4",
};

const SOURCES: { key: string; label: string; module: OpnameModule; kode?: string }[] = [
  { key: "GUDANG", label: "Gudang", module: "GUDANG" },
  { key: "KLINIK", label: "Klinik", module: "KLINIK" },
  { key: "SOLAR", label: "Solar", module: "BBM", kode: "SOLAR" },
  { key: "BENSIN", label: "Bensin", module: "BBM", kode: "BENSIN" },
  { key: "PUPUK", label: "Pupuk", module: "PUPUK" },
  { key: "OLI", label: "Oli", module: "OLI" },
];
const PERIODS: { key: Period; label: string }[] = [
  { key: "bulan", label: "Bulan ini" },
  { key: "3bulan", label: "3 bulan" },
  { key: "6bulan", label: "6 bulan" },
  { key: "tahun", label: "Tahun ini" },
  { key: "custom", label: "Pilih tanggal" },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
const compact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${fmt(n / 1_000_000)} jt` : Math.abs(n) >= 10_000 ? `${fmt(Math.round(n / 1000))} rb` : fmt(n);
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isoDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function periodRange(p: Period, custom: { from: string; to: string }) {
  const now = new Date();
  const to = localIso(now);
  const monthsBack = { bulan: 0, "3bulan": 2, "6bulan": 5 } as Record<string, number>;
  if (p in monthsBack) return { dateFrom: localIso(new Date(now.getFullYear(), now.getMonth() - monthsBack[p], 1)), dateTo: to };
  if (p === "tahun") return { dateFrom: localIso(new Date(now.getFullYear(), 0, 1)), dateTo: to };
  return { dateFrom: custom.from, dateTo: custom.to };
}

// Every week (Monday, like Postgres date_trunc) or month from `from` to `to`, so a bucket without
// usage still shows as 0 on the trend.
function buckets(from: string, to: string, bucket: "week" | "month") {
  const out: string[] = [];
  const end = isoDate(to);
  const d = isoDate(from);
  if (bucket === "month") d.setDate(1);
  else d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  while (d <= end) {
    out.push(localIso(d));
    if (bucket === "month") d.setMonth(d.getMonth() + 1);
    else d.setDate(d.getDate() + 7);
  }
  return out;
}
const bucketLabel = (iso: string, bucket: "week" | "month") => {
  const d = isoDate(iso);
  return bucket === "month" ? `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-md border border-[var(--border)] overflow-hidden text-xs">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-2.5 py-1 ${
            value === o.key ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Barang filter: Gudang / Klinik search the master data, Pupuk / Oli pick a jenis; empty = all.
function BarangPicker({ module, value, onChange }: { module: OpnameModule; value: Barang | null; onChange: (b: Barang | null) => void }) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<Barang[]>([]);
  const [open, setOpen] = useState(false);
  const searchable = module === "GUDANG" || module === "KLINIK";

  useEffect(() => {
    const t = setTimeout(() => api.perbandinganBarang(module, searchable ? search : "").then(setOptions).catch(() => setOptions([])), 250);
    return () => clearTimeout(t);
  }, [module, search, searchable]);

  if (!searchable) {
    return (
      <select
        value={value?.kode ?? ""}
        onChange={(e) => onChange(options.find((o) => o.kode === e.target.value) ?? null)}
        className="text-xs rounded-md border border-[var(--border)] px-2 py-1 bg-[var(--bg-card)]"
        aria-label="Jenis"
      >
        <option value="">Semua jenis</option>
        {options.map((o) => (
          <option key={o.kode} value={o.kode}>
            {o.nama}
          </option>
        ))}
      </select>
    );
  }
  if (value) {
    return (
      <span className="inline-flex items-center gap-1 text-xs rounded-md border border-[var(--accent-blue-border)] bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] pl-2 pr-1 py-1 max-w-[260px]">
        <span className="truncate">{value.nama}</span>
        <button onClick={() => onChange(null)} title="Semua barang" className="p-0.5 rounded hover:bg-white/60">
          <X size={12} />
        </button>
      </span>
    );
  }
  return (
    <div className="relative">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Semua barang (cari untuk pilih satu)"
        className="text-xs rounded-md border border-[var(--border)] px-2 py-1 w-60 bg-[var(--bg-card)]"
      />
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 w-72 max-h-60 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg-card)] shadow-lg">
          {options.map((o) => (
            <button
              key={o.kode}
              onMouseDown={() => {
                onChange(o);
                setSearch("");
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#f1f5f9]"
            >
              <div className="text-[var(--text-primary)] truncate">{o.nama}</div>
              <div className="text-[10px] text-[var(--text-muted)]">
                {o.kode} · {o.satuan}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Dashboard "Perbandingan": how much each estate on screen used in a period, as bars per estate,
// a trend line per estate and a table with the change against the period before.
export function PerbandinganPanel({ estates }: { estates: EstateLink[] }) {
  const { user } = useAuth();
  const sources = SOURCES.filter((s) => canModule(user, s.module));
  const [sourceKey, setSourceKey] = useState(() => {
    try {
      const saved = localStorage.getItem("perbandingan.source");
      if (saved && sources.some((s) => s.key === saved)) return saved;
    } catch {
      // ignore
    }
    return sources[0]?.key ?? "GUDANG";
  });
  const source = sources.find((s) => s.key === sourceKey) ?? sources[0];
  const [period, setPeriod] = useState<Period>("3bulan");
  const [custom, setCustom] = useState(() => periodRange("3bulan", { from: "", to: "" }));
  const [barang, setBarang] = useState<Barang | null>(null);
  const [data, setData] = useState<Perbandingan | null>(null);
  const [error, setError] = useState(false);

  const range = periodRange(period, { from: custom.dateFrom, to: custom.dateTo });
  const codes = estates.map((e) => e.estate);
  const codesKey = codes.join(",");
  const kode = source?.kode ?? barang?.kode ?? "";

  useEffect(() => {
    try {
      localStorage.setItem("perbandingan.source", sourceKey);
    } catch {
      // ignore
    }
    setBarang(null);
  }, [sourceKey]);

  useEffect(() => {
    if (!source || codes.length < 2 || !range.dateFrom || !range.dateTo) return;
    let stale = false;
    setData(null);
    setError(false);
    api
      .perbandingan({ module: source.module, estates: codes, kode, ...range })
      .then((d) => !stale && setData(d))
      .catch(() => !stale && setError(true));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.key, codesKey, kode, range.dateFrom, range.dateTo]);

  if (!source) return null;

  const labelOf = (code: string) => estates.find((e) => e.estate === code)?.label ?? code;
  const unit = data?.unit ?? "";
  const valueText = (n: number) => `${fmt(n)} ${unit}`.trim();
  const total = data ? data.perEstate.reduce((s, r) => s + r.value, 0) : 0;
  const bars = (data?.perEstate ?? []).map((r) => ({ ...r, label: labelOf(r.estate), share: total ? (r.value / total) * 100 : 0 }));
  // A period ending today ends in a week / month that isn't over yet; its label gets a *.
  const openEnd = range.dateTo >= localIso(new Date());
  const bucketList = data ? buckets(range.dateFrom, range.dateTo, data.bucket) : [];
  const trend = data
    ? bucketList.map((b, i) => {
        const row: Record<string, number | string> = {
          bucket: b,
          label: `${bucketLabel(b, data.bucket)}${openEnd && i === bucketList.length - 1 ? "*" : ""}`,
        };
        for (const c of codes) row[c] = data.series.find((s) => s.bucket === b && s.estate === c)?.value ?? 0;
        return row;
      })
    : [];
  const what =
    data?.metric === "trx"
      ? `jumlah transaksi keluar ${source.module === "GUDANG" ? "gudang" : "klinik"} (semua barang)`
      : source.kode
        ? `pemakaian ${source.label} (LTR)`
        : barang
          ? `keluar ${barang.nama} (${unit})`
          : `pemakaian ${source.label.toLowerCase()} (${unit})`;

  return (
    <section className="min-w-0 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <BarChart3 size={16} className="text-[var(--accent-blue)]" />
            Perbandingan Pemakaian Antar Estate
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {estates.length >= 2 ? `${estates.map((e) => e.label).join(" · ")} · ${what}` : "Pilih minimal 2 estate di atas"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sources.length > 1 && <Segmented value={sourceKey} onChange={setSourceKey} options={sources} />}
          <Segmented<Period> value={period} onChange={setPeriod} options={PERIODS} />
          {period === "custom" && (
            <div className="flex items-center gap-1 text-xs">
              {/* Tanggal dari - sampai: side by side, half the width each on a phone */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="date"
                  value={custom.dateFrom}
                  max={custom.dateTo || undefined}
                  onChange={(e) => setCustom((c) => ({ ...c, dateFrom: e.target.value }))}
                  className="border border-[var(--border)] rounded px-1.5 py-0.5 bg-[var(--bg-card)] flex-1 min-w-0 sm:flex-none"
                />
                <span className="text-[var(--text-muted)]">s/d</span>
                <input
                  type="date"
                  value={custom.dateTo}
                  min={custom.dateFrom || undefined}
                  onChange={(e) => setCustom((c) => ({ ...c, dateTo: e.target.value }))}
                  className="border border-[var(--border)] rounded px-1.5 py-0.5 bg-[var(--bg-card)] flex-1 min-w-0 sm:flex-none"
                />
              </div>
            </div>
          )}
          {!source.kode && <BarangPicker key={source.module} module={source.module} value={barang} onChange={setBarang} />}
        </div>
      </div>

      {estates.length < 2 ? (
        <div className="text-sm text-[var(--text-muted)]">Klik "Semua Estate" atau pilih 2 estate atau lebih di bagian atas untuk membandingkan.</div>
      ) : error ? (
        <div className="text-sm text-[var(--accent-red)]">Gagal memuat data</div>
      ) : data === null ? (
        <div className="text-sm text-[var(--text-muted)]">Memuat...</div>
      ) : total === 0 ? (
        <div className="text-sm text-[var(--text-muted)]">Tidak ada pemakaian pada periode ini</div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2 items-start">
            <div className="min-w-0">
              <div className="text-xs font-medium text-[var(--text-secondary)] mb-1">Total per estate</div>
              <div style={{ height: bars.length * 40 + 16 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bars} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 0 }} barCategoryGap={8}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="label" width={64} tick={{ fontSize: 12, fill: "#1a2634" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: "#f1f5f9" }}
                      content={({ active, payload }) => {
                        const r = active && (payload?.[0]?.payload as (typeof bars)[number] | undefined);
                        if (!r) return null;
                        return (
                          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md shadow px-3 py-2 text-xs">
                            <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ESTATE_COLOR[r.estate] }} />
                              {r.label}
                            </div>
                            <div className="mt-1">{valueText(r.value)}</div>
                            <div className="text-[var(--text-muted)]">{fmt(r.share)}% dari total</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={26}>
                      {bars.map((r) => (
                        <Cell key={r.estate} fill={ESTATE_COLOR[r.estate]} />
                      ))}
                      <LabelList dataKey="value" position="right" formatter={(v: unknown) => compact(Number(v))} style={{ fontSize: 11, fill: "#1a2634" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="min-w-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-secondary)] border-b border-[var(--border)]">
                    <th className="py-1.5 pr-2 font-medium">Estate</th>
                    <th className="py-1.5 pr-2 font-medium text-right">{data.metric === "trx" ? "Transaksi" : `Jumlah (${unit})`}</th>
                    <th className="py-1.5 pr-2 font-medium text-right">% total</th>
                    <th className="py-1.5 font-medium text-right">vs periode lalu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {bars.map((r) => {
                    const before = data.prev.find((p) => p.estate === r.estate)?.value ?? 0;
                    const change = before ? ((r.value - before) / before) * 100 : null;
                    return (
                      <tr key={r.estate}>
                        <td className="py-1.5 pr-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ESTATE_COLOR[r.estate] }} />
                            {r.label}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-semibold whitespace-nowrap">{fmt(r.value)}</td>
                        <td className="py-1.5 pr-2 text-right text-[var(--text-secondary)]">{fmt(r.share)}%</td>
                        <td className="py-1.5 text-right whitespace-nowrap" title={`Periode lalu: ${valueText(before)}`}>
                          {change === null ? (
                            <span className="text-[var(--text-muted)]">{r.value ? "baru" : "-"}</span>
                          ) : (
                            <span className={change > 0 ? "text-[var(--accent-red)]" : change < 0 ? "text-[var(--accent-green)]" : "text-[var(--text-muted)]"}>
                              {change > 0 ? "▲" : change < 0 ? "▼" : ""} {Math.abs(change) > 999 ? ">999" : fmt(Math.abs(change))}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="font-semibold">
                    <td className="py-1.5 pr-2">Total</td>
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap">{fmt(total)}</td>
                    <td className="py-1.5 pr-2 text-right">100%</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <div className="text-[10px] text-[var(--text-muted)] mt-2">
                Periode lalu = {data.prevFrom.split("-").reverse().join("/")} s/d {data.prevTo.split("-").reverse().join("/")}. Koreksi stok, pinjaman antar estate dan
                kiriman Gudang Nilam ke gudang estate lain tidak dihitung.
                {data.metric === "trx" && " Satuan barang berbeda-beda, jadi tanpa barang dipilih yang dibandingkan jumlah transaksi keluar."}
              </div>
            </div>
          </div>

          {trend.length >= 2 && (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className="text-xs font-medium text-[var(--text-secondary)]">
                  Tren per {data.bucket === "week" ? "minggu" : "bulan"}
                  {openEnd && <span className="font-normal text-[var(--text-muted)]"> · * {data.bucket === "week" ? "minggu" : "bulan"} berjalan, belum penuh</span>}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {codes.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <span className="w-3 h-0.5 rounded" style={{ background: ESTATE_COLOR[c] }} />
                      {labelOf(c)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e8edf3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={{ stroke: "#d5dde6" }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip
                      cursor={{ stroke: "#9aa9b8", strokeDasharray: "3 3" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const items = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
                        return (
                          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md shadow px-3 py-2 text-xs space-y-0.5">
                            <div className="font-medium text-[var(--text-primary)] mb-1">
                              {data.bucket === "week" ? `Minggu ${label}` : label}
                            </div>
                            {items.map((p) => (
                              <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
                                <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                                  <span className="w-2.5 h-0.5 rounded" style={{ background: ESTATE_COLOR[String(p.dataKey)] }} />
                                  {labelOf(String(p.dataKey))}
                                </span>
                                <span className="font-medium text-[var(--text-primary)]">{fmt(Number(p.value))}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    {codes.map((c) => (
                      <Line
                        key={c}
                        type="monotone"
                        dataKey={c}
                        name={c}
                        stroke={ESTATE_COLOR[c]}
                        strokeWidth={2}
                        dot={trend.length <= 14 ? { r: 4, strokeWidth: 2, stroke: "#ffffff", fill: ESTATE_COLOR[c] } : false}
                        activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff" }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
