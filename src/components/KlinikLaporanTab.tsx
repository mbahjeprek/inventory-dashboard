import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BedDouble, ChevronLeft, ChevronRight, ClipboardList, Hospital, LayoutDashboard, Pencil, Plus, Search, Stethoscope, Table2, Trash2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errorText, type Kunjungan, type LaporanCount, type LaporanKlinikSummary } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { StatCard } from "./StatCard";
import { ExportButtons } from "./ExportButtons";
import { ConfirmDialog } from "./ConfirmDialog";
import { EvidenceLink } from "./EvidenceInput";
import { KunjunganModal } from "./KunjunganModal";
import { fetchAllRows, type ReportSection, type SectionReport, type TableReport } from "../lib/printTable";
import { MAX_TERAPI, hariOf, kodeTglOf, periodeOf, tglSheet, yaTidak } from "../lib/kunjungan";

const PAGE_SIZE = 50;
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
type Flag = "" | "kecelakaan" | "istirahat" | "rujukan" | "mcu";
const FLAG_LABEL: Record<Exclude<Flag, "">, string> = { kecelakaan: "Kecelakaan kerja", istirahat: "Surat sakit", rujukan: "Rujukan", mcu: "MCU" };
type View = "data" | "ringkasan";

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
  const y = now.getFullYear(),
    m = now.getMonth();
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

