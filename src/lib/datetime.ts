// A transaction's date with the time it was entered, "25/09/2026 14:03". The time is only shown when
// the row was entered on that same date (created_at falls on it): imported history and back-dated
// entries have no real time of their own, so they show the date alone.
const pad = (n: number) => String(n).padStart(2, "0");

const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeText = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// isoDate "yyyy-mm-dd" (or "" / null), dateText the date as shown when it differs ("dd/mm/yyyy").
export function tanggalWaktu(isoDate: string | null | undefined, createdAt: string | null | undefined, dateText?: string | null): string {
  const shown = dateText || (isoDate ? isoDate.split("-").reverse().join("/") : "");
  if (!createdAt) return shown || "-";
  const c = new Date(createdAt);
  if (Number.isNaN(c.getTime())) return shown || "-";
  if (!isoDate) return shown || `${localIso(c).split("-").reverse().join("/")} ${timeText(c)}`;
  return localIso(c) === isoDate ? `${shown} ${timeText(c)}` : shown;
}

// A moment (created_at) as "25/09/2026 14:03".
export const waktu = (createdAt: string | null | undefined) => {
  if (!createdAt) return "-";
  const c = new Date(createdAt);
  return Number.isNaN(c.getTime()) ? "-" : `${localIso(c).split("-").reverse().join("/")} ${timeText(c)}`;
};
