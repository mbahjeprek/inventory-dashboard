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

export const MODULES = ["GUDANG", "BBM", "PUPUK", "KLINIK"] as const;
export type Module = (typeof MODULES)[number];

// `modules`: the inventory modules an estate account may open; null = all of them.
export type SessionUser = { id: number; username: string; nama: string; role: Role; estate: Estate | null; modules?: Module[] | null };

// users.modules text -> list (null when unrestricted).
export function parseModules(v: string | null | undefined): Module[] | null {
  const list = (v ?? "").split(",").map((s) => s.trim()).filter((s): s is Module => (MODULES as readonly string[]).includes(s));
  return list.length ? list : null;
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

export function signSession(user: SessionUser): string {
  return jwt.sign(user, JWT_SECRET!, { expiresIn: "7d" });
}

export function verifySession(token: string): SessionUser | null {
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
