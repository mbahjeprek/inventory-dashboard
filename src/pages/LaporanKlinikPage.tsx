import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BedDouble, ChevronLeft, ChevronRight, ClipboardList, ExternalLink, Hospital, RefreshCw, Search, Stethoscope, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errorText, ESTATES, type Kunjungan, type LaporanCount, type LaporanKlinikSummary } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can, userEstates } from "../lib/access";
import { StatCard } from "../components/StatCard";
import { ExportButtons } from "../components/ExportButtons";
import { fetchAllRows, type TableReport } from "../lib/printTable";
import { tanggalWaktu } from "../lib/datetime";

const PAGE_SIZE = 50;
const LABEL: Record<string, string> = { NILAM: "Nilam", KNS: "KNS", WJA: "WJA", ZAMRUD: "Zamrud", FIRUS: "Firus" };
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
type Flag = "" | "kecelakaan" | "istirahat" | "rujukan" | "mcu";
const FLAG_LABEL: Record<Exclude<Flag, "">, string> = { kecelakaan: "Kecelakaan kerja", istirahat: "Surat sakit", rujukan: "Rujukan", mcu: "MCU" };

// Local (Jakarta) dates as YYYY-MM-DD.
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tgl = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};
const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
const pct = (n: number, of: number) => (of ? `${fmt((n / of) * 100)}%` : "0%");

function presets() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const today = isoLocal(now);
  return [
    { key: "hari", label: "Hari ini", from: today, to: today },
    { key: "7", label: "7 hari", from: isoLocal(new Date(y, m, now.getDate() - 6)), to: today },
    { key: "bulan", label: "Bulan ini", from: isoLocal(new Date(y, m, 1)), to: today },
    { key: "lalu", label: "Bulan lalu", from: isoLocal(new Date(y, m - 1, 1)), to: isoLocal(new Date(y, m, 0)) },
    { key: "tahun", label: "Tahun ini", from: `${y}-01-01`, to: today },
  ];
}

