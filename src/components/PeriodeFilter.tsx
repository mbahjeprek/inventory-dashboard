import type { ReactNode } from "react";

// The period of a transaction list, with quick picks: Bulan ini (the 1st up to today - the default of the
// inventory lists, so the table, Cetak and Excel all show the running month), Bulan lalu, 3 bulan
// terakhir, Tahun ini, Semua (no dates) or own dates. `children` (the Cetak / Excel buttons) sit next to
// it, so what is printed is visibly the period chosen.

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
type Preset = "bulan" | "lalu" | "3bulan" | "tahun" | "semua" | "custom";
const range = (p: Exclude<Preset, "custom">): [string, string] => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (p) {
    case "bulan":
      return [iso(new Date(y, m, 1)), iso(now)];
    case "lalu":
      return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case "3bulan":
      return [iso(new Date(y, m - 2, 1)), iso(now)];
    case "tahun":
      return [iso(new Date(y, 0, 1)), iso(now)];
    case "semua":
      return ["", ""];
  }
};
// The default of a list: this month so far.
export const bulanIni = () => range("bulan");
const presetOf = (from: string, to: string): Preset =>
  (["bulan", "lalu", "3bulan", "tahun", "semua"] as const).find((p) => {
    const [f, t] = range(p);
    return f === from && t === to;
  }) ?? "custom";

const cls = "text-sm rounded-md border border-[var(--border)] px-3 py-2 bg-white";

export function PeriodeFilter({ from, to, onChange, children }: { from: string; to: string; onChange: (from: string, to: string) => void; children?: ReactNode }) {
  const preset = presetOf(from, to);
  return (
    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
      <select
        value={preset}
        onChange={(e) => {
          const p = e.target.value as Preset;
          if (p !== "custom") onChange(...range(p));
        }}
        className={cls}
        aria-label="Periode"
      >
        <option value="bulan">Bulan ini</option>
        <option value="lalu">Bulan lalu</option>
        <option value="3bulan">3 bulan terakhir</option>
        <option value="tahun">Tahun ini</option>
        <option value="semua">Semua tanggal</option>
        <option value="custom">Pilih tanggal...</option>
      </select>
      <div className="flex items-center gap-2 flex-1 sm:flex-none min-w-0">
        <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className={`${cls} flex-1 min-w-0 sm:flex-none`} aria-label="Dari tanggal" />
        <span className="text-[var(--text-muted)] text-sm">-</span>
        <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className={`${cls} flex-1 min-w-0 sm:flex-none`} aria-label="Sampai tanggal" />
      </div>
      {children}
    </div>
  );
}
