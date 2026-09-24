import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Package, Fuel, Sprout, Stethoscope, AlertTriangle, XCircle, CalendarClock, ChevronRight, History, CheckCircle2 } from "lucide-react";
import { api, type ActivityLog, type BbmSummary, type KlinikSummary, type PupukSummary } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useEstateFilter } from "../hooks/useEstateFilter";
import { TopKeluarPanel } from "../components/TopKeluarPanel";

type GudangStat = { totalItems: number; totalStock: number; lowStock: number; outOfStock: number };

// One entry per estate with the page of each inventory it has.
const ESTATES = [
  { estate: "NILAM", label: "Nilam", gudang: "/inventory", bbm: "/inventory-bbm", pupuk: "/inventory-pupuk", klinik: "/inventory-klinik" },
  { estate: "KNS", label: "KNS", gudang: "/inventory-kns", bbm: "/inventory-bbm-kns", pupuk: "/inventory-pupuk-kns", klinik: "/inventory-klinik-kns" },
  { estate: "WJA", label: "WJA", gudang: "/inventory-wja", bbm: "/inventory-bbm-wja", pupuk: "/inventory-pupuk-wja", klinik: "/inventory-klinik-wja" },
  {
    estate: "ZAMRUD",
    label: "Zamrud",
    gudang: "/inventory-zamrud",
    bbm: "/inventory-bbm-zamrud",
    pupuk: "/inventory-pupuk-zamrud",
    klinik: "/inventory-klinik-zamrud",
  },
  { estate: "FIRUS", label: "Firus", gudang: "/inventory-firus", bbm: "/inventory-bbm-firus", pupuk: "/inventory-pupuk-firus", klinik: "/inventory-klinik-firus" },
];
type EstateInfo = (typeof ESTATES)[number];

const MODULE_LABEL: Record<ActivityLog["module"], string> = { BARANG: "Gudang", BBM: "BBM", PUPUK: "Pupuk NPK", KLINIK: "Klinik" };

// Postgres COUNT/SUM can arrive as strings, so coerce before formatting or comparing.
const fmt = (n: number | string | undefined) => Number(n ?? 0).toLocaleString("id-ID");
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const formatWaktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function Panel({ to, title, icon, children }: { to: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group flex flex-col min-w-0 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 hover:shadow-md hover:border-[var(--accent-blue-border)] transition"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
          {icon}
          {title}
        </div>
        <ChevronRight size={16} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)]" />
      </div>
      <div className="flex-1">{children}</div>
    </Link>
  );
}

