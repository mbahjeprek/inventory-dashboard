import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";

export const COOKIE_NAME = "session";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET env var is not set");
}

export type Role = "superuser" | "estate";
export const ESTATES = ["NILAM", "FIRUS", "ZAMRUD", "KNS", "WJA"] as const;
export type Estate = (typeof ESTATES)[number];

// Checkable permissions of an estate account (a superuser has all of them). Each inventory module
// has view / input / edit / delete, opname (create + count a Stok Opname) and approve (approve / send
// back an opname). A one-item Koreksi Stok is Super User only: every other difference goes through a
// Stok Opname (counted blind, witnessed, approved by someone else). Then the
// master data pages and monitoring. Keep in sync with MODULE_ACTIONS in src/lib/access.ts.
export const MODULE_ACTIONS: Record<string, string[]> = {
  gudang: ["view", "input", "edit", "delete", "opname", "approve"],
  bbm: ["view", "input", "edit", "delete", "opname", "approve"],
  pupuk: ["view", "input", "edit", "delete", "opname", "approve"],
  klinik: ["view", "input", "edit", "delete", "opname", "approve"],
  oli: ["view", "input", "edit", "delete", "opname", "approve"],
};
export const MODULE_PERMS: string[] = Object.entries(MODULE_ACTIONS).flatMap(([m, acts]) => acts.map((a) => `${m}.${a}`));
export const ALL_PERMS: string[] = [
  ...MODULE_PERMS,
  "master.barang",
  "master.obat",
  "master.oli",
  "master.pupuk",
  "master.karyawan",
  "master.alat",
  "master.blok",
  "master.peta",
  "master.peta_edit",
  "master.users",
  "monitor.log_user",
  // Dokumen & Link: add / edit / delete the links (seeing them needs no tick).
  "dokumen.edit",
  // Kelola semua: change / delete / lock every link, not only one's own.
  "dokumen.kelola",
  // Koperasi karyawan: Lihat, Input (pengambilan / pembelian / rusak), Edit (hapus transaksi, master barang & anggota).
  "koperasi.view",
  "koperasi.input",
  "koperasi.edit",
  // Pelunasan: mark a karyawan's bill paid / not paid (HR only, not the koperasi admin).
  "koperasi.pelunasan",
  // Approve: check (Setujui / Tolak) a Barang Rusak / Expired entered by someone else.
  "koperasi.approve",
  // Kendaraan & Alat Berat: Lihat, Input (kondisi harian, rusak / selesai), Edit (tambah / ubah unit).
  "kendaraan.view",
  "kendaraan.input",
  "kendaraan.edit",
  // Pruning PT.AKSS: Lihat (riwayat, rekap), Input (pruning baru), Edit (ubah / hapus, target blok).
  "pruning.view",
  "pruning.input",
  "pruning.edit",
];

// Session: the token only identifies the account; estates and perms are re-read from the users
// table on every request (see loadSessionUser in app.ts) so a change applies without re-login.
export type SessionUser = {
  id: number;
  username: string;
  nama: string;
  role: Role;
  estate: Estate | null;
  estates: string[];
  perms: string[];
  // Until when it may edit earlier months' transactions (users.edit_lampau_until), only while that is ahead.
  editLampauUntil?: string | null;
};

// Comma separated users.estates / users.perms -> list of known values.
export function parseList(v: string | null | undefined, known: readonly string[]): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter((s) => known.includes(s));
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const candidate = scryptSync(password, salt, hashBuffer.length);
  return candidate.length === hashBuffer.length && timingSafeEqual(candidate, hashBuffer);
}

export function signSession(user: Pick<SessionUser, "id" | "username" | "nama" | "role" | "estate">): string {
  return jwt.sign({ id: user.id, username: user.username, nama: user.nama, role: user.role, estate: user.estate }, JWT_SECRET!, { expiresIn: "7d" });
}

// iat = when the token was issued (seconds), so an active session can be renewed (see app.ts).
export function verifySession(token: string): (Pick<SessionUser, "id" | "username" | "nama" | "role" | "estate"> & { iat?: number }) | null {
  try {
    const user = jwt.verify(token, JWT_SECRET!) as SessionUser & { iat?: number };
    // Tokens issued before roles existed carry no role/estate; treat them as logged out so the
    // user signs in again and gets a current token, instead of the client bouncing between
    // "/" and "/login" with a user it can't route anywhere (a blank page).
    if (user.role !== "superuser" && user.role !== "estate") return null;
    return user;
  } catch {
    return null;
  }
}