// Klinik > Laporan Harian of one clinic: the patient visits (entered here, the columns of the Daily
// Report sheet) and their KPI summary, for one period.
export function KlinikLaporanTab({ klinik }: { klinik: string }) {
  const { user } = useAuth();
  const canInput = can(user, "klinik.input");
  const canEdit = can(user, "klinik.edit");
  const canDelete = can(user, "klinik.delete");
  const P = useMemo(presets, []);
  const [view, setView] = useState<View>("data");
  const [preset, setPreset] = useState("bulan");
  const [dateFrom, setDateFrom] = useState(P[2].from);
  const [dateTo, setDateTo] = useState(P[2].to);
  const [summary, setSummary] = useState<LaporanKlinikSummary | null>(null);
  const [loadError, setLoadError] = useState("");
  const [allDiagnosis, setAllDiagnosis] = useState(false);
  const [rows, setRows] = useState<Kunjungan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [flag, setFlag] = useState<Flag>("");
  const [editing, setEditing] = useState<Kunjungan | null | "new">(null);
  const [deleting, setDeleting] = useState<Kunjungan | null>(null);
  const [actionError, setActionError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const range = { klinik, dateFrom, dateTo };
  useEffect(() => {
    if (view !== "ringkasan") return;
    setLoadError("");
    api
      .laporanKlinikSummary(range)
      .then(setSummary)
      .catch((e) => {
        setSummary(null);
        setLoadError(errorText(e, "Gagal memuat ringkasan"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, klinik, dateFrom, dateTo, reloadKey]);

  const listQuery = (p: number, ps: number) => ({ ...range, search, flag, page: p, pageSize: ps });
  useEffect(() => {
    if (view !== "data") return;
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
  }, [view, klinik, dateFrom, dateTo, search, flag, page, reloadKey]);
  useEffect(() => setPage(1), [klinik, dateFrom, dateTo, search, flag]);

  const pickPreset = (key: string) => {
    const p = P.find((x) => x.key === key)!;
    setPreset(key);
    setDateFrom(p.from);
    setDateTo(p.to);
  };

  // A KPI card opens its visits in Data Kunjungan.
  const flagCard = (f: Exclude<Flag, "">) => ({
    onClick: () => {
      setFlag(f);
      setView("data");
    },
    title: `Lihat daftar ${FLAG_LABEL[f].toLowerCase()}`,
  });

  const remove = async () => {
    if (!deleting) return;
    setActionError("");
    try {
      await api.deleteKunjungan(deleting.id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setActionError(errorText(e, "Gagal menghapus kunjungan"));
    } finally {
      setDeleting(null);
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
  const periodText = `${tgl(dateFrom)} - ${tgl(dateTo)}`;

  // Excel / Cetak: the Daily Report sheet's columns, in its order, oldest visit first.
  const buildReport = async (): Promise<TableReport> => {
    const all = (await fetchAllRows((p, ps) => api.laporanKlinikKunjungan(listQuery(p, ps)))).reverse();
    const terapiCols = Array.from({ length: MAX_TERAPI }, (_, i) => [{ label: `Terapi ${i + 1}` }, { label: `Qty ${i + 1}`, align: "right" as const }, { label: "Satuan" }]).flat();
    return {
      title: `Laporan Harian Pasien Klinik - Estate ${klinik}`,
      subtitle: [`Periode: ${periodText}`, ...(flag ? [`Filter: ${FLAG_LABEL[flag]}`] : []), ...(search ? [`Cari: "${search}"`] : [])],
      landscape: true,
      columns: [
        { label: "No", align: "right" },
        { label: "Periode" },
        { label: "Tanggal", nowrap: true },
        { label: "Kode tgl" },
        { label: "Hari" },
        { label: "Jenis Kunjungan" },
        { label: "Nama Pasien" },
        { label: "Jenis Kelamin L/P" },
        { label: "Tanggal Lahir", nowrap: true },
        { label: "Usia", align: "right" },
        { label: "Status Pasien" },
        { label: "Nama Yang Menanggung" },
        { label: "Jabatan" },
        { label: "Divisi" },
        { label: "Tempat Tinggal" },
        { label: "Asal Pasien Non PT AKSS" },
        { label: "Diagnosis" },
        { label: "Kecelakaan Kerja Y/N" },
        { label: "Istirahat" },
        { label: "Jumlah Hari Istirahat", align: "right" },
        { label: "Rujukan" },
        { label: "Provider" },
        ...terapiCols,
        { label: "Detail Kejadian" },
      ],
      rows: all.map((k) => [
        k.nomor,
        periodeOf(k.tanggal_iso),
        tglSheet(k.tanggal_iso),
        kodeTglOf(k.tanggal_iso),
        hariOf(k.tanggal_iso),
        k.jenis_kunjungan,
        k.nama_pasien,
        k.jenis_kelamin,
        tglSheet(k.tanggal_lahir_iso),
        k.usia,
        k.status_pasien,
        k.penanggung,
        k.jabatan,
        k.divisi,
        k.tempat_tinggal,
        k.asal_pasien,
        k.diagnosis,
        yaTidak(k.kecelakaan_kerja),
        yaTidak(k.istirahat),
        k.istirahat ? k.hari_istirahat : "",
        yaTidak(k.rujukan),
        k.provider,
        ...Array.from({ length: MAX_TERAPI }, (_, i) => {
          const o = k.obat[i];
          return o ? [o.nama_obat, o.qty, o.satuan] : ["", "", ""];
        }).flat(),
        k.detail_kejadian,
      ]),
    };
  };

  // Cetak / Excel of Ringkasan KPI: the same figures and lists as on screen, in the same order.
  const buildKpiReport = async (): Promise<SectionReport> => {
    if (!summary || !t) throw new Error("Ringkasan belum dimuat");
    const counts = (heading: string, label: string, rows: LaporanCount[], of: number): ReportSection => ({
      heading,
      columns: [{ label: "No", align: "right" }, { label }, { label: "Jumlah", align: "right" }, { label: "%", align: "right" }],
      rows: rows.map((r, i) => [i + 1, r.label, r.n, pct(r.n, of)]),
    });
    const diagnosis = allDiagnosis ? summary.diagnosis : summary.diagnosis.slice(0, 10);
    return {
      title: `Ringkasan KPI Klinik - Estate ${klinik}`,
      subtitle: [`Periode: ${periodText}`],
      sections: [
        {
          heading: "Ringkasan",
          columns: [{ label: "Indikator" }, { label: "Jumlah", align: "right" }, { label: "Keterangan" }],
          rows: [
            ["Total Kunjungan", t.total, t.hari ? `${fmt(t.total / t.hari)} / hari buka · ${fmt(t.pasien)} pasien` : "-"],
            ["Kecelakaan Kerja", t.kecelakaan, `${pct(t.kecelakaan, t.total)} dari kunjungan`],
            ["Surat Sakit", t.istirahat, `${fmt(t.hari_istirahat)} hari istirahat`],
            ["Rujukan", t.rujukan, `${pct(t.rujukan, t.total)} dari kunjungan`],
            ["MCU", t.mcu, `${pct(t.mcu, t.total)} dari kunjungan`],
          ],
        },
        {
          heading: trend.perBulan ? "Kunjungan per bulan" : "Kunjungan per hari",
          columns: [{ label: trend.perBulan ? "Bulan" : "Tanggal", nowrap: true }, { label: "Kunjungan", align: "right" }, { label: "Kecelakaan Kerja", align: "right" }],
          rows: trend.data.map((d) => [trend.perBulan ? d.label : tgl(d.key), d.n, d.kecelakaan]),
        },
        counts(
          allDiagnosis || summary.diagnosis.length <= 10 ? "Penyakit terbanyak" : `Penyakit terbanyak (10 teratas dari ${summary.diagnosis.length})`,
          "Penyakit",
          diagnosis,
          t.total
        ),
        counts("Pasien berdasarkan status", "Status Pasien", summary.status, t.total),
        counts("Jenis kunjungan", "Jenis Kunjungan", summary.jenis, t.total),
        counts(
          "Jenis kelamin",
          "Jenis Kelamin",
          summary.kelamin.map((r) => ({ ...r, label: r.label === "L" ? "Laki-laki" : r.label === "P" ? "Perempuan" : r.label })),
          t.total
        ),
        counts("Kunjungan per divisi", "Divisi", summary.divisi, t.total),
        counts("Rujukan per provider", "Provider", summary.provider, t.rujukan),
        {
          heading: "Obat terbanyak diberikan",
          columns: [{ label: "No", align: "right" }, { label: "Obat / Alat" }, { label: "Pasien", align: "right" }, { label: "Jumlah", align: "right" }, { label: "Satuan" }],
          rows: summary.obat.map((o, i) => [i + 1, o.label, o.n, o.qty, o.satuan]),
        },
        {
          heading: `Kecelakaan kerja (${fmt(t.kecelakaan)})`,
          columns: [
            { label: "Tanggal", nowrap: true },
            { label: "Nama Pasien" },
            { label: "Jabatan" },
            { label: "Divisi" },
            { label: "Diagnosis" },
            { label: "Istirahat (hari)", align: "right" },
            { label: "Rujukan" },
            { label: "Detail Kejadian" },
          ],
          rows: summary.kecelakaanList.map((k) => [
            tgl(k.tanggal_iso),
            k.nama_pasien,
            k.jabatan,
            k.divisi,
            k.diagnosis,
            k.istirahat ? k.hari_istirahat : "",
            k.rujukan ? k.provider || "Ya" : "",
            k.detail_kejadian,
          ]),
        },
      ],
    };
  };

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const tab = (v: View, label: string, Icon: typeof Table2) => (
    <button
      onClick={() => setView(v)}
      className={`inline-flex items-center gap-1.5 text-sm px-3.5 py-2 ${view === v ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-secondary)] hover:bg-[#f1f5f9]"}`}
    >
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* One row: what to see, which period, and the actions. */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden" role="tablist">
          {tab("data", "Data Kunjungan", Table2)}
          {tab("ringkasan", "Ringkasan KPI", LayoutDashboard)}
        </div>
        <div className="inline-flex flex-wrap rounded-md border border-[var(--border)] overflow-hidden" role="group" aria-label="Periode">
          {P.map((p) => (
            <button
              key={p.key}
              onClick={() => pickPreset(p.key)}
              className={`text-xs px-3 py-2 border-r last:border-r-0 border-[var(--border)] ${preset === p.key ? "bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] font-medium" : "text-[var(--text-secondary)] hover:bg-[#f1f5f9]"}`}
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
        <div className="flex flex-wrap gap-2 ml-auto">
          {view === "data" && <ExportButtons total={total} buildReport={buildReport} fileName={`laporan-harian-klinik-${klinik.toLowerCase()}`} />}
          {view === "ringkasan" && summary && <ExportButtons total={0} buildReport={buildKpiReport} fileName={`ringkasan-kpi-klinik-${klinik.toLowerCase()}`} />}
          {canInput && (
            <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md font-medium bg-[var(--accent-blue)] text-white hover:opacity-90">
              <Plus size={16} /> Input Kunjungan
            </button>
          )}
        </div>
      </div>

      {loadError && <p className="text-sm text-[var(--accent-red)]">{loadError}</p>}
      {actionError && <p className="text-sm text-[var(--accent-red)]">{actionError}</p>}

      {view === "ringkasan" ? (
        <>
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
        </>
      ) : (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
          <div className="p-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
            <div className="relative flex-1 min-w-[12rem] max-w-md">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama pasien, diagnosis, divisi, jabatan..."
                className="w-full text-sm rounded-md border border-[var(--border)] pl-8 pr-3 py-1.5"
              />
            </div>
            <select value={flag} onChange={(e) => setFlag(e.target.value as Flag)} className="text-sm rounded-md border border-[var(--border)] px-2 py-1.5" aria-label="Filter">
              <option value="">Semua kunjungan</option>
              {(Object.keys(FLAG_LABEL) as Exclude<Flag, "">[]).map((k) => (
                <option key={k} value={k}>
                  {FLAG_LABEL[k]}
                </option>
              ))}
            </select>
            <span className="text-xs text-[var(--text-muted)] ml-auto">
              {fmt(total)} kunjungan · {periodText}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="grid-table data-table text-sm">
              <thead>
                <tr className="bg-[#f8fafc] text-[var(--text-secondary)] text-xs uppercase">
                  <th className="px-3 py-2.5 text-right">No</th>
                  <th className="px-3 py-2.5 text-left">Tanggal</th>
                  <th className="px-3 py-2.5 text-left">Jenis Kunjungan</th>
                  <th className="px-3 py-2.5 text-left">Pasien</th>
                  <th className="px-3 py-2.5 text-left">Status</th>
                  <th className="px-3 py-2.5 text-left">Jabatan / Divisi</th>
                  <th className="px-3 py-2.5 text-left">Tempat Tinggal / Asal</th>
                  <th className="px-3 py-2.5 text-left">Diagnosis</th>
                  <th className="px-3 py-2.5 text-left">Medis</th>
                  <th className="px-3 py-2.5 text-left">Terapi</th>
                  <th className="px-3 py-2.5 text-left">Dokumentasi</th>
                  {(canEdit || canDelete) && <th className="px-3 py-2.5 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-[var(--text-muted)]">
                      Belum ada kunjungan di periode ini
                    </td>
                  </tr>
                ) : (
                  rows.map((k) => (
                    <tr key={k.id} className="border-t border-[var(--border)] hover:bg-[#f8fafc] align-top">
                      <td className="px-3 py-2 text-right text-[var(--text-muted)]">{k.nomor}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {tgl(k.tanggal_iso)}
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {hariOf(k.tanggal_iso)} · {periodeOf(k.tanggal_iso)}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{k.jenis_kunjungan}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {k.nama_pasien}
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {[k.jenis_kelamin, k.usia !== null && `${k.usia} th`, k.tanggal_lahir_iso && `lahir ${tglSheet(k.tanggal_lahir_iso)}`].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">
                        {k.status_pasien}
                        {k.penanggung && <div className="text-[11px] text-[var(--text-muted)]">ditanggung {k.penanggung}</div>}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">
                        {k.jabatan || "-"}
                        {k.divisi && <div className="text-[11px] text-[var(--text-muted)]">{k.divisi}</div>}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">
                        {k.tempat_tinggal || "-"}
                        {k.asal_pasien && <div className="text-[11px] text-[var(--text-muted)]">{k.asal_pasien}</div>}
                      </td>
                      <td className="col-grow px-3 py-2">{k.diagnosis || "-"}</td>
                      <td className="px-3 py-2 text-xs">
                        <div className="flex flex-wrap gap-1">
                          {k.kecelakaan_kerja && <span className="px-1.5 py-0.5 rounded bg-[var(--accent-red-bg)] text-[var(--accent-red)]">Kecelakaan kerja</span>}
                          {k.istirahat && <span className="px-1.5 py-0.5 rounded bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]">Istirahat {k.hari_istirahat} hr</span>}
                          {k.rujukan && <span className="px-1.5 py-0.5 rounded bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]">Rujuk{k.provider ? `: ${k.provider}` : ""}</span>}
                          {!k.kecelakaan_kerja && !k.istirahat && !k.rujukan && <span className="text-[var(--text-muted)]">-</span>}
                        </div>
                      </td>
                      <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">
                        {k.obat.length
                          ? k.obat.map((o, i) => (
                              <div key={i}>
                                {o.nama_obat}
                                {o.qty !== null && <span className="text-[var(--text-muted)]"> {fmt(o.qty)} {o.satuan}</span>}
                              </div>
                            ))
                          : "-"}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                        {k.evidence_id && <EvidenceLink id={k.evidence_id} />}
                        {k.detail_kejadian && <div className="text-[11px] text-[var(--text-muted)] max-w-[16rem]">{k.detail_kejadian}</div>}
                        {!k.evidence_id && !k.detail_kejadian && "-"}
                      </td>
                      {(canEdit || canDelete) && (
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-1.5">
                            {canEdit && (
                              <button onClick={() => setEditing(k)} title="Edit kunjungan" className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                                <Pencil size={14} />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => setDeleting(k)}
                                title="Hapus kunjungan"
                                className="p-1.5 rounded-md border border-[var(--accent-red-border)] text-[var(--accent-red)] hover:bg-[var(--accent-red-bg)]"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
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
      )}

      {editing && <KunjunganModal klinik={klinik} kunjungan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => setReloadKey((k) => k + 1)} />}
      {deleting && (
        <ConfirmDialog
          title="Hapus kunjungan?"
          message={`${deleting.nama_pasien} · ${tgl(deleting.tanggal_iso)}${deleting.diagnosis ? ` · ${deleting.diagnosis}` : ""}. Data kunjungan ini dihapus dari laporan.`}
          confirmLabel="Ya, Hapus"
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
