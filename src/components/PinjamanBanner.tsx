import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeftRight, BellRing, ChevronRight, X } from "lucide-react";
import { estateOfPath, moduleOfPath } from "../lib/access";
import { LOAN_LATE_DAYS, asalPinjaman, loanDays, useOpenPinjaman } from "../hooks/useOpenPinjaman";
import type { Pinjaman } from "../lib/api";
import { StatCard } from "./StatCard";

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

// The open loans (lent out or borrowed) of the inventory page's module + estate.
function usePinjamanHere() {
  const { pathname } = useLocation();
  const loans = useOpenPinjaman((s) => s.loans);
  const module = moduleOfPath(pathname);
  const estate = estateOfPath(pathname);
  const here = module && estate ? loans.filter((l) => l.module === module && (l.dari_estate === estate || l.ke_estate === estate)) : [];
  return { module, estate, here, late: here.filter((l) => loanDays(l.tanggal_iso) >= LOAN_LATE_DAYS) };
}
const loanText = (l: Pinjaman, estate: string) =>
  `${l.dari_estate === estate ? `Dipinjamkan ke ${l.ke_estate}` : `Dipinjam dari ${asalPinjaman(l)}`}: ${l.nama} ${fmt(l.qty - l.qty_kembali)} ${l.satuan} · sudah ${loanDays(l.tanggal_iso)} hari`;

// Gudang and Klinik show the loans as a card in their stock card row; the other modules (no such row) keep the banner.
const HAS_CARD = ["GUDANG", "KLINIK"];

// Card in the stock card row of Gudang / Klinik: open loans of this estate, red once one is LOAN_LATE_DAYS old.
export function PinjamanCard() {
  const navigate = useNavigate();
  const { estate, here, late } = usePinjamanHere();
  const dipinjam = here.filter((l) => l.ke_estate === estate).length;
  const terlama = here.reduce((d, l) => Math.max(d, loanDays(l.tanggal_iso)), 0);
  return (
    <StatCard
      label="Pinjaman Belum Kembali"
      value={here.length.toLocaleString("id-ID")}
      icon={ArrowLeftRight}
      tone={late.length ? "red" : here.length ? "amber" : "green"}
      onClick={() => navigate("/pinjaman")}
      title="Buka Pinjaman antar estate"
      footer={
        <span className={`text-[11px] line-clamp-1 ${late.length ? "text-[var(--accent-red)]" : here.length ? "text-[var(--accent-amber)]" : "text-[var(--text-muted)]"}`}>
          {here.length ? `${dipinjam} dipinjam · ${here.length - dipinjam} dipinjamkan · terlama ${terlama} hari` : "semua sudah kembali"}
        </span>
      }
    />
  );
}

// On BBM / Pupuk / Oli: the open loans of that module + estate as a banner, until they have been returned.
export function PinjamanBanner() {
  const { module, estate, here, late } = usePinjamanHere();
  if (!module || !estate || HAS_CARD.includes(module) || !here.length) return null;

  return (
    <Link
      to="/pinjaman"
      className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm group ${
        late.length
          ? "bg-[var(--accent-red-bg)] border-[var(--accent-red-border)] text-[var(--accent-red)]"
          : "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]"
      }`}
    >
      <AlertTriangle size={18} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{here.length} pinjaman belum dikembalikan</div>
        <ul className="mt-0.5 text-xs space-y-0.5">
          {here.slice(0, 5).map((l) => (
            <li key={l.id} className="truncate">
              {loanText(l, estate)}
            </li>
          ))}
          {here.length > 5 && <li>+{here.length - 5} lainnya</li>}
        </ul>
      </div>
      <span className="text-xs whitespace-nowrap self-center opacity-80 group-hover:opacity-100">
        Lihat <ChevronRight size={12} className="inline" />
      </span>
    </Link>
  );
}

// Pop-up in the corner the first time a module page with open loans is opened in this session
// (again when its loans change): which ones, how long. Closed with Tutup, or Lihat opens Pinjaman.
export function PinjamanNotif() {
  const navigate = useNavigate();
  const { module, estate, here, late } = usePinjamanHere();
  const key = module && estate && here.length ? `pinjaman-notif:${module}:${estate}:${here.map((l) => l.id).join(",")}` : "";
  const [open, setOpen] = useState("");
  useEffect(() => {
    if (!key) return setOpen("");
    let seen = false;
    try {
      seen = sessionStorage.getItem(key) === "1";
    } catch {
      /* no storage: show it */
    }
    setOpen(seen ? "" : key);
  }, [key]);
  if (!open || open !== key || !estate) return null;
  const tutup = () => {
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    setOpen("");
  };
  return (
    <div
      role="alert"
      className={`fixed z-40 bottom-20 right-4 left-4 sm:left-auto sm:right-20 sm:bottom-4 sm:w-[380px] rounded-lg border shadow-lg bg-[var(--bg-card)] ${late.length ? "border-[var(--accent-red-border)]" : "border-[var(--accent-amber-border)]"}`}
    >
      <div className={`flex items-start gap-2.5 px-4 py-3 rounded-t-lg ${late.length ? "bg-[var(--accent-red-bg)] text-[var(--accent-red)]" : "bg-[var(--accent-amber-bg)] text-[var(--accent-amber)]"}`}>
        <BellRing size={18} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 text-sm">
          <div className="font-semibold">{here.length} pinjaman belum dikembalikan</div>
          {late.length > 0 && (
            <div className="text-xs">
              {late.length} sudah lebih dari {LOAN_LATE_DAYS} hari
            </div>
          )}
        </div>
        <button onClick={tutup} title="Tutup" className="p-0.5 rounded hover:bg-black/5">
          <X size={16} />
        </button>
      </div>
      <ul className="px-4 py-2.5 text-xs text-[var(--text-secondary)] space-y-1">
        {here.slice(0, 4).map((l) => (
          <li key={l.id} className={`truncate ${loanDays(l.tanggal_iso) >= LOAN_LATE_DAYS ? "text-[var(--accent-red)]" : ""}`}>
            {loanText(l, estate)}
          </li>
        ))}
        {here.length > 4 && <li className="text-[var(--text-muted)]">+{here.length - 4} lainnya</li>}
      </ul>
      <div className="flex justify-end gap-2 px-4 pb-3">
        <button onClick={tutup} className="px-3 py-1.5 text-xs rounded-md border border-[var(--border)] text-[var(--text-secondary)]">
          Tutup
        </button>
        <button onClick={() => (tutup(), navigate("/pinjaman"))} className="px-3 py-1.5 text-xs rounded-md bg-[var(--accent-blue)] text-white">
          Lihat pinjaman
        </button>
      </div>
    </div>
  );
}