function Figure({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone?: "green" | "red" | "negative" }) {
  const color =
    tone === "green" ? "text-[var(--accent-green)]" : tone === "red" || tone === "negative" ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]";
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--text-secondary)]">{label}</div>
      <div className={`font-semibold ${color}`}>
        {value}
        {suffix && <span className="text-[11px] font-normal text-[var(--text-muted)] ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

// Status counts always carry an icon + label, not colour alone.
function StatusCount({ kind, count }: { kind: "menipis" | "habis" | "expired"; count: number }) {
  const Icon = kind === "menipis" ? AlertTriangle : kind === "habis" ? XCircle : CalendarClock;
  const tone =
    Number(count) === 0
      ? "text-[var(--text-muted)] border-[var(--border)]"
      : kind === "menipis"
        ? "text-[var(--accent-amber)] border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)]"
        : "text-[var(--accent-red)] border-[var(--accent-red-border)] bg-[var(--accent-red-bg)]";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${tone}`}>
      <Icon size={12} />
      {fmt(count)} {kind === "expired" ? "expired/segera" : kind}
    </span>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <div className="text-sm text-[var(--text-muted)]">{children}</div>;

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="h-full flex flex-col justify-center gap-1">
      <Muted>{text}</Muted>
      <div className="text-xs text-[var(--accent-blue)]">Buka untuk mulai input →</div>
    </div>
  );
}

type EstateData = { gudang?: GudangStat | null; bbm?: BbmSummary | null; pupuk?: PupukSummary | null; klinik?: KlinikSummary | null };

// The four inventory cards of one estate, side by side.
function EstateRow({ e, d, monthLabel }: { e: EstateInfo; d: EstateData; monthLabel: string }) {
  const loading = (v: unknown) => v === undefined;
  const failed = (v: unknown) => v === null;
  const bbmSaldo = (jenis: string) => d.bbm?.saldoTerakhir.find((x) => x.jenis_bbm === jenis && x.lokasi === e.estate)?.saldo_stock ?? 0;
  const bbmFlow = (jenis: string) => d.bbm?.perLokasi.find((x) => x.jenis_bbm === jenis && x.lokasi === e.estate);
  const bbmEmpty = d.bbm && (["SOLAR", "BENSIN"] as const).every((j) => !Number(bbmSaldo(j)) && !bbmFlow(j));
  const pupukJenis = d.pupuk ? Array.from(new Set(d.pupuk.saldoTerakhir.map((x) => x.jenis_pupuk))) : [];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Panel to={e.gudang} title="Gudang" icon={<Package size={16} className="text-[var(--accent-blue)]" />}>
        {loading(d.gudang) ? (
          <Muted>Memuat...</Muted>
        ) : failed(d.gudang) ? (
          <Muted>Gagal memuat data</Muted>
        ) : Number(d.gudang!.totalItems) === 0 ? (
          <EmptyCard text="Belum ada barang di gudang" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Figure label="Item barang" value={fmt(d.gudang!.totalItems)} />
              <Figure label="Stock tersedia" value={fmt(d.gudang!.totalStock)} />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <StatusCount kind="menipis" count={d.gudang!.lowStock} />
              <StatusCount kind="habis" count={d.gudang!.outOfStock} />
            </div>
          </>
        )}
      </Panel>

      <Panel to={e.bbm} title="BBM" icon={<Fuel size={16} className="text-[var(--accent-amber)]" />}>
        {loading(d.bbm) ? (
          <Muted>Memuat...</Muted>
        ) : failed(d.bbm) ? (
          <Muted>Gagal memuat data</Muted>
        ) : bbmEmpty ? (
          <EmptyCard text="Belum ada data BBM" />
        ) : (
          <div className="space-y-3">
            {(["SOLAR", "BENSIN"] as const).map((jenis) => (
              <div key={jenis} className="grid grid-cols-3 gap-2">
                <Figure label={jenis === "SOLAR" ? "Solar" : "Bensin"} value={fmt(bbmSaldo(jenis))} suffix="LTR" />
                <Figure label="Masuk" value={fmt(bbmFlow(jenis)?.diterima)} tone="green" />
                <Figure label="Keluar" value={fmt(bbmFlow(jenis)?.pemakaian)} tone="red" />
              </div>
            ))}
            <div className="text-[11px] text-[var(--text-muted)]">Masuk/keluar {monthLabel}</div>
          </div>
        )}
      </Panel>

      <Panel to={e.pupuk} title="Pupuk NPK" icon={<Sprout size={16} className="text-[var(--accent-green)]" />}>
        {loading(d.pupuk) ? (
          <Muted>Memuat...</Muted>
        ) : failed(d.pupuk) ? (
          <Muted>Gagal memuat data</Muted>
        ) : pupukJenis.length === 0 ? (
          <EmptyCard text="Belum ada data pupuk" />
        ) : (
          <div className="space-y-3">
            {pupukJenis.map((j) => {
              const saldo = Number(d.pupuk!.saldoTerakhir.find((x) => x.jenis_pupuk === j)?.saldo_stock ?? 0);
              const flow = d.pupuk!.perJenis.find((x) => x.jenis_pupuk === j);
              return (
                <div key={j} className="grid grid-cols-3 gap-2">
                  <Figure label={j.replace(/^PUPUK /, "")} value={fmt(saldo)} suffix="KG" tone={saldo < 0 ? "negative" : undefined} />
                  <Figure label="Masuk" value={fmt(flow?.diterima)} tone="green" />
                  <Figure label="Keluar" value={fmt(flow?.keluar)} tone="red" />
                </div>
              );
            })}
            <div className="text-[11px] text-[var(--text-muted)]">Masuk/keluar {monthLabel}</div>
          </div>
        )}
      </Panel>

      <Panel to={e.klinik} title="Klinik" icon={<Stethoscope size={16} className="text-[var(--accent-blue)]" />}>
        {loading(d.klinik) ? (
          <Muted>Memuat...</Muted>
        ) : failed(d.klinik) ? (
          <Muted>Gagal memuat data</Muted>
        ) : Number(d.klinik!.totalItems) === 0 ? (
          <EmptyCard text="Belum ada obat di klinik" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Figure label="Item obat" value={fmt(d.klinik!.totalItems)} />
              <Figure label="Total stock" value={fmt(d.klinik!.totalStock)} />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <StatusCount kind="menipis" count={d.klinik!.lowStock} />
              <StatusCount kind="habis" count={d.klinik!.outOfStock} />
              <StatusCount kind="expired" count={d.klinik!.expiring} />
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

type AttentionGroup = { key: string; title: string; tone: "red" | "amber"; to: string; total: number; names: string[] };

// Single-estate view: what needs action (stock habis/menipis, obat expired, negative pupuk saldo).
function AttentionPanel({ e, d }: { e: EstateInfo; d: EstateData }) {
  const [groups, setGroups] = useState<AttentionGroup[] | null>(null);

  useEffect(() => {
    let stale = false;
    const pick = (res: { data: { nama: string }[]; total: number }) => ({ total: Number(res.total), names: res.data.map((r) => r.nama) });
    const gudang = (stock: string) =>
      e.estate === "NILAM"
        ? api.items({ stock, sortBy: "nama", page: 1, pageSize: 4 })
        : api.gudangStock({ gudang: e.estate, stock, sortBy: "nama", page: 1, pageSize: 4 });
    const klinik = (stock: string) =>
      api.klinikStock({ klinik: e.estate, stock, sortBy: stock === "expired" ? "expired_date" : "nama", page: 1, pageSize: 4 });
    Promise.all([gudang("habis"), gudang("menipis"), klinik("expired"), klinik("habis")])
      .then(([gh, gm, ke, kh]) => {
        if (stale) return;
        const list: AttentionGroup[] = [
          { key: "gh", title: "Gudang · stok habis", tone: "red", to: e.gudang, ...pick(gh) },
          { key: "gm", title: "Gudang · stok menipis", tone: "amber", to: e.gudang, ...pick(gm) },
          { key: "ke", title: "Klinik · expired / ≤ 30 hari", tone: "red", to: e.klinik, ...pick(ke) },
          { key: "kh", title: "Klinik · stok habis", tone: "amber", to: e.klinik, ...pick(kh) },
        ];
        setGroups(list.filter((g) => g.total > 0));
      })
      .catch(() => !stale && setGroups([]));
    return () => {
      stale = true;
    };
  }, [e.estate, e.gudang, e.klinik]);

  const negativePupuk = (d.pupuk?.saldoTerakhir ?? []).filter((x) => Number(x.saldo_stock) < 0);

  return (
    <section className="min-w-0 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4">
      <h3 className="flex items-center gap-2 font-semibold text-[var(--text-primary)] mb-3">
        <AlertTriangle size={16} className="text-[var(--accent-amber)]" /> Perlu Perhatian
      </h3>
      {groups === null ? (
        <Muted>Memuat...</Muted>
      ) : groups.length === 0 && negativePupuk.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-[var(--accent-green)]">
          <CheckCircle2 size={16} /> Semua aman, tidak ada stok habis, menipis, atau obat expired.
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {groups.map((g) => (
            <Link key={g.key} to={g.to} className="block py-2.5 first:pt-0 group">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-medium ${g.tone === "red" ? "text-[var(--accent-red)]" : "text-[var(--accent-amber)]"}`}>{g.title}</span>
                <span className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-primary)] whitespace-nowrap">
                  {fmt(g.total)} item <ChevronRight size={12} className="inline" />
                </span>
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                {g.names.join(" · ")}
                {g.total > g.names.length && ` · +${fmt(g.total - g.names.length)} lainnya`}
              </div>
            </Link>
          ))}
          {negativePupuk.length > 0 && (
            <Link to={e.pupuk} className="block py-2.5 group">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--accent-red)]">Pupuk NPK · saldo minus</span>
                <ChevronRight size={12} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)]" />
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                {negativePupuk.map((x) => `${x.jenis_pupuk.replace(/^PUPUK /, "")} ${fmt(x.saldo_stock)} KG`).join(" · ")}
              </div>
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

