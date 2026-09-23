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
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: Tone;
  suffix?: string;
}) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-md border flex items-center justify-center shrink-0 ${toneClasses[tone]}`}>
        <Icon size={20} />
      </div>
      <div>
        <div className="text-2xl font-semibold text-[var(--text-primary)] leading-tight">
          {value}
          {suffix && <span className="text-sm font-normal text-[var(--text-muted)] ml-1">{suffix}</span>}
        </div>
        <div className="text-xs text-[var(--text-secondary)] mt-0.5">{label}</div>
      </div>
    </div>
  );
}
