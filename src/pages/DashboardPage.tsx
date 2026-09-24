import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Package, Fuel, AlertTriangle, XCircle, ChevronRight } from "lucide-react";
import { api, type BbmSummary } from "../lib/api";
import { useAuth } from "../context/AuthContext";

type GudangStat = { totalItems: number; totalStock: number; lowStock: number; outOfStock: number };

const GUDANG = [
  { estate: "NILAM", label: "Nilam", to: "/inventory" },
  { estate: "KNS", label: "KNS", to: "/inventory-kns" },
  { estate: "WJA", label: "WJA", to: "/inventory-wja" },
  { estate: "ZAMRUD", label: "Zamrud", to: "/inventory-zamrud" },
  { estate: "FIRUS", label: "Firus", to: "/inventory-firus" },
];

const BBM = [
  { estate: "NILAM", label: "Nilam", to: "/inventory-bbm" },
  { estate: "KNS", label: "KNS", to: "/inventory-bbm-kns" },
  { estate: "WJA", label: "WJA", to: "/inventory-bbm-wja" },
  { estate: "ZAMRUD", label: "Zamrud", to: "/inventory-bbm-zamrud" },
  { estate: "FIRUS", label: "Firus", to: "/inventory-bbm-firus" },
];

// Postgres COUNT/SUM can arrive as strings, so coerce before formatting or comparing.
const fmt = (n: number | string | undefined) => Number(n ?? 0).toLocaleString("id-ID");

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Panel({ to, title, icon, children }: { to: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group block bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 hover:shadow-md hover:border-[var(--accent-blue-border)] transition"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
          {icon}
          {title}
        </div>
        <ChevronRight size={16} className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)]" />
      </div>
      {children}
    </Link>
  );
}

function Figure({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone?: "green" | "red" }) {
  const color = tone === "green" ? "text-[var(--accent-green)]" : tone === "red" ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]";
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
function StatusCount({ kind, count }: { kind: "menipis" | "habis"; count: number }) {
  const Icon = kind === "menipis" ? AlertTriangle : XCircle;
  const tone =
    Number(count) === 0
      ? "text-[var(--text-muted)] border-[var(--border)]"
      : kind === "menipis"
        ? "text-[var(--accent-amber)] border-[var(--accent-amber-border)] bg-[var(--accent-amber-bg)]"
        : "text-[var(--accent-red)] border-[var(--accent-red-border)] bg-[var(--accent-red-bg)]";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${tone}`}>
      <Icon size={12} />
      {fmt(count)} {kind === "menipis" ? "menipis" : "habis"}
    </span>
  );
}

// Landing page after login: one overview panel per inventory (Gudang per estate, BBM per lokasi),
// limited to the estates this account can open. Each panel links to its full inventory page.
export function DashboardPage() {
  const { user } = useAuth();
  const allowed = (estate: string) => user?.role === "superuser" || user?.estate === estate;
  const gudangList = GUDANG.filter((g) => allowed(g.estate));
  const bbmList = BBM.filter((b) => allowed(b.estate));

  const [gudang, setGudang] = useState<Record<string, GudangStat | null>>({});
  const [bbm, setBbm] = useState<Record<string, BbmSummary | null>>({});

  const now = new Date();
  const monthRange = { dateFrom: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: localIso(now) };
  const monthLabel = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  useEffect(() => {
    for (const g of gudangList) {
      const req = g.estate === "NILAM" ? api.summary() : api.gudangStockSummary(g.estate);
      req.then((s) => setGudang((cur) => ({ ...cur, [g.estate]: s }))).catch(() => setGudang((cur) => ({ ...cur, [g.estate]: null })));
    }
    for (const b of bbmList) {
      api
        .bbmSummary(b.estate, monthRange)
        .then((s) => setBbm((cur) => ({ ...cur, [b.estate]: s })))
        .catch(() => setBbm((cur) => ({ ...cur, [b.estate]: null })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const grid = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Dashboard</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Selamat datang, {user?.nama || user?.username} ·{" "}
          {now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {gudangList.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Inventory Gudang</h2>
          <div className={grid}>
            {gudangList.map((g) => {
              const s = gudang[g.estate];
              return (
                <Panel key={g.estate} to={g.to} title={`Gudang ${g.label}`} icon={<Package size={16} className="text-[var(--accent-blue)]" />}>
                  {s === undefined ? (
                    <div className="text-sm text-[var(--text-muted)]">Memuat...</div>
                  ) : s === null ? (
                    <div className="text-sm text-[var(--text-muted)]">Gagal memuat data</div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Figure label="Total item barang" value={fmt(s.totalItems)} />
                        <Figure label="Total stock tersedia" value={fmt(s.totalStock)} />
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <StatusCount kind="menipis" count={s.lowStock} />
                        <StatusCount kind="habis" count={s.outOfStock} />
                      </div>
                    </>
                  )}
                </Panel>
              );
            })}
          </div>
        </section>
      )}

      {bbmList.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Inventory BBM <span className="normal-case font-normal text-[var(--text-muted)]">· masuk/keluar {monthLabel}</span>
          </h2>
          <div className={grid}>
            {bbmList.map((b) => {
              const s = bbm[b.estate];
              const saldo = (jenis: string) => s?.saldoTerakhir.find((x) => x.jenis_bbm === jenis && x.lokasi === b.estate)?.saldo_stock ?? 0;
              const flow = (jenis: string) => s?.perLokasi.find((x) => x.jenis_bbm === jenis && x.lokasi === b.estate);
              return (
                <Panel key={b.estate} to={b.to} title={`BBM ${b.label}`} icon={<Fuel size={16} className="text-[var(--accent-amber)]" />}>
                  {s === undefined ? (
                    <div className="text-sm text-[var(--text-muted)]">Memuat...</div>
                  ) : s === null ? (
                    <div className="text-sm text-[var(--text-muted)]">Gagal memuat data</div>
                  ) : (
                    <div className="space-y-3">
                      {(["SOLAR", "BENSIN"] as const).map((jenis) => (
                        <div key={jenis} className="grid grid-cols-3 gap-3">
                          <Figure label={`Stok ${jenis === "SOLAR" ? "Solar" : "Bensin"}`} value={fmt(saldo(jenis))} suffix="LTR" />
                          <Figure label="Masuk" value={fmt(flow(jenis)?.diterima)} tone="green" />
                          <Figure label="Keluar" value={fmt(flow(jenis)?.pemakaian)} tone="red" />
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
