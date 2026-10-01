import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp } from "lucide-react";
import { api, type TopKeluar, type TopKeluarRow } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { canModule } from "../lib/access";

type EstateLink = { estate: string; label: string; gudang: string; klinik: string };
type Source = "gudang" | "klinik";
type Period = "bulan" | "3bulan" | "tahun" | "custom";

const PERIODS: { key: Period; label: string }[] = [
  { key: "bulan", label: "Bulan ini" },
  { key: "3bulan", label: "3 bulan" },
  { key: "tahun", label: "Tahun ini" },
  { key: "custom", label: "Pilih tanggal" },
];

const BAR = "#1e5bb5";
const BAR_HOVER = "#16448a";

const fmt = (n: number | string | undefined) => Number(n ?? 0).toLocaleString("id-ID");
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function periodRange(p: Period, custom: { from: string; to: string }) {
  const now = new Date();
  const to = localIso(now);
  if (p === "bulan") return { dateFrom: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: to };
  if (p === "3bulan") return { dateFrom: localIso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), dateTo: to };
  if (p === "tahun") return { dateFrom: localIso(new Date(now.getFullYear(), 0, 1)), dateTo: to };
  return { dateFrom: custom.from, dateTo: custom.to };
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-xs">
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

// Dashboard ranking of the items that went out most often (number of transactions) for the estates on
// screen; total qty is shown alongside. Koreksi is not counted.
export function TopKeluarPanel({ estates }: { estates: EstateLink[] }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  // An admin limited to some modules only ranks those (Gudang and/or Klinik).
  const sources = ([
    { key: "gudang", label: "Gudang" },
    { key: "klinik", label: "Klinik" },
  ] as { key: Source; label: string }[]).filter((o) => canModule(user, o.key === "gudang" ? "GUDANG" : "KLINIK"));
  const [source, setSource] = useState<Source>(sources[0]?.key ?? "gudang");
  const [period, setPeriod] = useState<Period>("bulan");
  const [custom, setCustom] = useState(() => periodRange("bulan", { from: "", to: "" }));
  const [data, setData] = useState<TopKeluar | null>(null);
  const [error, setError] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const range = periodRange(period, { from: custom.dateFrom, to: custom.dateTo });
  const codes = estates.map((e) => e.estate);
  const codesKey = codes.join(",");

  useEffect(() => {
    if (!sources.length) return;
    let stale = false;
    setData(null);
    setError(false);
    api
      .topKeluar({ source, estates: codes, sortBy: "trx", ...range })
      .then((d) => !stale && setData(d))
      .catch(() => !stale && setError(true));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, codesKey, range.dateFrom, range.dateTo]);

  // Only a single estate has one page to jump to; Nilam's gudang items also have a detail page.
  const single = estates.length === 1 ? estates[0] : null;
  const linkFor = (r: TopKeluarRow) => {
    if (!single) return null;
    if (source === "gudang") return single.estate === "NILAM" && r.id ? `/inventory/${r.id}` : single.gudang;
    return single.klinik;
  };

  const rows = data?.rows ?? [];
  const chartData = rows.map((r) => ({ ...r, label: short(r.nama) }));
  const scope = single ? `Estate ${single.label}` : estates.length === 0 ? "" : `${estates.length} estate`;

  if (!sources.length) return null;

  return (
    <section className="min-w-0 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <TrendingUp size={16} className="text-[var(--accent-blue)]" />
            Top Barang Keluar
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            10 {source === "gudang" ? "barang gudang" : "obat klinik"} yang paling sering keluar
            {scope && ` · ${scope}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sources.length > 1 && <Segmented<Source> value={source} onChange={setSource} options={sources} />}
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
        </div>
      </div>

      {error ? (
        <div className="text-sm text-[var(--accent-red)]">Gagal memuat data</div>
      ) : data === null ? (
        <div className="text-sm text-[var(--text-muted)]">Memuat...</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)]">Tidak ada barang keluar pada periode ini</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5 items-start">
          <div className="lg:col-span-3 min-w-0" style={{ height: rows.length * 30 + 24 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
                <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={170} tick={{ fontSize: 11, fill: "#1a2634" }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "#e8f0fc" }}
                  content={({ active, payload }) => {
                    const r = active && (payload?.[0]?.payload as TopKeluarRow | undefined);
                    if (!r) return null;
                    return (
                      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md shadow px-3 py-2 text-xs">
                        <div className="font-medium text-[var(--text-primary)]">{r.nama}</div>
                        <div className="text-[var(--text-muted)]">{r.kode}</div>
                        <div className="mt-1">
                          Transaksi: <b>{fmt(r.trx)}</b>x
                        </div>
                        <div>
                          Qty keluar: {fmt(r.qty)} {r.satuan ?? ""}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="trx"
                  radius={[0, 4, 4, 0]}
                  onMouseLeave={() => setHover(null)}
                  onMouseEnter={(_, i) => setHover(i)}
                  onClick={(_, i) => {
                    const to = linkFor(rows[i]);
                    if (to) navigate(to);
                  }}
                  style={{ cursor: single ? "pointer" : "default" }}
                >
                  {chartData.map((r, i) => (
                    <Cell key={r.kode} fill={hover === i ? BAR_HOVER : BAR} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="lg:col-span-2 min-w-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-secondary)] border-b border-[var(--border)]">
                  <th className="py-1.5 pr-2 font-medium w-6">#</th>
                  <th className="py-1.5 pr-2 font-medium">Barang</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Transaksi</th>
                  <th className="py-1.5 font-medium text-right">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r, i) => {
                  const to = linkFor(r);
                  return (
                    <tr key={r.kode} className={hover === i ? "bg-[var(--accent-blue-bg)]" : ""} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                      <td className="py-1.5 pr-2 text-[var(--text-muted)]">{i + 1}</td>
                      <td className="py-1.5 pr-2 max-w-0 w-full">
                        <div className="truncate" title={r.nama}>
                          {to ? (
                            <Link to={to} className="hover:text-[var(--accent-blue)] hover:underline">
                              {r.nama}
                            </Link>
                          ) : (
                            r.nama
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">{r.kode}</div>
                      </td>
                      <td className="py-1.5 pr-2 text-right whitespace-nowrap font-semibold">{fmt(r.trx)}x</td>
                      <td className="py-1.5 text-right whitespace-nowrap text-[var(--text-secondary)]">
                        {fmt(r.qty)} <span className="text-[10px] text-[var(--text-muted)]">{r.satuan ?? ""}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-[10px] text-[var(--text-muted)] mt-2">
              Total periode ini: {fmt(data.totalTrx)} transaksi keluar. Koreksi stok tidak dihitung.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
