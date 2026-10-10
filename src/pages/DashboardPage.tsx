import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Package, Fuel, Sprout, Stethoscope, Droplet, AlertTriangle, XCircle, CalendarClock, ChevronRight, History, CheckCircle2, HeartPulse } from "lucide-react";
import { api, type ActivityLog, type BbmSummary, type KlinikSummary, type LaporanKlinikSummary, type OliSummary, type PupukSummary } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useEstateFilter } from "../hooks/useEstateFilter";
import { canModule, MODULES, userEstates, type Module } from "../lib/access";
import { TopKeluarPanel } from "../components/TopKeluarPanel";
import { PerbandinganPanel } from "../components/PerbandinganPanel";
import { ExportButtons } from "../components/ExportButtons";
import type { ReportPart, ReportSection, SectionReport } from "../lib/printTable";

type ExportBuild = (() => ReportPart) | null;
type User = ReturnType<typeof useAuth>["user"];

type GudangStat = { totalItems: number; totalStock: number; lowStock: number; outOfStock: number };

// One entry per estate with the page of each inventory it has.
const ESTATES = [
  { estate: "NILAM", label: "Nilam", gudang: "/inventory", bbm: "/inventory-bbm", pupuk: "/inventory-pupuk", klinik: "/inventory-klinik", oli: "/inventory-oli" },
  { estate: "KNS", label: "KNS", gudang: "/inventory-kns", bbm: "/inventory-bbm-kns", pupuk: "/inventory-pupuk-kns", klinik: "/inventory-klinik-kns", oli: "/inventory-oli-kns" },
  { estate: "WJA", label: "WJA", gudang: "/inventory-wja", bbm: "/inventory-bbm-wja", pupuk: "/inventory-pupuk-wja", klinik: "/inventory-klinik-wja", oli: "/inventory-oli-wja" },
  {
    estate: "ZAMRUD",
    label: "Zamrud",
    gudang: "/inventory-zamrud",
    bbm: "/inventory-bbm-zamrud",
    pupuk: "/inventory-pupuk-zamrud",
    klinik: "/inventory-klinik-zamrud",
    oli: "/inventory-oli-zamrud",
  },
  { estate: "FIRUS", label: "Firus", gudang: "/inventory-firus", bbm: "/inventory-bbm-firus", pupuk: "/inventory-pupuk-firus", klinik: "/inventory-klinik-firus", oli: "/inventory-oli-firus" },
];
type EstateInfo = (typeof ESTATES)[number];

const MODULE_LABEL: Record<ActivityLog["module"], string> = { BARANG: "Gudang", BBM: "BBM", PUPUK: "Pupuk NPK", KLINIK: "Klinik", OLI: "Oli" };

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

type EstateData = {
  gudang?: GudangStat | null;
  bbm?: BbmSummary | null;
  pupuk?: PupukSummary | null;
  klinik?: KlinikSummary | null;
  oli?: OliSummary | null;
  // Klinik > Laporan Harian, this month.
  pasien?: LaporanKlinikSummary["totals"] | null;
};

