import type { AuthUser } from "./api";

// Checkbox access of an account. A superuser has every estate and permission; an estate account
// only what is ticked for it in Pengguna. Mirrors ALL_PERMS / requiredPerms() in server/src/app.ts,
// which is the actual security boundary - this only decides what to show.
export const MODULES = ["GUDANG", "BBM", "PUPUK", "KLINIK", "OLI"] as const;
export type Module = (typeof MODULES)[number];
export const MODULE_LABELS: Record<Module, string> = { GUDANG: "Gudang", BBM: "BBM", PUPUK: "Pupuk", KLINIK: "Klinik", OLI: "Oli" };

export const ACTIONS = [
  { key: "view", label: "Lihat" },
  { key: "input", label: "Input" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Hapus" },
  { key: "opname", label: "Opname" },
  { key: "approve", label: "Approve Opname" },
] as const;
export type Action = (typeof ACTIONS)[number]["key"];

// Which actions each module has: Stok Opname (Opname = create + count, Approve Opname = approve / send
// back). A one-item Koreksi Stok is Super User only; every other difference goes through a Stok Opname.
export const MODULE_ACTIONS: Record<Module, Action[]> = {
  GUDANG: ["view", "input", "edit", "delete", "opname", "approve"],
  BBM: ["view", "input", "edit", "delete", "opname", "approve"],
  PUPUK: ["view", "input", "edit", "delete", "opname", "approve"],
  KLINIK: ["view", "input", "edit", "delete", "opname", "approve"],
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
      { key: "master.pupuk", label: "Pupuk" },
      { key: "master.karyawan", label: "Karyawan" },
      { key: "master.alat", label: "Alat Berat" },
      { key: "master.blok", label: "Blok" },
      { key: "master.peta", label: "Lihat Peta Blok" },
      { key: "master.peta_edit", label: "Ubah Peta Blok" },
      { key: "dokumen.edit", label: "Dokumen & Link (tambah; ubah / hapus dokumen buatan sendiri)" },
      { key: "dokumen.kelola", label: "Kelola semua Dokumen & Link (ubah / hapus / kunci dokumen siapa pun)" },
      { key: "sop.view", label: "Lihat Daftar SOP" },
      { key: "sop.edit", label: "Ubah Daftar SOP (tambah SOP di tiap bagian, ubah / hapus SOP yang tidak dikunci)" },
      { key: "sop.kunci", label: "Kunci Daftar SOP (kunci / buka kunci SOP atau satu bagian, ubah SOP yang dikunci)" },
      { key: "master.users", label: "Pengguna" },
    ],
  },
  {
    group: "Klinik",
    items: [
      { key: "klinik.ttd_dibuat", label: "Tanda tangan Permintaan Obat: Dibuat oleh (Manager Estate)" },
      { key: "klinik.ttd_diketahui", label: "Tanda tangan Permintaan Obat: Diketahui (GM Finance & Audit)" },
      { key: "klinik.ttd_disetujui1", label: "Tanda tangan Permintaan Obat: Disetujui 1 (Corporate GM Plantation)" },
      { key: "klinik.ttd_disetujui2", label: "Tanda tangan Permintaan Obat: Disetujui 2 (Head of Business Unit)" },
      { key: "klinik.permintaan_approve", label: "Approve Permintaan Obat per item (setelah ditandatangani lengkap; sebagian & tolak wajib alasan)" },
    ],
  },
  { group: "Monitoring", items: [{ key: "monitor.log_user", label: "Log Aktivitas User" }] },
  {
    group: "Koperasi PT.AKSS",
    items: [
      { key: "koperasi.view", label: "Lihat Koperasi" },
      { key: "koperasi.input", label: "Input Koperasi (pengambilan, pembelian, rusak)" },
      { key: "koperasi.edit", label: "Edit Koperasi (hapus transaksi, barang, anggota)" },
      { key: "koperasi.pelunasan", label: "Pelunasan Koperasi (tandai lunas / belum lunas, untuk HR)" },
      { key: "koperasi.approve", label: "Approve Koperasi (periksa barang rusak / expired dan koreksi stok, selesaikan stok opname; bukan yang menginput)" },
    ],
  },
  {
    group: "Kendaraan & Alat Berat",
    items: [
      { key: "kendaraan.view", label: "Lihat Kendaraan & Alat Berat" },
      { key: "kendaraan.input", label: "Input Kendaraan (kondisi harian, unit rusak / selesai)" },
      { key: "kendaraan.edit", label: "Edit Kendaraan (tambah / ubah data unit)" },
    ],
  },
  {
    group: "Pruning PT.AKSS",
    items: [
      { key: "pruning.view", label: "Lihat Pruning (riwayat & rekap per blok)" },
      { key: "pruning.input", label: "Input Pruning" },
      { key: "pruning.edit", label: "Edit Pruning (ubah / hapus input, target Ha & SPH blok)" },
    ],
  },
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

