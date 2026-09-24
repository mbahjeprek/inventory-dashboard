import type { AuthUser } from "./api";

// Inventory modules an estate account can be limited to (users.modules). Mirrors MODULES and
// moduleOfRequest() in server/src/app.ts, which is the actual security boundary.
export const MODULES = ["GUDANG", "BBM", "PUPUK", "KLINIK"] as const;
export type Module = (typeof MODULES)[number];
export const MODULE_LABELS: Record<Module, string> = { GUDANG: "Gudang", BBM: "BBM", PUPUK: "Pupuk NPK", KLINIK: "Klinik" };

export function canModule(user: AuthUser | null, m: Module): boolean {
  if (!user) return false;
  if (user.role === "superuser" || !user.modules?.length) return true;
  return user.modules.includes(m);
}

// Which module an inventory page path belongs to ("/inventory-bbm-kns" -> BBM).
export function moduleOfPath(path: string): Module | null {
  if (path.startsWith("/inventory-bbm")) return "BBM";
  if (path.startsWith("/inventory-pupuk")) return "PUPUK";
  if (path.startsWith("/inventory-klinik")) return "KLINIK";
  if (path.startsWith("/inventory")) return "GUDANG";
  return null;
}