// The inventory cards of one estate, side by side.
// An admin limited to some modules only gets those cards.
function EstateRow({ e, d, monthLabel }: { e: EstateInfo; d: EstateData; monthLabel: string }) {
  const { user } = useAuth();
  const can = (m: Module) => canModule(user, m);
  const loading = (v: unknown) => v === undefined;
  const failed = (v: unknown) => v === null;
  const bbmSaldo = (jenis: string) => d.bbm?.saldoTerakhir.find((x) => x.jenis_bbm === jenis && x.lokasi === e.estate)?.saldo_stock ?? 0;
  const bbmFlow = (jenis: string) => d.bbm?.perLokasi.find((x) => x.jenis_bbm === jenis && x.lokasi === e.estate);
  const bbmEmpty = d.bbm && (["SOLAR", "BENSIN"] as const).every((j) => !Number(bbmSaldo(j)) && !bbmFlow(j));
  const pupukJenis = d.pupuk ? Array.from(new Set(d.pupuk.saldoTerakhir.map((x) => x.jenis_pupuk))) : [];
  const oliJenis = d.oli ? Array.from(new Set([...d.oli.saldoTerakhir.map((x) => x.jenis_oli), ...d.oli.perJenis.map((x) => x.jenis_oli)])).sort() : [];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {can("GUDANG") && (
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
      )}

      {can("BBM") && (
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
      )}

      {can("PUPUK") && (
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
      )}

      {can("OLI") && (
      <Panel to={e.oli} title="Oli" icon={<Droplet size={16} className="text-[var(--accent-amber)]" />}>
        {loading(d.oli) ? (
          <Muted>Memuat...</Muted>
        ) : failed(d.oli) ? (
          <Muted>Gagal memuat data</Muted>
        ) : oliJenis.length === 0 ? (
          <EmptyCard text="Belum ada data oli" />
        ) : (
          <div className="space-y-3">
            {oliJenis.map((j) => {
              const saldo = Number(d.oli!.saldoTerakhir.find((x) => x.jenis_oli === j)?.saldo_stock ?? 0);
              const flow = d.oli!.perJenis.find((x) => x.jenis_oli === j);
              return (
                <div key={j} className="grid grid-cols-3 gap-2">
                  <Figure label={j} value={fmt(saldo)} suffix="LTR" tone={saldo < 0 ? "negative" : undefined} />
                  <Figure label="Masuk" value={fmt(flow?.diterima)} tone="green" />
                  <Figure label="Pakai" value={fmt(flow?.pemakaian)} tone="red" />
                </div>
              );
            })}
            <div className="text-[11px] text-[var(--text-muted)]">Stock In / Out {monthLabel}</div>
          </div>
        )}
      </Panel>
      )}

      {can("KLINIK") && (
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
      )}

      {can("KLINIK") && (
      <Panel to={`${e.klinik}?tab=laporan`} title="Pasien Klinik" icon={<HeartPulse size={16} className="text-[var(--accent-red)]" />}>
        {loading(d.pasien) ? (
          <Muted>Memuat...</Muted>
        ) : failed(d.pasien) ? (
          <Muted>Gagal memuat data</Muted>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Figure label="Kunjungan" value={fmt(d.pasien!.total)} suffix="pasien" />
              <Figure label="Kecelakaan kerja" value={fmt(d.pasien!.kecelakaan)} tone={d.pasien!.kecelakaan ? "red" : undefined} />
              <Figure label="Surat sakit" value={fmt(d.pasien!.istirahat)} suffix={`${fmt(d.pasien!.hari_istirahat)} hari`} />
              <Figure label="Rujukan" value={fmt(d.pasien!.rujukan)} />
            </div>
            <div className="text-[11px] text-[var(--text-muted)] mt-3">Laporan harian {monthLabel}</div>
          </>
        )}
      </Panel>
      )}
    </div>
  );
}