// Edit / hapus bulan berjalan (same as the server's editTooLate): without the module's Approve, a
// transaction can be edited / deleted only while its date is in the current month.
const rowDay = (row: Record<string, any>): string => {
  const d = row.tanggal_iso ?? row.tanggal_keluar_iso ?? row.tanggal_terima_iso;
  if (d) return String(d);
  if (!row.created_at) return "";
  const t = new Date(row.created_at);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
export function canEditRow(user: AuthUser | null, m: Module, row: object, action: "edit" | "delete" = "edit"): boolean {
  if (!can(user, modulePerm(m, action))) return false;
  if (user!.role === "superuser" || can(user, modulePerm(m, "approve"))) return true;
  // Edit bulan lalu, given for a while by a Super User: edit only, never delete.
  if (action === "edit" && user!.editLampauUntil && new Date(user!.editLampauUntil) > new Date()) return true;
  const now = new Date();
  return rowDay(row as Record<string, any>).slice(0, 7) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Tambah Bukti on older transactions without a photo: open for these estates (as on the server's
// EVIDENCE_ANYTIME) to an account with Input or Edit of the module.
export const EVIDENCE_ANYTIME_ESTATES = ["KNS"];
export function canAttachEvidence(user: AuthUser | null, m: Module, estate: string | null | undefined): boolean {
  if (!user || !estate) return false;
  if (user.role === "superuser") return true;
  return EVIDENCE_ANYTIME_ESTATES.includes(estate) && (can(user, modulePerm(m, "input")) || can(user, modulePerm(m, "edit")));
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
  "/master-pupuk": "master.pupuk",
  "/karyawan": "master.karyawan",
  "/alat-berat": "master.alat",
  "/master-blok": "master.blok",
  "/peta-blok": "master.blok",
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

// Master Pasien: the patients of the account's clinics, with Klinik Lihat (Input / Edit / Hapus to change).
export const PASIEN_PATH = "/master-pasien";

// Koperasi karyawan: only Nilam runs one for now; seen with Lihat Koperasi by an account with Nilam.
export const KOPERASI_PATH = "/koperasi";
// Kendaraan & Alat Berat (PT.AKSS): seen with Lihat Kendaraan.
export const KENDARAAN_PATH = "/kendaraan";

// Pruning PT.AKSS: seen with Lihat, Input or Edit Pruning - but the Kebun menu is hidden for now, Super User
// only (KEBUN_HANYA_SUPER, the same switch on the server).
export const PRUNING_PATH = "/pruning";
export const KEBUN_HANYA_SUPER = true;
export const kebunTerlihat = (user: AuthUser | null) => !!user && (user.role === "superuser" || !KEBUN_HANYA_SUPER);

// Dokumen & Link: every account sees the links of its estates; Kelola Dokumen adds / edits them.
export const DOKUMEN_PATH = "/dokumen";
// Persetujuan: the requests waiting for the account's signature, for whoever may sign a box of the Permintaan Obat.
export const PERSETUJUAN_PATH = "/persetujuan";
export const TTD_PERMS = ["klinik.ttd_dibuat", "klinik.ttd_diketahui", "klinik.ttd_disetujui1", "klinik.ttd_disetujui2"];
// Daftar SOP: seen with Lihat, Ubah or Kunci Daftar SOP.
export const SOP_PATH = "/sop";
export const KOPERASI_ESTATE = "NILAM";

// The main Dashboard only shows inventory modules. An account without any module (e.g. the koperasi
// admin, HR, a Kendaraan-only account) has nothing there, so it lands on the first page it can open
// instead - Koperasi first, Dokumen & Link (open to everyone) last.
const LANDING_PAGES = [
  "/persetujuan",
  KOPERASI_PATH,
  KENDARAAN_PATH,
  PRUNING_PATH,
  "/log-user",
  "/users",
  "/karyawan",
  "/master-barang",
  "/master-obat",
  "/master-oli",
  "/master-pupuk",
  "/alat-berat",
  "/master-blok",
  "/peta-blok",
  DOKUMEN_PATH,
];
export function hasDashboard(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.role === "superuser" || MODULES.some((m) => canModule(user, m));
}
export function landingPath(user: AuthUser | null): string {
  if (hasDashboard(user)) return "/";
  return LANDING_PAGES.find((p) => pageAllowed(user, p)) ?? DOKUMEN_PATH;
}

// Whether a non-inventory page (sidebar / router) may be opened.
export function pageAllowed(user: AuthUser | null, path: string): boolean {
  if (!user) return false;
  if (user.role === "superuser") return true;
  if (path === OPNAME_PATH || path.startsWith(`${OPNAME_PATH}/`)) return hasOpnameAccess(user);
  if (path === PINJAMAN_PATH) return MODULES.some((m) => canModule(user, m));
  if (path === PASIEN_PATH) return canModule(user, "KLINIK");
  if (path === DOKUMEN_PATH) return true;
  if (path === PERSETUJUAN_PATH) return TTD_PERMS.some((p) => can(user, p));
  if (path === SOP_PATH || path.startsWith(`${SOP_PATH}/`)) return ["sop.view", "sop.edit", "sop.kunci"].some((p) => can(user, p));
  if (path === KOPERASI_PATH) return can(user, "koperasi.view") && userEstates(user).includes(KOPERASI_ESTATE);
  if (path === KENDARAAN_PATH) return can(user, "kendaraan.view");
  if (path === PRUNING_PATH) return !KEBUN_HANYA_SUPER && ["pruning.view", "pruning.input", "pruning.edit"].some((p) => can(user, p));
  // Peta Blok: seen with Lihat Peta Blok, Ubah Peta Blok or Master Blok.
  if (path === "/peta-blok") return ["master.peta", "master.peta_edit", "master.blok"].some((p) => can(user, p));
  return !!PAGE_PERMS[path] && can(user, PAGE_PERMS[path]);
}

// One-line summary of an account's access for lists and reports, e.g.
// "ZAMRUD, FIRUS · Gudang (Lihat, Input) · BBM (Lihat) · Master Obat".
export function accessSummary(u: { role: string; estates: string | null; perms: string | null; temp_full_until?: string | null; edit_lampau_until?: string | null }): string {
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
  const lampau = u.edit_lampau_until && new Date(u.edit_lampau_until) > new Date() ? new Date(u.edit_lampau_until) : null;
  const lampauNote = lampau ? ` · EDIT BULAN LALU s/d ${lampau.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" })}` : "";
  return `${estates} · ${parts.join(" · ") || "tanpa hak akses"}${tempNote}${lampauNote}`;
}
