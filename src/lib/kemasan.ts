// Obat stock is kept in its satuan (tablet / biji); kemasan is the pack it comes in (STRIP isi 10).
// These turn a count into packs + loose pieces and back, for the forms and the stock columns.

export type Kemasan = { kemasan?: string; isi_kemasan?: number; satuan?: string };

// isi per pack, or 0 when the obat has no pack (or a pack of 1, nothing to convert).
export const isiOf = (o: Kemasan) => ((o.isi_kemasan ?? 0) > 1 ? o.isi_kemasan! : 0);
export const kemasanName = (o: Kemasan) => (o.kemasan || "KEMASAN").toUpperCase();

// 76 with STRIP isi 10 -> { pak: 7, lepas: 6 }.
export function split(qty: number, isi: number) {
  const pak = Math.floor(qty / isi);
  return { pak, lepas: Math.round((qty - pak * isi) * 1000) / 1000 };
}

// "7 STRIP + 6" ("7 STRIP" when nothing is loose); "" for an obat without a pack.
export function kemasanText(qty: number, o: Kemasan) {
  const isi = isiOf(o);
  if (!isi || qty <= 0) return "";
  const { pak, lepas } = split(qty, isi);
  const name = kemasanName(o);
  if (!pak) return `${lepas} lepas`;
  return lepas ? `${pak} ${name} + ${lepas}` : `${pak} ${name}`;
}
