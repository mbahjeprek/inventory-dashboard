import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, LayoutDashboard, List, Pencil, Plus, Search, Timer, Truck, Wrench, X } from "lucide-react";
import { api, errorText, type KdHarian, type KdUnit, type KdUnitInput } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";
import { StatCard } from "../components/StatCard";
import { ExportButtons } from "../components/ExportButtons";
import { ActivityLogButton } from "../components/ActivityLogButton";
import { isoDisplay, localToday } from "../lib/opname";

// Kendaraan & Alat Berat PT.AKSS: the units (internal = milik AKSS, eksternal = sewa dari kontraktor),
// their kondisi now (rusak / standby / mangkrak with the downtime since tgl_rusak) and the kondisi
// harian R / S / B of the internal units, with the availability per unit and per jenis.

type Tab = "dashboard" | "unit" | "harian";
const TABS: { key: Tab; label: string; icon: typeof List }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "unit", label: "Daftar Unit", icon: List },
  { key: "harian", label: "Kondisi Harian", icon: CalendarDays },
];
const ESTATES = ["NILAM", "ZAMRUD", "FIRUS"];
const KONDISI: Record<string, { label: string; cls: string }> = {
  BAIK: { label: "Baik", cls: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]" },
  RUSAK: { label: "Rusak", cls: "bg-[var(--accent-red-bg)] border-[var(--accent-red-border)] text-[var(--accent-red)]" },
  STANDBY: { label: "Standby", cls: "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]" },
  MANGKRAK: { label: "Mangkrak", cls: "bg-[#f1f5f9] border-[var(--border)] text-[var(--text-secondary)]" },
  "": { label: "Belum diisi", cls: "border-dashed border-[var(--border)] text-[var(--text-muted)]" },
};
const HARIAN: Record<string, string> = {
  R: "bg-[var(--accent-green-bg)] text-[var(--accent-green)]",
  S: "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]",
  B: "bg-[var(--accent-red-bg)] text-[var(--accent-red)]",
};
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const bulanLabel = (b: string) => `${BULAN[Number(b.slice(5, 7)) - 1] ?? ""} ${b.slice(0, 4)}`;
const inputCls = "w-full text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const selectCls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";
const labelCls = "text-xs text-[var(--text-secondary)] mb-1 block";
const btnPrimary = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50";
const btnOutline = "inline-flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-md border border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-[#f1f5f9]";
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const hariAntara = (dari: string, sampai: string) => Math.max(0, Math.round((Date.parse(sampai) - Date.parse(dari)) / 86400000));
// Downtime: days since it broke while not BAIK; for a repaired one, how long the repair took.
const downtime = (u: KdUnit) =>
  u.kondisi && u.kondisi !== "BAIK" && u.tgl_rusak ? hariAntara(u.tgl_rusak, localToday()) : u.kondisi === "BAIK" && u.tgl_rusak && u.tgl_selesai ? hariAntara(u.tgl_rusak, u.tgl_selesai) : null;
const durasiText = (d: number) => (d >= 30 ? `${Math.floor(d / 30)} bln ${d % 30} hari` : `${d} hari`);
const estateOf = (u: KdUnit) => (ESTATES.includes(u.alokasi) ? u.alokasi : "LAINNYA");

