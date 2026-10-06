import type { AuthUser } from "./api";

// Checkbox access of an account. A superuser has every estate and permission; an estate account
// only what is ticked for it in Pengguna. Mirrors ALL_PERMS / requiredPerms() in server/src/app.ts,
// which is the actual security boundary - this only decides what to show.
export const MODULES = ["GUDANG", "BBM", "PUPUK", "KLINIK", "OLI"] as const;
export type Module = (typeof MODULES)[number];
export const MODULE_LABELS: Record<Module, string> = { GUDANG: "Gudang", BBM: "BBM", PUPUK: "Pupuk NPK", KLINIK: "Klinik", OLI: "Oli" };

export const ACTIONS = [
  { key: "view", label: "Lihat" },
  { key: "input", label: "Input" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Hapus" },
  { key: "koreksi", label: "Koreksi" },
  { key: "opname", label: "Opname" },
  { key: "approve", label: "Approve Opname" },
] as const;
export type Action = (typeof ACTIONS)[number]["key"];

// Which actions each module has (only Gudang and Klinik have Koreksi of a single item; every module
// has Stok Opname: Opname = create + count, Approve Opname = approve / send back).
export const MODULE_ACTIONS: Record<Module, Action[]> = {
  GUDANG: ["view", "input", "edit", "delete", "koreksi", "opname", "approve"],
  BBM: ["view", "input", "edit", "delete", "opname", "approve"],
  PUPUK: ["view", "input", "edit", "delete", "opname", "approve"],
  KLINIK: ["view", "input", "edit", "delete", "koreksi", "opname", "approve"],
  OLI: ["view", "input", "edit", "delete", "opname", "approve"],
};
export const modulePerm = (m: Module, a: Action) => `${m.toLowerCase()}.${a}`;

export const OTHER_PERMS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: "Master Data",
    items: [
      { key: "master.barang", label: "Barang" },
      { key: "master.obat", label: "Obat" },
      { key: "master.oli", label: "Oli" },
      { key: "master.karyawan", label: "Karyawan" },
      { key: "master.alat", label: "Alat Berat" },
      { key: "master.users", label: "Pengguna" },
    ],
  },
  { group: "Monitoring", items: [{ key: "monitor.log_user", label: "Log Aktivitas User" }] },
];

export const ALL_PERMS: string[] = [
  ...MODULES.flatMap((m) => MODULE_ACTIONS[m].map((a) => modulePerm(m, a))),
  ...OTHER_PERMS.flatMap((g) => g.items.map((i) => i.key)),
];

// Quick presets for the Pengguna form; the boxes stay editable afterwards.
const viewInput = (mods: Module[]) => mods.flatMap((m) => [modulePerm(m, "view"), modulePerm(m, "input")]);
export const PERM_TEMPLATES: { label: string; perms: string[] }[] = [
  { label: "Admin Gudang/BBM/Pupuk/Oli", perms: viewInput(["GUDANG", "BBM", "PUPUK", "OLI"]) },
  { label: "Admin Klinik", perms: viewInput(["KLINIK"]) },
  { label: "Hanya Lihat", perms: MODULES.map((m) => modulePerm(m, "view")) },
  { label: "Semua modul (penuh)", perms: MODULES.flatMap((m) => MODULE_ACTIONS[m].map((a) => modulePerm(m, a))) },
];

// Add-on presets for Stok Opname: add the action (with Lihat) to every module the account already
// has something ticked in, or to every module when nothing is ticked yet. Other boxes stay as they are.
export const OPNAME_TEMPLATES: { label: string; action: "opname" | "approve" }[] = [
  { label: "+ Hitung Opname", action: "opname" },
  { label: "+ Approve Opname", action: "approve" },
];
export function addOpnamePerm(perms: string[], action: "opname" | "approve"): string[] {
  const held = MODULES.filter((m) => perms.some((p) => p.startsWith(`${m.toLowerCase()}.`)));
  const mods = held.length ? held : [...MODULES];
  return [...new Set([...perms, ...mods.flatMap((m) => [modulePerm(m, "view"), modulePerm(m, action)])])];
}

export function can(user: AuthUser | null, perm: string): boolean {
  if (!user) return false;
  return user.role === "superuser" || (user.perms ?? []).includes(perm);
}

export function canModule(user: AuthUser | null, m: Module): boolean {
  return can(user, modulePerm(m, "view"));
}

