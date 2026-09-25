import type { AuthUser } from "./api";

// Checkbox access of an account. A superuser has every estate and permission; an estate account
// only what is ticked for it in Pengguna. Mirrors ALL_PERMS / requiredPerms() in server/src/app.ts,
// which is the actual security boundary - this only decides what to show.
export const MODULES = ["GUDANG", "BBM", "PUPUK", "KLINIK"] as const;
export type Module = (typeof MODULES)[number];
export const MODULE_LABELS: Record<Module, string> = { GUDANG: "Gudang", BBM: "BBM", PUPUK: "Pupuk NPK", KLINIK: "Klinik" };

export const ACTIONS = [
  { key: "view", label: "Lihat" },
  { key: "input", label: "Input" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Hapus" },
  { key: "koreksi", label: "Koreksi" },
] as const;
export type Action = (typeof ACTIONS)[number]["key"];

// Which actions each module has (only Gudang and Klinik have Koreksi / stock opname).
export const MODULE_ACTIONS: Record<Module, Action[]> = {
  GUDANG: ["view", "input", "edit", "delete", "koreksi"],
  BBM: ["view", "input", "edit", "delete"],
  PUPUK: ["view", "input", "edit", "delete"],
  KLINIK: ["view", "input", "edit", "delete", "koreksi"],
};
export const modulePerm = (m: Module, a: Action) => `${m.toLowerCase()}.${a}`;

export const OTHER_PERMS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: "Master Data",
    items: [
      { key: "master.barang", label: "Barang" },
      { key: "master.obat", label: "Obat" },
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
  { label: "Admin Gudang/BBM/Pupuk", perms: viewInput(["GUDANG", "BBM", "PUPUK"]) },
  { label: "Admin Klinik", perms: viewInput(["KLINIK"]) },
  { label: "Hanya Lihat", perms: MODULES.map((m) => modulePerm(m, "view")) },
  { label: "Semua modul (penuh)", perms: MODULES.flatMap((m) => MODULE_ACTIONS[m].map((a) => modulePerm(m, a))) },
];

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
  if (path.startsWith("/inventory")) return "GUDANG";
  return null;
}

// Permission needed for the non-inventory pages in the sidebar / router.
export const PAGE_PERMS: Record<string, string> = {
  "/master-barang": "master.barang",
  "/master-obat": "master.obat",
  "/karyawan": "master.karyawan",
  "/alat-berat": "master.alat",
  "/users": "master.users",
  "/log-user": "monitor.log_user",
};

// One-line summary of an account's access for lists and reports, e.g.
// "ZAMRUD, FIRUS · Gudang (Lihat, Input) · BBM (Lihat) · Master Obat".
export function accessSummary(u: { role: string; estates: string | null; perms: string | null }): string {
  if (u.role === "superuser") return "Super User (semua akses)";
  const perms = (u.perms ?? "").split(",").filter(Boolean);
  const parts = MODULES.map((m) => {
    const acts = MODULE_ACTIONS[m].filter((a) => perms.includes(modulePerm(m, a)));
    return acts.length ? `${MODULE_LABELS[m]} (${acts.map((a) => ACTIONS.find((x) => x.key === a)!.label).join(", ")})` : "";
  }).filter(Boolean);
  for (const g of OTHER_PERMS) for (const i of g.items) if (perms.includes(i.key)) parts.push(`${g.group === "Master Data" ? "Master " : ""}${i.label}`);
  const estates = (u.estates ?? "").split(",").filter(Boolean).join(", ") || "tanpa estate";
  return `${estates} · ${parts.join(" · ") || "tanpa hak akses"}`;
}