// Single-estate view: the latest changes across Gudang, BBM, Pupuk and Klinik.
function RecentActivity({ estate }: { estate: string }) {
  const [rows, setRows] = useState<ActivityLog[] | null>(null);

  useEffect(() => {
    let stale = false;
    const modules: ActivityLog["module"][] = ["BARANG", "BBM", "PUPUK", "KLINIK"];
    Promise.all(modules.map((module) => api.activityLog({ module, estate, page: 1, pageSize: 8 }).catch(() => ({ data: [] as ActivityLog[] }))))
      .then((res) => {
        if (stale) return;
        const all = res.flatMap((r) => r.data).sort((a, b) => b.created_at.localeCompare(a.created_at));
        setRows(all.slice(0, 8));
      })
      .catch(() => !stale && setRows([]));
    return () => {
      stale = true;
    };
  }, [estate]);

  return (
    <section className="min-w-0 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4">
      <h3 className="flex items-center gap-2 font-semibold text-[var(--text-primary)] mb-3">
        <History size={16} className="text-[var(--accent-blue)]" /> Aktivitas Terbaru
      </h3>
      {rows === null ? (
        <Muted>Memuat...</Muted>
      ) : rows.length === 0 ? (
        <Muted>Belum ada aktivitas</Muted>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <li key={`${r.module}-${r.id}`} className="py-2 first:pt-0 flex gap-3 text-sm">
              <span className="w-24 shrink-0 text-xs text-[var(--text-muted)] pt-0.5">{formatWaktu(r.created_at)}</span>
              <div className="min-w-0">
                <div className="truncate">
                  <span className="text-[10px] mr-1.5 px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-secondary)]">
                    {MODULE_LABEL[r.module]}
                  </span>
                  <span className="font-medium">{r.aksi}</span> <span className="text-[var(--text-secondary)]">{r.objek}</span>
                </div>
                <div className="text-xs text-[var(--text-muted)] truncate">
                  {r.nama || r.username}
                  {r.detail ? ` · ${r.detail}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Landing page after login, organised per estate: one row of Gudang/BBM/Pupuk/Klinik cards per estate.
// An estate account (or a superuser who picks one estate) also gets "Perlu Perhatian" and
// "Aktivitas Terbaru" for that estate. Each card links to its full inventory page.
export function DashboardPage() {
  const { user } = useAuth();
  const isSuperuser = user?.role === "superuser";
  const { picked: pickedRaw, setPicked: storePicked } = useEstateFilter();
  const allowedEstates = ESTATES.filter((e) => isSuperuser || user?.estate === e.estate);
  // Superuser can pick any subset of estates; the sidebar follows the same choice (useEstateFilter).
  const picked = pickedRaw.filter((code) => allowedEstates.some((e) => e.estate === code));
  const shown = isSuperuser && picked.length ? allowedEstates.filter((e) => picked.includes(e.estate)) : allowedEstates;
  const single = shown.length === 1 ? shown[0] : null;
  const shownKey = shown.map((e) => e.estate).join(",");

  const [data, setData] = useState<Record<string, EstateData>>({});

  const now = new Date();
  const monthRange = { dateFrom: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: localIso(now) };
  const monthLabel = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  // Load the summaries of the estates on screen; ones already loaded are kept.
  const loaded = useRef(new Set<string>());
  useEffect(() => {
    const put = (estate: string, key: keyof EstateData, v: unknown) =>
      setData((cur) => ({ ...cur, [estate]: { ...cur[estate], [key]: v } }));
    for (const { estate } of shown) {
      if (loaded.current.has(estate)) continue;
      loaded.current.add(estate);
      (estate === "NILAM" ? api.summary() : api.gudangStockSummary(estate))
        .then((s) => put(estate, "gudang", s))
        .catch(() => put(estate, "gudang", null));
      api.bbmSummary(estate, monthRange).then((s) => put(estate, "bbm", s)).catch(() => put(estate, "bbm", null));
      api.pupukSummary(estate, monthRange).then((s) => put(estate, "pupuk", s)).catch(() => put(estate, "pupuk", null));
      api.klinikSummary(estate).then((s) => put(estate, "klinik", s)).catch(() => put(estate, "klinik", null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, shownKey]);

  const setPicked = (codes: string[]) => storePicked(ESTATES.filter((e) => codes.includes(e.estate)).map((e) => e.estate));
  const toggleEstate = (code: string) =>
    setPicked(picked.includes(code) ? picked.filter((c) => c !== code) : [...picked, code]);

  const chip = (active: boolean) =>
    `text-sm px-3 py-1.5 rounded-full border ${
      active
        ? "bg-[var(--accent-blue)] text-white border-[var(--accent-blue)]"
        : "bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]"
    }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Dashboard{single && !isSuperuser ? ` - Estate ${single.label}` : ""}</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Selamat datang, {user?.nama || user?.username} ·{" "}
            {now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        {isSuperuser && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setPicked([])} className={chip(!picked.length)}>
              Semua Estate
            </button>
            {ESTATES.map((e) => (
              <button key={e.estate} onClick={() => toggleEstate(e.estate)} className={chip(picked.includes(e.estate))}>
                {e.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.map((e) => (
        <section key={e.estate} className="space-y-3">
          {isSuperuser && <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Estate {e.label}</h2>}
          <EstateRow e={e} d={data[e.estate] ?? {}} monthLabel={monthLabel} />
        </section>
      ))}

      <TopKeluarPanel estates={shown} />

      {single && (
        <div className="grid gap-3 lg:grid-cols-2 items-start">
          <AttentionPanel e={single} d={data[single.estate] ?? {}} />
          <RecentActivity estate={single.estate} />
        </div>
      )}
    </div>
  );
}