// Estates this account can open (all five for a superuser).
export function userEstates(user: AuthUser | null): string[] {
  if (!user) return [];
  return user.estates ?? (user.estate ? [user.estate] : []);
}

// Which module an inventory page path belongs to ("/inventory-bbm-kns" -> BBM).
export function moduleOfPath(path: string): Module | null {
  if (path.startsWith("/inventory-bbm")) return "BBM";
  if (path.startsWith("/inventory-pupuk")) return "PUPUK";
  if (path.startsWith("/inventory-klinik")) return "KLINIK";
  if (path.startsWith("/inventory-oli")) return "OLI";
  if (path.startsWith("/inventory")) return "GUDANG";
  return null;
}

// Which estate an inventory page path belongs to ("/inventory-bbm-kns" -> KNS, "/inventory" -> NILAM).
export function estateOfPath(path: string): string | null {
  if (!moduleOfPath(path)) return null;
  const m = path.match(/-(kns|wja|zamrud|firus)$/);
  return m ? m[1].toUpperCase() : "NILAM";
}

// Permission needed for the non-inventory pages in the sidebar / router.
export const PAGE_PERMS: Record<string, string> = {
  "/master-barang": "master.barang",
  "/master-obat": "master.obat",
  "/master-oli": "master.oli",
  "/karyawan": "master.karyawan",
  "/alat-berat": "master.alat",
  "/users": "master.users",
  "/log-user": "monitor.log_user",
};

// Stok Opname of a module: seen with its Lihat, Opname or Approve permission (as on the server).
export function canOpname(user: AuthUser | null, m: Module, a: "view" | "opname" | "approve" = "view"): boolean {
  return (a === "view" ? (["view", "opname", "approve"] as const) : [a]).some((x) => can(user, modulePerm(m, x)));
}

// The Stok Opname page is open to anyone with an opname permission of some module.
export const OPNAME_PATH = "/stok-opname";
const hasOpnameAccess = (user: AuthUser | null) => MODULES.some((m) => can(user, modulePerm(m, "opname")) || can(user, modulePerm(m, "approve")));

// Pinjaman antar estate: seen with any module's Lihat, recorded with that module's Input.
export const PINJAMAN_PATH = "/pinjaman";

// Laporan Harian Klinik (KPI): seen with Klinik Lihat, for the account's own clinics.
export const LAPORAN_KLINIK_PATH = "/laporan-klinik";

// Whether a non-inventory page (sidebar / router) may be opened.
export function pageAllowed(user: AuthUser | null, path: string): boolean {
  if (!user) return false;
  if (user.role === "superuser") return true;
  if (path === OPNAME_PATH || path.startsWith(`${OPNAME_PATH}/`)) return hasOpnameAccess(user);
  if (path === PINJAMAN_PATH) return MODULES.some((m) => canModule(user, m));
  if (path === LAPORAN_KLINIK_PATH) return canModule(user, "KLINIK");
  return !!PAGE_PERMS[path] && can(user, PAGE_PERMS[path]);
}

// One-line summary of an account's access for lists and reports, e.g.
// "ZAMRUD, FIRUS · Gudang (Lihat, Input) · BBM (Lihat) · Master Obat".
export function accessSummary(u: { role: string; estates: string | null; perms: string | null; temp_full_until?: string | null }): string {
  if (u.role === "superuser") return "Super User (semua akses)";
  const temp = u.temp_full_until && new Date(u.temp_full_until) > new Date() ? new Date(u.temp_full_until) : null;
  const perms = (u.perms ?? "").split(",").filter(Boolean);
  const parts = MODULES.map((m) => {
    const acts = MODULE_ACTIONS[m].filter((a) => perms.includes(modulePerm(m, a)));
    return acts.length ? `${MODULE_LABELS[m]} (${acts.map((a) => ACTIONS.find((x) => x.key === a)!.label).join(", ")})` : "";
  }).filter(Boolean);
  for (const g of OTHER_PERMS) for (const i of g.items) if (perms.includes(i.key)) parts.push(`${g.group === "Master Data" ? "Master " : ""}${i.label}`);
  const estates = (u.estates ?? "").split(",").filter(Boolean).join(", ") || "tanpa estate";
  const tempNote = temp ? ` · AKSES PENUH SEMENTARA (modul di atas) s/d ${temp.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}` : "";
  return `${estates} · ${parts.join(" · ") || "tanpa hak akses"}${tempNote}`;
}