// One ranked list (penyakit, status, divisi, ...): label, a bar scaled to the largest, count and share.
function BarList({ rows, total, limit, empty = "Belum ada data" }: { rows: LaporanCount[]; total: number; limit?: number; empty?: string }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  const max = Math.max(1, ...shown.map((r) => r.n));
  if (!shown.length) return <p className="text-xs text-[var(--text-muted)] py-2">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {shown.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] sm:grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2 text-xs" title={`${r.label}: ${fmt(r.n)} (${pct(r.n, total)})`}>
          <span className="truncate text-[var(--text-primary)]">{r.label}</span>
          <span className="h-3.5 rounded bg-[#f1f5f9] overflow-hidden">
            <span className="block h-full rounded bg-[var(--accent-blue)]" style={{ width: `${Math.max(2, (r.n / max) * 100)}%` }} />
          </span>
          <span className="tabular-nums text-right text-[var(--text-secondary)] w-[5.5rem]">
            <b className="text-[var(--text-primary)] font-medium">{fmt(r.n)}</b> · {pct(r.n, total)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

// Laporan Harian Klinik: the KPI dashboard over each clinic's Daily Report sheet (visits, diagnoses,
// kecelakaan kerja, surat sakit, rujukan, obat given) plus the visit list.
export function LaporanKlinikPage() {
  const { user } = useAuth();
  const kliniks = ESTATES.filter((e) => userEstates(user).includes(e));
  const canSync = can(user, "klinik.input");
  const isSuper = user?.role === "superuser";
  const P = useMemo(presets, []);
  const [klinik, setKlinik] = useState<string>(kliniks.length === 1 ? kliniks[0] : "NILAM");
  const [preset, setPreset] = useState("bulan");
  const [dateFrom, setDateFrom] = useState(P[2].from);
  const [dateTo, setDateTo] = useState(P[2].to);
  const [summary, setSummary] = useState<LaporanKlinikSummary | null>(null);
  const [loadError, setLoadError] = useState("");
  const [allDiagnosis, setAllDiagnosis] = useState(false);
  // Visit list
  const [rows, setRows] = useState<Kunjungan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [flag, setFlag] = useState<Flag>("");
  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editUrl, setEditUrl] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const range = { klinik, dateFrom, dateTo };
  useEffect(() => {
    setLoadError("");
    api
      .laporanKlinikSummary(range)
      .then(setSummary)
      .catch((e) => {
        setSummary(null);
        setLoadError(errorText(e, "Gagal memuat laporan"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klinik, dateFrom, dateTo, reloadKey]);

  const listQuery = (p: number, ps: number) => ({ ...range, search, flag, page: p, pageSize: ps });
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .laporanKlinikKunjungan(listQuery(page, PAGE_SIZE))
        .then((r) => {
          setRows(r.data);
          setTotal(r.total);
        })
        .catch(() => {
          setRows([]);
          setTotal(0);
        });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klinik, dateFrom, dateTo, search, flag, page, reloadKey]);
  useEffect(() => setPage(1), [klinik, dateFrom, dateTo, search, flag]);

  const pickPreset = (key: string) => {
    const p = P.find((x) => x.key === key)!;
    setPreset(key);
    setDateFrom(p.from);
    setDateTo(p.to);
  };

  const sumber = summary?.sumber.find((s) => s.klinik === klinik);
  const sync = async (url?: string) => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await api.syncLaporanKlinik({ klinik, url });
      setSyncMsg({ ok: true, text: `${fmt(r.rows)} kunjungan terbaca, data s/d ${tgl(r.last)}${r.skipped ? ` · ${r.skipped} baris dilewati` : ""}` });
      setEditUrl(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setSyncMsg({ ok: false, text: errorText(e, "Gagal sinkron") });
    } finally {
      setSyncing(false);
    }
  };

  // Visits per day for a range up to two months (days without visits shown as 0), per month beyond.
  const trend = useMemo(() => {
    if (!summary) return { data: [] as { key: string; label: string; n: number; kecelakaan: number }[], perBulan: false };
    const days = summary.perHari;
    const start = new Date(`${days[0]?.tanggal ?? dateFrom}T00:00:00`);
    const end = new Date(`${(dateTo > isoLocal(new Date()) ? isoLocal(new Date()) : dateTo) || days.at(-1)?.tanggal}T00:00:00`);
    const from = dateFrom > "0000-01-01" ? new Date(`${dateFrom}T00:00:00`) : start;
    const span = (end.getTime() - from.getTime()) / 86400000;
    const by = new Map(days.map((d) => [d.tanggal, d]));
    if (span <= 62) {
      const out = [];
      for (let d = new Date(from); d <= end; d.setDate(d.getDate() + 1)) {
        const k = isoLocal(d);
        out.push({ key: k, label: `${d.getDate()} ${BULAN[d.getMonth()]}`, n: by.get(k)?.n ?? 0, kecelakaan: by.get(k)?.kecelakaan ?? 0 });
      }
      return { data: out, perBulan: false };
    }
    const months = new Map<string, { key: string; label: string; n: number; kecelakaan: number }>();
    for (const d of days) {
      const k = d.tanggal.slice(0, 7);
      const m = months.get(k) ?? { key: k, label: `${BULAN[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`, n: 0, kecelakaan: 0 };
      m.n += d.n;
      m.kecelakaan += d.kecelakaan;
      months.set(k, m);
    }
    return { data: [...months.values()], perBulan: true };
  }, [summary, dateFrom, dateTo]);

  const t = summary?.totals;
  const klinikName = klinik ? `Klinik ${LABEL[klinik]}` : "Semua Klinik";
  const periodText = `${tgl(dateFrom)} - ${tgl(dateTo)}`;

  const buildReport = async (): Promise<TableReport> => {
    const all = await fetchAllRows((p, ps) => api.laporanKlinikKunjungan(listQuery(p, ps)));
    return {
      title: `Laporan Harian Pasien - ${klinikName}`,
      subtitle: [`Periode: ${periodText}`, ...(flag ? [`Filter: ${FLAG_LABEL[flag]}`] : []), ...(search ? [`Cari: "${search}"`] : [])],
      landscape: true,
      columns: [
        { label: "No", align: "right" },
        { label: "Tanggal", nowrap: true },
        { label: "Jenis Kunjungan" },
        { label: "Nama Pasien" },
        { label: "L/P" },
        { label: "Usia", align: "right" },
        { label: "Status" },
        { label: "Jabatan" },
        { label: "Divisi" },
        { label: "Diagnosis" },
        { label: "Kecelakaan Kerja" },
        { label: "Istirahat (hari)", align: "right" },
        { label: "Rujukan" },
        { label: "Obat" },
      ],
      rows: all.map((k, i) => [
        i + 1,
        tgl(k.tanggal_iso),
        k.jenis_kunjungan,
        k.nama_pasien,
        k.jenis_kelamin,
        k.usia,
        k.status_pasien,
        k.jabatan,
        k.divisi,
        k.diagnosis,
        k.kecelakaan_kerja ? "Ya" : "Tidak",
        k.istirahat ? k.hari_istirahat : "",
        k.rujukan ? k.provider || "Ya" : "",
        k.obat,
      ]),
    };
  };

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const flagCard = (f: Exclude<Flag, "">) => ({ onClick: () => setFlag(flag === f ? "" : f), active: flag === f, title: flag === f ? "Tampilkan semua kunjungan" : `Lihat daftar ${FLAG_LABEL[f].toLowerCase()}` });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Laporan Harian Klinik</h1>
          <p className="text-sm text-[var(--text-secondary)]">KPI klinik dari Daily Report pasien · {klinikName} · {periodText}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButtons total={total} buildReport={buildReport} fileName={`laporan-harian-klinik-${(klinik || "semua").toLowerCase()}`} />
        </div>
      </div>

      {/* Filters: one row above everything they affect. */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 flex flex-wrap items-center gap-2">
        <select value={klinik} onChange={(e) => setKlinik(e.target.value)} className="text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-[var(--bg-card)]" aria-label="Klinik">
          {kliniks.length > 1 && <option value="">Semua klinik</option>}
          {kliniks.map((k) => (
            <option key={k} value={k}>
              Klinik {LABEL[k]}
            </option>
          ))}
        </select>
        <div className="inline-flex flex-wrap rounded-md border border-[var(--border)] overflow-hidden" role="group" aria-label="Periode">
          {P.map((p) => (
            <button
              key={p.key}
              onClick={() => pickPreset(p.key)}
              className={`text-xs px-3 py-2 border-r last:border-r-0 border-[var(--border)] ${preset === p.key ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-secondary)] hover:bg-[#f1f5f9]"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPreset("");
            }}
            className="text-sm rounded-md border border-[var(--border)] px-2 py-1.5"
            aria-label="Dari tanggal"
          />
          <span className="text-[var(--text-muted)]">-</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPreset("");
            }}
            className="text-sm rounded-md border border-[var(--border)] px-2 py-1.5"
            aria-label="Sampai tanggal"
          />
        </div>
      </div>

      {/* Where the data comes from, and refreshing it. */}
      {klinik && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 text-xs flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[var(--text-secondary)]">
            Sumber: Google Sheet Daily Report{" "}
            {sumber ? (
              <>
                <a href={sumber.sheet_url} target="_blank" rel="noreferrer" className="text-[var(--accent-blue)] hover:underline inline-flex items-center gap-0.5">
                  buka <ExternalLink size={11} />
                </a>
                {" · "}terakhir sinkron {sumber.synced_at ? tanggalWaktu(null, sumber.synced_at) : "-"}
                {sumber.synced_by ? ` oleh ${sumber.synced_by}` : ""} ({fmt(sumber.synced_rows ?? 0)} kunjungan)
              </>
            ) : (
              <b className="text-[var(--accent-amber)]">belum diatur untuk Klinik {LABEL[klinik]}</b>
            )}
          </span>
          {editUrl !== null ? (
            <span className="flex flex-1 min-w-[16rem] gap-1.5">
              <input
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/.../edit?gid=..."
                className="flex-1 min-w-0 text-xs rounded-md border border-[var(--border)] px-2 py-1.5"
              />
              <button onClick={() => sync(editUrl)} disabled={syncing || !editUrl.trim()} className="px-3 rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-50">
                Simpan & sinkron
              </button>
              <button onClick={() => setEditUrl(null)} className="px-2 rounded-md border border-[var(--border)] text-[var(--text-muted)]" title="Batal">
                <X size={13} />
              </button>
            </span>
          ) : (
            <span className="flex gap-1.5">
              {canSync && sumber && (
                <button onClick={() => sync()} disabled={syncing} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[var(--accent-blue-border)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)] disabled:opacity-50">
                  <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> {syncing ? "Menyinkron..." : "Sinkron sekarang"}
                </button>
              )}
              {(isSuper || (canSync && !sumber)) && (
                <button onClick={() => setEditUrl(sumber?.sheet_url ?? "")} className="px-3 py-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                  {sumber ? "Ganti link" : "Atur link sheet"}
                </button>
              )}
            </span>
          )}
          {syncMsg && <span className={syncMsg.ok ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}>{syncMsg.text}</span>}
        </div>
      )}

      {loadError && <p className="text-sm text-[var(--accent-red)]">{loadError}</p>}

      {t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard
              label="Total Kunjungan"
              value={fmt(t.total)}
              icon={Stethoscope}
              footer={<span className="text-xs text-[var(--text-muted)]">{t.hari ? `${fmt(t.total / t.hari)} / hari buka · ${fmt(t.pasien)} pasien` : "-"}</span>}
            />
            <StatCard
              label="Kecelakaan Kerja"
              value={fmt(t.kecelakaan)}
              icon={AlertTriangle}
              tone="red"
              footer={<span className="text-xs text-[var(--text-muted)]">{pct(t.kecelakaan, t.total)} dari kunjungan</span>}
              {...flagCard("kecelakaan")}
            />
            <StatCard
              label="Surat Sakit"
              value={fmt(t.istirahat)}
              icon={BedDouble}
              tone="amber"
              footer={<span className="text-xs text-[var(--text-muted)]">{fmt(t.hari_istirahat)} hari istirahat</span>}
              {...flagCard("istirahat")}
            />
            <StatCard
              label="Rujukan"
              value={fmt(t.rujukan)}
              icon={Hospital}
              footer={<span className="text-xs text-[var(--text-muted)]">{pct(t.rujukan, t.total)} dari kunjungan</span>}
              {...flagCard("rujukan")}
            />
            <StatCard
              label="MCU"
              value={fmt(t.mcu)}
              icon={ClipboardList}
              tone="green"
              footer={<span className="text-xs text-[var(--text-muted)]">{pct(t.mcu, t.total)} dari kunjungan</span>}
              {...flagCard("mcu")}
            />
          </div>

          <Panel title={trend.perBulan ? "Kunjungan per bulan" : "Kunjungan per hari"}>
            {trend.data.length ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend.data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke="#e8edf3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={{ stroke: "#d5dde6" }} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5b6b7c" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip
                      cursor={{ fill: "#f1f5f9" }}
                      content={({ active, payload }) => {
                        const r = active && (payload?.[0]?.payload as (typeof trend.data)[number] | undefined);
                        if (!r) return null;
                        return (
                          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md shadow px-3 py-2 text-xs">
                            <div className="font-medium text-[var(--text-primary)]">{trend.perBulan ? r.label : tgl(r.key)}</div>
                            <div className="mt-1 text-[var(--text-secondary)]">
                              <b className="text-[var(--text-primary)]">{fmt(r.n)}</b> kunjungan
                            </div>
                            {r.kecelakaan > 0 && <div className="text-[var(--text-secondary)]">{fmt(r.kecelakaan)} kecelakaan kerja</div>}
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="n" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">Belum ada kunjungan di periode ini</p>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Penyakit terbanyak"
              right={
                summary.diagnosis.length > 10 && (
                  <button onClick={() => setAllDiagnosis((v) => !v)} className="text-xs text-[var(--accent-blue)] hover:underline">
                    {allDiagnosis ? "Top 10 saja" : `Semua (${summary.diagnosis.length})`}
                  </button>
                )
              }
            >
              <BarList rows={summary.diagnosis} total={t.total} limit={allDiagnosis ? undefined : 10} />
            </Panel>
            <div className="grid gap-4 content-start">
              <Panel title="Pasien berdasarkan status">
                <BarList rows={summary.status} total={t.total} />
              </Panel>
              <Panel title="Jenis kunjungan">
                <BarList rows={summary.jenis} total={t.total} />
              </Panel>
              <Panel title="Jenis kelamin">
                <BarList rows={summary.kelamin.map((r) => ({ ...r, label: r.label === "L" ? "Laki-laki" : r.label === "P" ? "Perempuan" : r.label }))} total={t.total} />
              </Panel>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Kunjungan per divisi">
              <BarList rows={summary.divisi} total={t.total} />
            </Panel>
            <Panel title="Rujukan per provider">
              <BarList rows={summary.provider} total={t.rujukan} empty="Tidak ada rujukan di periode ini" />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Obat terbanyak diberikan">
              {summary.obat.length ? (
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[var(--bg-card)]">
                      <tr className="text-left text-[var(--text-secondary)] border-b border-[var(--border)]">
                        <th className="py-1.5 pr-2 font-medium">Obat / Alat</th>
                        <th className="py-1.5 pr-2 font-medium text-right">Pasien</th>
                        <th className="py-1.5 font-medium text-right">Jumlah</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.obat.map((o) => (
                        <tr key={o.label} className="border-b border-[var(--border)] last:border-0">
                          <td className="py-1.5 pr-2 text-[var(--text-primary)]">{o.label}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(o.n)}</td>
                          <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
                            {fmt(o.qty)} <span className="text-[var(--text-muted)]">{o.satuan}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">Belum ada data obat</p>
              )}
            </Panel>
            <Panel title={`Kecelakaan kerja (${fmt(t.kecelakaan)})`}>
              {summary.kecelakaanList.length ? (
                <ul className="divide-y divide-[var(--border)] max-h-80 overflow-y-auto text-xs">
                  {summary.kecelakaanList.map((k, i) => (
                    <li key={i} className="py-2">
                      <div className="flex flex-wrap justify-between gap-x-2">
                        <span className="font-medium text-[var(--text-primary)]">
                          {k.nama_pasien} <span className="font-normal text-[var(--text-muted)]">· {[k.jabatan, k.divisi].filter(Boolean).join(", ")}</span>
                        </span>
                        <span className="text-[var(--text-muted)]">
                          {tgl(k.tanggal_iso)}
                          {!klinik && ` · ${LABEL[k.klinik]}`}
                        </span>
                      </div>
                      <div className="text-[var(--text-secondary)]">
                        {k.diagnosis || "-"}
                        {k.istirahat && ` · istirahat ${k.hari_istirahat} hari`}
                        {k.rujukan && ` · dirujuk${k.provider ? ` ke ${k.provider}` : ""}`}
                      </div>
                      {k.detail_kejadian && <div className="text-[var(--text-muted)] mt-0.5">{k.detail_kejadian}</div>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">Tidak ada kecelakaan kerja di periode ini</p>
              )}
            </Panel>
          </div>
        </>
      )}

      {/* Visit list */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mr-2 inline-flex items-center gap-1.5">
            <Activity size={15} className="text-[var(--accent-blue)]" /> Daftar kunjungan
          </h3>
          <div className="relative flex-1 min-w-[12rem] max-w-md">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama pasien, diagnosis, divisi, jabatan..."
              className="w-full text-sm rounded-md border border-[var(--border)] pl-8 pr-3 py-1.5"
            />
          </div>
          {flag && (
            <button onClick={() => setFlag("")} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border border-[var(--accent-blue-border)]">
              {FLAG_LABEL[flag]} <X size={12} />
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{fmt(total)} kunjungan</span>
        </div>
        <div className="overflow-x-auto">
          <table className="grid-table data-table text-sm">
            <thead>
              <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                <th className="px-3 py-2.5 text-left">Tanggal</th>
                {!klinik && <th className="px-3 py-2.5 text-left">Klinik</th>}
                <th className="px-3 py-2.5 text-left">Pasien</th>
                <th className="px-3 py-2.5 text-left">Status</th>
                <th className="px-3 py-2.5 text-left">Divisi / Jabatan</th>
                <th className="px-3 py-2.5 text-left">Kunjungan</th>
                <th className="px-3 py-2.5 text-left">Diagnosis</th>
                <th className="px-3 py-2.5 text-left">Keterangan</th>
                <th className="px-3 py-2.5 text-left">Obat</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    Tidak ada kunjungan
                  </td>
                </tr>
              ) : (
                rows.map((k) => (
                  <tr key={k.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc] align-top">
                    <td className="px-3 py-2 whitespace-nowrap">{tgl(k.tanggal_iso)}</td>
                    {!klinik && <td className="px-3 py-2">{LABEL[k.klinik]}</td>}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {k.nama_pasien}
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {[k.jenis_kelamin, k.usia !== null && `${k.usia} th`].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">
                      {k.status_pasien}
                      {k.penanggung && <div className="text-[11px] text-[var(--text-muted)]">dari {k.penanggung}</div>}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">
                      {k.divisi || "-"}
                      {k.jabatan && <div className="text-[11px] text-[var(--text-muted)]">{k.jabatan}</div>}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{k.jenis_kunjungan}</td>
                    <td className="px-3 py-2">{k.diagnosis || "-"}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {k.kecelakaan_kerja && <span className="px-1.5 py-0.5 rounded bg-[var(--accent-red-bg)] text-[var(--accent-red)]">Kecelakaan kerja</span>}
                        {k.istirahat && <span className="px-1.5 py-0.5 rounded bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]">Istirahat {k.hari_istirahat} hr</span>}
                        {k.rujukan && <span className="px-1.5 py-0.5 rounded bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]">Rujuk{k.provider ? `: ${k.provider}` : ""}</span>}
                      </div>
                      {k.detail_kejadian && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.detail_kejadian}</div>}
                    </td>
                    <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">{k.obat || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-sm text-[var(--text-secondary)]">
          <span>
            Halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40" aria-label="Halaman sebelumnya">
              <ChevronLeft size={16} />
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md border border-[var(--border)] disabled:opacity-40" aria-label="Halaman berikutnya">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