// Cetak / Excel of one estate's cards (EstateRow): one row per figure, with the same states
// (memuat / gagal / belum ada data) as the cards.
function estateSection(e: EstateInfo, d: EstateData, user: User, heading: string): ReportSection {
  const rows: ReportSection["rows"] = [];
  const n = (v: number | string | undefined) => Number(v ?? 0);
  // false = the card shows a message instead of figures (that message is the row).
  const ready = (modul: string, v: unknown, empty: () => boolean, emptyText: string) => {
    const msg = v === undefined ? "Memuat..." : v === null ? "Gagal memuat data" : empty() ? emptyText : "";
    if (msg) rows.push([modul, msg, "", "", "", "", ""]);
    return !msg;
  };
  const minus = (saldo: number) => (saldo < 0 ? "Saldo minus" : "");

  if (canModule(user, "GUDANG") && ready("Gudang", d.gudang, () => n(d.gudang!.totalItems) === 0, "Belum ada barang di gudang")) {
    const g = d.gudang!;
    rows.push(
      ["Gudang", "Item barang", n(g.totalItems), "item", "", "", ""],
      ["Gudang", "Stock tersedia", n(g.totalStock), "", "", "", ""],
      ["Gudang", "Stok menipis", n(g.lowStock), "item", "", "", ""],
      ["Gudang", "Stok habis", n(g.outOfStock), "item", "", "", ""]
    );
  }
  if (canModule(user, "BBM")) {
    const saldo = (j: string) => n(d.bbm?.saldoTerakhir.find((x) => x.jenis_bbm === j && x.lokasi === e.estate)?.saldo_stock);
    const flow = (j: string) => d.bbm?.perLokasi.find((x) => x.jenis_bbm === j && x.lokasi === e.estate);
    if (ready("BBM", d.bbm, () => ["SOLAR", "BENSIN"].every((j) => !saldo(j) && !flow(j)), "Belum ada data BBM"))
      for (const j of ["SOLAR", "BENSIN"])
        rows.push(["BBM", j === "SOLAR" ? "Solar" : "Bensin", saldo(j), "LTR", n(flow(j)?.diterima), n(flow(j)?.pemakaian), minus(saldo(j))]);
  }
  if (canModule(user, "PUPUK")) {
    const jenis = d.pupuk ? Array.from(new Set(d.pupuk.saldoTerakhir.map((x) => x.jenis_pupuk))) : [];
    if (ready("Pupuk NPK", d.pupuk, () => jenis.length === 0, "Belum ada data pupuk"))
      for (const j of jenis) {
        const saldo = n(d.pupuk!.saldoTerakhir.find((x) => x.jenis_pupuk === j)?.saldo_stock);
        const flow = d.pupuk!.perJenis.find((x) => x.jenis_pupuk === j);
        rows.push(["Pupuk NPK", j.replace(/^PUPUK /, ""), saldo, "KG", n(flow?.diterima), n(flow?.keluar), minus(saldo)]);
      }
  }
  if (canModule(user, "OLI")) {
    const jenis = d.oli ? Array.from(new Set([...d.oli.saldoTerakhir.map((x) => x.jenis_oli), ...d.oli.perJenis.map((x) => x.jenis_oli)])).sort() : [];
    if (ready("Oli", d.oli, () => jenis.length === 0, "Belum ada data oli"))
      for (const j of jenis) {
        const saldo = n(d.oli!.saldoTerakhir.find((x) => x.jenis_oli === j)?.saldo_stock);
        const flow = d.oli!.perJenis.find((x) => x.jenis_oli === j);
        rows.push(["Oli", j, saldo, "LTR", n(flow?.diterima), n(flow?.pemakaian), minus(saldo)]);
      }
  }
  if (canModule(user, "KLINIK")) {
    if (ready("Klinik", d.klinik, () => n(d.klinik!.totalItems) === 0, "Belum ada obat di klinik")) {
      const k = d.klinik!;
      rows.push(
        ["Klinik", "Item obat", n(k.totalItems), "item", "", "", ""],
        ["Klinik", "Total stock", n(k.totalStock), "", "", "", ""],
        ["Klinik", "Stok menipis", n(k.lowStock), "item", "", "", ""],
        ["Klinik", "Stok habis", n(k.outOfStock), "item", "", "", ""],
        ["Klinik", "Expired / segera expired", n(k.expiring), "item", "", "", ""]
      );
    }
    if (ready("Pasien Klinik", d.pasien, () => false, "")) {
      const p = d.pasien!;
      rows.push(
        ["Pasien Klinik", "Kunjungan", n(p.total), "pasien", "", "", ""],
        ["Pasien Klinik", "Kecelakaan kerja", n(p.kecelakaan), "", "", "", ""],
        ["Pasien Klinik", "Surat sakit", n(p.istirahat), "", "", "", `${fmt(p.hari_istirahat)} hari`],
        ["Pasien Klinik", "Rujukan", n(p.rujukan), "", "", "", ""]
      );
    }
  }
  return {
    heading,
    columns: [
      { label: "Modul", nowrap: true },
      { label: "Uraian" },
      { label: "Saldo / Jumlah", align: "right" },
      { label: "Satuan" },
      { label: "Masuk", align: "right" },
      { label: "Keluar / Pakai", align: "right" },
      { label: "Keterangan" },
    ],
    rows,
  };
}

