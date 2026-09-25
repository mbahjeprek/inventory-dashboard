import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ChevronLeft, ChevronRight, LogIn, UserCheck, UserX, ArrowLeftRight } from "lucide-react";
import { api, type UserActivity } from "../lib/api";
import { ExportButtons } from "../components/ExportButtons";
import { MODULE_LABELS, type Module } from "../lib/access";
import type { TableReport } from "../lib/printTable";

// Categorical slots in fixed order (dataviz reference palette, light mode); "Lainnya" is neutral.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const OTHER = "#8a8984";
const TOP = SERIES.length;

type Preset = "7" | "14" | "30" | "bulan" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "7", label: "7 hari" },
  { key: "14", label: "14 hari" },
  { key: "30", label: "30 hari" },
  { key: "bulan", label: "Bulan ini" },
];

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s: string, n: number) => {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return localIso(d);
};
const daysBetween = (a: string, b: string) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000) + 1;
const shortDate = (s: string) => parseIso(s).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
const longDate = (s: string) => parseIso(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";

function presetRange(p: Preset): { from: string; to: string } {
  const today = localIso(new Date());
  if (p === "bulan") {
    const now = new Date();
    return { from: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  return { from: addDays(today, -(Number(p) - 1)), to: today };
}

type UserRow = UserActivity["users"][number] & {
  aksi: number;
  hari_aktif: number;
  stok_masuk: number;
  stok_keluar: number;
  koreksi: number;
  lainnya: number;
  login: number;
  modul: string;
  akses: string;
};

// "Super User", or "FIRUS · Gudang, BBM, Pupuk NPK" for an estate account.
function aksesLabel(u: UserActivity["users"][number]) {
  if (u.role === "superuser") return "Super User";
  const mods = u.modules ? u.modules.split(",").map((m) => MODULE_LABELS[m as Module] ?? m).join(", ") : "Semua modul";
  return `${u.estate} · ${mods}`;
}

function Tile({ icon, label, value, note, onClick }: { icon: ReactNode; label: string; value: string; note: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="text-left bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 enabled:hover:border-[var(--accent-blue-border)] enabled:hover:shadow-sm transition min-w-0"
    >
      <div className="w-8 h-8 rounded-md bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] flex items-center justify-center mb-3">{icon}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{label}</div>
      <div className="text-2xl font-semibold text-[var(--text-primary)] mt-0.5">{value}</div>
      <div className="text-xs text-[var(--text-muted)] mt-0.5">{note}</div>
    </button>
  );
}

// Superuser monitoring of who uses the system: actions (add/edit/delete/transactions, every
// module) and logins per account over a period, with the accounts that did nothing listed apart.
export function UserActivityPage() {
  const [preset, setPreset] = useState<Preset>("bulan");
  const [range, setRange] = useState(() => presetRange("bulan"));
  const [data, setData] = useState<UserActivity | null>(null);
  const [error, setError] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const tableRef = useRef<HTMLDivElement>(null);
  const idleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!range.from || !range.to || range.from > range.to) return;
    let stale = false;
    setError(false);
    api
      .userActivity(range.from, range.to)
      .then((d) => !stale && setData(d))
      .catch(() => !stale && setError(true));
    return () => {
      stale = true;
    };
  }, [range.from, range.to]);

  const pickPreset = (p: Preset) => {
    setPreset(p);
    setRange(presetRange(p));
  };
  // Previous / next period of the same length.
  const shift = (dir: -1 | 1) => {
    const len = daysBetween(range.from, range.to);
    setPreset("custom");
    setRange({ from: addDays(range.from, dir * len), to: addDays(range.to, dir * len) });
  };

  const days = daysBetween(range.from, range.to);

  const rows: UserRow[] = useMemo(() => {
    if (!data) return [];
    const per = new Map(data.perUser.map((p) => [p.user_id, p]));
    const log = new Map(data.logins.map((l) => [l.user_id, l.login]));
    return data.users
      .map((u) => {
        const p = per.get(u.id);
        const aksi = p?.aksi ?? 0;
        const mods = p
          ? ([
              ["Gudang", p.m_gudang],
              ["BBM", p.m_bbm],
              ["Pupuk NPK", p.m_pupuk],
              ["Klinik", p.m_klinik],
            ] as [string, number][])
              .filter(([, n]) => n > 0)
              .map(([m, n]) => `${m} ${fmt(n)}`)
              .join(" · ")
          : "";
        return {
          ...u,
          aksi,
          hari_aktif: p?.hari_aktif ?? 0,
          stok_masuk: p?.stok_masuk ?? 0,
          stok_keluar: p?.stok_keluar ?? 0,
          koreksi: p?.koreksi ?? 0,
          lainnya: aksi - (p?.stok_masuk ?? 0) - (p?.stok_keluar ?? 0) - (p?.koreksi ?? 0),
          login: log.get(u.id) ?? 0,
          modul: mods,
          akses: aksesLabel(u),
        };
      })
      .sort((a, b) => b.aksi - a.aksi || b.login - a.login || a.nama.localeCompare(b.nama));
  }, [data]);

  const active = rows.filter((r) => r.aksi > 0);
  const idle = rows.filter((r) => r.aksi === 0);
  const totalAksi = active.reduce((s, r) => s + r.aksi, 0);
  const totalStok = active.reduce((s, r) => s + r.stok_masuk + r.stok_keluar, 0);
  const totalLogin = rows.reduce((s, r) => s + r.login, 0);
  const loggedIn = rows.filter((r) => r.login > 0).length;

  // Daily actions: the most active users get a colored line each, the rest fold into "Lainnya".
  const top = active.slice(0, TOP);
  const topIds = new Set(top.map((r) => r.id));
  const hasOther = active.length > TOP;
  const chartData = useMemo(() => {
    const byDay = new Map<string, Record<string, number>>();
    for (let i = 0; i < days && i < 400; i++) byDay.set(addDays(range.from, i), {});
    for (const d of data?.daily ?? []) {
      const rec = byDay.get(d.tanggal);
      if (!rec) continue;
      const key = topIds.has(d.user_id) ? `u${d.user_id}` : "other";
      rec[key] = (rec[key] ?? 0) + d.aksi;
    }
    return [...byDay.entries()].map(([tanggal, rec]) => {
      const row: Record<string, number | string> = { tanggal };
      for (const r of top) row[`u${r.id}`] = rec[`u${r.id}`] ?? 0;
      if (hasOther) row.other = rec.other ?? 0;
      return row;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range.from, days]);
  const nameOf = (key: string) => (key === "other" ? `Lainnya (${active.length - TOP} user)` : top.find((r) => `u${r.id}` === key)?.nama ?? key);
  const toggle = (key: string) =>
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const buildReport = async (): Promise<TableReport> => ({
    title: "Log Aktivitas User",
    subtitle: [`Periode: ${longDate(range.from)} - ${longDate(range.to)}`, `${active.length} user aktif, ${idle.length} user tanpa aksi, ${fmt(totalAksi)} aksi`],
    landscape: true,
    columns: [
      { label: "Nama" },
      { label: "Username", nowrap: true },
      { label: "Akses" },
      { label: "Aksi", align: "right" },
      { label: "Hari Aktif", align: "right" },
      { label: "Stok Masuk", align: "right" },
      { label: "Stok Keluar", align: "right" },
      { label: "Koreksi", align: "right" },
      { label: "Edit/Tambah/Hapus", align: "right" },
      { label: "Login", align: "right" },
      { label: "Rata-rata/Hari Aktif", align: "right" },
      { label: "Aksi Terakhir", nowrap: true },
      { label: "Login Terakhir", nowrap: true },
    ],
    rows: rows.map((r) => [
      r.nama,
      r.username,
      r.akses,
      r.aksi,
      r.hari_aktif,
      r.stok_masuk,
      r.stok_keluar,
      r.koreksi,
      r.lainnya,
      r.login,
      r.hari_aktif ? r.aksi / r.hari_aktif : 0,
      when(r.last_action),
      when(r.last_login),
    ]),
  });

  const chip = (on: boolean) =>
    `px-2.5 py-1 text-xs ${on ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`;
  const inputCls = "text-sm rounded-md border border-[var(--border)] px-2 py-1.5 bg-[var(--bg-card)]";
  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Log Aktivitas User</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Siapa yang aktif mengisi data (tambah, edit, hapus, transaksi di semua modul) dan siapa yang login, per periode.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] mr-1">Periode</span>
        <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => pickPreset(p.key)} className={chip(preset === p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => shift(-1)} title="Periode sebelumnya" className="p-1.5 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]">
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              setPreset("custom");
              setRange((r) => ({ ...r, from: e.target.value }));
            }}
            className={inputCls}
          />
          <span className="text-[var(--text-muted)] text-sm">s/d</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              setPreset("custom");
              setRange((r) => ({ ...r, to: e.target.value }));
            }}
            className={inputCls}
          />
          <button onClick={() => shift(1)} title="Periode berikutnya" className="p-1.5 rounded-md border border-[var(--border)] hover:bg-[#f1f5f9]">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <ExportButtons total={rows.length} buildReport={buildReport} fileName="log-aktivitas-user" />
        </div>
      </div>

      {error ? (
        <div className="text-sm text-[var(--accent-red)]">Gagal memuat data</div>
      ) : !data ? (
        <div className="text-sm text-[var(--text-muted)]">Memuat...</div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <Tile icon={<Activity size={16} />} label="Total Aksi" value={fmt(totalAksi)} note={`${days} hari`} onClick={() => scrollTo(tableRef)} />
            <Tile icon={<UserCheck size={16} />} label="User Aktif" value={fmt(active.length)} note={`dari ${rows.length} akun, klik untuk rincian`} onClick={() => scrollTo(tableRef)} />
            <Tile icon={<UserX size={16} />} label="User Tanpa Aksi" value={fmt(idle.length)} note="pada periode ini, klik untuk rincian" onClick={() => scrollTo(idleRef)} />
            <Tile icon={<ArrowLeftRight size={16} />} label="Transaksi Stok" value={fmt(totalStok)} note="stok masuk + stok keluar" />
            <Tile icon={<LogIn size={16} />} label="Login" value={fmt(totalLogin)} note={`${loggedIn} user pernah login di periode ini`} />
          </div>

          <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <h3 className="font-semibold text-[var(--text-primary)]">Aksi harian per user</h3>
              <span className="text-xs text-[var(--text-muted)]">
                {hasOther ? `${TOP} user teratas berwarna, ${active.length - TOP} lainnya digabung · ` : ""}klik nama di legenda untuk sembunyikan/tampilkan
              </span>
            </div>
            {active.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)] py-10 text-center">Belum ada aksi pada periode ini</div>
            ) : (
              <div className="h-72 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="tanggal" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} minTickGap={16} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip
                      cursor={{ stroke: "#94a3b8", strokeWidth: 1 }}
                      content={({ active: on, payload, label }) => {
                        if (!on || !payload?.length) return null;
                        const items = payload.filter((p) => Number(p.value) > 0).sort((a, b) => Number(b.value) - Number(a.value));
                        return (
                          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md shadow px-3 py-2 text-xs min-w-[160px]">
                            <div className="font-medium text-[var(--text-primary)] mb-1">{longDate(String(label))}</div>
                            {items.length === 0 ? (
                              <div className="text-[var(--text-muted)]">Tidak ada aksi</div>
                            ) : (
                              items.map((p) => (
                                <div key={String(p.dataKey)} className="flex items-center gap-2 py-0.5">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
                                  <span className="flex-1 text-[var(--text-secondary)] truncate">{nameOf(String(p.dataKey))}</span>
                                  <b className="text-[var(--text-primary)]">{fmt(Number(p.value))}</b>
                                </div>
                              ))
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend
                      onClick={(e) => toggle(String(e.dataKey))}
                      formatter={(value) => <span className="text-xs text-[var(--text-secondary)] cursor-pointer">{value}</span>}
                      wrapperStyle={{ paddingTop: 8 }}
                    />
                    {top.map((r, i) => (
                      <Line
                        key={r.id}
                        type="monotone"
                        dataKey={`u${r.id}`}
                        name={r.nama}
                        stroke={SERIES[i]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
                        hide={hidden.has(`u${r.id}`)}
                        isAnimationActive={false}
                      />
                    ))}
                    {hasOther && (
                      <Line
                        type="monotone"
                        dataKey="other"
                        name={nameOf("other")}
                        stroke={OTHER}
                        strokeDasharray="4 3"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
                        hide={hidden.has("other")}
                        isAnimationActive={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div className="grid gap-3 xl:grid-cols-3 items-start">
            <section ref={tableRef} className="xl:col-span-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden scroll-mt-4">
              <h3 className="font-semibold text-[var(--text-primary)] px-4 pt-4 pb-3">Rekap per user</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-secondary)] border-y border-[var(--border)] bg-[#f8fafc]">
                      <th className="px-4 py-2 font-medium">User</th>
                      <th className="px-3 py-2 font-medium text-right">Aksi</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Hari Aktif</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Stok Masuk</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Stok Keluar</th>
                      <th className="px-3 py-2 font-medium text-right">Koreksi</th>
                      <th className="px-3 py-2 font-medium text-right">Login</th>
                      <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Rata-rata/Hari</th>
                      <th className="px-4 py-2 font-medium whitespace-nowrap">Terakhir Aktif</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {active.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                          Belum ada user yang beraksi pada periode ini
                        </td>
                      </tr>
                    ) : (
                      active.map((r) => {
                        const i = top.findIndex((t) => t.id === r.id);
                        return (
                          <tr key={r.id} className="hover:bg-[#f8fafc]">
                            <td className="px-4 py-2.5 min-w-[200px]">
                              <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: i >= 0 ? SERIES[i] : OTHER }} />
                                {r.nama}
                              </div>
                              <div className="text-[11px] text-[var(--text-muted)] pl-[18px]">
                                {r.username} · {r.akses}
                              </div>
                              {r.modul && <div className="text-[11px] text-[var(--text-secondary)] pl-[18px]">{r.modul}</div>}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold">{fmt(r.aksi)}</td>
                            <td className="px-3 py-2.5 text-right">{fmt(r.hari_aktif)}</td>
                            <td className="px-3 py-2.5 text-right">{fmt(r.stok_masuk)}</td>
                            <td className="px-3 py-2.5 text-right">{fmt(r.stok_keluar)}</td>
                            <td className="px-3 py-2.5 text-right">{fmt(r.koreksi)}</td>
                            <td className="px-3 py-2.5 text-right">{fmt(r.login)}</td>
                            <td className="px-3 py-2.5 text-right">{fmt(r.hari_aktif ? r.aksi / r.hari_aktif : 0)}</td>
                            <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] whitespace-nowrap">{when(r.last_action)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section ref={idleRef} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 scroll-mt-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-[var(--text-primary)]">User tanpa aksi</h3>
                <span className="text-xs px-2 py-0.5 rounded-full border bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]">
                  {idle.length}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">Akun yang tidak mencatat satu aksi pun pada periode ini.</p>
              {idle.length === 0 ? (
                <div className="text-sm text-[var(--accent-green)]">Semua akun beraksi pada periode ini.</div>
              ) : (
                <ul className="divide-y divide-[var(--border)] xl:max-h-[480px] xl:overflow-y-auto xl:pr-1">
                  {idle.map((r) => (
                    <li key={r.id} className="py-2 first:pt-0">
                      <div className="text-sm font-medium text-[var(--text-primary)]">{r.nama}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {r.username} · {r.akses}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {r.login > 0
                          ? `Login ${r.login}x di periode ini, tapi belum input data`
                          : r.last_login
                            ? `Login terakhir ${when(r.last_login)}`
                            : "Belum pernah login"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
