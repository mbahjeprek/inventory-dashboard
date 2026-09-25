import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { estateOfPath, moduleOfPath } from "../lib/access";
import { LOAN_LATE_DAYS, loanDays, useOpenPinjaman } from "../hooks/useOpenPinjaman";

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

// On an inventory page, the open loans of that module + estate (lent out or borrowed): a reminder
// that stays until they have been returned.
export function PinjamanBanner() {
  const { pathname } = useLocation();
  const loans = useOpenPinjaman((s) => s.loans);
  const module = moduleOfPath(pathname);
  const estate = estateOfPath(pathname);
  if (!module || !estate) return null;
  const here = loans.filter((l) => l.module === module && (l.dari_estate === estate || l.ke_estate === estate));
  if (!here.length) return null;
  const late = here.some((l) => loanDays(l.tanggal_iso) >= LOAN_LATE_DAYS);

  return (
    <Link
      to="/pinjaman"
      className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm group ${
        late
          ? "bg-[var(--accent-red-bg)] border-[var(--accent-red-border)] text-[var(--accent-red)]"
          : "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]"
      }`}
    >
      <AlertTriangle size={18} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{here.length} pinjaman belum dikembalikan</div>
        <ul className="mt-0.5 text-xs space-y-0.5">
          {here.slice(0, 5).map((l) => {
            const sisa = l.qty - l.qty_kembali;
            const days = loanDays(l.tanggal_iso);
            return (
              <li key={l.id} className="truncate">
                {l.dari_estate === estate ? `Dipinjamkan ke ${l.ke_estate}` : `Dipinjam dari ${l.dari_estate}`}: {l.nama} {fmt(sisa)} {l.satuan} · sudah {days} hari
              </li>
            );
          })}
          {here.length > 5 && <li>+{here.length - 5} lainnya</li>}
        </ul>
      </div>
      <span className="text-xs whitespace-nowrap self-center opacity-80 group-hover:opacity-100">
        Lihat <ChevronRight size={12} className="inline" />
      </span>
    </Link>
  );
}
