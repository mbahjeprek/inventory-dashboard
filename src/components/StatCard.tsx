import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Tone = "blue" | "green" | "amber" | "red";

const toneClasses: Record<Tone, string> = {
  blue: "bg-[var(--accent-blue-bg)] border-[var(--accent-blue-border)] text-[var(--accent-blue)]",
  green: "bg-[var(--accent-green-bg)] border-[var(--accent-green-border)] text-[var(--accent-green)]",
  amber: "bg-[var(--accent-amber-bg)] border-[var(--accent-amber-border)] text-[var(--accent-amber)]",
  red: "bg-[var(--accent-red-bg)] border-[var(--accent-red-border)] text-[var(--accent-red)]",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "blue",
  suffix,
  onClick,
  active = false,
  footer,
  title,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: Tone;
  suffix?: string;
  onClick?: () => void;
  active?: boolean;
  footer?: ReactNode;
  // Tooltip for a clickable card (default: show / clear its list).
  title?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, title: title ?? (active ? "Tampilkan semua barang" : `Lihat daftar ${label}`) } : {})}
      className={`bg-[var(--bg-card)] border rounded-lg p-3 sm:p-4 text-left w-full min-w-0 ${
        active ? "border-[var(--accent-blue)] ring-2 ring-[var(--accent-blue-border)]" : "border-[var(--border)]"
      } ${onClick ? "cursor-pointer hover:shadow-md hover:border-[var(--accent-blue-border)] transition" : ""}`}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className={`w-9 h-9 sm:w-11 sm:h-11 rounded-md border flex items-center justify-center shrink-0 ${toneClasses[tone]}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)] leading-tight">
            {value}
            {suffix && <span className="text-sm font-normal text-[var(--text-muted)] ml-1">{suffix}</span>}
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">{label}</div>
        </div>
      </div>
      {footer && <div className="mt-3 pt-3 border-t border-[var(--border)]">{footer}</div>}
    </Tag>
  );
}
