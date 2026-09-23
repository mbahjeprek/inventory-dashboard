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

export type SessionUser = { id: number; username: string; nama: string; role: Role; estate: Estate | null };

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
    return jwt.verify(token, JWT_SECRET!) as SessionUser;
  } catch {
    return null;
  }
}
