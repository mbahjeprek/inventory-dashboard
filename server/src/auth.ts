import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";

export const COOKIE_NAME = "session";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET env var is not set");
}

export type Role = "superuser" | "estate";
export const ESTATES = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"] as const;
export type Estate = (typeof ESTATES)[number];

// Checkable permissions of an estate account (a superuser has all of them). Each inventory module
// has view / input / edit / delete, Gudang and Klinik also koreksi (stock opname); then the master
// data pages and monitoring. Keep in sync with PERM_GROUPS in src/lib/access.ts.
export const MODULE_ACTIONS: Record<string, string[]> = {
  gudang: ["view", "input", "edit", "delete", "koreksi"],
  bbm: ["view", "input", "edit", "delete"],
  pupuk: ["view", "input", "edit", "delete"],
  klinik: ["view", "input", "edit", "delete", "koreksi"],
};
export const ALL_PERMS: string[] = [
  ...Object.entries(MODULE_ACTIONS).flatMap(([m, acts]) => acts.map((a) => `${m}.${a}`)),
  "master.barang",
  "master.obat",
  "master.karyawan",
  "master.alat",
  "master.users",
  "monitor.log_user",
];

// Session: the token only identifies the account; estates and perms are re-read from the users
// table on every request (see loadSessionUser in app.ts) so a change applies without re-login.
export type SessionUser = { id: number; username: string; nama: string; role: Role; estate: Estate | null; estates: string[]; perms: string[] };

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

export function verifySession(token: string): Pick<SessionUser, "id" | "username" | "nama" | "role" | "estate"> | null {
  try {
    const user = jwt.verify(token, JWT_SECRET!) as SessionUser;
    // Tokens issued before roles existed carry no role/estate; treat them as logged out so the
    // user signs in again and gets a current token, instead of the client bouncing between
    // "/" and "/login" with a user it can't route anywhere (a blank page).
    if (user.role !== "superuser" && user.role !== "estate") return null;
    return user;
  } catch {
    return null;
  }
}
