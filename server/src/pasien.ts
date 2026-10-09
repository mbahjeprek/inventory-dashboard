// Master Pasien helpers: when two visits are the same patient. The sheets type a patient's name and
// birth date a little differently from visit to visit ("Asnani" 19-07-1997 / 25-05-1997), so a
// patient is one estate + one name (letters only, any case) + a birth year within a year; a name
// with birth years further apart is several people (Riska 1989 / 1998).
export const namaKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
export const tahunOf = (iso: string | null | undefined) => (iso ? Number(iso.slice(0, 4)) : null);
// Two spellings of one name, for patients born on the same day ("Jafar" / "Jaffar", "Muh Jufri" /
// "Muhammad Jufri", "Ramli" / "Muh Ramli"): Muhammad and its short forms count as one, then a few
// letters' difference or one name inside the other (of 4+ letters).
const muh = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(muhammad|muhamad|mohammad|mohamad|muhamat|muh|moh|mhd|m)[\s.]+/, "muh ")
    .replace(/[^a-z]/g, "");
function editDistance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
export function namaMirip(x: string, y: string) {
  const a = muh(x), b = muh(y);
  const short = Math.min(a.length, b.length);
  if (short >= 4 && (a.includes(b) || b.includes(a))) return true;
  return editDistance(a, b) <= Math.max(2, Math.floor(short * 0.25));
}

export const sameTahun = (a: string | null | undefined, b: string | null | undefined) => {
  const ya = tahunOf(a), yb = tahunOf(b);
  return ya === null || yb === null || Math.abs(ya - yb) <= 1;
};
