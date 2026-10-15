import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { create } from "zustand";
import { BellRing, ChevronRight, ClipboardCheck, X } from "lucide-react";
import { api, type StatusUpdate } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/access";

// Status Update: how current each estate's data is per module (server: GET /api/status-update).
export const UPDATE_COLS = [
  { modul: "GUDANG", label: "Gudang", perm: "gudang" },
  { modul: "BBM", label: "BBM", perm: "bbm" },
  { modul: "OLI", label: "Oli", perm: "oli" },
  { modul: "PUPUK", label: "Pupuk", perm: "pupuk" },
  { modul: "KLINIK", label: "Klinik Stok", perm: "klinik" },
  { modul: "LAPORAN", label: "Laporan Klinik", perm: "klinik" },
] as const;
const LABEL: Record<string, string> = Object.fromEntries(UPDATE_COLS.map((c) => [c.modul, c.label]));
const ESTATE_LABEL: Record<string, string> = { NILAM: "Nilam", KNS: "KNS", WJA: "WJA", ZAMRUD: "Zamrud", FIRUS: "Firus" };

// The page where that data is entered.
export function updatePath(modul: string, estate: string) {
  const suffix = estate === "NILAM" ? "" : `-${estate.toLowerCase()}`;
  if (modul === "GUDANG") return estate === "NILAM" ? "/inventory" : `/inventory-${estate.toLowerCase()}`;
  if (modul === "LAPORAN") return `/inventory-klinik${suffix}?tab=laporan`;
  return `/inventory-${modul.toLowerCase()}${suffix}`;
}

type Row = StatusUpdate["data"][number];
// ok = within the module's limit; telat = up to 2 days over; parah = more; kosong = never had data.
export const updateLevel = (r: Row | undefined) => (!r || r.hari === null ? "kosong" : r.hari <= r.batas ? "ok" : r.hari <= r.batas + 2 ? "telat" : "parah");
const late = (r: Row) => updateLevel(r) === "telat" || updateLevel(r) === "parah";
const fmtTgl = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
const ago = (h: number) => (h === 0 ? "hari ini" : h === 1 ? "kemarin" : `${h} hari lalu`);

// Loaded once per page change by MainLayout, like the open loans.
export const useStatusUpdate = create<{ status: StatusUpdate | null; refresh: () => void }>((set) => ({
  status: null,
  refresh: () => {
    api
      .statusUpdate()
      .then((status) => set({ status }))
      .catch(() => set({ status: null }));
  },
}));

const LEVEL_CLS: Record<string, string> = {
  ok: "bg-[var(--accent-green-bg)] text-[var(--accent-green)] border-[var(--accent-green-border)]",
  telat: "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)] border-[var(--accent-amber-border)]",
  parah: "bg-[var(--accent-red-bg)] text-[var(--accent-red)] border-[var(--accent-red-border)]",
  kosong: "bg-[#f8fafc] text-[var(--text-muted)] border-[var(--border)]",
};