// Registers a panel's Cetak / Excel builder with the Dashboard; the builder always reads the latest render.
function useExport(onExport: ((b: ExportBuild) => void) | undefined) {
  const buildRef = useRef<() => ReportPart>(() => ({ sections: [] }));
  useEffect(() => {
    if (!onExport) return;
    onExport(() => buildRef.current());
    return () => onExport(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return buildRef;
}

type AttentionGroup = { key: string; title: string; tone: "red" | "amber"; to: string; total: number; names: string[] };

// Single-estate view: what needs action (stock habis/menipis, obat expired, negative pupuk saldo).
function AttentionPanel({ e, d, onExport }: { e: EstateInfo; d: EstateData; onExport?: (b: ExportBuild) => void }) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<AttentionGroup[] | null>(null);
  const buildRef = useExport(onExport);

  useEffect(() => {
    let stale = false;
    const pick = (res: { data: { nama: string }[]; total: number }) => ({ total: Number(res.total), names: res.data.map((r) => r.nama) });
    // Modules this account can't open count as "nothing to report".
    const none = Promise.resolve({ data: [] as { nama: string }[], total: 0 });
    const gudang = (stock: string) =>
      !canModule(user, "GUDANG")
        ? none
        : e.estate === "NILAM"
        ? api.items({ stock, sortBy: "nama", page: 1, pageSize: 4 })
        : api.gudangStock({ gudang: e.estate, stock, sortBy: "nama", page: 1, pageSize: 4 });
    const klinik = (stock: string) =>
      !canModule(user, "KLINIK")
        ? none
        : api.klinikStock({ klinik: e.estate, stock, sortBy: stock === "expired" ? "expired_date" : "nama", page: 1, pageSize: 4 });
    // Loans of this estate (lent out or borrowed) that haven't fully come back yet.
    const pinjaman = api
      .pinjamanList({ estate: e.estate, status: "OPEN", pageSize: 4 })
      .then((res) => ({
        total: res.total,
        data: res.data.map((l) => ({
          nama: `${l.nama} ${(l.qty - l.qty_kembali).toLocaleString("id-ID", { maximumFractionDigits: 3 })} ${l.satuan} (${l.dari_estate} → ${l.ke_estate})`,
        })),
      }))
      .catch(() => ({ data: [] as { nama: string }[], total: 0 }));
    Promise.all([gudang("habis"), gudang("menipis"), klinik("expired"), klinik("habis"), pinjaman])
      .then(([gh, gm, ke, kh, pj]) => {
        if (stale) return;
        const list: AttentionGroup[] = [
          { key: "gh", title: "Gudang · stok habis", tone: "red", to: e.gudang, ...pick(gh) },
          { key: "gm", title: "Gudang · stok menipis", tone: "amber", to: e.gudang, ...pick(gm) },
          { key: "ke", title: "Klinik · expired / ≤ 30 hari", tone: "red", to: e.klinik, ...pick(ke) },
          { key: "kh", title: "Klinik · stok habis", tone: "amber", to: e.klinik, ...pick(kh) },
          { key: "pj", title: "Pinjaman belum kembali", tone: "amber", to: "/pinjaman", ...pick(pj) },
        ];
        setGroups(list.filter((g) => g.total > 0));
      })
      .catch(() => !stale && setGroups([]));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.estate, e.gudang, e.klinik, user?.id]);

  const negativePupuk = canModule(user, "PUPUK") ? (d.pupuk?.saldoTerakhir ?? []).filter((x) => Number(x.saldo_stock) < 0) : [];
  const negativeOli = canModule(user, "OLI") ? (d.oli?.saldoTerakhir ?? []).filter((x) => Number(x.saldo_stock) < 0) : [];

  buildRef.current = () => {
    const rows: ReportSection["rows"] =
      groups === null
        ? [["Memuat...", "", ""]]
        : groups.length === 0 && negativePupuk.length === 0 && negativeOli.length === 0
          ? [["Semua aman, tidak ada stok habis, menipis, atau obat expired.", "", ""]]
          : [
              ...groups.map((g) => [
                g.title,
                `${fmt(g.total)} item`,
                g.names.join(" · ") + (g.total > g.names.length ? ` · +${fmt(g.total - g.names.length)} lainnya` : ""),
              ]),
              ...(negativePupuk.length
                ? [["Pupuk NPK · saldo minus", "", negativePupuk.map((x) => `${x.jenis_pupuk.replace(/^PUPUK /, "")} ${fmt(x.saldo_stock)} KG`).join(" · ")]]
                : []),
              ...(negativeOli.length ? [["Oli · saldo minus", "", negativeOli.map((x) => `${x.jenis_oli} ${fmt(x.saldo_stock)} LTR`).join(" · ")]] : []),
            ];
    return {
      sections: [{ heading: "Perlu Perhatian", columns: [{ label: "Perhatian" }, { label: "Jumlah", align: "right", nowrap: true }, { label: "Rincian" }], rows }],
    };
  };

  return (
    <section className="min-w-0 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4">
      <h3 className="flex items-center gap-2 font-semibold text-[var(--text-primary)] mb-3">
        <AlertTriangle size={16} className="text-[var(--accent-amber)]" /> Perlu Perhatian
      </h3>
      {groups === null ? (
        <Muted>Memuat...</Muted>
      ) : groups.length === 0 && negativePupuk.length === 0 && negativeOli.length === 0 ? (
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
          {negativeOli.length > 0 && (
            <Link to={e.oli} className="block py-2.5 group">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--accent-red)]">Oli · saldo minus</span>
                <ChevronRight size={12} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)]" />
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">{negativeOli.map((x) => `${x.jenis_oli} ${fmt(x.saldo_stock)} LTR`).join(" · ")}</div>
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

// Single-estate view: the latest changes across Gudang, BBM, Pupuk, Oli and Klinik.
function RecentActivity({ estate, onExport }: { estate: string; onExport?: (b: ExportBuild) => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ActivityLog[] | null>(null);
  const buildRef = useExport(onExport);

  useEffect(() => {
    let stale = false;
    const modules = (["BARANG", "BBM", "PUPUK", "KLINIK", "OLI"] as ActivityLog["module"][]).filter((m) =>
      canModule(user, m === "BARANG" ? "GUDANG" : m)
    );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estate, user?.id]);

  buildRef.current = () => ({
    sections: [
      {
        heading: "Aktivitas Terbaru",
        columns: [{ label: "Waktu", nowrap: true }, { label: "Modul" }, { label: "Aksi" }, { label: "Objek" }, { label: "Oleh" }, { label: "Detail" }],
        rows:
          rows === null
            ? [["Memuat...", "", "", "", "", ""]]
            : rows.length === 0
              ? [["Belum ada aktivitas", "", "", "", "", ""]]
              : rows.map((r) => [formatWaktu(r.created_at), MODULE_LABEL[r.module], r.aksi, r.objek, r.nama || r.username, r.detail]),
      },
    ],
  });

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

// Landing page after login, organised per estate: one row of Gudang/BBM/Pupuk/Oli/Klinik cards per estate.
// An estate account (or a superuser who picks one estate) also gets "Perlu Perhatian" and
// "Aktivitas Terbaru" for that estate. Each card links to its full inventory page.
export function DashboardPage() {
  const { user } = useAuth();
  const { picked: pickedRaw, setPicked: storePicked } = useEstateFilter();
  const allowedEstates = ESTATES.filter((e) => userEstates(user).includes(e.estate));
  // An account with several estates can pick any subset of them; the sidebar follows the same
  // choice (useEstateFilter).
  const multiEstate = allowedEstates.length > 1;
  const picked = pickedRaw.filter((code) => allowedEstates.some((e) => e.estate === code));
  const shown = picked.length ? allowedEstates.filter((e) => picked.includes(e.estate)) : allowedEstates;
  const anyModule = MODULES.some((m) => canModule(user, m));
  const single = shown.length === 1 ? shown[0] : null;
  const shownKey = shown.map((e) => e.estate).join(",");

  const [data, setData] = useState<Record<string, EstateData>>({});
  // Ringkasan (cards per estate) or Perbandingan (estates side by side); remembered per browser.
  // Only an account with several estates has something to compare.
  const [tabPref, setTabPref] = useState<"ringkasan" | "perbandingan">(() => {
    try {
      return localStorage.getItem("dashboard.tab") === "perbandingan" ? "perbandingan" : "ringkasan";
    } catch {
      return "ringkasan";
    }
  });
  const tab = multiEstate && anyModule ? tabPref : "ringkasan";
  const pickTab = (t: "ringkasan" | "perbandingan") => {
    setTabPref(t);
    try {
      localStorage.setItem("dashboard.tab", t);
    } catch {
      // ignore
    }
  };

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
      if (canModule(user, "GUDANG"))
        (estate === "NILAM" ? api.summary() : api.gudangStockSummary(estate))
          .then((s) => put(estate, "gudang", s))
          .catch(() => put(estate, "gudang", null));
      if (canModule(user, "BBM")) api.bbmSummary(estate, monthRange).then((s) => put(estate, "bbm", s)).catch(() => put(estate, "bbm", null));
      if (canModule(user, "PUPUK")) api.pupukSummary(estate, monthRange).then((s) => put(estate, "pupuk", s)).catch(() => put(estate, "pupuk", null));
      if (canModule(user, "KLINIK")) api.klinikSummary(estate).then((s) => put(estate, "klinik", s)).catch(() => put(estate, "klinik", null));
      if (canModule(user, "KLINIK"))
        api.laporanKlinikTotals({ klinik: estate, ...monthRange }).then((s) => put(estate, "pasien", s.totals)).catch(() => put(estate, "pasien", null));
      if (canModule(user, "OLI")) api.oliSummary(estate, monthRange).then((s) => put(estate, "oli", s)).catch(() => put(estate, "oli", null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, shownKey]);

  // Cetak / Excel of the tab on screen. The panels with their own data (Top Barang Keluar,
  // Perbandingan, Perlu Perhatian, Aktivitas Terbaru) register a builder here.
  const parts = useRef<Record<string, ExportBuild>>({});
  const register = (key: string) => (b: ExportBuild) => {
    parts.current[key] = b;
  };
  const part = (key: string): ReportPart => parts.current[key]?.() ?? { sections: [] };
  const buildReport = async (): Promise<SectionReport> => {
    const title = `Dashboard${single && !multiEstate ? ` - Estate ${single.label}` : ""}`;
    if (tab === "perbandingan") {
      const p = part("perbandingan");
      return { title: `${title} - Perbandingan Pemakaian Antar Estate`, subtitle: p.subtitle, sections: p.sections, landscape: true };
    }
    return {
      title: `${title} - Ringkasan`,
      subtitle: [
        `Estate: ${shown.map((e) => e.label).join(", ")}`,
        `Saldo & stok per ${now.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} · masuk / keluar dan pasien klinik: ${monthLabel}`,
      ],
      sections: [
        ...shown.map((e) => estateSection(e, data[e.estate] ?? {}, user, `Estate ${e.label}`)),
        ...part("top").sections,
        ...(single ? [...part("attention").sections, ...part("recent").sections] : []),
      ],
      landscape: true,
    };
  };

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
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Dashboard{single && !multiEstate ? ` - Estate ${single.label}` : ""}</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Selamat datang, {user?.nama || user?.username} ·{" "}
            {now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        {anyModule && (
          <div className="flex flex-wrap items-center gap-2">
            {multiEstate && (
              <>
                <button onClick={() => setPicked([])} className={chip(!picked.length)}>
                  Semua Estate
                </button>
                {allowedEstates.map((e) => (
                  <button key={e.estate} onClick={() => toggleEstate(e.estate)} className={chip(picked.includes(e.estate))}>
                    {e.label}
                  </button>
                ))}
              </>
            )}
            <ExportButtons total={0} buildReport={buildReport} fileName={`dashboard-${tab}`} />
          </div>
        )}
      </div>

      {multiEstate && anyModule && (
        <div className="flex gap-1 border-b border-[var(--border)] -mt-2">
          {(
            [
              ["ringkasan", "Ringkasan"],
              ["perbandingan", "Perbandingan"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => pickTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === key
                  ? "border-[var(--accent-blue)] text-[var(--accent-blue)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "perbandingan" && <PerbandinganPanel estates={shown} onExport={register("perbandingan")} />}

      {!anyModule && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 text-sm text-[var(--text-secondary)]">
          Akun ini tidak punya akses inventory. Buka menu di samping untuk halaman yang bisa diakses.
        </div>
      )}

      {tab === "ringkasan" && anyModule && shown.map((e) => (
        <section key={e.estate} className="space-y-3">
          {multiEstate && <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Estate {e.label}</h2>}
          <EstateRow e={e} d={data[e.estate] ?? {}} monthLabel={monthLabel} />
        </section>
      ))}

      {tab === "ringkasan" && anyModule && <TopKeluarPanel estates={shown} onExport={register("top")} />}

      {tab === "ringkasan" && anyModule && single && (
        <div className="grid gap-3 lg:grid-cols-2 items-start">
          <AttentionPanel e={single} d={data[single.estate] ?? {}} onExport={register("attention")} />
          <RecentActivity estate={single.estate} onExport={register("recent")} />
        </div>
      )}
    </div>
  );
}