function Badge({ k }: { k: string }) {
  const s = KONDISI[k] ?? KONDISI[""];
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-2 sm:p-6 overflow-y-auto" onClick={onClose}>
      <div className={`bg-[var(--bg-card)] rounded-lg shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-lg"} mt-8`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">{title}</h3>
            {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} title="Tutup" className="p-1 rounded hover:bg-[#f1f5f9] text-[var(--text-muted)]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function KendaraanPage() {
  const { user } = useAuth();
  const canInput = can(user, "kendaraan.input");
  const canEdit = can(user, "kendaraan.edit");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [units, setUnits] = useState<KdUnit[] | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    api
      .kdUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, [reload]);
  const done = () => setReload((n) => n + 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Kendaraan & Alat Berat PT.AKSS</h1>
          <p className="text-sm text-[var(--text-secondary)]">Unit internal (milik AKSS) dan eksternal (sewa), kondisi, downtime dan kesiapan harian</p>
        </div>
        <ActivityLogButton module="KENDARAAN" estate="" />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm -mb-px border-b-2 ${
              tab === t.key ? "border-[var(--accent-blue)] text-[var(--accent-blue)] font-medium" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {units === null ? (
        <p className="text-sm text-[var(--text-muted)]">Memuat...</p>
      ) : tab === "dashboard" ? (
        <Dashboard units={units.filter((u) => u.aktif)} onUnit={() => setTab("unit")} />
      ) : tab === "unit" ? (
        <UnitTab units={units} canInput={canInput} canEdit={canEdit} onChanged={done} />
      ) : (
        <HarianTab units={units.filter((u) => u.aktif && u.status === "INTERNAL")} canInput={canInput} />
      )}
    </div>
  );
}

// ---- Dashboard: jumlah unit per jenis x estate, kondisi per jenis (availability) and the downtime list ----
function Dashboard({ units, onUnit }: { units: KdUnit[]; onUnit: () => void }) {
  const [status, setStatus] = useState<"" | "INTERNAL" | "EKSTERNAL">("INTERNAL");
  const list = units.filter((u) => !status || u.status === status);
  const jenis = [...new Set(list.map((u) => u.jenis))].sort();
  const count = (f: (u: KdUnit) => boolean) => list.filter(f).length;
  const baik = count((u) => u.kondisi === "BAIK");
  const rusak = count((u) => !!u.kondisi && u.kondisi !== "BAIK");
  const terisi = count((u) => !!u.kondisi);
  const estCols = [...ESTATES, ...(list.some((u) => estateOf(u) === "LAINNYA") ? ["LAINNYA"] : [])];
  const turun = list.filter((u) => u.kondisi && u.kondisi !== "BAIK").sort((a, b) => (downtime(b) ?? -1) - (downtime(a) ?? -1));
  const buildReport = async () => ({
    title: `Kendaraan & Alat Berat PT.AKSS - ${status ? (status === "INTERNAL" ? "Internal" : "Eksternal") : "Semua"}`,
    subtitle: [`Per ${isoDisplay(localToday())} · ${list.length} unit · Baik ${baik} · Rusak/Standby/Mangkrak ${rusak} · Availability ${pct(baik, terisi)}`],
    sections: [
      {
        heading: "Kondisi per jenis unit",
        columns: [{ label: "Jenis Unit" }, ...estCols.map((e) => ({ label: e, align: "right" as const })), { label: "Total", align: "right" as const }, { label: "Baik", align: "right" as const }, { label: "Rusak", align: "right" as const }, { label: "Standby", align: "right" as const }, { label: "Mangkrak", align: "right" as const }, { label: "Availability", align: "right" as const }],
        rows: jenis.map((j) => {
          const js = list.filter((u) => u.jenis === j);
          const b = js.filter((u) => u.kondisi === "BAIK").length;
          return [j, ...estCols.map((e) => js.filter((u) => estateOf(u) === e).length), js.length, b, ...["RUSAK", "STANDBY", "MANGKRAK"].map((k) => js.filter((u) => u.kondisi === k).length), pct(b, js.filter((u) => u.kondisi).length)];
        }),
      },
      {
        heading: "Downtime (unit tidak baik)",
        columns: [{ label: "Kode" }, { label: "Nama Unit" }, { label: "Jenis" }, { label: "Estate" }, { label: "Pemilik" }, { label: "Kondisi" }, { label: "Tgl Rusak" }, { label: "Downtime", align: "right" as const }, { label: "Keterangan" }],
        rows: turun.map((u) => [u.kode, u.nama, u.jenis, u.alokasi, u.pemilik, KONDISI[u.kondisi]?.label ?? "", u.tgl_rusak ? isoDisplay(u.tgl_rusak) : "", downtime(u) === null ? "" : `${downtime(u)} hari`, u.keterangan]),
      },
    ],
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["INTERNAL", "EKSTERNAL", ""] as const).map((s) => (
          <button key={s || "all"} onClick={() => setStatus(s)} className={`px-3 py-1.5 text-sm rounded-md border ${status === s ? "border-[var(--accent-blue)] bg-[#eef4ff] text-[var(--accent-blue)] font-medium" : "border-[var(--border)] bg-white text-[var(--text-secondary)]"}`}>
            {s === "INTERNAL" ? "Internal (milik AKSS)" : s === "EKSTERNAL" ? "Eksternal (sewa)" : "Semua"}
          </button>
        ))}
        <div className="ml-auto">
          <ExportButtons total={list.length} buildReport={buildReport} fileName={`kendaraan-akss-${status.toLowerCase() || "semua"}`} />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total unit" value={list.length} icon={Truck} tone="blue" onClick={onUnit} title="Buka Daftar Unit" footer={<span className="text-[11px] text-[var(--text-muted)]">{jenis.length} jenis unit</span>} />
        <StatCard label="Kondisi baik" value={baik} icon={CheckCircle2} tone="green" />
        <StatCard
          label="Rusak / standby / mangkrak"
          value={rusak}
          icon={Wrench}
          tone={rusak ? "red" : "green"}
          footer={<span className="text-[11px] text-[var(--text-muted)]">{list.length - terisi ? `${list.length - terisi} unit kondisinya belum diisi` : "semua unit sudah diisi kondisinya"}</span>}
        />
        <StatCard label="Availability" value={pct(baik, terisi)} icon={Timer} tone={terisi && baik / terisi >= 0.8 ? "green" : "amber"} footer={<span className="text-[11px] text-[var(--text-muted)]">baik / unit yang kondisinya diisi</span>} />
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
        <h2 className="px-4 py-3 text-sm font-semibold text-[var(--text-primary)] border-b border-[var(--border)]">Jumlah & kondisi per jenis unit</h2>
        <div className="table-scroll">
          <table className="data-table text-sm">
            <thead>
              <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
                <th className="px-3 py-2.5">Jenis Unit</th>
                {estCols.map((e) => (
                  <th key={e} className="px-3 py-2.5 text-right">
                    {e === "LAINNYA" ? "Lainnya" : e}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right">Total</th>
                <th className="px-3 py-2.5 text-right">Baik</th>
                <th className="px-3 py-2.5 text-right">Rusak</th>
                <th className="px-3 py-2.5 text-right">Standby</th>
                <th className="px-3 py-2.5 text-right">Mangkrak</th>
                <th className="px-3 py-2.5 text-right">Availability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {jenis.map((j) => {
                const js = list.filter((u) => u.jenis === j);
                const b = js.filter((u) => u.kondisi === "BAIK").length;
                const isi = js.filter((u) => u.kondisi).length;
                const n = (k: string) => js.filter((u) => u.kondisi === k).length || "";
                return (
                  <tr key={j}>
                    <td className="col-grow px-3 py-2 font-medium text-[var(--text-primary)]">{j}</td>
                    {estCols.map((e) => (
                      <td key={e} className="px-3 py-2 text-right">
                        {js.filter((u) => estateOf(u) === e).length || <span className="text-[var(--text-muted)]">-</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold">{js.length}</td>
                    <td className="px-3 py-2 text-right text-[var(--accent-green)]">{b || ""}</td>
                    <td className="px-3 py-2 text-right text-[var(--accent-red)]">{n("RUSAK")}</td>
                    <td className="px-3 py-2 text-right text-[var(--accent-amber)]">{n("STANDBY")}</td>
                    <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{n("MANGKRAK")}</td>
                    <td className={`px-3 py-2 text-right font-medium ${isi && b / isi < 0.8 ? "text-[var(--accent-red)]" : ""}`}>{isi ? pct(b, isi) : <span className="text-[var(--text-muted)] font-normal">belum diisi</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
        <h2 className="px-4 py-3 text-sm font-semibold text-[var(--text-primary)] border-b border-[var(--border)] flex items-center gap-2">
          <AlertTriangle size={15} className="text-[var(--accent-red)]" /> Downtime: unit tidak baik ({turun.length})
        </h2>
        <div className="table-scroll">
          <table className="data-table text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-secondary)]">
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Estate</th>
                <th className="px-3 py-2">Kondisi</th>
                <th className="px-3 py-2">Tgl rusak</th>
                <th className="px-3 py-2 text-right">Downtime</th>
                <th className="px-3 py-2">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {!turun.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Tidak ada unit yang rusak / standby / mangkrak.
                  </td>
                </tr>
              ) : (
                turun.map((u) => {
                  const d = downtime(u);
                  return (
                    <tr key={u.id} className="align-top">
                      <td className="px-3 py-2">
                        <div className="text-[var(--text-primary)]">{u.nama}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {u.kode} · {u.jenis}
                          {u.status === "EKSTERNAL" ? ` · ${u.pemilik}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{u.alokasi || "-"}</td>
                      <td className="px-3 py-2">
                        <Badge k={u.kondisi} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{u.tgl_rusak ? isoDisplay(u.tgl_rusak) : "-"}</td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${d !== null && d >= 30 ? "text-[var(--accent-red)]" : ""}`}>{d === null ? "-" : durasiText(d)}</td>
                      <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">{u.keterangan || "-"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Daftar Unit ----
function UnitTab({ units, canInput, canEdit, onChanged }: { units: KdUnit[]; canInput: boolean; canEdit: boolean; onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [jenis, setJenis] = useState("");
  const [estate, setEstate] = useState("");
  const [kondisi, setKondisi] = useState("");
  const [aktif, setAktif] = useState("1");
  const [editing, setEditing] = useState<KdUnit | "new" | null>(null);
  const [ubahKondisi, setUbahKondisi] = useState<KdUnit | null>(null);
  const q = search.trim().toLowerCase();
  const jenisList = [...new Set(units.map((u) => u.jenis))].sort();
  const shown = units.filter(
    (u) =>
      (!q || [u.kode, u.nama, u.id_unit, u.info, u.pemilik, u.keterangan].some((v) => v.toLowerCase().includes(q))) &&
      (!status || u.status === status) &&
      (!jenis || u.jenis === jenis) &&
      (!estate || estateOf(u) === estate) &&
      (kondisi === "" || (kondisi === "TIDAK_BAIK" ? !!u.kondisi && u.kondisi !== "BAIK" : kondisi === "KOSONG" ? !u.kondisi : u.kondisi === kondisi)) &&
      (aktif === "" || u.aktif === (aktif === "1"))
  );
  const buildReport = async () => ({
    title: "Daftar Unit Kendaraan & Alat Berat PT.AKSS",
    subtitle: [`Per ${isoDisplay(localToday())} · ${shown.length} unit`],
    landscape: true,
    columns: ["Kode", "ID Unit", "Status", "Group", "Jenis", "Nama Unit", "Kepemilikan", "Pemilik", "Estate", "Identitas / Nopol", "Kondisi", "Tgl Rusak", "Tgl Selesai", "Downtime (hari)", "Keterangan"].map((label) => ({ label })),
    rows: shown.map((u) => [u.kode, u.id_unit, u.status, u.grup, u.jenis, u.nama, u.kepemilikan, u.pemilik, u.alokasi, u.info, KONDISI[u.kondisi]?.label ?? "", u.tgl_rusak ? isoDisplay(u.tgl_rusak) : "", u.tgl_selesai ? isoDisplay(u.tgl_selesai) : "", downtime(u) ?? "", u.keterangan]),
  });
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari kode, nama, nopol, pemilik..." className={`${inputCls} pl-8`} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} aria-label="Status">
          <option value="">Internal & eksternal</option>
          <option value="INTERNAL">Internal</option>
          <option value="EKSTERNAL">Eksternal (sewa)</option>
        </select>
        <select value={jenis} onChange={(e) => setJenis(e.target.value)} className={selectCls} aria-label="Jenis">
          <option value="">Semua jenis</option>
          {jenisList.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
        <select value={estate} onChange={(e) => setEstate(e.target.value)} className={selectCls} aria-label="Estate">
          <option value="">Semua estate</option>
          {[...ESTATES, "LAINNYA"].map((e) => (
            <option key={e} value={e}>
              {e === "LAINNYA" ? "Lainnya / semua estate" : e}
            </option>
          ))}
        </select>
        <select value={kondisi} onChange={(e) => setKondisi(e.target.value)} className={selectCls} aria-label="Kondisi">
          <option value="">Semua kondisi</option>
          <option value="BAIK">Baik</option>
          <option value="TIDAK_BAIK">Rusak / standby / mangkrak</option>
          <option value="RUSAK">Rusak</option>
          <option value="STANDBY">Standby</option>
          <option value="MANGKRAK">Mangkrak</option>
          <option value="KOSONG">Belum diisi</option>
        </select>
        <select value={aktif} onChange={(e) => setAktif(e.target.value)} className={selectCls} aria-label="Aktif">
          <option value="1">Unit aktif</option>
          <option value="0">Tidak aktif</option>
          <option value="">Semua</option>
        </select>
        <span className="text-xs text-[var(--text-muted)]">{shown.length} unit</span>
        <div className="ml-auto flex gap-2">
          <ExportButtons total={shown.length} buildReport={buildReport} fileName="kendaraan-akss-unit" />
          {canEdit && (
            <button onClick={() => setEditing("new")} className={btnPrimary}>
              <Plus size={16} /> Unit Baru
            </button>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table text-sm">
          <thead>
            <tr className="bg-[#d5edc9] text-left text-xs text-[var(--text-primary)]">
              <th className="px-3 py-2.5">Kode</th>
              <th className="px-3 py-2.5">Nama Unit</th>
              <th className="px-3 py-2.5">Jenis</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Estate</th>
              <th className="px-3 py-2.5">Kondisi</th>
              <th className="px-3 py-2.5 text-right">Downtime</th>
              <th className="px-3 py-2.5">Keterangan</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {!shown.length ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-[var(--text-muted)]">
                  Tidak ada unit yang cocok.
                </td>
              </tr>
            ) : (
              shown.map((u) => {
                const d = downtime(u);
                return (
                  <tr key={u.id} className={`align-top ${u.aktif ? "" : "opacity-60"}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="font-mono text-xs text-[var(--text-primary)]">{u.kode}</div>
                      {u.id_unit && <div className="text-[11px] text-[var(--text-muted)]">{u.id_unit}</div>}
                    </td>
                    <td className="col-grow px-3 py-2">
                      <div className="text-[var(--text-primary)]">{u.nama}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">{[u.info && u.info !== "-" ? u.info : "", u.status === "EKSTERNAL" ? u.pemilik : ""].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{u.jenis}</div>
                      <div className="text-[var(--text-muted)]">{u.grup}</div>
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {u.status === "EKSTERNAL" ? "Eksternal" : "Internal"}
                      <div className="text-[var(--text-muted)]">{u.kepemilikan}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{u.alokasi || "-"}</td>
                    <td className="px-3 py-2">
                      <Badge k={u.kondisi} />
                      {u.tgl_rusak && u.kondisi !== "BAIK" && <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">sejak {isoDisplay(u.tgl_rusak)}</div>}
                    </td>
                    <td className={`px-3 py-2 text-right whitespace-nowrap text-xs ${d !== null && u.kondisi !== "BAIK" && d >= 30 ? "text-[var(--accent-red)] font-semibold" : "text-[var(--text-secondary)]"}`}>
                      {d === null ? "-" : u.kondisi === "BAIK" ? `perbaikan ${durasiText(d)}` : durasiText(d)}
                    </td>
                    <td className="col-grow px-3 py-2 text-xs text-[var(--text-secondary)]">{u.keterangan || "-"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {canInput && (
                        <button onClick={() => setUbahKondisi(u)} className="text-xs text-[var(--accent-blue)] hover:underline mr-2">
                          Kondisi
                        </button>
                      )}
                      {canEdit && (
                        <button onClick={() => setEditing(u)} title="Edit unit" className="p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[#f1f5f9]">
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {editing && <UnitModal unit={editing === "new" ? null : editing} units={units} onClose={() => setEditing(null)} onSuccess={() => (setEditing(null), onChanged())} />}
      {ubahKondisi && <KondisiModal unit={ubahKondisi} onClose={() => setUbahKondisi(null)} onSuccess={() => (setUbahKondisi(null), onChanged())} />}
    </div>
  );
}

function KondisiModal({ unit, onClose, onSuccess }: { unit: KdUnit; onClose: () => void; onSuccess: () => void }) {
  const [kondisi, setKondisi] = useState<string>(unit.kondisi || "BAIK");
  const [rusak, setRusak] = useState(unit.tgl_rusak ?? "");
  const [selesai, setSelesai] = useState(unit.tgl_selesai ?? (unit.kondisi && unit.kondisi !== "BAIK" ? localToday() : ""));
  const [ket, setKet] = useState(unit.keterangan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Marking a repaired unit BAIK keeps its tanggal rusak and asks when it was done; a new breakdown starts fresh.
  const pilih = (k: string) => {
    setKondisi(k);
    if (k !== "BAIK" && unit.kondisi === "BAIK") {
      setRusak(localToday());
      setSelesai("");
    }
    if (k === "BAIK" && unit.kondisi && unit.kondisi !== "BAIK" && !selesai) setSelesai(localToday());
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api.kdKondisi(unit.id, { kondisi, tgl_rusak: rusak || null, tgl_selesai: kondisi === "BAIK" ? selesai || null : null, keterangan: ket.trim() });
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Kondisi ${unit.kode}`} subtitle={unit.nama} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {["BAIK", "RUSAK", "STANDBY", "MANGKRAK"].map((k) => (
            <button key={k} onClick={() => pilih(k)} className={`px-2 py-2 text-sm rounded-md border ${kondisi === k ? "border-[var(--accent-blue)] bg-[#eef4ff] text-[var(--accent-blue)] font-medium" : "border-[var(--border)] text-[var(--text-secondary)]"}`}>
              {KONDISI[k].label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Tanggal rusak {kondisi === "BAIK" ? "(perbaikan terakhir)" : ""}</label>
            <input type="date" value={rusak} max={localToday()} onChange={(e) => setRusak(e.target.value)} className={inputCls} />
          </div>
          {kondisi === "BAIK" && (
            <div>
              <label className={labelCls}>Tanggal selesai</label>
              <input type="date" value={selesai} min={rusak || undefined} max={localToday()} onChange={(e) => setSelesai(e.target.value)} className={inputCls} />
            </div>
          )}
        </div>
        <div>
          <label className={labelCls}>Keterangan (kerusakan, progres perbaikan, lokasi)</label>
          <textarea value={ket} onChange={(e) => setKet(e.target.value)} rows={3} className={inputCls} />
        </div>
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnOutline}>
            Batal
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UnitModal({ unit, units, onClose, onSuccess }: { unit: KdUnit | null; units: KdUnit[]; onClose: () => void; onSuccess: () => void }) {
  const kosong: KdUnitInput = {
    kode: "",
    id_unit: "",
    status: "INTERNAL",
    grup: "",
    jenis: "",
    nama: "",
    kepemilikan: "BELI",
    tgl_perolehan: null,
    pemilik: "AKSS",
    alokasi: "",
    info: "",
    kondisi: "BAIK",
    tgl_rusak: null,
    tgl_selesai: null,
    keterangan: "",
    aktif: true,
  };
  const [f, setF] = useState<KdUnitInput>(unit ? { ...unit } : kosong);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof KdUnitInput>(k: K, v: KdUnitInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const opsi = useMemo(() => {
    const of = (k: keyof KdUnit) => [...new Set(units.map((u) => String(u[k] ?? "")).filter(Boolean))].sort();
    return { grup: of("grup"), jenis: of("jenis"), kepemilikan: of("kepemilikan"), pemilik: of("pemilik") };
  }, [units]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (unit) await api.kdEditUnit(unit.id, f);
      else await api.kdTambahUnit(f);
      onSuccess();
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
    } finally {
      setBusy(false);
    }
  };
  const field = (label: string, el: ReactNode) => (
    <div>
      <label className={labelCls}>{label}</label>
      {el}
    </div>
  );
  const pilihan = (k: "grup" | "jenis" | "kepemilikan" | "pemilik") => (
    <>
      <input list={`kd-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} className={inputCls} />
      <datalist id={`kd-${k}`}>
        {opsi[k].map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
  return (
    <Modal title={unit ? `Edit ${unit.kode}` : "Unit Baru"} subtitle="Kode unit dipakai juga di BBM (kode kendaraan)" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {field("Kode unit", <input value={f.kode} onChange={(e) => set("kode", e.target.value.toUpperCase())} placeholder="mis. DT08" className={inputCls} />)}
          {field("ID unit (sheet lama)", <input value={f.id_unit} onChange={(e) => set("id_unit", e.target.value)} className={inputCls} />)}
          {field(
            "Status",
            <select value={f.status} onChange={(e) => set("status", e.target.value as KdUnit["status"])} className={`${selectCls} w-full`}>
              <option value="INTERNAL">Internal (milik AKSS)</option>
              <option value="EKSTERNAL">Eksternal (sewa)</option>
            </select>
          )}
          {field("Group", pilihan("grup"))}
          {field("Jenis unit", pilihan("jenis"))}
          {field("Kepemilikan", pilihan("kepemilikan"))}
        </div>
        {field("Nama / merk unit", <input value={f.nama} onChange={(e) => set("nama", e.target.value)} className={inputCls} />)}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {field("Pemilik (PT / kontraktor)", pilihan("pemilik"))}
          {field(
            "Estate",
            <select value={f.alokasi} onChange={(e) => set("alokasi", e.target.value)} className={`${selectCls} w-full`}>
              <option value="">-</option>
              {[...ESTATES, ...(f.alokasi && !ESTATES.includes(f.alokasi) ? [f.alokasi] : [])].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          )}
          {field("Tgl perolehan", <input type="date" value={f.tgl_perolehan ?? ""} onChange={(e) => set("tgl_perolehan", e.target.value || null)} className={inputCls} />)}
        </div>
        {field("Identitas (nopol / no. rangka / lainnya)", <input value={f.info} onChange={(e) => set("info", e.target.value)} className={inputCls} />)}
        {field("Keterangan", <textarea value={f.keterangan} onChange={(e) => set("keterangan", e.target.value)} rows={2} className={inputCls} />)}
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input type="checkbox" checked={f.aktif} onChange={(e) => set("aktif", e.target.checked)} /> Aktif (tidak aktif = sudah dijual / dikembalikan / dipulangkan)
        </label>
        <p className="text-[11px] text-[var(--text-muted)]">Kondisi (rusak / selesai) diubah lewat tombol Kondisi di daftar unit.</p>
        {error && <p className="text-xs text-[var(--accent-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnOutline}>
            Batal
          </button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Kondisi Harian: R / S / B per internal unit per day of a month; a click cycles the cell ----
const NEXT: Record<string, string> = { "": "R", R: "S", S: "B", B: "" };
function HarianTab({ units, canInput }: { units: KdUnit[]; canInput: boolean }) {
  const [bulan, setBulan] = useState(localToday().slice(0, 7));
  const [cells, setCells] = useState<Map<string, string> | null>(null);
  const [jenis, setJenis] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [tglIsi, setTglIsi] = useState(localToday());
  const [busy, setBusy] = useState(false);
  const [muat, setMuat] = useState(0);
  useEffect(() => {
    setCells(null);
    api
      .kdHarian(bulan)
      .then((r: KdHarian[]) => setCells(new Map(r.map((c) => [`${c.unit_id}|${c.tanggal}`, c.kondisi]))))
      .catch(() => setCells(new Map()));
  }, [bulan, muat]);
  // One date for all units at once; only empty cells are filled, so a typed S / B stays.
  const isi = async (mode: "kemarin" | "semua") => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const r = await api.kdIsiHarian({ tanggal: tglIsi, mode });
      setNote(r.n ? `${r.n} unit diisi untuk ${isoDisplay(tglIsi)}` : `Tidak ada sel kosong yang bisa diisi untuk ${isoDisplay(tglIsi)}${mode === "kemarin" ? " (kemarin kosong?)" : ""}`);
      if (tglIsi.slice(0, 7) !== bulan) setBulan(tglIsi.slice(0, 7));
      else setMuat((n) => n + 1);
    } catch (e) {
      setError(errorText(e, "Gagal mengisi"));
    } finally {
      setBusy(false);
    }
  };
  const hari = new Date(Number(bulan.slice(0, 4)), Number(bulan.slice(5, 7)), 0).getDate();
  const days = Array.from({ length: hari }, (_, i) => `${bulan}-${String(i + 1).padStart(2, "0")}`);
  const today = localToday();
  const list = units.filter((u) => !jenis || u.jenis === jenis).sort((a, b) => a.jenis.localeCompare(b.jenis) || a.kode.localeCompare(b.kode, undefined, { numeric: true }));
  const jenisList = [...new Set(units.map((u) => u.jenis))].sort();
  const get = (u: KdUnit, d: string) => cells?.get(`${u.id}|${d}`) ?? "";
  const rekap = (u: KdUnit) => {
    const v = days.map((d) => get(u, d)).filter(Boolean);
    const r = v.filter((x) => x === "R").length;
    const s = v.filter((x) => x === "S").length;
    return { r, s, b: v.filter((x) => x === "B").length, isi: v.length, last: [...days].reverse().map((d) => get(u, d)).find(Boolean) ?? "" };
  };
  const klik = async (u: KdUnit, d: string) => {
    if (!canInput || d > today || !cells) return;
    const now = get(u, d);
    const next = NEXT[now];
    setError("");
    setCells((m) => {
      const n = new Map(m);
      if (next) n.set(`${u.id}|${d}`, next);
      else n.delete(`${u.id}|${d}`);
      return n;
    });
    try {
      await api.kdSetHarian({ unit_id: u.id, tanggal: d, kondisi: next });
    } catch (e) {
      setError(errorText(e, "Gagal menyimpan"));
      setCells((m) => {
        const n = new Map(m);
        if (now) n.set(`${u.id}|${d}`, now);
        else n.delete(`${u.id}|${d}`);
        return n;
      });
    }
  };
  // Per jenis: units by their last kondisi of the month, achieve = running / units.
  const perJenis = jenisList
    .map((j) => {
      const js = units.filter((u) => u.jenis === j).map(rekap);
      return { j, n: js.length, r: js.filter((x) => x.last === "R").length, s: js.filter((x) => x.last === "S").length, b: js.filter((x) => x.last === "B").length };
    })
    .filter((x) => x.n);
  const tot = perJenis.reduce((a, x) => ({ n: a.n + x.n, r: a.r + x.r, s: a.s + x.s, b: a.b + x.b }), { n: 0, r: 0, s: 0, b: 0 });
  const buildReport = async () => ({
    title: `Kondisi Harian Unit Internal PT.AKSS - ${bulanLabel(bulan)}`,
    subtitle: ["R = running · S = standby / breakdown sebagian · B = breakdown", `Achieve per unit = (R + S) / hari terisi`],
    landscape: true,
    sections: [
      {
        heading: "Per unit",
        columns: [{ label: "Kode" }, { label: "Nama" }, { label: "Jenis" }, ...days.map((d) => ({ label: String(Number(d.slice(8))) })), { label: "R", align: "right" as const }, { label: "S", align: "right" as const }, { label: "B", align: "right" as const }, { label: "Ach", align: "right" as const }],
        rows: list.map((u) => {
          const x = rekap(u);
          return [u.kode, u.nama, u.jenis, ...days.map((d) => get(u, d)), x.r, x.s, x.b, x.isi ? pct(x.r + x.s, x.isi) : ""];
        }),
      },
      {
        heading: "Kesiapan per jenis (kondisi terakhir di bulan ini)",
        columns: [{ label: "Jenis" }, { label: "Unit", align: "right" as const }, { label: "R", align: "right" as const }, { label: "S", align: "right" as const }, { label: "B", align: "right" as const }, { label: "Achieve", align: "right" as const }],
        rows: [...perJenis.map((x) => [x.j, x.n, x.r, x.s, x.b, pct(x.r, x.n)]), ["TOTAL", tot.n, tot.r, tot.s, tot.b, pct(tot.r, tot.n)]],
      },
    ],
  });
  return (
    <div className="space-y-4">
      {canInput && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--accent-blue-border)] bg-[var(--accent-blue-bg)] px-4 py-3 text-sm">
          <span className="font-medium text-[var(--accent-blue)]">Isi sekaligus untuk tanggal</span>
          <input type="date" value={tglIsi} max={today} onChange={(e) => e.target.value && setTglIsi(e.target.value)} className="text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white" />
          <button onClick={() => isi("kemarin")} disabled={busy} className={btnOutline} title="Kondisi semua unit sama dengan hari sebelumnya">
            Salin dari kemarin
          </button>
          <button onClick={() => isi("semua")} disabled={busy} className={btnPrimary} title="R untuk semua unit; B untuk yang tercatat rusak / mangkrak, S untuk yang standby">
            Isi semua R (rusak = B)
          </button>
          <span className="text-xs text-[var(--text-secondary)]">Hanya sel yang masih kosong; yang sudah diisi tidak berubah. Setelah itu klik sel yang berbeda.</span>
          {note && <span className="text-xs text-[var(--accent-green)]">{note}</span>}
        </div>
      )}

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--border)]">
          <input type="month" value={bulan} max={today.slice(0, 7)} onChange={(e) => e.target.value && setBulan(e.target.value)} className="text-sm rounded-md border border-[var(--border)] px-3 py-1.5 bg-white" aria-label="Bulan" />
          <select value={jenis} onChange={(e) => setJenis(e.target.value)} className={selectCls} aria-label="Jenis">
            <option value="">Semua jenis</option>
            {jenisList.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--text-muted)]">
            {list.length} unit internal ·{" "}
            {(["R", "S", "B"] as const).map((k) => (
              <span key={k} className={`ml-1 px-1.5 rounded ${HARIAN[k]}`}>
                {k}
              </span>
            ))}{" "}
            = running / standby sebagian / breakdown{canInput ? " · klik sel untuk mengisi (R → S → B → kosong)" : ""}
          </span>
          {error && <span className="text-xs text-[var(--accent-red)]">{error}</span>}
          <div className="ml-auto">
            <ExportButtons total={list.length} buildReport={buildReport} fileName={`kendaraan-akss-harian-${bulan}`} />
          </div>
        </div>
        {cells === null ? (
          <p className="p-4 text-sm text-[var(--text-muted)]">Memuat...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr className="bg-[#d5edc9] text-[var(--text-primary)]">
                  <th className="sticky left-0 z-10 bg-[#d5edc9] px-2 py-2 text-left min-w-[200px]">Unit</th>
                  {days.map((d) => (
                    <th key={d} className={`px-0 py-2 w-7 text-center font-medium ${d === today ? "text-[var(--accent-blue)]" : ""}`}>
                      {Number(d.slice(8))}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right">R</th>
                  <th className="px-2 py-2 text-right">S</th>
                  <th className="px-2 py-2 text-right">B</th>
                  <th className="px-2 py-2 text-right">Ach</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u, i) => {
                  const x = rekap(u);
                  const head = i === 0 || list[i - 1].jenis !== u.jenis;
                  return [
                    head && (
                      <tr key={`h-${u.jenis}`} className="bg-[#f8fafc]">
                        <td colSpan={days.length + 5} className="sticky left-0 px-2 py-1 font-semibold text-[var(--text-secondary)]">
                          {u.jenis}
                        </td>
                      </tr>
                    ),
                    <tr key={u.id} className="border-t border-[var(--border)]">
                      <td className="sticky left-0 z-10 bg-[var(--bg-card)] px-2 py-1 whitespace-nowrap">
                        <span className="font-mono text-[var(--text-primary)]">{u.kode}</span> <span className="text-[var(--text-muted)]">{u.alokasi}</span>
                      </td>
                      {days.map((d) => {
                        const k = get(u, d);
                        return (
                          <td key={d} className="p-0 text-center">
                            <button
                              onClick={() => klik(u, d)}
                              disabled={!canInput || d > today}
                              title={`${u.kode} ${isoDisplay(d)}${k ? `: ${k}` : ""}`}
                              className={`w-7 h-6 text-[11px] font-semibold ${k ? HARIAN[k] : d > today ? "bg-[#f8fafc]" : "hover:bg-[#eef4ff]"} ${canInput && d <= today ? "cursor-pointer" : "cursor-default"}`}
                            >
                              {k}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 text-right text-[var(--accent-green)]">{x.r || ""}</td>
                      <td className="px-2 text-right text-[var(--accent-amber)]">{x.s || ""}</td>
                      <td className="px-2 text-right text-[var(--accent-red)]">{x.b || ""}</td>
                      <td className={`px-2 text-right font-medium ${x.isi && (x.r + x.s) / x.isi < 0.8 ? "text-[var(--accent-red)]" : ""}`}>{x.isi ? pct(x.r + x.s, x.isi) : ""}</td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
        <h2 className="px-4 py-3 text-sm font-semibold text-[var(--text-primary)] border-b border-[var(--border)]">Kesiapan unit per jenis - {bulanLabel(bulan)} (kondisi terakhir)</h2>
        <div className="table-scroll">
          <table className="data-table text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-secondary)]">
                <th className="px-3 py-2">Jenis</th>
                <th className="px-3 py-2 text-right">Unit</th>
                <th className="px-3 py-2 text-right">Running</th>
                <th className="px-3 py-2 text-right">Standby</th>
                <th className="px-3 py-2 text-right">Breakdown</th>
                <th className="px-3 py-2 text-right">Achieve</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {perJenis.map((x) => (
                <tr key={x.j}>
                  <td className="col-grow px-3 py-2">{x.j}</td>
                  <td className="px-3 py-2 text-right">{x.n}</td>
                  <td className="px-3 py-2 text-right text-[var(--accent-green)]">{x.r}</td>
                  <td className="px-3 py-2 text-right text-[var(--accent-amber)]">{x.s}</td>
                  <td className="px-3 py-2 text-right text-[var(--accent-red)]">{x.b}</td>
                  <td className={`px-3 py-2 text-right font-medium ${x.n && x.r / x.n < 0.8 ? "text-[var(--accent-red)]" : ""}`}>{pct(x.r, x.n)}</td>
                </tr>
              ))}
              <tr className="font-semibold bg-[#f8fafc]">
                <td className="px-3 py-2">TOTAL</td>
                <td className="px-3 py-2 text-right">{tot.n}</td>
                <td className="px-3 py-2 text-right">{tot.r}</td>
                <td className="px-3 py-2 text-right">{tot.s}</td>
                <td className="px-3 py-2 text-right">{tot.b}</td>
                <td className="px-3 py-2 text-right">{pct(tot.r, tot.n)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