// Dashboard: estates x modules, the last date with data and how long ago, coloured by the limit.
export function StatusUpdatePanel({ estates }: { estates: string[] }) {
  const status = useStatusUpdate((s) => s.status);
  const refresh = useStatusUpdate((s) => s.refresh);
  // Fresh figures when the Dashboard opens and whenever its browser tab comes back into view.
  useEffect(() => {
    refresh();
    const onShow = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [refresh]);
  if (!status) return null;
  const cols = UPDATE_COLS.filter((c) => status.data.some((r) => r.modul === c.modul));
  const rows = estates;
  if (!cols.length) return null;
  const cell = (modul: string, estate: string) => status.data.find((r) => r.modul === modul && r.estate === estate);
  const nLate = status.data.filter((r) => estates.includes(r.estate) && late(r)).length;

  return (
    <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
        <ClipboardCheck size={16} className="text-[var(--accent-blue)]" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Status Update Data</h2>
        <span className={`text-xs ${nLate ? "text-[var(--accent-red)] font-medium" : "text-[var(--accent-green)]"}`}>
          {nLate ? `${nLate} terlambat update` : "semua up to date"}
        </span>
        <span className="ml-auto text-[11px] text-[var(--text-muted)]">
          Batas: {cols.map((c) => `${c.label} ${status.limits[c.modul]} hr`).join(" · ")}
        </span>
      </div>
      <div className="table-scroll">
        <table className="data-table text-sm w-full">
          <thead>
            <tr className="text-xs text-[var(--text-secondary)] uppercase">
              <th className="px-3 py-2 text-left">Estate</th>
              {cols.map((c) => (
                <th key={c.modul} className="px-3 py-2 text-left whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e} className="border-t border-[var(--border)]">
                <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{ESTATE_LABEL[e] ?? e}</td>
                {cols.map((c) => {
                  const r = cell(c.modul, e);
                  const lv = updateLevel(r);
                  const body = (
                    <span className={`inline-block min-w-[6.5rem] rounded-md border px-2 py-1 text-xs leading-tight ${LEVEL_CLS[lv]}`}>
                      {r?.terakhir ? (
                        <>
                          <span className="font-semibold">{fmtTgl(r.terakhir)}</span>
                          <span className="block text-[10px] opacity-90">{ago(r.hari!)}</span>
                        </>
                      ) : (
                        <span className="block py-1 text-[10px]">belum ada data</span>
                      )}
                    </span>
                  );
                  return (
                    <td key={c.modul} className="px-3 py-1.5">
                      {r ? (
                        <Link to={updatePath(c.modul, e)} title={`Buka ${c.label} ${ESTATE_LABEL[e] ?? e}`} className="hover:opacity-80">
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)]">
        Tanggal = tanggal transaksi terakhir yang tercatat. Hijau = masih dalam batas, oranye = lewat sampai 2 hari, merah = lewat lebih dari 2 hari. Klik untuk membuka halamannya.
      </p>
    </section>
  );
}

// Reminder on every page for the admin who enters that data: the modules of its estates that are
// past their limit. A superuser gets one line with the count. Dismissed until the list changes or a new day.
export function StatusUpdateBanner() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const status = useStatusUpdate((s) => s.status);
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem("status-update.hide") ?? "";
    } catch {
      return "";
    }
  });
  if (!status || !user) return null;
  const superuser = user.role === "superuser";
  // The Dashboard shows the whole table already.
  if (superuser && pathname === "/") return null;
  // Pupuk is seasonal (months without pemupukan are normal): it shows on the Dashboard panel only.
  const mine = status.data.filter(
    (r) => r.modul !== "PUPUK" && late(r) && (superuser || can(user, `${UPDATE_COLS.find((c) => c.modul === r.modul)!.perm}.input`))
  );
  if (!mine.length) return null;
  const key = `${status.today}|${mine.map((r) => `${r.modul}-${r.estate}-${r.hari}`).join(",")}`;
  if (hidden === key) return null;
  const hide = () => {
    setHidden(key);
    try {
      sessionStorage.setItem("status-update.hide", key);
    } catch {
      // ignore
    }
  };
  const parah = mine.some((r) => updateLevel(r) === "parah");
  const cls = parah
    ? "bg-[var(--accent-red-bg)] border-[var(--accent-red-border)] text-[var(--accent-red)]"
    : "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]";

  return (
    <div className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <BellRing size={18} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        {superuser ? (
          <>
            <div className="font-semibold">{mine.length} data estate terlambat update</div>
            <Link to="/" className="text-xs underline">
              Lihat Status Update Data di Dashboard
            </Link>
          </>
        ) : (
          <>
            <div className="font-semibold">Mohon update data berikut:</div>
            <ul className="mt-0.5 text-xs space-y-0.5">
              {mine.map((r) => (
                <li key={`${r.modul}-${r.estate}`}>
                  <Link to={updatePath(r.modul, r.estate)} className="hover:underline">
                    {LABEL[r.modul]} {ESTATE_LABEL[r.estate] ?? r.estate}: terakhir diisi {fmtTgl(r.terakhir!)} ({ago(r.hari!)}, batas {r.batas} hari)
                    <ChevronRight size={12} className="inline" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <button onClick={hide} title="Sembunyikan untuk sesi ini" className="p-1 rounded-md opacity-70 hover:opacity-100">
        <X size={16} />
      </button>
    </div>
  );
}
