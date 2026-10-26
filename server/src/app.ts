import express from "express";
import fs from "fs/promises";
import nodePath from "path";
import cookieParser from "cookie-parser";
import type { PoolClient } from "pg";
import { queryMany, queryOne, execute, withTransaction, txTime } from "./db.js";
import { canonProvider, labelKey, splitDiagnosis } from "./klinikLaporan.js";
import { namaKey, namaMirip, sameTahun } from "./pasien.js";
import { COOKIE_NAME, hashPassword, verifyPassword, signSession, verifySession, ESTATES, ALL_PERMS, MODULE_PERMS, parseList, type SessionUser } from "./auth.js";

export const app = express();
// Frontend and API are always same-origin (one Vercel domain in production, Vite's dev proxy
// locally) - no cross-origin requests happen, so no CORS middleware is needed. Keeping it out
// matters now that auth uses a cookie: a permissive `cors()` would otherwise widen who can send
// credentialed requests.
// Photos (foto bukti) arrive as base64 JSON, already shrunk to a few hundred KB in the browser.
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

const isProd = process.env.NODE_ENV === "production";

function setSessionCookie(res: express.Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// ---- Auth ----
// ---- Session user: the cookie names the account, access is read fresh from users ----
type UserRow = {
  id: number;
  username: string;
  nama: string;
  role: "superuser" | "estate";
  estate: string | null;
  estates: string | null;
  perms: string | null;
  temp_full_until: Date | null;
  temp_full_modules?: string | null;
  edit_lampau_until?: Date | null;
};

// Temporary full access (users.temp_full_until): until it expires, every action (edit, hapus,
// koreksi, approve...) of the modules the account already has, in its own estates. It never opens a
// module the account has nothing ticked in (a klinik account stays in Klinik).
// temp_full_modules (e.g. "bbm") narrows it to those modules; empty = every module it holds.
function withTempFull(perms: string[], until: Date | null, modules?: string | null): string[] {
  if (!until || until <= new Date()) return perms;
  const held = new Set(perms.filter((p) => MODULE_PERMS.includes(p)).map((p) => p.split(".")[0]));
  const only = (modules ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  if (only.length) for (const m of [...held]) if (!only.includes(m)) held.delete(m);
  return [...new Set([...perms, ...MODULE_PERMS.filter((p) => held.has(p.split(".")[0]))])];
}

function toSessionUser(row: UserRow): SessionUser {
  const superuser = row.role === "superuser";
  const estates = superuser ? [...ESTATES] : parseList(row.estates ?? row.estate, ESTATES);
  return {
    id: row.id,
    username: row.username,
    nama: row.nama,
    role: row.role,
    estate: (estates[0] ?? null) as SessionUser["estate"],
    estates,
    perms: superuser
      ? [...ALL_PERMS]
      : withTempFull(parseList(row.perms, ALL_PERMS), row.temp_full_until, row.temp_full_modules),
    editLampauUntil: row.edit_lampau_until && row.edit_lampau_until > new Date() ? row.edit_lampau_until.toISOString() : null,
  };
}

// Short per-instance cache so every API call doesn't hit the users table; cleared when an account
// is changed here, so a new checkbox applies within seconds everywhere.
const sessionCache = new Map<number, { user: SessionUser; at: number }>();
const SESSION_TTL_MS = 15_000;
// A session in use is renewed (a fresh 7-day cookie) at most once an hour, so an account working in
// the app is never logged out in the middle of a form - only one left unused for 7 days.
const SESSION_RENEW_S = 60 * 60;
// Last seen of an account (Log Aktivitas User > Sedang online): written at most once a minute per
// instance, or at once when the page it is on changes. A failure never fails the request.
const seen = new Map<number, { at: number; page: string }>();
async function markSeen(id: number, req: express.Request) {
  const page = String(req.get("x-page") ?? "").slice(0, 200);
  const last = seen.get(id);
  if (last && Date.now() - last.at < 60_000 && (!page || page === last.page)) return;
  seen.set(id, { at: Date.now(), page: page || last?.page || "" });
  await execute("UPDATE users SET last_seen_at = now(), last_page = COALESCE(NULLIF(@page, ''), last_page) WHERE id = @id", { id, page }).catch(() => {});
}
async function sessionFromCookie(req: express.Request, res?: express.Response): Promise<SessionUser | null> {
  const token = req.cookies?.[COOKIE_NAME];
  const claims = token ? verifySession(token) : null;
  if (!claims) return null;
  const renew = (u: SessionUser) => {
    if (res && claims.iat && Date.now() / 1000 - claims.iat > SESSION_RENEW_S) setSessionCookie(res, signSession(u));
    return u;
  };
  await markSeen(claims.id, req);
  const hit = sessionCache.get(claims.id);
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return renew(hit.user);
  const row = await queryOne<UserRow>("SELECT id, username, nama, role, estate, estates, perms, temp_full_until, temp_full_modules, edit_lampau_until FROM users WHERE id = @id", { id: claims.id });
  if (!row) return null;
  const user = toSessionUser(row);
  sessionCache.set(user.id, { user, at: Date.now() });
  return renew(user);
}

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username dan password wajib diisi" });

  // The username is matched case-insensitively (Admin1 = admin1 = ADMIN1); only the password is exact.
  const row = await queryOne<UserRow & { password_hash: string }>("SELECT * FROM users WHERE LOWER(username) = LOWER(@username) ORDER BY id LIMIT 1", {
    username: String(username).trim(),
  });
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: "Username atau password salah" });
  }

  const user = toSessionUser(row);
  setSessionCookie(res, signSession(user));
  // Login history for the Log Aktivitas User page; a failure here never blocks the login.
  await execute("INSERT INTO login_log (user_id) VALUES (@id)", { id: user.id }).catch((e) => console.error("login log failed", e));
  res.json({ user });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

// Whether foto bukti is switched on (photo storage configured); public, no secrets.
app.get("/api/evidence-status", (_req, res) => res.json({ enabled: evidenceEnabled() }));

app.get("/api/auth/me", async (req, res) => {
  const user = await sessionFromCookie(req, res);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  res.json({ user });
});

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

// ---- Everything else under /api requires a valid session ----
app.use("/api", async (req, res, next) => {
  const user = await sessionFromCookie(req, res);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.user = user;
  next();
});

// ---- Access: a superuser can do everything; an estate account only what is ticked for it ----
// Each request maps to the permission(s) that allow it (any one is enough): the module from the
// path (without the /api prefix), the action from the method. "super" = superusers
// only; null = any logged-in account (the route still checks the estate itself).
type Need = string[] | "super" | null;
// Kebun (Pruning PT.AKSS, and its tab on the Peta Blok) is hidden for now: only a Super User sees it, whatever
// pruning ticks an account has (they are kept for when it opens). Same switch in src/lib/access.ts.
const KEBUN_HANYA_SUPER = true;
const TTD_PERMS = ["klinik.ttd_dibuat", "klinik.ttd_diketahui", "klinik.ttd_disetujui1", "klinik.ttd_disetujui2"];
// The signers who may also approve / refuse single items (Sebagian / Ditolak with an alasan): Finance, GM, Head.
const TTD_ITEM_PERMS = ["klinik.ttd_diketahui", "klinik.ttd_disetujui1", "klinik.ttd_disetujui2"];
// Their rank for an item's decision: a higher one may change a lower one's, not the other way round.
const ITEM_RANK_LABEL = ["Approve Permintaan Obat", "Diketahui (Finance)", "Disetujui 1 (GM)", "Disetujui 2 (Head)", "Super User"];
const itemRank = (u: SessionUser) =>
  u.role === "superuser" ? 4 : Math.max(0, ...TTD_ITEM_PERMS.map((x, i) => (u.perms.includes(x) ? i + 1 : 0)));
const ACTIVITY_PERM: Record<string, string> = { BARANG: "gudang", BBM: "bbm", PUPUK: "pupuk", KLINIK: "klinik", OLI: "oli", KOPERASI: "koperasi", KENDARAAN: "kendaraan", PRUNING: "pruning" };
function requiredPerms(req: express.Request): Need {
  // Inside app.use("/api") req.path is relative to the mount, inside a route it is the full path.
  const p = (req.baseUrl + req.path).replace(/^\/api/, "");
  const m = req.method;
  const q = req.query as Record<string, string>;
  const act = m === "GET" ? "view" : m === "POST" ? "input" : m === "PUT" ? "edit" : m === "DELETE" ? "delete" : "";
  const is = (re: RegExp) => re.test(p);

  if (is(/^\/auth\//) || is(/^\/karyawan\/pick$/) || is(/^\/alat-berat\/pick$/)) return null;
  // Stok Opname: each route checks the opname's own module (view / opname / approve) and estate.
  if (is(/^\/stock-opname(\/|$)/)) return null;
  // Log Stok Opname: the route lists the modules / estates whose opnames the account may see.
  if (is(/^\/stock-opname-log$/)) return null;
  // Chat: any logged-in account; each route checks that the room is one of the account's.
  if (is(/^\/chat(\/|$)/)) return null;
  // Berita Acara Pemusnahan: each route checks the modul's permission (Klinik / Koperasi) and the unit itself.
  if (is(/^\/berita-acara(\/|$)/)) return null;
  // Persetujuan: how much waits for the account's signature (the route counts only what it may sign).
  if (is(/^\/persetujuan\/jumlah$/)) return null;
  // Pinjaman antar estate: each route checks the loan's module (view / input) and estates itself.
  if (is(/^\/pinjaman(\/|$)/)) return null;
  // Perbandingan antar estate: the route checks the module's Lihat and the estates itself.
  if (is(/^\/perbandingan(\/|$)/)) return null;
  // Pemakaian per bulan: the route checks the module's Lihat and the estate itself.
  if (is(/^\/pemakaian(\/|$)/)) return null;
  // Dokumen & Link: every account sees the links of its estates (the route filters); changing them needs Kelola Dokumen.
  // Dokumen & Link: add with Dokumen & Link; change / delete one's own (not locked) - checked in the route - or
  // every one with Kelola semua.
  if (is(/^\/dokumen(\/|$)/)) return m === "GET" ? null : ["dokumen.edit", "dokumen.kelola"];
  // Daftar SOP: Lihat; added / changed / deleted with Ubah (the route refuses a locked one); locked with Kunci.
  if (is(/^\/sop\/kunci$/)) return ["sop.kunci"];
  if (is(/^\/sop(\/|$)/)) return m === "GET" ? ["sop.view", "sop.edit", "sop.kunci"] : ["sop.edit", "sop.kunci"];
  // Status Update: the route lists only the estates and modules the account can see.
  if (is(/^\/status-update$/)) return null;
  // Foto bukti: any logged-in account uploads for its own transactions (the transaction route checks).
  if (is(/^\/evidence(\/|$)/)) return null;
  // Koreksi Stok of one item: Super User only (with a reason); other differences go through a Stok Opname.
  if (is(/^\/(stock-correction|gudang-stock\/correction|klinik-stock\/correction)$/)) return "super";
  // items = the master barang list, which is also Nilam's gudang stock.
  if (is(/^\/items$/) && m === "GET") return ["gudang.view", "master.barang"];
  if (is(/^\/items(\/\d+)?$/) && m !== "GET") return ["master.barang", `gudang.${act}`];
  if (is(/^\/satuan-options$/)) return ["gudang.view", "master.barang"];
  if (is(/^\/(summary|items|transactions|stock-in|stock-out|gudang-stock)(\/|$)/)) return [`gudang.${act}`];
  if (is(/^\/bbm(\/|$)/)) return [`bbm.${act}`];
  if (is(/^\/pupuk(\/|$)/)) return [`pupuk.${act}`];
  if (is(/^\/oli(\/|$)/)) return [`oli.${act}`];
  // Obat expired / rusak / retur: checked (Setujui / Tolak) by a second account with Approve Klinik.
  if (is(/^\/klinik-stock\/tarik\/\d+\/periksa$/)) return ["klinik.approve"];
  if (is(/^\/klinik-stock(\/|$)/)) return [`klinik.${act}`];
  // Klinik > Laporan Harian: Lihat / Input / Edit / Hapus kunjungan (estate checked in the route).
  if (is(/^\/klinik-laporan(\/|$)/)) return [`klinik.${act}`];
  // Permintaan Obat: Lihat; buat / ubah / ajukan / catat pemenuhan with Input; hapus with Hapus.
  // Tanda tangan Permintaan Obat: the waiting list and signing with a level's tick (the route checks which level
  // is next); the signers may open a request without Lihat Klinik.
  if (is(/^\/klinik-permintaan\/(menunggu|\d+\/ttd)$/)) return TTD_PERMS;
  if (is(/^\/klinik-permintaan\/\d+$/) && m === "GET") return ["klinik.view", ...TTD_PERMS];
  // Pemenuhan: dipenuhi / tanggal with Input Klinik, the status approval with Approve Permintaan Obat (checked in the route).
  if (is(/^\/klinik-permintaan\/\d+\/pemenuhan$/)) return ["klinik.input", "klinik.permintaan_approve", ...TTD_ITEM_PERMS];
  if (is(/^\/klinik-permintaan(-rekap)?(\/|$)/)) return m === "GET" ? ["klinik.view"] : m === "DELETE" ? ["klinik.delete"] : ["klinik.input"];
  // Master Pasien: the patients of the account's clinics (estate checked in the route).
  if (is(/^\/pasien(\/|$)/)) return [`klinik.${act}`];
  if (is(/^\/top-keluar$/)) return [q.source === "klinik" ? "klinik.view" : "gudang.view"];
  if (is(/^\/activity-log$/) && q.module === "SOP") return ["sop.view", "sop.edit", "sop.kunci"];
  if (is(/^\/activity-log$/)) return ACTIVITY_PERM[q.module] ? [`${ACTIVITY_PERM[q.module]}.view`] : "super";
  if (is(/^\/obat(\/|$)/)) return ["master.obat"];
  if (is(/^\/master-oli(\/|$)/)) return ["master.oli"];
  if (is(/^\/master-pupuk(\/|$)/)) return ["master.pupuk"];
  if (is(/^\/karyawan(\/|$)/)) return ["master.karyawan"];
  if (is(/^\/alat-berat(\/|$)/)) return ["master.alat"];
  if (is(/^\/master-blok(\/|$)/)) return ["master.blok"];
  // Peta Blok: seen with Lihat Peta Blok, Ubah Peta Blok or Master Blok; colours / legend changed only with Ubah Peta Blok.
  // Kebun (pruning) is hidden for now: Super User only (KEBUN_HANYA_SUPER), also on the Peta Blok.
  if (KEBUN_HANYA_SUPER && (is(/^\/pruning(\/|$)/) || is(/^\/peta-blok\/pruning$/))) return "super";
  if (is(/^\/peta-blok(\/|$)/)) return m === "GET" ? ["master.peta", "master.peta_edit", "master.blok"] : ["master.peta_edit"];
  if (is(/^\/users(\/|$)/)) return ["master.users"];
  if (is(/^\/user-activity$/) || is(/^\/user-online$/)) return ["monitor.log_user"];
  // Koperasi: Lihat; Input = pengambilan / pembelian / barang rusak; Edit = hapus transaksi and the master barang / anggota.
  // Stok opname: start / fill in the counts with Input; Selesai / Batal and Koreksi Stok with Edit.
  // Kendaraan & Alat Berat: Lihat; Input = kondisi harian and a unit's rusak / selesai; Edit = add / change units.
  // Lengkapi Data (a month's missing SPB / bukti ...): seen with the module's Lihat, saved with its Input or Edit.
  {
    const lk = p.match(/^\/lengkapi\/(bbm|pupuk|oli|gudang|klinik|nilam_masuk|nilam_keluar)$/);
    const mod = lk && (lk[1].startsWith("nilam_") ? "gudang" : lk[1]);
    if (mod) return m === "GET" ? [`${mod}.view`] : [`${mod}.input`, `${mod}.edit`];
  }
  // Pruning PT.AKSS: Lihat (riwayat, rekap); Input = new entries (form or Excel upload); Edit = change / delete entries and a blok's target.
  if (is(/^\/pruning(\/|$)/)) return m === "GET" ? ["pruning.view", "pruning.input", "pruning.edit"] : m === "POST" && is(/^\/pruning(\/import)?$/) ? ["pruning.input"] : ["pruning.edit"];
  if (is(/^\/kendaraan(\/|$)/)) {
    if (m === "GET") return ["kendaraan.view"];
    if (is(/^\/kendaraan\/harian(\/isi)?$/) || is(/^\/kendaraan\/unit\/\d+\/kondisi$/)) return ["kendaraan.input"];
    return ["kendaraan.edit"];
  }
  if (is(/^\/koperasi(\/|$)/)) {
    if (m === "GET") return ["koperasi.view"];
    // Pelunasan (record / tandai lunas / delete a payment): its own tick, given to HR only.
    if (is(/^\/koperasi\/bayar(\/|$)/)) return ["koperasi.pelunasan"];
    // Barang Rusak / Expired and Koreksi Stok: checked (Setujui / Tolak) by a second account with Approve Koperasi;
    // finishing a stok opname (it books the koreksi) too.
    if (is(/^\/koperasi\/(rusak|koreksi)\/\d+\/periksa$/) || is(/^\/koperasi\/opname\/\d+\/selesai$/)) return ["koperasi.approve"];
    const input =
      (m === "POST" && is(/^\/koperasi\/((jual|beli|rusak)(\/batch)?|opname|koreksi|depo\/biaya)$/)) || (m === "PUT" && is(/^\/koperasi\/opname\/\d+\/lines$/));
    return input ? ["koperasi.input"] : ["koperasi.edit"];
  }
  return "super";
}

// "bbm.edit" -> "Edit BBM", for telling the user which tick in Pengguna is missing.
const PERM_MODUL: Record<string, string> = { gudang: "Gudang", bbm: "BBM", pupuk: "Pupuk", klinik: "Klinik", oli: "Oli", koperasi: "Koperasi", kendaraan: "Kendaraan", pruning: "Pruning" };
const PERM_AKSI: Record<string, string> = { view: "Lihat", input: "Input", edit: "Edit", delete: "Hapus", koreksi: "Koreksi", opname: "Opname", approve: "Approve", pelunasan: "Pelunasan" };
const permLabel = (p: string) => {
  const [m, a] = p.split(".");
  if (PERM_MODUL[m]) return `${PERM_AKSI[a] ?? a} ${PERM_MODUL[m]}`;
  const other: Record<string, string> = { "dokumen.edit": "Dokumen & Link", "dokumen.kelola": "Kelola semua Dokumen & Link", "klinik.permintaan_approve": "Approve Permintaan Obat", "ba.setujui": "Setujui Berita Acara Pemusnahan", "klinik.ttd_dibuat": "Tanda tangan Permintaan Obat (Dibuat oleh)",
    "klinik.ttd_diketahui": "Tanda tangan Permintaan Obat (Diketahui)", "klinik.ttd_disetujui1": "Tanda tangan Permintaan Obat (Disetujui 1)",
    "klinik.ttd_disetujui2": "Tanda tangan Permintaan Obat (Disetujui 2)", "sop.view": "Lihat Daftar SOP", "sop.edit": "Ubah Daftar SOP", "sop.kunci": "Kunci Daftar SOP", "master.peta": "Lihat Peta Blok", "master.peta_edit": "Ubah Peta Blok", "master.alat": "Master Alat Berat", "master.users": "Pengguna", "monitor.log_user": "Log Aktivitas User" };
  return other[p] ?? (m === "master" ? `Master ${a.charAt(0).toUpperCase()}${a.slice(1)}` : p);
};

app.use("/api", (req, res, next) => {
  if (req.user!.role === "superuser") return next();
  const need = requiredPerms(req);
  if (need === "super") return res.status(403).json({ error: "Hanya Super User yang bisa melakukan ini" });
  if (need && !need.some((p) => req.user!.perms.includes(p))) {
    return res.status(403).json({ error: `Akun ini tidak punya hak ${permLabel(need[0])}. Minta Super User mencentangnya di menu Pengguna.` });
  }
  next();
});

// ---- Stok Opname lock: while a location has an open opname (DRAFT / SUBMITTED) its stock can't move ----
type OpnameModule = "GUDANG" | "KLINIK" | "BBM" | "PUPUK" | "OLI";
type StockLocation = { module: OpnameModule; estate: string };

// The locations whose stock a request would change. Only stock-moving routes are listed: master
// data, buffer/catatan edits and the imported Nilam stock in/out history don't change the stock.
async function stockLocations(req: express.Request): Promise<StockLocation[]> {
  const m = req.method;
  if (m === "GET") return [];
  const p = (req.baseUrl + req.path).replace(/^\/api/, "");
  const b = req.body ?? {};
  const id = p.match(/\/(\d+)$/)?.[1];
  const col = async (table: string, column: string) =>
    id ? (await queryOne<{ v: string }>(`SELECT ${column} v FROM ${table} WHERE id = @id`, { id }))?.v : undefined;
  const at = (module: OpnameModule) => (estate: unknown) => (typeof estate === "string" && estate ? [{ module, estate }] : []);
  const [G, K, B, P, O] = (["GUDANG", "KLINIK", "BBM", "PUPUK", "OLI"] as const).map(at);
  // A Nilam Stok Keluar to another estate's gudang also books a Stok Masuk there (see addTransfer).
  const transferTo = (tujuan: unknown, type: unknown) => (type === "OUT" && GUDANG_STOCK_OPTIONS.includes(String(tujuan)) ? G(tujuan) : []);

  if (p === "/stock-correction") return G("NILAM");
  if (p === "/transactions" && m === "POST") return [...G("NILAM"), ...transferTo(b.tujuan, b.type)];
  // Input Banyak: the location(s) of every row.
  const batchRows: any[] = Array.isArray(b.rows) ? b.rows : [];
  if (p === "/transactions/batch" && m === "POST") return [...G("NILAM"), ...batchRows.flatMap((r) => transferTo(r?.tujuan, r?.type))];
  if (/^\/transactions\/\d+$/.test(p)) {
    const t = await queryOne<{ gudang: string }>("SELECT gudang FROM gudang_stock_tx WHERE transfer_from_id = @id", { id });
    return [...G("NILAM"), ...G(t?.gudang), ...(m === "PUT" ? transferTo(b.tujuan, b.type) : [])];
  }
  if (/^\/stock-(in|out)\/\d+$/.test(p)) {
    const t = await queryOne<{ gudang: string }>(
      "SELECT g.gudang FROM transactions x JOIN gudang_stock_tx g ON g.transfer_from_id = x.id WHERE x.mirror_source = @s AND x.mirror_id = @id",
      { s: p.startsWith("/stock-in") ? "stock_in_log" : "stock_out_log", id }
    );
    return [...G("NILAM"), ...G(t?.gudang), ...(m === "PUT" && p.startsWith("/stock-out") ? transferTo(b.tujuan, "OUT") : [])];
  }
  if (/^\/gudang-stock(\/transactions|\/transactions\/batch|\/correction)?$/.test(p) && m === "POST") return G(b.gudang);
  if (/^\/gudang-stock\/\d+$/.test(p)) return G(await col("gudang_stock", "gudang"));
  if (/^\/gudang-stock\/history\/\d+$/.test(p)) return G(await col("gudang_stock_tx", "gudang"));
  // Input Banyak rows with "ke" also book stock into that estate, so its opname locks them too.
  const kirimKe = <T,>(f: (e: unknown) => T[]) => (Array.isArray(b.rows) ? b.rows : []).flatMap((r: any) => (r?.ke ? f(r.ke) : []));
  if (/^\/klinik-stock\/(transactions|transactions\/batch|correction)$/.test(p)) return [...K(b.klinik), ...kirimKe(K)];
  if (p === "/klinik-stock/tarik" && m === "POST") return K(b.klinik);
  if (/^\/klinik-stock\/tarik\/\d+\/periksa$/.test(p))
    return K((await queryOne<{ v: string }>("SELECT klinik v FROM klinik_stock_tx WHERE id = @id", { id: p.split("/")[3] }))?.v);
  if (/^\/klinik-stock\/batch\/\d+$/.test(p)) return K(await col("klinik_batch", "klinik"));
  if (/^\/klinik-stock\/\d+$/.test(p) && m === "DELETE") return K(await col("klinik_stock", "klinik"));
  if (/^\/klinik-stock\/\d+\/batches$/.test(p))
    return K((await queryOne<{ v: string }>("SELECT klinik v FROM klinik_stock WHERE id = @id", { id: p.split("/")[2] }))?.v);
  if (/^\/klinik-stock\/history\/\d+$/.test(p)) return K(await col("klinik_stock_tx", "klinik"));
  // Laporan Harian: a kunjungan moves the clinic's stock when its terapi names a master obat.
  // Any terapi: a name typed by hand may be a master obat through an alias (resolveTerapiKode).
  const terapiStok = Array.isArray(b.obat) && b.obat.some((o: any) => String(o?.obat_kode ?? "").trim() || String(o?.nama_obat ?? "").trim());
  if (p === "/klinik-laporan/sinkron-stok" && m === "POST") return K(b.klinik);
  if (p === "/klinik-laporan/kunjungan" && m === "POST") return terapiStok ? K(b.klinik) : [];
  if (/^\/klinik-laporan\/kunjungan\/\d+$/.test(p)) {
    const linked = await queryOne("SELECT 1 FROM klinik_stock_tx WHERE kunjungan_id = @id LIMIT 1", { id });
    return terapiStok || linked ? K(await col("klinik_kunjungan", "klinik")) : [];
  }
  if ((p === "/bbm" || p === "/bbm/batch") && m === "POST") return [...B(b.lokasi), ...kirimKe(B)];
  if (/^\/bbm\/\d+$/.test(p)) return B(await col("bbm_log", "lokasi"));
  if ((p === "/pupuk" || p === "/pupuk/batch") && m === "POST") return [...P(b.estate), ...kirimKe(P)];
  if (/^\/pupuk\/\d+$/.test(p)) return P(await col("pupuk_log", "estate"));
  if ((p === "/oli" || p === "/oli/batch") && m === "POST") return [...O(b.estate), ...kirimKe(O)];
  // Pinjaman: both the lending and the borrowing estate's stock move.
  const loanAt = (module: unknown, ...estates: unknown[]) =>
    OPNAME_MODULES_LIST.includes(module as OpnameModule) ? estates.flatMap(at(module as OpnameModule)) : [];
  if ((p === "/pinjaman" || p === "/pinjaman/batch") && m === "POST") return loanAt(b.module, b.dari, b.ke);
  if (/^\/pinjaman\/\d+\/(kembali|batal|delete)$/.test(p)) {
    const l = await queryOne<any>("SELECT module, dari_estate, ke_estate FROM pinjaman WHERE id = @id", { id: p.split("/")[2] });
    return l ? loanAt(l.module, l.dari_estate, l.ke_estate) : [];
  }
  if (/^\/oli\/\d+$/.test(p)) return O(await col("oli_log", "estate"));
  return [];
}

const OPNAME_MODULES_LIST: OpnameModule[] = ["GUDANG", "KLINIK", "BBM", "PUPUK", "OLI"];

// Movement rows booked by a Pinjaman (pinjaman_id set) only change through the Pinjaman page, so the
// loan and both estates' stock stay in step.
const PINJAMAN_ROWS: [RegExp, string][] = [
  [/^\/transactions\/(\d+)$/, "transactions"],
  [/^\/stock-in\/(\d+)$/, "stock_in_log"],
  [/^\/stock-out\/(\d+)$/, "stock_out_log"],
  [/^\/gudang-stock\/history\/(\d+)$/, "gudang_stock_tx"],
  [/^\/klinik-stock\/history\/(\d+)$/, "klinik_stock_tx"],
  [/^\/bbm\/(\d+)$/, "bbm_log"],
  [/^\/pupuk\/(\d+)$/, "pupuk_log"],
  [/^\/oli\/(\d+)$/, "oli_log"],
];
app.use("/api", async (req, res, next) => {
  if (req.method !== "PUT" && req.method !== "DELETE") return next();
  const p = (req.baseUrl + req.path).replace(/^\/api/, "");
  for (const [re, table] of PINJAMAN_ROWS) {
    const id = p.match(re)?.[1];
    if (!id) continue;
    const row = await queryOne<{ pinjaman_id: number | null; kunjungan_id: number | null }>(
      `SELECT pinjaman_id, ${table === "klinik_stock_tx" ? "kunjungan_id" : "NULL::int AS kunjungan_id"} FROM ${table} WHERE id = @id`,
      { id }
    );
    if (row?.pinjaman_id)
      return res.status(409).json({ error: `Transaksi ini bagian dari Pinjaman #${row.pinjaman_id}. Kelola lewat menu Pinjaman Antar Estate.` });
    if (row?.kunjungan_id)
      return res.status(409).json({ error: "Stock Out ini dari terapi pasien di Laporan Harian. Ubah / hapus lewat Edit Kunjungan di tab Laporan Harian." });
  }
  next();
});

const OPNAME_MODULE_LABEL: Record<OpnameModule, string> = { GUDANG: "Gudang", KLINIK: "Klinik", BBM: "BBM", PUPUK: "Pupuk", OLI: "Oli" };

app.use("/api", async (req, res, next) => {
  const locs = await stockLocations(req);
  if (!locs.length) return next();
  const open = await queryOne<{ id: number; module: OpnameModule; estate: string; status: string }>(
    `SELECT id, module, estate, status FROM opname
     WHERE status IN ('DRAFT', 'SUBMITTED') AND module || ':' || estate = ANY(@keys::text[]) ORDER BY id LIMIT 1`,
    { keys: locs.map((l) => `${l.module}:${l.estate}`) }
  );
  if (!open) return next();
  res.status(423).json({
    error:
      `${OPNAME_MODULE_LABEL[open.module]} ${open.estate} sedang Stok Opname #${open.id} ` +
      `(${open.status === "DRAFT" ? "sedang dihitung" : "menunggu approval"}). ` +
      "Transaksi stok dikunci sampai opname disetujui atau dibatalkan.",
  });
});

// Routes that used to be superuser-only: the gate above has already checked the account's
// permission for them, so this only still refuses routes with no permission mapped ("super").
function requireSuperuser(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.user!.role === "superuser" || Array.isArray(requiredPerms(req))) return next();
  return res.status(403).json({ error: "Akses ditolak" });
}

// Edit / hapus bulan berjalan: an account that isn't a supervisor of the module (its Approve) may
// change or delete a transaction only while its date is in the current month (Jakarta), and an edit
// may not move it out of that month; an earlier month goes through a supervisor or Super User - or the
// account itself while a Super User gave it "edit bulan lalu" for a while (users.edit_lampau_until):
// edit only, never delete. Every change is still logged with its before / after.
const jakartaDay = (v: unknown) =>
  v instanceof Date || (typeof v === "string" && v.includes("T"))
    ? new Date(new Date(v as string).getTime() + 7 * 3600_000).toISOString().slice(0, 10)
    : String(v ?? "");
const rowDay = (row: Record<string, any>) => jakartaDay(row.tanggal_iso ?? row.tanggal_keluar_iso ?? row.tanggal_terima_iso ?? row.created_at);
function editTooLate(req: express.Request, res: express.Response, module: string, row: Record<string, any>) {
  const u = req.user!;
  if (u.role === "superuser" || u.perms.includes(`${module}.approve`)) return false;
  if (req.method === "PUT" && u.editLampauUntil && new Date(u.editLampauUntil) > new Date()) return false;
  const month = jakartaToday().slice(0, 7);
  const b = req.method === "PUT" ? req.body ?? {} : {};
  const moved = b.tanggal_iso ?? b.tanggal_keluar_iso ?? b.tanggal_terima_iso;
  const day = rowDay(row);
  if (/^\d{4}-\d{2}/.test(day) && day.slice(0, 7) === month && (!moved || String(moved).slice(0, 7) === month)) return false;
  res.status(403).json({
    error:
      day.slice(0, 7) === month
        ? "Tanggal transaksi tidak bisa dipindah ke luar bulan berjalan. Minta supervisor (hak Approve) atau Super User."
        : `Transaksi bulan ${day ? day.slice(0, 7).split("-").reverse().join("/") : "lalu"} hanya bisa ${req.method === "DELETE" ? "dihapus" : "diubah"} oleh supervisor (hak Approve) atau Super User. Admin hanya bisa mengubah / menghapus transaksi bulan berjalan.`,
  });
  return true;
}

function estateAllowed(user: SessionUser, estate: string | null | undefined) {
  return user.role === "superuser" || (!!estate && user.estates.includes(estate));
}

// The estates a cross-estate list (stok opname, pinjaman, log) shows: the account's own, narrowed to
// `estate` if given, else to the estates picked on the dashboard (`estates`, comma separated) if any.
function listEstates(user: SessionUser, estate: string, picked: string): string[] {
  const own = ESTATES.filter((e) => estateAllowed(user, e));
  if (estate) return own.filter((e) => e === estate);
  const pick = picked.split(",").filter(Boolean);
  const narrowed = own.filter((e) => pick.includes(e));
  return narrowed.length ? narrowed : own;
}

function requireEstate(estate: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!estateAllowed(req.user!, estate)) return res.status(403).json({ error: "Akses ditolak" });
    next();
  };
}

// ---- Activity log (audit trail), see schema.sql's activity_log ----
type LogModule = "BARANG" | "BBM" | "PUPUK" | "KLINIK" | "OLI" | "KOPERASI" | "KENDARAAN" | "PRUNING" | "SOP";

// Records who changed what. Called after the change succeeded; a logging failure is reported but
// never fails the user's action itself.
async function logActivity(
  req: express.Request,
  entry: { module: LogModule; estate: string | null; aksi: string; objek: string; detail?: string }
) {
  const u = req.user!;
  try {
    await execute(
      `INSERT INTO activity_log (module, estate, aksi, objek, detail, user_id, username, nama)
       VALUES (@module, @estate, @aksi, @objek, @detail, @user_id, @username, @nama)`,
      { ...entry, detail: entry.detail ?? "", user_id: u.id, username: u.username, nama: u.nama }
    );
  } catch (e) {
    console.error("activity log failed", e);
  }
}

// Many log entries in one statement (e.g. one Koreksi Stok per line of an approved opname).
async function logActivities(
  req: express.Request,
  entries: { module: LogModule; estate: string | null; aksi: string; objek: string; detail?: string }[]
) {
  if (!entries.length) return;
  const u = req.user!;
  try {
    await execute(
      `INSERT INTO activity_log (module, estate, aksi, objek, detail, user_id, username, nama)
       SELECT x.module, x.estate, x.aksi, x.objek, x.detail, @user_id, @username, @nama
       FROM json_to_recordset(@rows::json) AS x(module text, estate text, aksi text, objek text, detail text)`,
      { rows: JSON.stringify(entries.map((e) => ({ ...e, detail: e.detail ?? "" }))), user_id: u.id, username: u.username, nama: u.nama }
    );
  } catch (e) {
    console.error("activity log failed", e);
  }
}

// "Label: old → new" for each field that actually changed, e.g. "Stock Tersedia: 10 → 12".
function describeChanges(before: Record<string, any>, after: Record<string, any>, labels: Record<string, string>) {
  const show = (v: any) => (v === null || v === undefined || v === "" ? "-" : String(v));
  const changes = Object.entries(labels)
    .filter(([k]) => k in after && show(before[k]) !== show(after[k]))
    .map(([k, label]) => `${label}: ${show(before[k])} → ${show(after[k])}`);
  return changes.length ? changes.join("; ") : "Tidak ada perubahan";
}

// Nilam/Zamrud/Firus are consumer/destination estates, NOT separate physical warehouses.
// There is only one physical stock pool (the main warehouse, located at Nilam).
const TUJUAN_OPTIONS = ["NILAM", "FIRUS", "ZAMRUD", "KNS", "WJA"];

// BBM (fuel, Solar & Bensin) physical storage/gudang sites. Nilam, WJA and KNS hold the imported
// history; Zamrud and Firus were added later as their own lokasi so they can record their own stock
// from the first delivery on (their older Solar sheets stay filed under NILAM, estate=ZAMRUD/FIRUS).
// Zamrud/Firus/AKSS/UKM (under Nilam), LUBAKAN/TAGUL (under WJA) and MALAPIAK/TAGANG (under KNS)
// are distribution/consumption destinations, not separate warehouses - see `estate`.
const BBM_LOKASI_OPTIONS = ["NILAM", "FIRUS", "ZAMRUD", "KNS", "WJA"];

function isoToDisplay(iso: string): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- Mirror a manual IN/OUT transaction into stock_in_log/stock_out_log so it shows up
// alongside imported history on the Stock In / Stock Out pages. Correction (stock opname)
// transactions are never mirrored - they stay only in `transactions`. ----
async function mirrorTransaction(
  client: PoolClient,
  item: any,
  type: "IN" | "OUT",
  tujuan: string,
  qty: number,
  note: string | null,
  penerima: string
): Promise<{ source: "stock_in_log" | "stock_out_log"; id: number }> {
  // The movement's own day when it is entered later (txTime), else today.
  const iso = txTime.getStore()?.slice(0, 10) ?? jakartaToday();
  const display = isoToDisplay(iso);

  if (type === "IN") {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO stock_in_log (item_id, kode, nama, nama_vendor, qty, satuan, tujuan, tanggal_terima, tanggal_terima_iso, keterangan)
       VALUES (@item_id, @kode, @nama, @nama_vendor, @qty, @satuan, @tujuan, @tanggal_terima, @tanggal_terima_iso, @keterangan)
       RETURNING id`,
      {
        item_id: item.id,
        kode: item.kode,
        nama: item.nama,
        nama_vendor: penerima ? `Diterima: ${penerima}` : "Input Manual",
        qty,
        satuan: item.satuan,
        tujuan: tujuan || null,
        tanggal_terima: display,
        tanggal_terima_iso: iso,
        keterangan: note || "",
      },
      client
    );
    return { source: "stock_in_log", id: Number(row!.id) };
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO stock_out_log (item_id, kode, nama, penerima, qty, satuan, tujuan, tanggal_keluar, tanggal_keluar_iso, keterangan)
     VALUES (@item_id, @kode, @nama, @penerima, @qty, @satuan, @tujuan, @tanggal_keluar, @tanggal_keluar_iso, @keterangan)
     RETURNING id`,
    {
      item_id: item.id,
      kode: item.kode,
      nama: item.nama,
      penerima: penerima || "",
      qty,
      satuan: item.satuan,
      tujuan: tujuan || null,
      tanggal_keluar: display,
      tanggal_keluar_iso: iso,
      keterangan: note || "",
    },
    client
  );
  return { source: "stock_out_log", id: Number(row!.id) };
}

async function deleteMirror(client: PoolClient, mirrorSource: string | null, mirrorId: number | null) {
  if (!mirrorSource || !mirrorId) return;
  if (mirrorSource === "stock_in_log") await execute(`DELETE FROM stock_in_log WHERE id = @id`, { id: mirrorId }, client);
  if (mirrorSource === "stock_out_log") await execute(`DELETE FROM stock_out_log WHERE id = @id`, { id: mirrorId }, client);
}

// ---- Summary for dashboard ----
app.get("/api/summary", requireEstate("NILAM"), async (_req, res) => {
  const totalItems = (await queryOne<any>("SELECT COUNT(*) c FROM items"))!.c;
  const lowStock = (
    await queryOne<any>("SELECT COUNT(*) c FROM items WHERE stock_tersedia <= buffer_stock AND buffer_stock > 0")
  )!.c;
  const outOfStock = (await queryOne<any>("SELECT COUNT(*) c FROM items WHERE stock_tersedia <= 0"))!.c;
  const statusBreakdown = await queryMany(
    "SELECT keterangan, COUNT(*) c FROM items GROUP BY keterangan ORDER BY c DESC"
  );

  const totalStock = (await queryOne<any>("SELECT SUM(stock_tersedia) s FROM items"))!.s || 0;
  const totalStockIn = (await queryOne<any>("SELECT SUM(stock_in) s FROM items"))!.s || 0;
  const totalStockOut = (await queryOne<any>("SELECT SUM(stock_out) s FROM items"))!.s || 0;

  // Consumption distribution per destination (Nilam/Zamrud/Firus) - this is a flow metric
  // (how much went out to each estate), not a separate stock balance. Manual OUT transactions
  // are mirrored into stock_out_log, so that table alone already covers imported + manual flows.
  const perTujuan = await queryMany(
    `SELECT tujuan, SUM(qty) qty FROM stock_out_log WHERE tujuan IS NOT NULL GROUP BY tujuan ORDER BY qty DESC`
  );

  res.json({ totalItems, lowStock, outOfStock, totalStock, totalStockIn, totalStockOut, statusBreakdown, perTujuan });
});

// ---- Top barang keluar (dashboard ranking) ----
// Ranks the items that went out most, over the chosen estates and period, either by total qty or
// by number of transactions. Gudang: Nilam's outflow is stock_out_log (manual OUTs are mirrored
// there, corrections are not), the other gudang use gudang_stock_tx. Klinik uses klinik_stock_tx.
// Koreksi rows are left out - they fix a count, they aren't usage.
app.get("/api/top-keluar", async (req, res) => {
  const { source = "gudang", estates = "", sortBy = "trx", dateFrom = "", dateTo = "", tz = "", limit = "10" } =
    req.query as Record<string, string>;
  if (!["gudang", "klinik"].includes(source)) return res.status(400).json({ error: "Sumber tidak valid" });
  const requested = estates ? estates.split(",") : [...ESTATES];
  const allowed = requested.filter((e) => (ESTATES as readonly string[]).includes(e) && estateAllowed(req.user!, e));
  if (!allowed.length) return res.json({ rows: [], totalQty: 0, totalTrx: 0 });

  const params: any = {
    tz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : "Asia/Jakarta",
    dateFrom: dateFrom || "1900-01-01",
    dateTo: dateTo || "9999-12-31",
    limit: Math.min(Math.max(parseInt(limit) || 10, 1), 50),
  };
  const txDate = "(t.created_at AT TIME ZONE @tz)::date BETWEEN @dateFrom::date AND @dateTo::date";

  let srcSql: string;
  let master: string;
  if (source === "gudang") {
    const parts: string[] = [];
    if (allowed.includes("NILAM")) {
      parts.push(`SELECT s.kode, s.qty FROM stock_out_log s
        WHERE s.kode IS NOT NULL AND s.pinjaman_id IS NULL AND s.tanggal_keluar_iso BETWEEN @dateFrom AND @dateTo`);
    }
    params.gudangs = allowed.filter((e) => GUDANG_STOCK_OPTIONS.includes(e));
    if (params.gudangs.length) {
      parts.push(`SELECT t.item_kode, t.qty FROM gudang_stock_tx t
        WHERE t.type = 'OUT' AND t.is_correction = 0 AND t.pinjaman_id IS NULL AND t.gudang = ANY(@gudangs::text[]) AND ${txDate}`);
    }
    srcSql = parts.join(" UNION ALL ");
    master = "items";
  } else {
    params.kliniks = allowed;
    srcSql = `SELECT t.obat_kode, t.qty FROM klinik_stock_tx t
      WHERE t.type = 'OUT' AND t.is_correction = 0 AND t.pinjaman_id IS NULL AND COALESCE(t.tujuan, '') <> 'DIBUANG' AND t.klinik = ANY(@kliniks::text[]) AND ${txDate}`;
    master = "obat";
  }

  const order = sortBy === "trx" ? "trx DESC, qty DESC" : "qty DESC, trx DESC";
  const rows = await queryMany(
    `WITH src(kode, qty) AS (${srcSql}),
     agg AS (SELECT kode, SUM(qty)::float qty, COUNT(*)::int trx FROM src GROUP BY kode)
     SELECT agg.kode, m.id, COALESCE(m.nama, agg.kode) nama, m.satuan, agg.qty, agg.trx,
       SUM(agg.qty) OVER ()::float "totalQty", SUM(agg.trx) OVER ()::int "totalTrx"
     FROM agg LEFT JOIN ${master} m ON m.kode = agg.kode
     ORDER BY ${order}, nama LIMIT @limit`,
    params
  );
  res.json({
    rows: rows.map(({ totalQty: _q, totalTrx: _t, ...r }) => r),
    totalQty: rows[0]?.totalQty ?? 0,
    totalTrx: rows[0]?.totalTrx ?? 0,
  });
});

// ---- Distinct satuan values (for filter dropdown) ----
app.get("/api/satuan-options", async (_req, res) => {
  const rows = await queryMany<{ satuan: string }>(
    "SELECT DISTINCT satuan FROM items WHERE satuan IS NOT NULL AND satuan != '' ORDER BY satuan"
  );
  res.json(rows.map((r) => r.satuan));
});

// Every word must appear somewhere in kode or nama, in any order, so "filter oli klx" finds
// "FILTER OLI MOTOR KLX". `alias` is the items table alias in the query ("" or "i.").
// Every search word must appear in at least one of `cols` (so "pipa 4" finds "PIPA PVC 4 IN").
function wordSearch(search: string, cols: string[], conditions: string[], params: Record<string, any>) {
  search
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10)
    .forEach((word, i) => {
      conditions.push(`(${cols.map((c) => `${c} ILIKE @search${i}`).join(" OR ")})`);
      params[`search${i}`] = `%${word}%`;
    });
}

// Word search over a master table's kode + nama plus `extra` columns; a bare column name gets the
// table `alias`, a qualified one ("t.note") is used as is.
function addWordSearch(search: string, alias: string, conditions: string[], params: Record<string, any>, extra: string[] = []) {
  const cols = ["kode", "nama", ...extra].map((c) => (c.includes(".") ? c : `${alias}${c}`));
  wordSearch(search, cols, conditions, params);
}

// Obat can also be found by their kategori, jenis (kelompok obat) or deskripsi, e.g. "antibiotik".
const OBAT_SEARCH = ["kategori", "jenis", "deskripsi"];

// ---- Items list with search/filter/sort/pagination ----
app.get("/api/items", async (req, res) => {
  const {
    search = "",
    status = "",
    satuan = "",
    stock = "",
    sortBy = "kode",
    sortDir = "asc",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  const validSort = ["kode", "nama", "stock_tersedia", "buffer_stock"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = [];
  const params: any = {};

  addWordSearch(search, "", conditions, params, ["satuan"]);
  if (status) {
    conditions.push("keterangan = @status");
    params.status = status;
  }
  if (satuan) {
    conditions.push("satuan = @satuan");
    params.satuan = satuan;
  }
  // Same conditions as the lowStock/outOfStock counts in /api/summary, so the stat cards link to matching rows.
  if (stock === "menipis") conditions.push("stock_tersedia <= buffer_stock AND buffer_stock > 0");
  if (stock === "habis") conditions.push("stock_tersedia <= 0");
  if (stock === "tersedia") conditions.push("stock_tersedia > 0");

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM items ${where}`, params))!.c;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const items = await queryMany(
    // sortBy ada_stok (the barang pickers): in stock first, then by kode.
    `SELECT * FROM items ${where} ORDER BY ${sortBy === "ada_stok" ? "(stock_tersedia > 0) DESC, kode" : `${sortCol} ${dir} NULLS LAST`} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data: items, total: Number(total), page: parseInt(page), pageSize: limit });
});

app.get("/api/items/:id", requireEstate("NILAM"), async (req, res) => {
  const item = await queryOne("SELECT * FROM items WHERE id = @id", { id: req.params.id });
  if (!item) return res.status(404).json({ error: "Not found" });
  const transactions = await queryMany(
    "SELECT * FROM transactions WHERE item_id = @id ORDER BY created_at DESC LIMIT 50",
    { id: req.params.id }
  );
  res.json({ ...item, transactions });
});

// A new master barang: from Nilam's gudang page or by a Master Barang admin of any estate.
app.post("/api/items", (req, res, next) => (req.user!.perms.includes("master.barang") ? next() : requireEstate("NILAM")(req, res, next)), async (req, res) => {
  const { kode, nama, satuan, buffer_stock } = req.body;
  if (!kode || !String(kode).trim() || !nama || !String(nama).trim()) {
    return res.status(400).json({ error: "Kode dan nama wajib diisi" });
  }

  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO items (kode, nama, satuan, buffer_stock) VALUES (@kode, @nama, @satuan, @buffer_stock) RETURNING id`,
      {
        kode: String(kode).trim(),
        nama: String(nama).trim(),
        satuan: satuan || "",
        buffer_stock: buffer_stock ?? 0,
      }
    );
    await logActivity(req, {
      module: "BARANG",
      estate: "NILAM",
      aksi: "Tambah Barang",
      objek: `${String(kode).trim()} - ${String(nama).trim()}`,
      detail: `Satuan: ${satuan || "-"}; Buffer: ${buffer_stock ?? 0}`,
    });
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Kode sudah digunakan barang lain" });
    }
    throw e;
  }
});

// Master barang is shared by every gudang: changed with Master Barang, or by Gudang Nilam (whose list it is).
app.put("/api/items/:id", (req, res, next) => (req.user!.perms.includes("master.barang") ? next() : requireEstate("NILAM")(req, res, next)), async (req, res) => {
  const { kode, nama, satuan, buffer_stock } = req.body;
  const existing = await queryOne("SELECT * FROM items WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!kode || !String(kode).trim()) {
    return res.status(400).json({ error: "Kode wajib diisi" });
  }

  try {
    await execute("UPDATE items SET kode = @kode, nama = @nama, satuan = @satuan, buffer_stock = @buffer_stock WHERE id = @id", {
      kode: String(kode).trim(),
      nama,
      satuan,
      buffer_stock: buffer_stock ?? 0,
      id: req.params.id,
    });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Kode sudah digunakan barang lain" });
    }
    if (e.code === "23503") {
      return res.status(409).json({ error: "Kode ini dipakai di stok gudang lain, tidak bisa diganti" });
    }
    throw e;
  }
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Edit Barang",
    objek: `${String(kode).trim()} - ${nama}`,
    detail: describeChanges(
      existing,
      { kode: String(kode).trim(), nama, satuan, buffer_stock: buffer_stock ?? 0 },
      { kode: "Kode", nama: "Nama", satuan: "Satuan", buffer_stock: "Buffer" }
    ),
  });
  res.json({ success: true });
});

app.delete("/api/items/:id", (req, res, next) => (req.user!.perms.includes("master.barang") ? next() : requireEstate("NILAM")(req, res, next)), async (req, res) => {
  const { id } = req.params;
  const existing = await queryOne("SELECT * FROM items WHERE id = @id", { id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const [tx, stockIn, stockOut] = await Promise.all([
    queryOne<any>("SELECT 1 FROM transactions WHERE item_id = @id LIMIT 1", { id }),
    queryOne<any>("SELECT 1 FROM stock_in_log WHERE item_id = @id LIMIT 1", { id }),
    queryOne<any>("SELECT 1 FROM stock_out_log WHERE item_id = @id LIMIT 1", { id }),
  ]);
  if (tx || stockIn || stockOut) {
    return res.status(409).json({ error: "Barang ini punya riwayat transaksi, tidak bisa dihapus" });
  }

  await execute("DELETE FROM items WHERE id = @id", { id });
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Hapus Barang",
    objek: `${existing.kode} - ${existing.nama}`,
    detail: `Stock terakhir: ${existing.stock_tersedia ?? 0}`,
  });
  res.json({ success: true });
});

// ---- Inventory Gudang for the non-Nilam warehouses (KNS/WJA/ZAMRUD/FIRUS) ----
// Nilam's stock lives directly on `items`; these gudang instead keep their own buffer/stock
// quantities in `gudang_stock`, picking the item name/satuan from that same master item list.
const GUDANG_STOCK_OPTIONS = ["FIRUS", "ZAMRUD", "KNS", "WJA"];
// The estates each of these sites supplies (KNS and WJA each supply two): the Stok Keluar tujuan of
// their gudang and the BBM Estate choices of their lokasi. Only Gudang Nilam supplies other estates.
// Keep in sync with GUDANG_TUJUAN in src/lib/api.ts.
const GUDANG_TUJUAN: Record<string, string[]> = {
  KNS: ["MALAPIAK", "TAGANG"],
  WJA: ["LUBAKAN", "TAGUL"],
  ZAMRUD: ["ZAMRUD"],
  FIRUS: ["FIRUS"],
};

app.get("/api/gudang-stock/summary", async (req, res) => {
  const { gudang = "" } = req.query as Record<string, string>;
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });

  const totalItems = (await queryOne<any>("SELECT COUNT(*) c FROM gudang_stock WHERE gudang = @gudang", { gudang }))!.c;
  const lowStock = (
    await queryOne<any>(
      "SELECT COUNT(*) c FROM gudang_stock WHERE gudang = @gudang AND stock_tersedia <= buffer_stock AND buffer_stock > 0",
      { gudang }
    )
  )!.c;
  const outOfStock = (
    await queryOne<any>("SELECT COUNT(*) c FROM gudang_stock WHERE gudang = @gudang AND stock_tersedia <= 0", { gudang })
  )!.c;
  const totalStock =
    (await queryOne<any>("SELECT SUM(stock_tersedia) s FROM gudang_stock WHERE gudang = @gudang", { gudang }))!.s || 0;

  res.json({ totalItems, lowStock, outOfStock, totalStock });
});

app.get("/api/gudang-stock", async (req, res) => {
  const {
    gudang = "",
    search = "",
    satuan = "",
    status = "",
    stock = "",
    sortBy = "kode",
    sortDir = "asc",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });

  const validSort = ["kode", "nama", "stock_tersedia", "buffer_stock"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = ["gs.gudang = @gudang"];
  const params: any = { gudang };

  addWordSearch(search, "i.", conditions, params, ["satuan"]);
  if (satuan) {
    conditions.push("i.satuan = @satuan");
    params.satuan = satuan;
  }
  if (status === "AMAN") {
    conditions.push("gs.stock_tersedia > 0");
  } else if (status === "BUFFER STOCK") {
    conditions.push("gs.stock_tersedia <= 0");
  }
  // Same conditions as the lowStock/outOfStock counts in /api/gudang-stock/summary.
  if (stock === "menipis") conditions.push("gs.stock_tersedia <= gs.buffer_stock AND gs.buffer_stock > 0");
  if (stock === "habis") conditions.push("gs.stock_tersedia <= 0");
  if (stock === "tersedia") conditions.push("gs.stock_tersedia > 0");

  const where = "WHERE " + conditions.join(" AND ");
  const joinSql = `FROM gudang_stock gs JOIN items i ON i.kode = gs.item_kode ${where}`;

  const total = (await queryOne<any>(`SELECT COUNT(*) c ${joinSql}`, params))!.c;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT gs.id, i.kode, i.nama, i.satuan, gs.buffer_stock, gs.stock_tersedia,
            CASE WHEN gs.stock_tersedia > 0 THEN 'AMAN' ELSE 'BUFFER STOCK' END AS keterangan
     ${joinSql}
     ORDER BY ${sortCol === "kode" || sortCol === "nama" ? "i." + sortCol : "gs." + sortCol} ${dir} NULLS LAST
     LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

// Tanggal of a Stock In / Out / Koreksi of barang & obat (single, Input Banyak, Koreksi): a movement
// entered later than it happened takes that day (with the current time) as its time, through txTime
// in db.ts. Not after today, and not before the last approved stok opname of that estate's gudang /
// klinik - what the opname counted already includes it. A Pinjaman / Transfer checks the opname of
// both estates in its module.
const BACKDATE: Record<string, { module: OpnameModule | ((b: any) => string); estate: (b: any) => string | string[] }> = {
  "/api/transactions": { module: "GUDANG", estate: () => "NILAM" },
  "/api/transactions/batch": { module: "GUDANG", estate: () => "NILAM" },
  "/api/stock-correction": { module: "GUDANG", estate: () => "NILAM" },
  "/api/gudang-stock/transactions": { module: "GUDANG", estate: (b) => b.gudang },
  "/api/gudang-stock/transactions/batch": { module: "GUDANG", estate: (b) => b.gudang },
  "/api/gudang-stock/correction": { module: "GUDANG", estate: (b) => b.gudang },
  "/api/klinik-stock/transactions": { module: "KLINIK", estate: (b) => b.klinik },
  "/api/klinik-stock/transactions/batch": {
    module: "KLINIK",
    // Rows sent on to another clinic land there too, behind that clinic's last opname as well.
    estate: (b) => [b.klinik, ...(Array.isArray(b.rows) ? b.rows : []).map((r: any) => String(r?.ke ?? "").trim()).filter(Boolean)],
  },
  "/api/klinik-stock/correction": { module: "KLINIK", estate: (b) => b.klinik },
  "/api/pinjaman": { module: (b) => b.module, estate: (b) => [b.dari, b.ke] },
  "/api/pinjaman/batch": { module: (b) => b.module, estate: (b) => [b.dari, b.ke] },
};
app.use(async (req, res, next) => {
  const route = req.method === "POST" ? BACKDATE[req.path] : undefined;
  const tanggal = route ? String(req.body?.tanggal_iso ?? "") : "";
  if (!route || !tanggal) return next();
  const today = jakartaToday();
  if (!ISO_DATE.test(tanggal)) return res.status(400).json({ error: "Tanggal tidak valid" });
  if (tanggal > today) return res.status(400).json({ error: "Tanggal tidak boleh lewat dari hari ini" });
  if (tanggal === today) return next();
  const module = typeof route.module === "function" ? String(route.module(req.body) ?? "") : route.module;
  const estates = [route.estate(req.body)].flat().map((e) => String(e ?? ""));
  const opname = await queryOne<{ tanggal: string; estate: string }>(
    "SELECT tanggal, estate FROM opname WHERE module = @module AND estate = ANY(@estates::text[]) AND status = 'APPROVED' ORDER BY tanggal DESC LIMIT 1",
    { module, estates }
  );
  if (opname && tanggal < opname.tanggal)
    return res.status(400).json({
      error: `Tanggal tidak boleh sebelum stok opname terakhir${estates.length > 1 ? ` ${opname.estate}` : ""} (${opname.tanggal.split("-").reverse().join("/")}) - hasil hitung opname sudah mencakupnya`,
    });
  const time = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour12: false });
  txTime.run(`${tanggal}T${time}+07:00`, () => next());
});

// The same rule for changing what is already there: a movement dated before the last approved stok opname
// of its estate was counted by it, so editing / deleting it (or moving one there) would undo the count.
// A Super User can still correct it.
const jakDate = (col: string) => `to_char((${col} AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD')`;
const OPNAME_EDIT_LOCK: { re: RegExp; table: string; date: string; module: OpnameModule; estate: string }[] = [
  { re: /^\/api\/transactions\/(\d+)$/, table: "transactions", date: jakDate("created_at"), module: "GUDANG", estate: "'NILAM'" },
  { re: /^\/api\/stock-in\/(\d+)$/, table: "stock_in_log", date: "tanggal_terima_iso", module: "GUDANG", estate: "'NILAM'" },
  { re: /^\/api\/stock-out\/(\d+)$/, table: "stock_out_log", date: "tanggal_keluar_iso", module: "GUDANG", estate: "'NILAM'" },
  { re: /^\/api\/gudang-stock\/history\/(\d+)$/, table: "gudang_stock_tx", date: jakDate("created_at"), module: "GUDANG", estate: "gudang" },
  { re: /^\/api\/klinik-stock\/history\/(\d+)$/, table: "klinik_stock_tx", date: jakDate("created_at"), module: "KLINIK", estate: "klinik" },
  { re: /^\/api\/bbm\/(\d+)$/, table: "bbm_log", date: "tanggal_iso", module: "BBM", estate: "lokasi" },
  { re: /^\/api\/pupuk\/(\d+)$/, table: "pupuk_log", date: "tanggal_iso", module: "PUPUK", estate: "estate" },
  { re: /^\/api\/oli\/(\d+)$/, table: "oli_log", date: "tanggal_iso", module: "OLI", estate: "estate" },
];
app.use(async (req, res, next) => {
  if ((req.method !== "PUT" && req.method !== "DELETE") || req.user?.role === "superuser") return next();
  const lock = OPNAME_EDIT_LOCK.find((l) => l.re.test(req.path));
  if (!lock) return next();
  const id = Number(req.path.match(lock.re)![1]);
  const row = await queryOne<{ d: string | null; e: string | null }>(`SELECT ${lock.date} d, ${lock.estate} e FROM ${lock.table} WHERE id = @id`, { id });
  if (!row?.e) return next();
  const opname = await queryOne<{ tanggal: string }>(
    "SELECT tanggal FROM opname WHERE module = @module AND estate = @estate AND status = 'APPROVED' ORDER BY tanggal DESC LIMIT 1",
    { module: lock.module, estate: row.e }
  );
  if (!opname) return next();
  const b = req.body ?? {};
  const moved = req.method === "PUT" ? String(b.tanggal_iso ?? b.tanggal_terima_iso ?? b.tanggal_keluar_iso ?? "") : "";
  const before = (d: string | null | undefined) => !!d && ISO_DATE.test(d) && d < opname.tanggal;
  if (before(row.d) || before(moved))
    return res.status(400).json({
      error: `Transaksi sebelum stok opname terakhir ${row.e} (${opname.tanggal.split("-").reverse().join("/")}) sudah tercakup hasil hitungnya, jadi tidak bisa diubah / dihapus. Minta Super User bila memang perlu dikoreksi.`,
    });
  next();
});

app.post("/api/gudang-stock", async (req, res) => {
  const { gudang, item_kode, buffer_stock, stock_tersedia } = req.body;
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });
  if (!item_kode || !String(item_kode).trim()) return res.status(400).json({ error: "Barang wajib dipilih" });

  const item = await queryOne("SELECT kode FROM items WHERE kode = @item_kode", { item_kode });
  if (!item) return res.status(400).json({ error: "Barang tidak ditemukan di master data" });

  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO gudang_stock (gudang, item_kode, buffer_stock, stock_tersedia)
       VALUES (@gudang, @item_kode, @buffer_stock, @stock_tersedia) RETURNING id`,
      { gudang, item_kode, buffer_stock: buffer_stock ?? 0, stock_tersedia: stock_tersedia ?? 0 }
    );
    const master = await queryOne<any>("SELECT nama FROM items WHERE kode = @item_kode", { item_kode });
    await logActivity(req, {
      module: "BARANG",
      estate: gudang,
      aksi: "Tambah Item",
      objek: `${item_kode} - ${master?.nama ?? ""}`,
      detail: `Buffer: ${buffer_stock ?? 0}; Stock Tersedia: ${stock_tersedia ?? 0}`,
    });
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Barang ini sudah ada di gudang ini" });
    }
    throw e;
  }
});

app.put("/api/gudang-stock/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM gudang_stock WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.gudang)) return res.status(403).json({ error: "Akses ditolak" });

  const { buffer_stock } = req.body;
  // A changed stock is a Koreksi (Super User only, a history row with the difference), like Klinik's
  // edit: setting the number directly left the Riwayat saldo out of step with the stock.
  const stockBaru = req.body.stock_tersedia === undefined || req.body.stock_tersedia === null || req.body.stock_tersedia === "" ? null : Number(req.body.stock_tersedia);
  const stockBerubah = stockBaru !== null && round3(stockBaru) !== round3(Number(existing.stock_tersedia));
  if (stockBerubah) {
    if (req.user!.role !== "superuser") return res.status(403).json({ error: "Stok hanya bisa diubah Super User (tercatat sebagai Koreksi Stok); selisih stok lewat Stok Opname" });
    if (!validQty(GUDANG_LEDGER, stockBaru) || stockBaru! < 0) return res.status(400).json({ error: "Stok tidak valid" });
  }
  await execute("UPDATE gudang_stock SET buffer_stock = @buffer_stock WHERE id = @id", { buffer_stock: buffer_stock ?? 0, id: req.params.id });
  if (stockBerubah) await recordCorrection(req, GUDANG_LEDGER, existing.gudang, existing.item_kode, stockBaru!, "Edit stok");
  const stock_tersedia = stockBerubah ? stockBaru : existing.stock_tersedia;
  const master = await queryOne<any>("SELECT nama FROM items WHERE kode = @kode", { kode: existing.item_kode });
  await logActivity(req, {
    module: "BARANG",
    estate: existing.gudang,
    aksi: "Edit Stok",
    objek: `${existing.item_kode} - ${master?.nama ?? ""}`,
    detail: describeChanges(
      existing,
      { buffer_stock: buffer_stock ?? 0, stock_tersedia: stock_tersedia ?? 0 },
      { buffer_stock: "Buffer", stock_tersedia: "Stock Tersedia" }
    ),
  });
  res.json({ success: true });
});

app.delete("/api/gudang-stock/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM gudang_stock WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.gudang)) return res.status(403).json({ error: "Akses ditolak" });

  await execute("DELETE FROM gudang_stock WHERE id = @id", { id: req.params.id });
  const master = await queryOne<any>("SELECT nama FROM items WHERE kode = @kode", { kode: existing.item_kode });
  await logActivity(req, {
    module: "BARANG",
    estate: existing.gudang,
    aksi: "Hapus Item",
    objek: `${existing.item_kode} - ${master?.nama ?? ""}`,
    detail: `Buffer: ${existing.buffer_stock}; Stock Tersedia: ${existing.stock_tersedia}`,
  });
  res.json({ success: true });
});

// ---- Combined movement history for one item (stock in + stock out + manual transactions) ----
// ---- Stock In / Stock Out / Koreksi for the non-Nilam gudang (same form as Nilam) ----

// Picker list for the transaction form: every master barang with its stock in this gudang
// (0 when the gudang doesn't hold it yet - a Stock In adds it).
app.get("/api/gudang-stock/pick", async (req, res) => {
  const { gudang = "", search = "", page = "1", pageSize = "50" } = req.query as Record<string, string>;
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });

  const conditions: string[] = [];
  const params: any = { gudang };
  addWordSearch(search, "i.", conditions, params, ["satuan"]);
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const joinSql = `FROM items i LEFT JOIN gudang_stock gs ON gs.item_kode = i.kode AND gs.gudang = @gudang ${where}`;

  const total = (await queryOne<any>(`SELECT COUNT(*) c ${joinSql}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT i.id, i.kode, i.nama, i.satuan, COALESCE(gs.buffer_stock, 0) buffer_stock,
            COALESCE(gs.stock_tersedia, 0) stock_tersedia,
            CASE WHEN COALESCE(gs.stock_tersedia, 0) > 0 THEN 'AMAN' ELSE 'BUFFER STOCK' END AS keterangan
     ${joinSql} ORDER BY (COALESCE(gs.stock_tersedia, 0) > 0) DESC, i.kode LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

// A per-location stock ledger: the stock table, its movement table and their column names.
// Gudang (KNS/WJA/Zamrud/Firus) and Klinik share the same Stock In/Out/Koreksi logic.
type StockLedger = { stock: string; tx: string; scope: string; item: string };
const GUDANG_LEDGER: StockLedger = { stock: "gudang_stock", tx: "gudang_stock_tx", scope: "gudang", item: "item_kode" };
const KLINIK_LEDGER: StockLedger = { stock: "klinik_stock", tx: "klinik_stock_tx", scope: "klinik", item: "obat_kode" };

// Gudang (KNS/WJA/Zamrud/Firus) qty may be decimal (see schema.sql); Klinik qty is a whole number.
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const validQty = (l: StockLedger, v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && (l === GUDANG_LEDGER || Number.isInteger(v));

type Movement = {
  scope: string;
  item: string;
  type: "IN" | "OUT";
  qty: number;
  tujuan: string;
  penerima: string;
  note: string | null;
  is_correction: number;
  // Only on gudang_stock_tx: the Nilam Stok Keluar (transactions.id) this Stok Masuk came from.
  transferFromId?: number;
  // The Pinjaman antar estate this movement belongs to (see "Pinjaman" at the end).
  pinjamanId?: number;
  // Foto bukti (evidence.id) of a Stok Masuk / Keluar.
  evidenceId?: string | null;
};

// Applies one movement to a location's stock, creating its stock row on first use.
// Returns the stock before the change.
async function applyMovement(client: PoolClient, req: express.Request, l: StockLedger, m: Movement) {
  await execute(
    `INSERT INTO ${l.stock} (${l.scope}, ${l.item}, buffer_stock, stock_tersedia) VALUES (@scope, @item, 0, 0)
     ON CONFLICT (${l.scope}, ${l.item}) DO NOTHING`,
    m,
    client
  );
  const row = (await queryOne<any>(
    `SELECT id, stock_tersedia FROM ${l.stock} WHERE ${l.scope} = @scope AND ${l.item} = @item FOR UPDATE`,
    m,
    client
  ))!;
  const link = m.transferFromId !== undefined;
  const loan = m.pinjamanId !== undefined;
  await execute(
    `INSERT INTO ${l.tx} (${l.scope}, ${l.item}, type, qty, tujuan, penerima, note, is_correction, user_id, evidence_id${link ? ", transfer_from_id" : ""}${loan ? ", pinjaman_id" : ""})
     VALUES (@scope, @item, @type, @qty, @tujuan, @penerima, @note, @is_correction, @user_id, @evidenceId::uuid${link ? ", @transferFromId" : ""}${loan ? ", @pinjamanId" : ""})`,
    { ...m, evidenceId: m.evidenceId ?? null, user_id: req.user!.id },
    client
  );
  await execute(
    `UPDATE ${l.stock} SET stock_tersedia = ROUND((stock_tersedia + @delta)::numeric, 3) WHERE id = @id`,
    { delta: m.type === "IN" ? m.qty : -m.qty, id: row.id },
    client
  );
  return row.stock_tersedia as number;
}

// Stock In / Stock Out; a Stock Out larger than the stock is rolled back. Returns an error message or null.
async function recordMovement(req: express.Request, l: StockLedger, m: Movement): Promise<string | null> {
  try {
    await withTransaction(async (client) => {
      const before = await applyMovement(client, req, l, m);
      // Thrown inside the transaction so the movement is rolled back.
      if (m.type === "OUT" && m.qty > before) throw Object.assign(new Error("insufficient stock"), { stockAvailable: before });
    });
    return null;
  } catch (e: any) {
    if (e.stockAvailable !== undefined) return `Stock tersedia hanya ${e.stockAvailable}`;
    throw e;
  }
}

// An edit / delete of a gudang movement may not take the stock below zero (e.g. removing a Stock In
// whose barang has gone out since).
async function ledgerStockCheck(client: PoolClient, l: StockLedger, scope: string, item: string) {
  const s = (await queryOne<{ s: number }>(`SELECT stock_tersedia::float8 s FROM ${l.stock} WHERE ${l.scope} = @scope AND ${l.item} = @item`, { scope, item }, client))?.s ?? 0;
  if (s < 0) throw new StockError(`Stok ${item} di ${scope} tidak cukup (jadi ${round3(s)}). Ubah / hapus dulu Stock Out-nya.`);
}

// Koreksi: sets the stock to the counted quantity via one IN/OUT movement. Returns the stock before.
async function recordCorrection(req: express.Request, l: StockLedger, scope: string, item: string, actual: number, note: string) {
  return withTransaction((client) => ledgerCorrection(client, req, l, scope, item, actual, `Koreksi Stok (Opname)${note ? `: ${note}` : ""}`));
}

// The movement of a Koreksi inside an open transaction (also used by an approved Stok Opname).
async function ledgerCorrection(client: PoolClient, req: express.Request, l: StockLedger, scope: string, item: string, actual: number, note: string) {
  const current = await queryOne<any>(
    `SELECT stock_tersedia FROM ${l.stock} WHERE ${l.scope} = @scope AND ${l.item} = @item FOR UPDATE`,
    { scope, item },
    client
  );
  const before: number = current?.stock_tersedia ?? 0;
  const delta = round3(actual - before);
  if (delta === 0) return before;
  await applyMovement(client, req, l, {
    scope,
    item,
    type: delta > 0 ? "IN" : "OUT",
    qty: Math.abs(delta),
    tujuan: "",
    penerima: "",
    note,
    is_correction: 1,
  });
  return before;
}

const movementDetail = (qty: number, tujuan?: string, penerima?: string, note?: string) =>
  [`Jumlah: ${qty}`, tujuan && `Tujuan: ${tujuan}`, penerima && `Penerima: ${penerima}`, note && `Catatan: ${note}`].filter(Boolean).join("; ");

app.post("/api/gudang-stock/transactions", async (req, res) => {
  const { gudang, item_kode, type, qty, tujuan, penerima, note } = req.body;
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });
  if (!["IN", "OUT"].includes(type) || !validQty(GUDANG_LEDGER, qty) || qty <= 0) return res.status(400).json({ error: "Invalid payload" });
  if (tujuan && !GUDANG_TUJUAN[gudang].includes(tujuan)) {
    return res.status(400).json({ error: `Gudang ${gudang} hanya bisa menyuplai ${GUDANG_TUJUAN[gudang].join(", ")}` });
  }

  const item = await queryOne<any>("SELECT kode, nama FROM items WHERE kode = @item_kode", { item_kode });
  if (!item) return res.status(404).json({ error: "Barang tidak ditemukan di master data" });
  const evidenceId = await claimEvidence(req, res);
  if (evidenceId === undefined) return;

  const err = await recordMovement(req, GUDANG_LEDGER, {
    scope: gudang,
    item: item_kode,
    type,
    qty: round3(qty),
    tujuan: tujuan || "",
    penerima: penerima || "",
    note: note || null,
    is_correction: 0,
    evidenceId,
  });
  if (err) {
    await releaseEvidence(evidenceId);
    return res.status(400).json({ error: err });
  }

  await logActivity(req, {
    module: "BARANG",
    estate: gudang,
    aksi: type === "IN" ? "Stok Masuk" : "Stok Keluar",
    objek: `${item.kode} - ${item.nama}`,
    detail: movementDetail(qty, tujuan, penerima, note),
  });
  res.json({ success: true });
});

app.post("/api/gudang-stock/correction", requireSuperuser, async (req, res) => {
  const { gudang, item_kode, actual_qty, note } = req.body;
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });
  if (!validQty(GUDANG_LEDGER, actual_qty) || actual_qty < 0) return res.status(400).json({ error: "Invalid payload" });
  if (!String(note ?? "").trim()) return res.status(400).json({ error: "Isi alasan koreksinya" });

  const item = await queryOne<any>("SELECT kode, nama FROM items WHERE kode = @item_kode", { item_kode });
  if (!item) return res.status(404).json({ error: "Barang tidak ditemukan di master data" });

  const before = await recordCorrection(req, GUDANG_LEDGER, gudang, item_kode, actual_qty, note);
  const delta = actual_qty - before;

  await logActivity(req, {
    module: "BARANG",
    estate: gudang,
    aksi: "Koreksi Stok",
    objek: `${item.kode} - ${item.nama}`,
    detail: `Stock: ${before} → ${actual_qty} (selisih ${delta > 0 ? "+" : ""}${delta})${note ? `; Catatan: ${note}` : ""}`,
  });
  res.json({ success: true, delta });
});

app.get("/api/items/:id/movements", requireEstate("NILAM"), async (req, res) => {
  const itemId = req.params.id;

  const stockIn = await queryMany<any>(
    `SELECT id, tanggal_terima_iso as date, tanggal_terima as "dateDisplay", qty, satuan, tujuan, keterangan as note, nama_vendor as ref, po_in_akss as "refCode", evidence_id, created_at, pinjaman_id
     FROM stock_in_log WHERE item_id = @id`,
    { id: itemId }
  );

  const stockOut = await queryMany<any>(
    `SELECT id, tanggal_keluar_iso as date, tanggal_keluar as "dateDisplay", qty, satuan, tujuan, keterangan as note, penerima as ref, no_embrace_gudang as "refCode", evidence_id, created_at, pinjaman_id
     FROM stock_out_log WHERE item_id = @id`,
    { id: itemId }
  );

  // Regular manual IN/OUT transactions are mirrored into stock_in_log/stock_out_log (above),
  // so only correction (stock opname) rows are pulled from `transactions` here to avoid duplicates.
  const manual = await queryMany<any>(
    `SELECT id, created_at as date, created_at as "dateDisplay", qty, tujuan, type, note, penerima
     FROM transactions WHERE item_id = @id AND is_correction = 1`,
    { id: itemId }
  );

  const rows = [
    ...stockIn.map((r) => ({
      id: r.id,
      date: r.date,
      dateDisplay: r.dateDisplay,
      type: "IN",
      source: "STOCK_IN",
      tujuan: r.tujuan,
      qty: r.qty,
      satuan: r.satuan,
      note: r.note,
      ref: r.ref === "-" ? "" : r.ref,
      refCode: r.refCode,
      evidence_id: r.evidence_id,
      created_at: r.created_at,
      pinjaman_id: r.pinjaman_id,
    })),
    ...stockOut.map((r) => ({
      id: r.id,
      date: r.date,
      dateDisplay: r.dateDisplay,
      type: "OUT",
      source: "STOCK_OUT",
      tujuan: r.tujuan,
      qty: r.qty,
      satuan: r.satuan,
      note: r.note,
      ref: r.ref,
      refCode: r.refCode,
      evidence_id: r.evidence_id,
      created_at: r.created_at,
      pinjaman_id: r.pinjaman_id,
    })),
    ...manual.map((r) => ({
      id: r.id,
      // A timestamp (the others are "yyyy-mm-dd" text), as ISO text so the sort below compares strings.
      date: new Date(r.date).toISOString(),
      dateDisplay: r.dateDisplay,
      type: r.type,
      source: "MANUAL",
      tujuan: r.tujuan || null,
      qty: r.qty,
      satuan: null,
      note: r.note,
      ref: r.penerima && r.penerima.trim() ? r.penerima : "Input Manual",
      refCode: null,
      evidence_id: null,
    })),
  ];

  rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  res.json({ data: rows });
});

// ---- Stock transaction (IN/OUT) ----
// There is one shared stock pool per item. `tujuan` is informational metadata
// (which estate the goods are for) and never splits the balance.

async function applyStockEffect(
  client: PoolClient,
  item_id: number,
  type: "IN" | "OUT",
  qty: number,
  direction: 1 | -1
) {
  const signedQty = qty * direction;
  const delta = type === "IN" ? signedQty : -signedQty;

  // Locked, so two movements of the same barang at once can't overwrite each other's count.
  const item = (await queryOne<any>("SELECT * FROM items WHERE id = @id FOR UPDATE", { id: item_id }, client))!;
  const stockTersedia = item.stock_tersedia + delta;
  const stockIn = item.stock_in + (type === "IN" ? signedQty : 0);
  const stockOut = item.stock_out + (type === "OUT" ? signedQty : 0);
  const keterangan = stockTersedia > 0 ? "AMAN" : "BUFFER STOCK";

  await execute(
    "UPDATE items SET stock_tersedia = @stock_tersedia, stock_in = @stock_in, stock_out = @stock_out, keterangan = @keterangan WHERE id = @id",
    { stock_tersedia: stockTersedia, stock_in: stockIn, stock_out: stockOut, keterangan, id: item_id },
    client
  );
}

// ---- Transfer Gudang Nilam -> gudang estate lain ----
// Gudang Nilam supplies every estate; a Nilam Stok Keluar whose tujuan is KNS/WJA/Zamrud/Firus books
// the same qty as Stok Masuk in that estate's gudang. The receiving gudang_stock_tx row points back
// via transfer_from_id (see schema.sql), is rebuilt when the Stok Keluar is edited, removed with it,
// and can't be edited or deleted on its own. The other gudang only supply their own estate (GUDANG_TUJUAN).
type TransferChange = { estate: string; qty: number } | null;
const TRANSFER_LOCKED = "Stok masuk ini otomatis dari Gudang NILAM. Ubah atau hapus lewat stok keluar di Gudang NILAM.";

async function addTransfer(
  client: PoolClient,
  req: express.Request,
  nilamTxId: number,
  itemKode: string,
  tujuan: string | undefined,
  qty: number,
  penerima: string | undefined,
  note: string | null | undefined,
  evidenceId?: string | null
): Promise<TransferChange> {
  if (!tujuan || !GUDANG_STOCK_OPTIONS.includes(tujuan)) return null;
  await applyMovement(client, req, GUDANG_LEDGER, {
    scope: tujuan,
    item: itemKode,
    type: "IN",
    qty,
    tujuan: "",
    penerima: penerima || "",
    note: `Transfer dari Gudang NILAM${note ? `: ${note}` : ""}`,
    is_correction: 0,
    transferFromId: nilamTxId,
    evidenceId,
  });
  return { estate: tujuan, qty };
}

// Undoes the Stok Masuk a Nilam Stok Keluar transferred into another gudang, if any. Refused
// (StockError) once that gudang has used the stock: its Stok Keluar has to change first.
// `rowId`: only that transfer row (the old one, when an edit has booked its replacement already).
async function removeTransfer(client: PoolClient, nilamTxId: number, rowId?: number): Promise<TransferChange> {
  const g = await queryOne<any>(
    `DELETE FROM gudang_stock_tx WHERE transfer_from_id = @id ${rowId ? "AND id = @rowId" : ""} RETURNING *`,
    { id: nilamTxId, rowId: rowId ?? 0 },
    client
  );
  if (!g) return null;
  const have = (await queryOne<{ s: number }>(
    "SELECT stock_tersedia::float8 s FROM gudang_stock WHERE gudang = @gudang AND item_kode = @item FOR UPDATE",
    { gudang: g.gudang, item: g.item_kode },
    client
  ))?.s ?? 0;
  if (round3(have - g.qty) < 0) {
    throw new StockError(
      `${g.item_kode} dari transfer ini sudah terpakai di Gudang ${g.gudang}, jadi transfernya tidak bisa dikurangi / dipindah / dihapus sebanyak itu. Ubah / hapus dulu Stock Out-nya di Gudang ${g.gudang}.`
    );
  }
  await execute(
    `UPDATE gudang_stock SET stock_tersedia = ROUND((stock_tersedia - @qty)::numeric, 3) WHERE gudang = @gudang AND item_kode = @item`,
    { qty: g.qty, gudang: g.gudang, item: g.item_kode },
    client
  );
  return { estate: g.gudang, qty: g.qty };
}

// A manual Nilam transaction changed or removed, with everything it booked: Nilam's stock (items),
// its Stock In / Out history row and the Stock In it transferred into another gudang. Refused
// (StockError) when Nilam's or that gudang's stock would go below zero. Used by the Transaksi edit
// and by the Stock In / Out tabs, whose rows are these transactions' history rows.
type NilamTxChange = { type: "IN" | "OUT"; qty: number; tujuan: string; penerima: string; note: string | null };
async function nilamStockCheck(client: PoolClient, itemId: number) {
  const it = (await queryOne<{ kode: string; s: number }>("SELECT kode, stock_tersedia s FROM items WHERE id = @id", { id: itemId }, client))!;
  if (it.s < 0) throw new StockError(`Stok ${it.kode} di Gudang NILAM tidak cukup (jadi ${it.s})`);
}
async function reviseNilamTx(client: PoolClient, req: express.Request, tx: any, next: NilamTxChange) {
  await lockMovement(client, "transactions", tx);
  const item = (await queryOne<any>("SELECT * FROM items WHERE id = @id", { id: tx.item_id }, client))!;
  // The new transfer is booked before the old one is taken back, so only the net change has to be
  // in that gudang's stock (10 -> 8 needs 2 there, not 10).
  const old = await queryOne<{ id: number }>("SELECT id FROM gudang_stock_tx WHERE transfer_from_id = @id", { id: tx.id }, client);
  const added = next.type === "OUT" && !tx.is_correction ? await addTransfer(client, req, tx.id, item.kode, next.tujuan, next.qty, next.penerima, next.note ?? "", tx.evidence_id) : null;
  const removed = old ? await removeTransfer(client, tx.id, old.id) : null;
  await applyStockEffect(client, tx.item_id, tx.type, tx.qty, -1);
  await applyStockEffect(client, tx.item_id, next.type, next.qty, 1);
  await nilamStockCheck(client, tx.item_id);
  await execute(
    "UPDATE transactions SET tujuan = @tujuan, type = @type, qty = @qty, note = @note, penerima = @penerima WHERE id = @id",
    { ...next, tujuan: next.tujuan || "", penerima: next.penerima || "", id: tx.id },
    client
  );
  return { item, removed, added };
}
async function deleteNilamTx(client: PoolClient, tx: any) {
  await lockMovement(client, "transactions", tx);
  const removed = await removeTransfer(client, tx.id);
  await applyStockEffect(client, tx.item_id, tx.type, tx.qty, -1);
  await nilamStockCheck(client, tx.item_id);
  if (!tx.is_correction) await deleteMirror(client, tx.mirror_source, tx.mirror_id);
  await execute("DELETE FROM transactions WHERE id = @id", { id: tx.id }, client);
  return removed;
}
// Gudang Nilam stock right after a Stock In / Out row: the item's stock now minus every later movement
// (transactions). Only rows made in the app have a movement; imported history rows get null.
const nilamSaldoSql = (table: "stock_in_log" | "stock_out_log") => `(
  SELECT ROUND((i.stock_tersedia - COALESCE((SELECT SUM(CASE WHEN y.type = 'IN' THEN y.qty ELSE -y.qty END) FROM transactions y
                 WHERE y.item_id = x.item_id AND (y.created_at, y.id) > (x.created_at, x.id)), 0))::numeric, 3)::float8
  FROM transactions x JOIN items i ON i.id = x.item_id WHERE x.mirror_source = '${table}' AND x.mirror_id = ${table}.id LIMIT 1)`;

// The manual transaction a Nilam Stock In / Out history row mirrors; null = imported history.
const mirroredTx = (table: "stock_in_log" | "stock_out_log", id: unknown) =>
  queryOne<any>("SELECT * FROM transactions WHERE mirror_source = @t AND mirror_id = @id", { t: table, id });

// Logs the receiving side of a transfer in the receiving estate's activity log.
async function logTransfer(req: express.Request, objek: string, removed: TransferChange, added: TransferChange) {
  if (removed && added && removed.estate === added.estate) {
    if (removed.qty === added.qty) return;
    await logActivity(req, { module: "BARANG", estate: added.estate, aksi: "Edit Stok Masuk", objek, detail: `Transfer: Jumlah ${removed.qty} → ${added.qty}` });
    return;
  }
  if (removed) await logActivity(req, { module: "BARANG", estate: removed.estate, aksi: "Hapus Stok Masuk", objek, detail: `Transfer dibatalkan; Jumlah: ${removed.qty}` });
  if (added) await logActivity(req, { module: "BARANG", estate: added.estate, aksi: "Stok Masuk", objek, detail: `Transfer masuk; Jumlah: ${added.qty}` });
}

app.post("/api/transactions", requireEstate("NILAM"), async (req, res) => {
  const { item_id, tujuan, type, qty, note, penerima } = req.body;

  if (!item_id || !["IN", "OUT"].includes(type) || !qty || qty <= 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const item = await queryOne<any>("SELECT * FROM items WHERE id = @id", { id: item_id });
  if (!item) return res.status(404).json({ error: "Not found" });
  const evidenceId = await claimEvidence(req, res);
  if (evidenceId === undefined) return;

  let transfer: TransferChange = null;
  try {
  await withTransaction(async (client) => {
    // The form checks the stock too, but it may be stale (another tab / user): never below zero.
    if (type === "OUT") {
      const cur = (await queryOne<{ s: number }>("SELECT stock_tersedia s FROM items WHERE id = @id FOR UPDATE", { id: item_id }, client))!;
      if (qty > cur.s) throw new StockError(`Stock tersedia hanya ${cur.s}`);
    }
    const result = await queryOne<{ id: number }>(
      `INSERT INTO transactions (item_id, tujuan, type, qty, note, penerima, evidence_id)
       VALUES (@item_id, @tujuan, @type, @qty, @note, @penerima, @evidenceId::uuid) RETURNING id`,
      { item_id, tujuan: tujuan || "", type, qty, note: note || null, penerima: penerima || "", evidenceId },
      client
    );

    const mirror = await mirrorTransaction(client, item, type, tujuan || "", qty, note, penerima || "");
    await execute(`UPDATE ${mirror.source} SET evidence_id = @evidenceId::uuid WHERE id = @id`, { evidenceId, id: mirror.id }, client);
    await execute(
      `UPDATE transactions SET mirror_source = @source, mirror_id = @mirror_id WHERE id = @id`,
      { source: mirror.source, mirror_id: mirror.id, id: result!.id },
      client
    );

    await applyStockEffect(client, item_id, type, qty, 1);
    if (type === "OUT") transfer = await addTransfer(client, req, result!.id, item.kode, tujuan, qty, penerima, note, evidenceId);
  });
  } catch (e) {
    // Refused (or failed): the photo can be used again when the form is sent again.
    await releaseEvidence(evidenceId);
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }

  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: type === "IN" ? "Stok Masuk" : "Stok Keluar",
    objek: `${item.kode} - ${item.nama}`,
    detail: [`Jumlah: ${qty}`, tujuan && `Tujuan: ${tujuan}`, penerima && `Penerima: ${penerima}`, note && `Catatan: ${note}`]
      .filter(Boolean)
      .join("; "),
  });
  await logTransfer(req, `${item.kode} - ${item.nama}`, null, transfer);
  res.json({ success: true });
});

app.put("/api/transactions/:id", requireEstate("NILAM"), async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM transactions WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (editTooLate(req, res, "gudang", existing)) return;

  const { tujuan, type, qty, note, penerima } = req.body;
  if (!["IN", "OUT"].includes(type) || !qty || qty <= 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  let item: any;
  let removed: TransferChange = null;
  let added: TransferChange = null;
  try {
    await withTransaction(async (client) => {
      ({ item, removed, added } = await reviseNilamTx(client, req, existing, { type, qty, tujuan: tujuan || "", penerima: penerima || "", note: note || null }));
      if (existing.is_correction) return;
      // Same type: its history row changes in place (keeping its date); another type moves it to the
      // other history.
      if (existing.mirror_source === (type === "IN" ? "stock_in_log" : "stock_out_log")) {
        if (type === "IN")
          await execute("UPDATE stock_in_log SET qty = @qty, keterangan = @note WHERE id = @id", { qty, note: note || "", id: existing.mirror_id }, client);
        else
          await execute(
            "UPDATE stock_out_log SET qty = @qty, tujuan = @tujuan, penerima = @penerima, keterangan = @note WHERE id = @id",
            { qty, tujuan: tujuan || null, penerima: penerima || "", note: note || "", id: existing.mirror_id },
            client
          );
      } else {
        await deleteMirror(client, existing.mirror_source, existing.mirror_id);
        const mirror = await mirrorTransaction(client, item, type, tujuan || "", qty, note, penerima || "");
        await execute(
          `UPDATE transactions SET mirror_source = @source, mirror_id = @mirror_id WHERE id = @id`,
          { source: mirror.source, mirror_id: mirror.id, id: req.params.id },
          client
        );
      }
    });
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }

  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Edit Transaksi",
    objek: `${item?.kode} - ${item?.nama}`,
    detail: describeChanges(
      existing,
      { type, qty, tujuan: tujuan || "", penerima: penerima || "", note: note || null },
      { type: "Tipe", qty: "Jumlah", tujuan: "Tujuan", penerima: "Penerima", note: "Catatan" }
    ),
  });
  await logTransfer(req, `${item?.kode} - ${item?.nama}`, removed, added);
  res.json({ success: true });
});

app.delete("/api/transactions/:id", requireEstate("NILAM"), async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM transactions WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (editTooLate(req, res, "gudang", existing)) return;
  let removed: TransferChange = null;
  try {
    await withTransaction(async (client) => {
      removed = await deleteNilamTx(client, existing);
    });
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const item = await queryOne<any>("SELECT kode, nama FROM items WHERE id = @id", { id: existing.item_id });
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Hapus Transaksi",
    objek: `${item?.kode} - ${item?.nama}`,
    detail: `${existing.type === "IN" ? "Stok Masuk" : "Stok Keluar"} ${existing.qty}${existing.tujuan ? `; Tujuan: ${existing.tujuan}` : ""}`,
  });
  await logTransfer(req, `${item?.kode} - ${item?.nama}`, removed, null);
  res.json({ success: true });
});

// ---- Stock correction (stock opname / physical count adjustment) ----
app.post("/api/stock-correction", requireEstate("NILAM"), async (req, res) => {
  const { item_id, actual_qty, note } = req.body;

  if (!item_id || actual_qty === undefined || actual_qty < 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  if (!String(note ?? "").trim()) return res.status(400).json({ error: "Isi alasan koreksinya" });

  const item = await queryOne<any>("SELECT * FROM items WHERE id = @id", { id: item_id });
  if (!item) return res.status(404).json({ error: "Not found" });

  const delta = actual_qty - item.stock_tersedia;
  await withTransaction((client) => nilamCorrection(client, item_id, actual_qty, `Koreksi Stok (Opname)${note ? `: ${note}` : ""}`));

  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Koreksi Stok",
    objek: `${item.kode} - ${item.nama}`,
    detail: `Stock: ${item.stock_tersedia} → ${actual_qty} (selisih ${delta > 0 ? "+" : ""}${delta})${note ? `; Catatan: ${note}` : ""}`,
  });
  res.json({ success: true, delta });
});

// Sets a Nilam item's stock to the counted quantity (one correction transaction, never mirrored into
// the stock in/out logs). Returns the stock before.
async function nilamCorrection(client: PoolClient, itemId: number, actual: number, note: string) {
  const item = (await queryOne<any>("SELECT id, stock_tersedia FROM items WHERE id = @id FOR UPDATE", { id: itemId }, client))!;
  const delta = actual - item.stock_tersedia;
  if (delta !== 0) {
    const type: "IN" | "OUT" = delta > 0 ? "IN" : "OUT";
    const qty = Math.abs(delta);
    await execute(
      `INSERT INTO transactions (item_id, tujuan, type, qty, note, is_correction) VALUES (@item_id, '', @type, @qty, @note, 1)`,
      { item_id: itemId, type, qty, note },
      client
    );
    await applyStockEffect(client, itemId, type, qty, 1);
  }
  await execute(
    `UPDATE items SET stock_fisik = @stock_fisik, selisih_stock = @selisih_stock WHERE id = @id`,
    { stock_fisik: actual, selisih_stock: delta, id: itemId },
    client
  );
  return item.stock_tersedia as number;
}

app.get("/api/transactions", requireEstate("NILAM"), async (req, res) => {
  const { limit = "100" } = req.query as Record<string, string>;
  const rows = await queryMany(
    `SELECT transactions.*, items.kode, items.nama FROM transactions
     JOIN items ON items.id = transactions.item_id
     ORDER BY transactions.created_at DESC LIMIT @limit`,
    { limit: Math.min(parseInt(limit) || 100, 500) }
  );
  res.json(rows);
});

// ---- Stock In log (history from Google Sheet) ----
app.get("/api/stock-in", requireEstate("NILAM"), async (req, res) => {
  const {
    search = "",
    tujuan = "",
    vendor = "",
    dateFrom = "",
    dateTo = "",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  const conditions: string[] = [];
  const params: any = {};

  addWordSearch(search, "", conditions, params, ["satuan", "nama_vendor", "tujuan", "divisi", "po_in_akss", "no_pr", "keterangan"]);
  if (tujuan && TUJUAN_OPTIONS.includes(tujuan)) {
    conditions.push("tujuan = @tujuan");
    params.tujuan = tujuan;
  }
  if (vendor) {
    conditions.push("nama_vendor = @vendor");
    params.vendor = vendor;
  }
  if (dateFrom) {
    conditions.push("tanggal_terima_iso >= @dateFrom");
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push("tanggal_terima_iso <= @dateTo");
    params.dateTo = dateTo;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM stock_in_log ${where}`, params))!.c;
  const qtySum = (await queryOne<any>(`SELECT SUM(qty) s FROM stock_in_log ${where}`, params))!.s || 0;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    // Newest first; old imported rows without a date go last.
    `SELECT stock_in_log.*, ${nilamSaldoSql("stock_in_log")} AS saldo FROM stock_in_log ${where}
     ORDER BY NULLIF(tanggal_terima_iso, '') DESC NULLS LAST, id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), qtySum: Number(qtySum), page: parseInt(page), pageSize: limit });
});

app.get("/api/stock-in/vendors", requireEstate("NILAM"), async (_req, res) => {
  const rows = await queryMany<{ nama_vendor: string }>(
    "SELECT DISTINCT nama_vendor FROM stock_in_log WHERE nama_vendor IS NOT NULL AND nama_vendor NOT IN ('', '-') ORDER BY nama_vendor"
  );
  res.json(rows.map((r) => r.nama_vendor));
});

app.put("/api/stock-in/:id", requireEstate("NILAM"), async (req, res) => {
  const existing = await queryOne("SELECT * FROM stock_in_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (editTooLate(req, res, "gudang", existing)) return;
  const newEvidence = await checkEditEvidence(req, res, existing.evidence_id);
  if (newEvidence === undefined) return;

  const { nama_vendor, qty, satuan, tujuan, tanggal_terima_iso, keterangan } = req.body;
  // Made by a manual transaction: Nilam's stock follows the new jumlah.
  const tx = await mirroredTx("stock_in_log", existing.id);
  let sync: Awaited<ReturnType<typeof reviseNilamTx>> | null = null;
  if (tx) {
    if (!(Number(qty) > 0)) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
    try {
      sync = await withTransaction((client) =>
        reviseNilamTx(client, req, tx, { type: "IN", qty: Number(qty), tujuan: tx.tujuan ?? "", penerima: tx.penerima ?? "", note: keterangan ?? "" })
      );
    } catch (e) {
      if (e instanceof StockError) return res.status(400).json({ error: e.message });
      throw e;
    }
  }
  await execute(
    `UPDATE stock_in_log SET nama_vendor = @nama_vendor, qty = @qty, satuan = @satuan, tujuan = @tujuan, tanggal_terima_iso = @tanggal_terima_iso, tanggal_terima = @tanggal_terima, keterangan = @keterangan WHERE id = @id`,
    {
      nama_vendor: nama_vendor ?? "",
      qty: qty ?? 0,
      satuan: satuan ?? "",
      tujuan: tujuan && TUJUAN_OPTIONS.includes(tujuan) ? tujuan : null,
      tanggal_terima_iso: tanggal_terima_iso || null,
      tanggal_terima: tanggal_terima_iso ? isoToDisplay(tanggal_terima_iso) : "",
      keterangan: keterangan ?? "",
      id: req.params.id,
    }
  );
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Edit Stock In",
    objek: `${existing.kode} - ${existing.nama}`,
    detail: describeChanges(
      existing,
      { nama_vendor: nama_vendor ?? "", qty: qty ?? 0, satuan: satuan ?? "", tujuan, tanggal_terima_iso: tanggal_terima_iso || null, keterangan: keterangan ?? "" },
      { nama_vendor: "Vendor", qty: "Jumlah", satuan: "Satuan", tujuan: "Tujuan", tanggal_terima_iso: "Tanggal", keterangan: "Keterangan" }
    ),
  });
  if (sync) await logTransfer(req, `${existing.kode} - ${existing.nama}`, sync.removed, sync.added);
  await useEditEvidence(newEvidence, nilamEvidenceRows("stock_in_log", existing.id));
  res.json({ success: true });
});

app.delete("/api/stock-in/:id", requireEstate("NILAM"), async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM stock_in_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (editTooLate(req, res, "gudang", existing)) return;
  // Made by a manual transaction: that transaction goes too, with its stock and transfer. An
  // imported history row is only a record (the stock never came from it).
  const tx = await mirroredTx("stock_in_log", existing.id);
  let removed: TransferChange = null;
  try {
    if (tx) await withTransaction(async (client) => void (removed = await deleteNilamTx(client, tx)));
    else await execute("DELETE FROM stock_in_log WHERE id = @id", { id: existing.id });
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (tx) await logTransfer(req, `${existing.kode} - ${existing.nama}`, removed, null);
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Hapus Stock In",
    objek: `${existing?.kode} - ${existing?.nama}`,
    detail: `Jumlah: ${existing?.qty}; Tanggal: ${existing?.tanggal_terima || "-"}; Vendor: ${existing?.nama_vendor || "-"}`,
  });
  res.json({ success: true });
});

// ---- Stock Out log (history from Google Sheet) ----
app.get("/api/stock-out", requireEstate("NILAM"), async (req, res) => {
  const {
    search = "",
    tujuan = "",
    dateFrom = "",
    dateTo = "",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  const conditions: string[] = [];
  const params: any = {};

  addWordSearch(search, "", conditions, params, ["satuan", "penerima", "tujuan", "divisi", "req_by", "no_request", "no_embrace_gudang", "keterangan"]);
  if (tujuan && TUJUAN_OPTIONS.includes(tujuan)) {
    conditions.push("tujuan = @tujuan");
    params.tujuan = tujuan;
  }
  if (dateFrom) {
    conditions.push("tanggal_keluar_iso >= @dateFrom");
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push("tanggal_keluar_iso <= @dateTo");
    params.dateTo = dateTo;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM stock_out_log ${where}`, params))!.c;
  const qtySum = (await queryOne<any>(`SELECT SUM(qty) s FROM stock_out_log ${where}`, params))!.s || 0;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    // Newest first; old imported rows without a date go last.
    `SELECT stock_out_log.*, ${nilamSaldoSql("stock_out_log")} AS saldo FROM stock_out_log ${where}
     ORDER BY NULLIF(tanggal_keluar_iso, '') DESC NULLS LAST, id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), qtySum: Number(qtySum), page: parseInt(page), pageSize: limit });
});

app.put("/api/stock-out/:id", requireEstate("NILAM"), async (req, res) => {
  const existing = await queryOne("SELECT * FROM stock_out_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (editTooLate(req, res, "gudang", existing)) return;
  const newEvidence = await checkEditEvidence(req, res, existing.evidence_id);
  if (newEvidence === undefined) return;

  const { penerima, qty, satuan, tujuan, tanggal_keluar_iso, keterangan } = req.body;
  // Made by a manual transaction: Nilam's stock and the transfer into another gudang follow.
  const tx = await mirroredTx("stock_out_log", existing.id);
  let sync: Awaited<ReturnType<typeof reviseNilamTx>> | null = null;
  if (tx) {
    if (!(Number(qty) > 0)) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
    try {
      sync = await withTransaction((client) =>
        reviseNilamTx(client, req, tx, {
          type: "OUT",
          qty: Number(qty),
          tujuan: tujuan && TUJUAN_OPTIONS.includes(tujuan) ? tujuan : "",
          penerima: penerima ?? "",
          note: keterangan ?? "",
        })
      );
    } catch (e) {
      if (e instanceof StockError) return res.status(400).json({ error: e.message });
      throw e;
    }
  }
  await execute(
    `UPDATE stock_out_log SET penerima = @penerima, qty = @qty, satuan = @satuan, tujuan = @tujuan, tanggal_keluar_iso = @tanggal_keluar_iso, tanggal_keluar = @tanggal_keluar, keterangan = @keterangan WHERE id = @id`,
    {
      penerima: penerima ?? "",
      qty: qty ?? 0,
      satuan: satuan ?? "",
      tujuan: tujuan && TUJUAN_OPTIONS.includes(tujuan) ? tujuan : null,
      tanggal_keluar_iso: tanggal_keluar_iso || null,
      tanggal_keluar: tanggal_keluar_iso ? isoToDisplay(tanggal_keluar_iso) : "",
      keterangan: keterangan ?? "",
      id: req.params.id,
    }
  );
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Edit Stock Out",
    objek: `${existing.kode} - ${existing.nama}`,
    detail: describeChanges(
      existing,
      { penerima: penerima ?? "", qty: qty ?? 0, satuan: satuan ?? "", tujuan, tanggal_keluar_iso: tanggal_keluar_iso || null, keterangan: keterangan ?? "" },
      { penerima: "Penerima", qty: "Jumlah", satuan: "Satuan", tujuan: "Tujuan", tanggal_keluar_iso: "Tanggal", keterangan: "Keterangan" }
    ),
  });
  if (sync) await logTransfer(req, `${existing.kode} - ${existing.nama}`, sync.removed, sync.added);
  await useEditEvidence(newEvidence, nilamEvidenceRows("stock_out_log", existing.id));
  res.json({ success: true });
});

app.delete("/api/stock-out/:id", requireEstate("NILAM"), async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM stock_out_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (editTooLate(req, res, "gudang", existing)) return;
  // Made by a manual transaction: that transaction goes too, with its stock and transfer. An
  // imported history row is only a record (the stock never came from it).
  const tx = await mirroredTx("stock_out_log", existing.id);
  let removed: TransferChange = null;
  try {
    if (tx) await withTransaction(async (client) => void (removed = await deleteNilamTx(client, tx)));
    else await execute("DELETE FROM stock_out_log WHERE id = @id", { id: existing.id });
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (tx) await logTransfer(req, `${existing.kode} - ${existing.nama}`, removed, null);
  await logActivity(req, {
    module: "BARANG",
    estate: "NILAM",
    aksi: "Hapus Stock Out",
    objek: `${existing?.kode} - ${existing?.nama}`,
    detail: `Jumlah: ${existing?.qty}; Tanggal: ${existing?.tanggal_keluar || "-"}; Penerima: ${existing?.penerima || "-"}`,
  });
  res.json({ success: true });
});

// ---- Own password: any logged-in user, the current password must match ----
app.post("/api/auth/change-password", async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return res.status(422).json({ error: "Password baru minimal 6 karakter" });
  }
  const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = @id", { id: req.user!.id });
  if (!row) return res.status(404).json({ error: "Akun tidak ditemukan" });
  if (!verifyPassword(String(currentPassword ?? ""), row.password_hash)) {
    return res.status(400).json({ error: "Password lama salah" });
  }
  await execute("UPDATE users SET password_hash = @hash WHERE id = @id", { hash: hashPassword(newPassword), id: req.user!.id });
  res.json({ success: true });
});

// ---- Users (login accounts) master data ----
// users.estates / users.perms from the form's checkboxes (only kept for estate accounts).
const listValue = (v: unknown, known: readonly string[]) => (Array.isArray(v) ? known.filter((k) => v.includes(k)).join(",") : "");

app.get("/api/users", requireSuperuser, async (req, res) => {
  const { search = "", sortBy = "nama", sortDir = "asc", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;

  const validSort = ["username", "nama", "created_at"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "nama";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = [];
  const params: any = {};

  if (search) {
    conditions.push("(username ILIKE @search OR nama ILIKE @search)");
    params.search = `%${search}%`;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM users ${where}`, params))!.c;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT id, username, nama, role, estates, perms, temp_full_until, edit_lampau_until, created_at FROM users ${where} ORDER BY ${sortCol} ${dir} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

// A superuser has every estate and permission; an estate account needs at least one estate.
function userAccess(body: any): { role: "superuser" | "estate"; estates: string; perms: string; error?: string } {
  const role = body.role === "estate" ? "estate" : "superuser";
  if (role === "superuser") return { role, estates: "", perms: "" };
  const estates = listValue(body.estates, ESTATES);
  if (!estates) return { role, estates, perms: "", error: "Pilih minimal satu estate untuk akun estate" };
  return { role, estates, perms: listValue(body.perms, ALL_PERMS) };
}

// A Pengguna admin who isn't a Super User hands out only what it has itself: estates and permissions
// outside its own (or an account that holds more than it) are refused, so it can't raise its own access
// or take over a wider account by resetting its password.
function beyondActor(req: express.Request, estates: string | null | undefined, perms: string | null | undefined): string | null {
  const u = req.user!;
  if (u.role === "superuser") return null;
  const e = String(estates ?? "").split(",").filter(Boolean).find((x) => !u.estates.includes(x));
  if (e) return `Estate ${e} tidak termasuk akses akun Anda`;
  const p = String(perms ?? "").split(",").filter(Boolean).find((x) => !u.perms.includes(x));
  if (p) return `Hak ${p} tidak dimiliki akun Anda, jadi tidak bisa diberikan`;
  return null;
}

// Login ignores case, so two accounts may not differ only in case (admin / Admin).
const usernameTaken = async (username: string, exceptId = 0) =>
  !!(await queryOne("SELECT 1 FROM users WHERE LOWER(username) = LOWER(@username) AND id <> @exceptId", { username, exceptId }));

app.post("/api/users", requireSuperuser, async (req, res) => {
  const { username, password, nama } = req.body;
  if (!username || !String(username).trim() || !password || !nama || !String(nama).trim()) {
    return res.status(400).json({ error: "Username, password, dan nama wajib diisi" });
  }
  const access = userAccess(req.body);
  if (access.error) return res.status(400).json({ error: access.error });
  if (access.role === "superuser" && req.user!.role !== "superuser") return res.status(403).json({ error: "Hanya Super User yang bisa membuat Super User" });
  const lebih = beyondActor(req, access.estates, access.perms);
  if (lebih) return res.status(403).json({ error: lebih });
  if (await usernameTaken(String(username).trim())) return res.status(409).json({ error: "Username sudah digunakan" });

  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO users (username, password_hash, nama, role, estate, estates, perms)
       VALUES (@username, @password_hash, @nama, @role, @estate, @estates, @perms) RETURNING id`,
      {
        username: String(username).trim(),
        password_hash: hashPassword(password),
        nama: String(nama).trim(),
        role: access.role,
        estate: access.estates.split(",")[0] || null,
        estates: access.estates || null,
        perms: access.role === "estate" ? access.perms : null,
      }
    );
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Username sudah digunakan" });
    }
    throw e;
  }
});

app.put("/api/users/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM users WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { username, nama, password } = req.body;
  if (!username || !String(username).trim() || !nama || !String(nama).trim()) {
    return res.status(400).json({ error: "Username dan nama wajib diisi" });
  }
  const access = userAccess(req.body);
  if (access.error) return res.status(400).json({ error: access.error });
  // A Pengguna admin who isn't a superuser can't make or change Super User accounts.
  if ((access.role === "superuser" || existing.role === "superuser") && req.user!.role !== "superuser") {
    return res.status(403).json({ error: "Hanya Super User yang bisa mengubah akun Super User" });
  }
  if (req.user!.role !== "superuser") {
    const wider = beyondActor(req, existing.estates ?? existing.estate, existing.perms);
    if (wider) return res.status(403).json({ error: `Akun ini punya akses lebih luas dari akun Anda (${wider.toLowerCase()}); hanya Super User yang bisa mengubahnya` });
    const lebih = beyondActor(req, access.estates, access.perms);
    if (lebih) return res.status(403).json({ error: lebih });
    const same = (a: string | null | undefined, b: string | null | undefined) =>
      String(a ?? "").split(",").filter(Boolean).sort().join() === String(b ?? "").split(",").filter(Boolean).sort().join();
    if (existing.id === req.user!.id && (!same(access.estates, existing.estates ?? existing.estate) || !same(access.perms, existing.perms)))
      return res.status(403).json({ error: "Hak akses akun sendiri hanya bisa diubah oleh Super User" });
  }
  if (await usernameTaken(String(username).trim(), existing.id)) return res.status(409).json({ error: "Username sudah digunakan" });
  // Edit bulan lalu sementara: a date (until its end, WIB), or empty to close it; Super User only.
  const lampauRaw = req.body.edit_lampau_until;
  const lampauGiven = lampauRaw !== undefined;
  if (lampauGiven && lampauRaw !== null && lampauRaw !== "" && !(isIsoDate(lampauRaw) && lampauRaw >= jakartaToday()))
    return res.status(400).json({ error: "Tanggal batas edit bulan lalu tidak valid (paling cepat hari ini)" });
  if (lampauGiven && req.user!.role !== "superuser" && String(lampauRaw ?? "") !== jakartaDay(existing.edit_lampau_until ?? ""))
    return res.status(403).json({ error: "Edit bulan lalu sementara hanya bisa diatur Super User" });
  const lampau = !lampauGiven ? existing.edit_lampau_until : lampauRaw ? `${lampauRaw}T23:59:59+07:00` : null;

  try {
    await execute(
      `UPDATE users SET username = @username, nama = @nama, password_hash = @password_hash, role = @role,
         estate = @estate, estates = @estates, perms = @perms, modules = NULL, edit_lampau_until = @lampau WHERE id = @id`,
      {
        username: String(username).trim(),
        nama: String(nama).trim(),
        password_hash: password ? hashPassword(password) : existing.password_hash,
        role: access.role,
        estate: access.estates.split(",")[0] || null,
        estates: access.estates || null,
        perms: access.role === "estate" ? access.perms : null,
        lampau,
        id: req.params.id,
      }
    );
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Username sudah digunakan" });
    }
    throw e;
  }
  sessionCache.delete(Number(req.params.id));
  // A new nama (e.g. a clinic account given its bidan's full name and title): the copies of the old one
  // that letters and reports print follow it - the visits it entered, the obat it received, its stok
  // opname, permintaan obat and pruning entries.
  const namaBaru = String(nama).trim();
  if (namaBaru !== existing.nama) {
    const uid = existing.id;
    const lama = existing.nama;
    const ests = String(access.estates || existing.estates || existing.estate || "").split(",").filter(Boolean);
    await withTransaction(async (c) => {
      await execute("UPDATE klinik_kunjungan SET created_by = @baru WHERE created_by = @lama AND klinik = ANY(@ests)", { baru: namaBaru, lama, ests }, c);
      await execute("UPDATE klinik_stock_tx SET penerima = @baru WHERE penerima = @lama AND user_id = @uid", { baru: namaBaru, lama, uid }, c);
      await execute("UPDATE opname SET created_by_nama = @baru WHERE created_by = @uid AND created_by_nama = @lama", { baru: namaBaru, lama, uid }, c);
      await execute("UPDATE opname SET submitted_by_nama = @baru WHERE submitted_by = @uid AND submitted_by_nama = @lama", { baru: namaBaru, lama, uid }, c);
      await execute("UPDATE opname SET approved_by_nama = @baru WHERE approved_by = @uid AND approved_by_nama = @lama", { baru: namaBaru, lama, uid }, c);
      await execute("UPDATE klinik_permintaan SET created_by = @baru WHERE user_id = @uid AND created_by = @lama", { baru: namaBaru, lama, uid }, c);
      await execute("UPDATE pruning_log SET created_by = @baru WHERE user_id = @uid AND created_by = @lama", { baru: namaBaru, lama, uid }, c);
      // The Log Aktivitas and the counters of stok opname show the account by its current name too.
      await execute("UPDATE activity_log SET nama = @baru WHERE user_id = @uid AND nama <> @baru", { baru: namaBaru, uid }, c);
      await execute("UPDATE opname_line SET dihitung_oleh_nama = @baru WHERE dihitung_oleh = @uid AND dihitung_oleh_nama = @lama", { baru: namaBaru, lama, uid }, c);
      await execute("UPDATE opname SET dibuka_oleh_nama = @baru WHERE dibuka_oleh_nama = @lama", { baru: namaBaru, lama }, c);
      await execute("UPDATE gudang_stock_tx SET penerima = @baru WHERE penerima = @lama AND user_id = @uid", { baru: namaBaru, lama, uid }, c);
      await execute("UPDATE klinik_laporan_sumber SET synced_by = @baru WHERE synced_by = @lama", { baru: namaBaru, lama }, c);
    });
    // Logged (after the rename, so under the new name) in the Log of the modules / estates the account works in.
    const LOG_OF: Record<string, LogModule> = { gudang: "BARANG", bbm: "BBM", pupuk: "PUPUK", klinik: "KLINIK", oli: "OLI", koperasi: "KOPERASI" };
    const mods = [...new Set(String(existing.perms ?? "").split(",").map((x) => LOG_OF[x.split(".")[0]]).filter(Boolean))].slice(0, 6);
    for (const module of mods)
      for (const estate of ests.slice(0, 5))
        await logActivity(req, { module, estate, aksi: "Ubah Nama Akun", objek: existing.username, detail: `${lama} → ${namaBaru} (nama lama di log, transaksi, stok opname dan surat ikut diperbarui)` });
  }
  const sebelum = existing.edit_lampau_until ? jakartaDay(existing.edit_lampau_until) : "";
  // Logged in the Log of every module / estate the account works in, where its edits will show up.
  if (lampauGiven && String(lampauRaw ?? "") !== sebelum) {
    const LOG_OF: Record<string, LogModule> = { gudang: "BARANG", bbm: "BBM", pupuk: "PUPUK", klinik: "KLINIK", oli: "OLI" };
    const mods = [...new Set(String(access.perms).split(",").map((x) => LOG_OF[x.split(".")[0]]).filter(Boolean))];
    for (const module of mods)
      for (const estate of String(access.estates).split(",").filter(Boolean))
        await logActivity(req, {
          module,
          estate,
          aksi: lampauRaw ? "Buka Edit Bulan Lalu" : "Tutup Edit Bulan Lalu",
          objek: `${existing.username} - ${existing.nama}`,
          detail: lampauRaw ? `sampai ${String(lampauRaw).split("-").reverse().join("/")} (edit saja, tanpa hapus)` : `sebelumnya sampai ${sebelum.split("-").reverse().join("/")}`,
        });
  }
  res.json({ success: true });
});

app.delete("/api/users/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM users WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.user!.role !== "superuser" && (existing.role === "superuser" || beyondActor(req, existing.estates ?? existing.estate, existing.perms)))
    return res.status(403).json({ error: "Akun ini punya akses lebih luas dari akun Anda; hanya Super User yang bisa menghapusnya" });

  const { c: userCount } = (await queryOne<{ c: number }>("SELECT COUNT(*) c FROM users"))!;
  if (Number(userCount) <= 1) {
    return res.status(400).json({ error: "Tidak bisa menghapus satu-satunya akun yang tersisa" });
  }

  if (existing.role === "superuser" && req.user!.role !== "superuser") return res.status(403).json({ error: "Hanya Super User yang bisa menghapus Super User" });
  await execute("DELETE FROM users WHERE id = @id", { id: req.params.id });
  sessionCache.delete(Number(req.params.id));
  res.json({ success: true });
});

// ---- Karyawan master data ----
app.get("/api/karyawan/status-options", requireSuperuser, async (_req, res) => {
  const rows = await queryMany<{ status: string }>(
    "SELECT DISTINCT status FROM karyawan WHERE status IS NOT NULL AND status != '' ORDER BY status"
  );
  res.json(rows.map((r) => r.status));
});

app.get("/api/karyawan/estate-options", requireSuperuser, async (_req, res) => {
  const rows = await queryMany<{ estate: string }>(
    "SELECT DISTINCT estate FROM karyawan WHERE estate IS NOT NULL AND estate != '' ORDER BY estate"
  );
  res.json(rows.map((r) => r.estate));
});

// Penerima picker in the transaction forms: only the karyawan of the estate the transaction belongs
// to. Open to that estate's users (the full list above is superuser-only). karyawan.estate is
// stored as e.g. "Nilam", hence the case-insensitive match.
app.get("/api/karyawan/pick", async (req, res) => {
  const { estate = "", search = "" } = req.query as Record<string, string>;
  if (!(ESTATES as readonly string[]).includes(estate)) return res.status(400).json({ error: "Estate tidak valid" });
  if (!estateAllowed(req.user!, estate)) return res.status(403).json({ error: "Akses ditolak" });
  const data = await queryMany(
    `SELECT nik, nama FROM karyawan
     WHERE UPPER(estate) = @estate AND (@search = '' OR nama ILIKE @like OR nik ILIKE @like)
     ORDER BY nama LIMIT 8`,
    { estate, search, like: `%${search}%` }
  );
  res.json(data);
});

app.get("/api/karyawan", requireSuperuser, async (req, res) => {
  const { search = "", status = "", estate = "", sortBy = "nama", sortDir = "asc", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;

  const validSort = ["nik", "nama", "status", "estate", "lokasi_kerja"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "nama";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = [];
  const params: any = {};

  if (search) {
    conditions.push("(nik ILIKE @search OR nama ILIKE @search OR nik_ktp ILIKE @search)");
    params.search = `%${search}%`;
  }
  if (status) {
    conditions.push("status = @status");
    params.status = status;
  }
  if (estate) {
    conditions.push("estate = @estate");
    params.estate = estate;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM karyawan ${where}`, params))!.c;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT * FROM karyawan ${where} ORDER BY ${sortCol} ${dir} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

app.post("/api/karyawan", requireSuperuser, async (req, res) => {
  const { nik, nama, status, estate, lokasi_kerja, nik_ktp } = req.body;
  if (!nik || !String(nik).trim() || !nama || !String(nama).trim()) {
    return res.status(400).json({ error: "NIK dan nama wajib diisi" });
  }

  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO karyawan (nik, nama, status, estate, lokasi_kerja, nik_ktp)
       VALUES (@nik, @nama, @status, @estate, @lokasi_kerja, @nik_ktp) RETURNING id`,
      {
        nik: String(nik).trim(),
        nama: String(nama).trim(),
        status: status || "",
        estate: estate || "",
        lokasi_kerja: lokasi_kerja || "",
        nik_ktp: nik_ktp || "",
      }
    );
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "NIK sudah digunakan karyawan lain" });
    }
    throw e;
  }
});

app.put("/api/karyawan/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne("SELECT * FROM karyawan WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { nik, nama, status, estate, lokasi_kerja, nik_ktp } = req.body;
  if (!nik || !String(nik).trim() || !nama || !String(nama).trim()) {
    return res.status(400).json({ error: "NIK dan nama wajib diisi" });
  }

  try {
    await execute(
      `UPDATE karyawan SET nik = @nik, nama = @nama, status = @status, estate = @estate, lokasi_kerja = @lokasi_kerja, nik_ktp = @nik_ktp WHERE id = @id`,
      {
        nik: String(nik).trim(),
        nama: String(nama).trim(),
        status: status || "",
        estate: estate || "",
        lokasi_kerja: lokasi_kerja || "",
        nik_ktp: nik_ktp || "",
        id: req.params.id,
      }
    );
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "NIK sudah digunakan karyawan lain" });
    }
    throw e;
  }

  res.json({ success: true });
});

app.delete("/api/karyawan/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne("SELECT * FROM karyawan WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await execute("DELETE FROM karyawan WHERE id = @id", { id: req.params.id });
  res.json({ success: true });
});

// ---- Alat Berat master data (heavy equipment/vehicles that consume fuel) ----
// Suggestions for Kode Kendaraan on a BBM Stok Keluar; any logged-in account (like karyawan/pick).
app.get("/api/alat-berat/pick", async (req, res) => {
  const { search = "" } = req.query as Record<string, string>;
  const data = await queryMany(
    `SELECT kode, jenis_unit, nama FROM alat_berat
     WHERE @search = '' OR kode ILIKE @like OR nama ILIKE @like OR jenis_unit ILIKE @like
     ORDER BY kode LIMIT 100`,
    { search, like: `%${search}%` }
  );
  res.json(data);
});

app.get("/api/alat-berat/jenis-options", requireSuperuser, async (_req, res) => {
  const rows = await queryMany<{ jenis_unit: string }>(
    "SELECT DISTINCT jenis_unit FROM alat_berat WHERE jenis_unit IS NOT NULL AND jenis_unit != '' ORDER BY jenis_unit"
  );
  res.json(rows.map((r) => r.jenis_unit));
});

app.get("/api/alat-berat", requireSuperuser, async (req, res) => {
  const { search = "", jenis_unit = "", sortBy = "kode", sortDir = "asc", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;

  const validSort = ["kode", "jenis_unit", "nama"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions: string[] = [];
  const params: any = {};

  addWordSearch(search, "", conditions, params, ["jenis_unit"]);
  if (jenis_unit) {
    conditions.push("jenis_unit = @jenis_unit");
    params.jenis_unit = jenis_unit;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM alat_berat ${where}`, params))!.c;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const data = await queryMany(
    `SELECT * FROM alat_berat ${where} ORDER BY ${sortCol} ${dir} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

app.post("/api/alat-berat", requireSuperuser, async (req, res) => {
  const { kode, jenis_unit, nama } = req.body;
  if (!kode || !String(kode).trim()) {
    return res.status(400).json({ error: "Kode wajib diisi" });
  }

  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO alat_berat (kode, jenis_unit, nama) VALUES (@kode, @jenis_unit, @nama) RETURNING id`,
      { kode: String(kode).trim(), jenis_unit: jenis_unit || "", nama: nama || "" }
    );
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Kode sudah digunakan alat lain" });
    }
    throw e;
  }
});

app.put("/api/alat-berat/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne("SELECT * FROM alat_berat WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { kode, jenis_unit, nama } = req.body;
  if (!kode || !String(kode).trim()) {
    return res.status(400).json({ error: "Kode wajib diisi" });
  }

  try {
    await execute(`UPDATE alat_berat SET kode = @kode, jenis_unit = @jenis_unit, nama = @nama WHERE id = @id`, {
      kode: String(kode).trim(),
      jenis_unit: jenis_unit || "",
      nama: nama || "",
      id: req.params.id,
    });
  } catch (e: any) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Kode sudah digunakan alat lain" });
    }
    throw e;
  }

  res.json({ success: true });
});

app.delete("/api/alat-berat/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne("SELECT * FROM alat_berat WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await execute("DELETE FROM alat_berat WHERE id = @id", { id: req.params.id });
  res.json({ success: true });
});

// ---- Master Blok (see schema.sql master_blok) ----
// The blocks of the account's estates, in the sheet's order unless sorted. A superuser or an
// account with master.blok changes them; an estate account only those of its own estates.
const BLOK_SORT: Record<string, string> = {
  urut: "urut", estate: "estate", divisi: "divisi", blok: "blok", planting_material: "planting_material",
  tahun_tanam: "tahun_tanam", ha: "ha", sph: "sph", pkk: "pkk",
};
const blokEstates = (req: express.Request) => ESTATES.filter((e) => estateAllowed(req.user!, e)) as string[];
function blokFilters(req: express.Request) {
  const q = req.query as Record<string, string>;
  const estates = blokEstates(req);
  const conditions = ["estate = ANY(@estates)"];
  const params: any = { estates: q.estate && estates.includes(q.estate) ? [q.estate] : estates };
  for (const f of ["divisi", "planting_material"]) {
    if (q[f]) {
      conditions.push(`${f} = @${f}`);
      params[f] = q[f];
    }
  }
  if (/^\d{4}$/.test(q.tahun_tanam ?? "")) {
    conditions.push("tahun_tanam = @tahun_tanam");
    params.tahun_tanam = Number(q.tahun_tanam);
  }
  // Each word anywhere in blok / divisi / planting material ("I-5" only finds I-5, not I5).
  wordSearch(q.search || "", ["blok", "divisi", "planting_material"], conditions, params);
  return { where: "WHERE " + conditions.join(" AND "), params };
}

app.get("/api/master-blok/options", async (req, res) => {
  const estates = blokEstates(req);
  const col = async (c: string) =>
    (await queryMany<{ v: any }>(`SELECT DISTINCT ${c} v FROM master_blok WHERE estate = ANY(@estates) AND ${c} IS NOT NULL ORDER BY 1`, { estates })).map((r) => r.v);
  res.json({ estates, divisi: await col("divisi"), planting_material: await col("planting_material"), tahun_tanam: await col("tahun_tanam") });
});

app.get("/api/master-blok", async (req, res) => {
  const q = req.query as Record<string, string>;
  const { where, params } = blokFilters(req);
  const sortCol = BLOK_SORT[q.sortBy] ?? "urut";
  const dir = q.sortDir === "desc" ? "DESC" : "ASC";
  const totals = (await queryOne<any>(
    `SELECT COUNT(*)::int c, COALESCE(SUM(ha), 0)::float8 ha, COALESCE(SUM(pkk), 0)::int pkk FROM master_blok ${where}`,
    params
  ))!;
  const limit = Math.min(parseInt(q.pageSize) || 50, 1000);
  const offset = (Math.max(parseInt(q.page) || 1, 1) - 1) * limit;
  // An exact blok match comes first when searching (so "I5" lists I5 before I50).
  const exact = q.search?.trim() ? "(upper(blok) = upper(@exact)) DESC," : "";
  const data = await queryMany(
    `SELECT * FROM master_blok ${where} ORDER BY ${exact} ${sortCol} ${dir} NULLS LAST, urut, id LIMIT @limit OFFSET @offset`,
    { ...params, exact: q.search?.trim() ?? "", limit, offset }
  );
  res.json({ data, total: totals.c, totalHa: totals.ha, totalPkk: totals.pkk, page: parseInt(q.page) || 1, pageSize: limit });
});

function blokPayload(b: any): { data?: Record<string, any>; error?: string } {
  const t = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const num = (v: unknown) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const data = {
    estate: t(b.estate).toUpperCase(),
    divisi: t(b.divisi),
    blok: t(b.blok),
    planting_material: t(b.planting_material),
    tahun_tanam: num(b.tahun_tanam),
    ha: num(b.ha),
    sph: num(b.sph),
    pkk: num(b.pkk),
  };
  if (!(ESTATES as readonly string[]).includes(data.estate)) return { error: "Pilih estate" };
  if (!data.blok) return { error: "Nama blok wajib diisi" };
  if (data.tahun_tanam !== null && !Number.isInteger(data.tahun_tanam)) return { error: "Tahun tanam harus tahun (cth. 2013)" };
  for (const f of ["sph", "pkk"] as const) if (data[f] !== null && !Number.isInteger(data[f])) return { error: `${f.toUpperCase()} harus bilangan bulat` };
  return { data };
}
const blokObjek = (r: { estate: string; divisi: string; blok: string; tahun_tanam: number | null }) =>
  `${r.estate} · Div ${r.divisi || "-"} · Blok ${r.blok}${r.tahun_tanam ? ` (TT ${r.tahun_tanam})` : ""}`;
const BLOK_LABELS = { estate: "Estate", divisi: "Divisi", blok: "Blok", planting_material: "Planting Material", tahun_tanam: "Tahun Tanam", ha: "Ha", sph: "SPH", pkk: "PKK" };

app.post("/api/master-blok", async (req, res) => {
  const p = blokPayload(req.body);
  if (!p.data) return res.status(400).json({ error: p.error });
  if (!estateAllowed(req.user!, p.data.estate)) return res.status(403).json({ error: "Akses ditolak" });
  const row = await queryOne<{ id: number }>(
    `INSERT INTO master_blok (estate, divisi, blok, planting_material, tahun_tanam, ha, sph, pkk, urut)
     VALUES (@estate, @divisi, @blok, @planting_material, @tahun_tanam, @ha, @sph, @pkk, (SELECT COALESCE(MAX(urut), 0) + 1 FROM master_blok)) RETURNING id`,
    p.data
  );
  await logActivity(req, { module: "PUPUK", estate: p.data.estate, aksi: "Tambah Blok", objek: blokObjek(p.data as any) });
  res.json({ success: true, id: row!.id });
});

app.put("/api/master-blok/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM master_blok WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Blok tidak ditemukan" });
  const p = blokPayload(req.body);
  if (!p.data) return res.status(400).json({ error: p.error });
  if (!estateAllowed(req.user!, existing.estate) || !estateAllowed(req.user!, p.data.estate)) return res.status(403).json({ error: "Akses ditolak" });
  await execute(
    `UPDATE master_blok SET estate = @estate, divisi = @divisi, blok = @blok, planting_material = @planting_material,
       tahun_tanam = @tahun_tanam, ha = @ha, sph = @sph, pkk = @pkk WHERE id = @id`,
    { ...p.data, id: existing.id }
  );
  await logActivity(req, { module: "PUPUK", estate: p.data.estate, aksi: "Edit Blok", objek: blokObjek(p.data as any), detail: describeChanges(existing, p.data, BLOK_LABELS) });
  res.json({ success: true });
});

app.delete("/api/master-blok/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM master_blok WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Blok tidak ditemukan" });
  if (!estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  await execute("DELETE FROM master_blok WHERE id = @id", { id: existing.id });
  await logActivity(req, { module: "PUPUK", estate: existing.estate, aksi: "Hapus Blok", objek: blokObjek(existing) });
  res.json({ success: true });
});

// ---- Peta Blok (see schema.sql peta_blok / peta_legend) ----
// The map's boxes with, per blok of the account's estates, its Master Blok figures (divisi, tahun
// tanam, Ha, PKK) and the pupuk NPK that went out to it in the period (pupuk_log keluar by blok), as
// the sheet's SUMIFS did; progress = kg / PKK. Other estates' boxes come without figures.
const HEX = /^#[0-9a-f]{6}$/i;
app.get("/api/peta-blok", async (req, res) => {
  const { from, to } = laporanRange(req.query as Record<string, string>);
  const estates = blokEstates(req);
  const cells = await queryMany(
    `SELECT c.id, c.kind, c.label, c.gx, c.gy, c.h, c.estate, c.warna,
       m.divisi, m.tahun_tanam, m.planting_material, m.ha, m.pkk, p.kg, p.terakhir
     FROM peta_blok c
     LEFT JOIN (SELECT estate, upper(blok) b, string_agg(DISTINCT divisi, ' / ') divisi, string_agg(DISTINCT tahun_tanam::text, ' / ') tahun_tanam,
                  string_agg(DISTINCT planting_material, ' / ') planting_material, SUM(ha)::float8 ha, SUM(pkk)::int pkk
                FROM master_blok WHERE estate = ANY(@estates) GROUP BY 1, 2) m ON m.estate = c.estate AND m.b = upper(c.label)
     LEFT JOIN (SELECT estate, upper(blok) b, SUM(keluar)::float8 kg, MAX(tanggal_iso) terakhir
                FROM pupuk_log WHERE keluar > 0 AND estate = ANY(@estates) AND tanggal_iso BETWEEN @from AND @to GROUP BY 1, 2) p
       ON p.estate = c.estate AND p.b = upper(c.label)
     ORDER BY c.gy, c.gx`,
    { estates, from, to }
  );
  const legend = await queryMany("SELECT id, dari, label, warna FROM peta_legend WHERE jenis = 'pupuk' ORDER BY dari");
  const pruningLegend = await queryMany("SELECT id, dari, label, warna FROM peta_legend WHERE jenis = 'pruning' ORDER BY dari");
  res.json({ estates, cells, legend, pruningLegend });
});

// ---- Pruning PT.AKSS (see schema.sql pruning_baris / pruning_log) ----
// Entered per date and blok in Kebun > Pruning (the history came once from the old sheet). The Rekap is
// the sheet's BLOCK DETAIL row for row (pruning_baris); every entry belongs to one row (baris_id). The
// map adds a blok's rows up, as the mapping sheet does: progress = pokok pruned / (Ha x SPH).
const PRUNING_ISO = /^\d{4}-\d{2}-\d{2}$/;
const pruningEstates = (req: express.Request, estate: string) => blokEstates(req).filter((e) => !estate || e === estate);
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
type PBaris = {
  id: number;
  estate: string;
  divisi: string;
  blok: string;
  planting_material: string;
  tahun_tanam: number | null;
  ha: number | null;
  sph: number | null;
  pkk: number | null;
  kondisi: string;
  field_number: string;
  urut: number;
};
const pruningBaris = (estates: string[], c?: PoolClient) =>
  queryMany<PBaris>("SELECT * FROM pruning_baris WHERE estate = ANY(@estates) ORDER BY urut, id", { estates }, c);

// The blok an entry can be for: the Rekap's (with its rows, when it has two) and the other Master Blok ones.
async function pruningBlokList(estates: string[]) {
  const baris = await pruningBaris(estates);
  const out = new Map<string, { estate: string; blok: string; divisi: string | null; ha: number | null; sph: number | null; sumber: "pruning" | "master"; baris: { id: number; divisi: string; tahun_tanam: number | null; ha: number | null; sph: number | null }[] }>();
  for (const b of baris) {
    const k = `${b.estate}|${b.blok.toUpperCase()}`;
    const o = out.get(k) ?? { estate: b.estate, blok: b.blok, divisi: b.divisi || null, ha: b.ha, sph: b.sph, sumber: "pruning" as const, baris: [] };
    o.baris.push({ id: b.id, divisi: b.divisi, tahun_tanam: b.tahun_tanam, ha: b.ha, sph: b.sph });
    out.set(k, o);
  }
  const master = await queryMany<{ estate: string; blok: string; divisi: string | null; ha: number | null; sph: number | null }>(
    `SELECT estate, min(blok) blok, string_agg(DISTINCT NULLIF(divisi, ''), ' / ') divisi, SUM(ha)::float8 ha, (SUM(ha * sph) / NULLIF(SUM(ha), 0))::float8 sph
     FROM master_blok WHERE estate = ANY(@estates) GROUP BY estate, upper(blok) ORDER BY estate, min(urut)`,
    { estates }
  );
  for (const m of master) {
    const k = `${m.estate}|${m.blok.toUpperCase()}`;
    if (!out.has(k)) out.set(k, { ...m, sumber: "master", baris: [] });
  }
  return [...out.values()];
}

// The Rekap row an entry goes to: the one asked for (baris_id, same blok), else the blok's first; a blok
// not in the Rekap yet gets its row from Master Blok (as a new sheet row would be added).
async function pruningBarisFor(c: PoolClient, estate: string, blok: string, barisId?: unknown): Promise<{ id: number; blok: string } | null> {
  const id = Number(barisId);
  if (Number.isInteger(id) && id > 0) {
    const b = await queryOne<{ id: number; blok: string }>("SELECT id, blok FROM pruning_baris WHERE id = @id AND estate = @estate AND upper(blok) = upper(@blok)", { id, estate, blok }, c);
    if (b) return b;
  }
  const first = await queryOne<{ id: number; blok: string }>(
    "SELECT id, blok FROM pruning_baris WHERE estate = @estate AND upper(blok) = upper(@blok) ORDER BY urut, id LIMIT 1",
    { estate, blok },
    c
  );
  if (first) return first;
  const made = await queryOne<{ id: number; blok: string }>(
    `INSERT INTO pruning_baris (estate, divisi, blok, planting_material, tahun_tanam, ha, sph, pkk, urut)
     SELECT estate, COALESCE(string_agg(DISTINCT NULLIF(divisi, ''), ' / '), ''), min(blok), COALESCE(string_agg(DISTINCT NULLIF(planting_material, ''), ' / '), ''),
       min(tahun_tanam), SUM(ha), SUM(ha * sph) / NULLIF(SUM(ha), 0), round(SUM(ha * sph))::int, (SELECT COALESCE(MAX(urut), 0) + 1 FROM pruning_baris)
     FROM master_blok WHERE estate = @estate AND upper(blok) = upper(@blok) GROUP BY estate
     RETURNING id, blok`,
    { estate, blok },
    c
  );
  return made ?? null;
}

const pruningTahun = (q: unknown) => {
  const t = Number(q);
  return Number.isInteger(t) && t >= 2000 && t <= 2100 ? t : Number(jakartaToday().slice(0, 4));
};

// Rekap per Blok, the sheet's layout: every row with its pokok / Ha per month of every year (sparse:
// "yyyy-mm" -> [pkk, ha]) and its last pruning; the totals are worked out on the page like the sheet's.
app.get("/api/pruning/rekap", async (req, res) => {
  const estates = pruningEstates(req, String(req.query.estate ?? ""));
  const [baris, bulan] = await Promise.all([
    pruningBaris(estates),
    queryMany<{ baris_id: number; m: string; pkk: number; ha: number }>(
      `SELECT baris_id, left(tanggal_iso, 7) m, SUM(pkk)::float8 pkk, SUM(ha)::float8 ha FROM pruning_log WHERE estate = ANY(@estates) GROUP BY 1, 2`,
      { estates }
    ),
  ]);
  const per = new Map<number, Record<string, [number, number]>>();
  const last = new Map<number, string>();
  for (const b of bulan) {
    const o = per.get(b.baris_id) ?? {};
    o[b.m] = [b.pkk, Math.round(b.ha * 10000) / 10000];
    per.set(b.baris_id, o);
    if (b.pkk > 0 && b.m > (last.get(b.baris_id) ?? "")) last.set(b.baris_id, b.m);
  }
  const now = Number(jakartaToday().slice(0, 4));
  const years = bulan.map((b) => Number(b.m.slice(0, 4)));
  res.json({
    tahunAwal: Math.min(2020, ...years),
    tahunAkhir: Math.max(now, ...years),
    sekarang: now,
    baris: baris.map((b) => ({ ...b, bulan: per.get(b.id) ?? {}, terakhir: last.get(b.id) ?? null })),
  });
});

// Per blok for one year (the map, and the hint next to an input row): a blok's rows added up.
async function pruningPerBlok(estates: string[], tahun: number) {
  const months = Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, "0")}`);
  const perBulan = (col: string) => `ARRAY[${months.map((m) => `COALESCE(SUM(l.${col}) FILTER (WHERE left(l.tanggal_iso, 7) = '${m}'), 0)`).join(", ")}]::float8[]`;
  const blok = await queryMany(
    `WITH b AS (
       SELECT estate, upper(blok) k, min(blok) blok, string_agg(DISTINCT NULLIF(divisi, ''), ' / ') divisi, SUM(ha)::float8 ha,
         SUM(ha * sph)::float8 target, min(urut) urut, array_agg(id) ids
       FROM pruning_baris WHERE estate = ANY(@estates) GROUP BY estate, upper(blok)
     )
     SELECT b.estate, b.blok, b.divisi, b.ha, b.target, (b.target / NULLIF(b.ha, 0))::float8 sph, 'pruning' target_sumber,
       COALESCE(SUM(l.pkk) FILTER (WHERE left(l.tanggal_iso, 4) = @y), 0)::float8 pkk,
       COALESCE(SUM(l.ha) FILTER (WHERE left(l.tanggal_iso, 4) = @y), 0)::float8 ha_pruning,
       ${perBulan("pkk")} bulan, ${perBulan("ha")} ha_bulan,
       max(l.tanggal_iso) FILTER (WHERE l.pkk > 0) terakhir,
       COUNT(l.id) FILTER (WHERE left(l.tanggal_iso, 4) = @y)::int entri
     FROM b LEFT JOIN pruning_log l ON l.baris_id = ANY(b.ids)
     GROUP BY b.estate, b.blok, b.divisi, b.ha, b.target, b.urut
     ORDER BY b.urut`,
    { estates, y: String(tahun) }
  );
  const tahunList = (await queryMany<{ t: number }>("SELECT DISTINCT left(tanggal_iso, 4)::int t FROM pruning_log WHERE estate = ANY(@estates) ORDER BY 1", { estates })).map((r) => r.t);
  const now = Number(jakartaToday().slice(0, 4));
  if (!tahunList.includes(now)) tahunList.push(now);
  return { tahun, tahunList, blok };
}
app.get("/api/peta-blok/pruning", async (req, res) => {
  res.json(await pruningPerBlok(blokEstates(req), pruningTahun(req.query.tahun)));
});
app.get("/api/pruning/per-blok", async (req, res) => {
  res.json(await pruningPerBlok(pruningEstates(req, String(req.query.estate ?? "")), pruningTahun(req.query.tahun)));
});
app.get("/api/pruning/blok-options", async (req, res) => {
  res.json(await pruningBlokList(blokEstates(req)));
});

// Riwayat: the entries, newest first, filtered by estate / month (yyyy-mm) or year / blok / text; with
// their Rekap row (tahun tanam / divisi, shown for a blok that has two rows).
app.get("/api/pruning", async (req, res) => {
  const q = req.query as Record<string, string>;
  const estates = pruningEstates(req, q.estate ?? "");
  const where = ["l.estate = ANY(@estates)"];
  const params: Record<string, any> = { estates, limit: Math.min(Number(q.limit) || 50, 500), offset: Math.max(Number(q.offset) || 0, 0) };
  if (/^\d{4}(-\d{2})?$/.test(q.periode ?? "")) {
    where.push("l.tanggal_iso LIKE @periode");
    params.periode = `${q.periode}%`;
  }
  if (q.blok) {
    where.push("upper(l.blok) = upper(@blok)");
    params.blok = q.blok;
  }
  if (q.sumber === "app" || q.sumber === "sheet") {
    where.push("l.sumber = @sumber");
    params.sumber = q.sumber;
  }
  wordSearch(q.search ?? "", ["l.blok", "l.keterangan", "l.created_by"], where, params);
  const w = `WHERE ${where.join(" AND ")}`;
  const sum = await queryOne(`SELECT COUNT(*)::int total, COALESCE(SUM(l.pkk), 0)::float8 pkk, COALESCE(SUM(l.ha), 0)::float8 ha FROM pruning_log l ${w}`, params);
  const rows = await queryMany(
    `SELECT l.id, l.estate, l.blok, l.tanggal_iso, l.pkk, l.ha, l.keterangan, l.sumber, l.user_id, l.created_by, l.created_at, l.updated_at, l.baris_id,
       b.tahun_tanam, NULLIF(b.divisi, '') divisi,
       (SELECT COUNT(*) FROM pruning_baris x WHERE x.estate = l.estate AND upper(x.blok) = upper(l.blok))::int > 1 AS dua_baris
     FROM pruning_log l LEFT JOIN pruning_baris b ON b.id = l.baris_id
     ${w} ORDER BY l.tanggal_iso DESC, l.id DESC LIMIT @limit OFFSET @offset`,
    params
  );
  res.json({ rows, ...sum });
});

// Checks one entry's fields; the error text, or null when fine.
async function pruningInvalid(estate: string, blok: string, tanggal: string, pkk: number, ha: number): Promise<string | null> {
  if (!PRUNING_ISO.test(tanggal)) return "Tanggal tidak valid";
  if (tanggal > jakartaToday()) return "Tanggal tidak boleh lewat dari hari ini";
  if (!Number.isFinite(pkk) || pkk <= 0) return `Blok ${blok}: jumlah pokok harus lebih dari 0`;
  if (!Number.isFinite(ha) || ha < 0) return `Blok ${blok}: Ha tidak valid`;
  const known = await queryOne(
    `SELECT 1 FROM pruning_baris WHERE estate = @estate AND upper(blok) = upper(@blok)
     UNION ALL SELECT 1 FROM master_blok WHERE estate = @estate AND upper(blok) = upper(@blok) LIMIT 1`,
    { estate, blok }
  );
  return known ? null : `Blok ${blok} tidak ada di Master Blok ${estate}`;
}

// Input: one date, one estate, one or more blok (baris_id = which row of a blok that has two).
app.post("/api/pruning", async (req, res) => {
  const estate = String(req.body?.estate ?? "");
  const tanggal = String(req.body?.tanggal_iso ?? "");
  if (!estateAllowed(req.user!, estate) || !blokEstates(req).includes(estate)) return res.status(403).json({ error: "Akses estate ditolak" });
  const rows = (Array.isArray(req.body?.rows) ? req.body.rows : []).slice(0, 200).map((r: any) => ({
    blok: String(r?.blok ?? "").trim(),
    baris_id: r?.baris_id,
    pkk: Number(r?.pkk),
    ha: Number(r?.ha ?? 0) || 0,
    keterangan: String(r?.keterangan ?? "").trim().slice(0, 300),
  }));
  if (!rows.length) return res.status(400).json({ error: "Isi minimal satu blok" });
  for (const r of rows) {
    const bad = await pruningInvalid(estate, r.blok, tanggal, r.pkk, r.ha);
    if (bad) return res.status(400).json({ error: bad });
  }
  const u = req.user!;
  await withTransaction(async (c) => {
    for (const r of rows) {
      const b = await pruningBarisFor(c, estate, r.blok, r.baris_id);
      await execute(
        `INSERT INTO pruning_log (estate, blok, baris_id, tanggal_iso, pkk, ha, keterangan, sumber, user_id, created_by)
         VALUES (@estate, @blok, @baris, @tanggal, @pkk, @ha, @keterangan, 'app', @uid, @nama)`,
        { estate, blok: b?.blok ?? r.blok, baris: b?.id ?? null, tanggal, pkk: r.pkk, ha: r.ha, keterangan: r.keterangan, uid: u.id, nama: u.nama },
        c
      );
    }
  });
  await logActivity(req, {
    module: "PRUNING",
    estate,
    aksi: "Input Pruning",
    objek: `${rows.length} blok · ${tanggal.split("-").reverse().join("/")}`,
    detail: rows.map((r: any) => `${r.blok}: ${r.pkk} pokok${r.ha ? ` / ${r.ha} Ha` : ""}${r.keterangan ? ` (${r.keterangan})` : ""}`).join("; "),
  });
  res.json({ success: true });
});

// Upload Excel: rows of any date / estate / blok. Every row is checked (estate of the account, date not in
// the future, blok known, pokok > 0); Ha left empty is estimated as pokok / SPH; Tahun Tanam (optional)
// picks the row of a blok that has two, else its first. A row that is already in (same estate, blok,
// date, pokok and Ha - e.g. the same file uploaded twice) is skipped. dryRun = only the check, for the
// preview; otherwise the OK rows are saved.
const PRUNING_ESTATE: Record<string, string> = { NILAM: "NILAM", ZAMRUD: "ZAMRUD", FIRUS: "FIRUS", KNS: "KNS", WJA: "WJA" };
app.post("/api/pruning/import", async (req, res) => {
  const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!input.length) return res.status(400).json({ error: "File tidak berisi baris pruning" });
  if (input.length > 3000) return res.status(400).json({ error: "Maksimal 3.000 baris sekali upload" });
  const allowed = blokEstates(req);
  const list = await pruningBlokList(allowed);
  const blokOf = new Map(list.map((b) => [`${b.estate}|${b.blok.toUpperCase()}`, b]));
  const today = jakartaToday();
  type Row = { row: number; estate: string; blok: string; baris_id: number | null; tanggal_iso: string; pkk: number; ha: number; keterangan: string; status: "ok" | "duplikat" | "error"; error?: string };
  const rows: Row[] = input.map((r: any, i: number) => {
    const estate = PRUNING_ESTATE[String(r?.estate ?? "").trim().toUpperCase()] ?? String(r?.estate ?? "").trim();
    const blokRaw = String(r?.blok ?? "").trim();
    const b = blokOf.get(`${estate}|${blokRaw.toUpperCase()}`);
    const tt = numOrNull(r?.tahun_tanam);
    const baris = b?.baris.length ? (tt ? b.baris.find((x) => x.tahun_tanam === tt) : b.baris[0]) : undefined;
    const tanggal = String(r?.tanggal_iso ?? "").trim();
    const pkk = Number(r?.pkk);
    const sph = baris?.sph ?? b?.sph;
    const haIn = r?.ha === null || r?.ha === undefined || r?.ha === "" ? null : Number(r.ha);
    const ha = haIn ?? (sph && pkk > 0 ? Math.round((pkk / sph) * 100) / 100 : 0);
    const out: Row = { row: Number(r?.row) || i + 1, estate, blok: b?.blok ?? blokRaw, baris_id: baris?.id ?? null, tanggal_iso: tanggal, pkk, ha, keterangan: String(r?.keterangan ?? "").trim().slice(0, 300), status: "ok" };
    const err = !estate
      ? "Estate kosong"
      : !allowed.includes(estate)
        ? `Estate ${estate} tidak ada di akses akun ini`
        : !PRUNING_ISO.test(tanggal) || Number.isNaN(Date.parse(tanggal))
          ? "Tanggal tidak valid"
          : tanggal > today
            ? "Tanggal lewat dari hari ini"
            : !blokRaw
              ? "Blok kosong"
              : !b
                ? `Blok ${blokRaw} tidak ada di Master Blok ${estate}`
                : tt && b.baris.length && !baris
                  ? `Blok ${b.blok} tidak punya baris tahun tanam ${tt} (ada: ${b.baris.map((x) => x.tahun_tanam ?? "-").join(", ")})`
                  : !Number.isFinite(pkk) || pkk <= 0
                    ? "Pokok harus lebih dari 0"
                    : !Number.isFinite(ha) || ha < 0
                      ? "Ha tidak valid"
                      : null;
    if (err) Object.assign(out, { status: "error", error: err });
    return out;
  });
  // Already saved, or twice in the file.
  const ok = rows.filter((r) => r.status === "ok");
  const key = (r: { estate: string; blok: string; tanggal_iso: string; pkk: number; ha: number }) =>
    `${r.estate}|${r.blok.toUpperCase()}|${r.tanggal_iso}|${Number(r.pkk)}|${Math.round(Number(r.ha) * 100)}`;
  const existing = ok.length
    ? await queryMany<{ estate: string; blok: string; tanggal_iso: string; pkk: number; ha: number }>(
        `SELECT estate, blok, tanggal_iso, pkk, ha FROM pruning_log WHERE estate = ANY(@estates) AND tanggal_iso = ANY(@tanggal)`,
        { estates: [...new Set(ok.map((r) => r.estate))], tanggal: [...new Set(ok.map((r) => r.tanggal_iso))] }
      )
    : [];
  const seen = new Set(existing.map(key));
  for (const r of ok) {
    const k = key(r);
    if (seen.has(k)) Object.assign(r, { status: "duplikat", error: "Sudah ada (dilewati)" });
    seen.add(k);
  }
  const save = rows.filter((r) => r.status === "ok");
  const count = { ok: save.length, duplikat: rows.filter((r) => r.status === "duplikat").length, error: rows.filter((r) => r.status === "error").length };
  if (req.body?.dryRun || !save.length) return res.json({ rows, ...count, saved: 0 });

  const u = req.user!;
  await withTransaction(async (c) => {
    for (const r of save) {
      const b = await pruningBarisFor(c, r.estate, r.blok, r.baris_id);
      await execute(
        `INSERT INTO pruning_log (estate, blok, baris_id, tanggal_iso, pkk, ha, keterangan, sumber, user_id, created_by)
         VALUES (@estate, @blok, @baris, @tanggal, @pkk, @ha, @ket, 'app', @uid, @nama)`,
        { estate: r.estate, blok: b?.blok ?? r.blok, baris: b?.id ?? null, tanggal: r.tanggal_iso, pkk: r.pkk, ha: r.ha, ket: r.keterangan, uid: u.id, nama: u.nama },
        c
      );
    }
  });
  const estates = [...new Set(save.map((r) => r.estate))];
  const dates = save.map((r) => r.tanggal_iso).sort();
  await logActivity(req, {
    module: "PRUNING",
    estate: estates.length === 1 ? estates[0] : null,
    aksi: "Upload Excel Pruning",
    objek: `${save.length} baris · ${save.reduce((s, r) => s + r.pkk, 0).toLocaleString("id-ID")} pokok · ${dates[0].split("-").reverse().join("/")}${dates.length > 1 && dates[0] !== dates[dates.length - 1] ? ` - ${dates[dates.length - 1].split("-").reverse().join("/")}` : ""}`,
    detail:
      save
        .slice(0, 60)
        .map((r) => `${r.tanggal_iso.split("-").reverse().join("/")} ${r.blok}: ${r.pkk} pokok`)
        .join("; ") + (save.length > 60 ? ` +${save.length - 60} lainnya` : "") + (count.duplikat ? ` · ${count.duplikat} baris sudah ada dilewati` : ""),
  });
  res.json({ rows, ...count, saved: save.length });
});

// A Rekap row's data (the sheet's ESTATE ... Field Number columns): Divisi, Planting Material, Tahun
// Tanam, Ha, SPH, Kondisi Pokok, Field Number; PKK follows Ha x SPH (rounded) when either changes.
app.put("/api/pruning/baris/:id", async (req, res) => {
  const ex = await queryOne<PBaris>("SELECT * FROM pruning_baris WHERE id = @id", { id: Number(req.params.id) || 0 });
  if (!ex) return res.status(404).json({ error: "Baris tidak ditemukan" });
  if (!estateAllowed(req.user!, ex.estate)) return res.status(403).json({ error: "Akses estate ditolak" });
  const b = req.body ?? {};
  const v = {
    divisi: b.divisi === undefined ? ex.divisi : String(b.divisi).trim(),
    planting_material: b.planting_material === undefined ? ex.planting_material : String(b.planting_material).trim(),
    tahun_tanam: b.tahun_tanam === undefined ? ex.tahun_tanam : numOrNull(b.tahun_tanam),
    ha: b.ha === undefined ? ex.ha : numOrNull(b.ha),
    sph: b.sph === undefined ? ex.sph : numOrNull(b.sph),
    kondisi: b.kondisi === undefined ? ex.kondisi : String(b.kondisi).trim(),
    field_number: b.field_number === undefined ? ex.field_number : String(b.field_number).trim(),
  };
  if ((v.ha !== null && !(v.ha >= 0)) || (v.sph !== null && !(v.sph >= 0))) return res.status(400).json({ error: "Ha / SPH harus angka ≥ 0" });
  if (v.tahun_tanam !== null && !(Number.isInteger(v.tahun_tanam) && v.tahun_tanam > 1900 && v.tahun_tanam < 2100)) return res.status(400).json({ error: "Tahun tanam tidak valid" });
  const pkk = v.ha === ex.ha && v.sph === ex.sph ? ex.pkk : v.ha !== null && v.sph !== null ? Math.round(v.ha * v.sph) : null;
  await execute(
    `UPDATE pruning_baris SET divisi = @divisi, planting_material = @planting_material, tahun_tanam = @tahun_tanam, ha = @ha, sph = @sph, pkk = @pkk,
       kondisi = @kondisi, field_number = @field_number WHERE id = @id`,
    { ...v, pkk, id: ex.id }
  );
  const label: Record<string, string> = { divisi: "Divisi", planting_material: "Planting Material", tahun_tanam: "Tahun Tanam", ha: "Ha", sph: "SPH", kondisi: "Kondisi Pokok", field_number: "Field Number" };
  const diff = Object.keys(label)
    .filter((k) => (ex as any)[k] !== (v as any)[k])
    .map((k) => `${label[k]}: ${(ex as any)[k] ?? "-"} → ${(v as any)[k] ?? "-"}`);
  if (diff.length) await logActivity(req, { module: "PRUNING", estate: ex.estate, aksi: "Ubah Baris Rekap Pruning", objek: `${ex.blok}${ex.tahun_tanam ? ` (TT ${ex.tahun_tanam})` : ""}`, detail: diff.join("; ") });
  res.json({ success: true });
});

app.put("/api/pruning/:id", async (req, res) => {
  const ex = await queryOne<any>("SELECT * FROM pruning_log WHERE id = @id", { id: Number(req.params.id) || 0 });
  if (!ex) return res.status(404).json({ error: "Data tidak ditemukan" });
  if (!estateAllowed(req.user!, ex.estate)) return res.status(403).json({ error: "Akses estate ditolak" });
  const v = {
    blok: String(req.body?.blok ?? ex.blok).trim(),
    tanggal: String(req.body?.tanggal_iso ?? ex.tanggal_iso),
    pkk: Number(req.body?.pkk ?? ex.pkk),
    ha: Number(req.body?.ha ?? ex.ha) || 0,
    keterangan: String(req.body?.keterangan ?? ex.keterangan).trim().slice(0, 300),
  };
  const bad = await pruningInvalid(ex.estate, v.blok, v.tanggal, v.pkk, v.ha);
  if (bad) return res.status(400).json({ error: bad });
  await withTransaction(async (c) => {
    // Same blok: the row stays unless another is picked; another blok: its (first) row.
    const keep = v.blok.toUpperCase() === String(ex.blok).toUpperCase() && req.body?.baris_id === undefined ? ex.baris_id : req.body?.baris_id;
    const b = await pruningBarisFor(c, ex.estate, v.blok, keep);
    await execute(
      "UPDATE pruning_log SET blok = @blok, baris_id = @baris, tanggal_iso = @tanggal, pkk = @pkk, ha = @ha, keterangan = @keterangan, updated_at = now() WHERE id = @id",
      { ...v, blok: b?.blok ?? v.blok, baris: b?.id ?? null, id: ex.id },
      c
    );
  });
  const diff = [
    ex.blok !== v.blok && `Blok: ${ex.blok} → ${v.blok}`,
    ex.tanggal_iso !== v.tanggal && `Tanggal: ${ex.tanggal_iso} → ${v.tanggal}`,
    ex.pkk !== v.pkk && `Pokok: ${ex.pkk} → ${v.pkk}`,
    ex.ha !== v.ha && `Ha: ${ex.ha} → ${v.ha}`,
    ex.keterangan !== v.keterangan && `Keterangan: ${ex.keterangan || "-"} → ${v.keterangan || "-"}`,
  ].filter(Boolean);
  if (diff.length) await logActivity(req, { module: "PRUNING", estate: ex.estate, aksi: "Edit Pruning", objek: `${v.blok} · ${v.tanggal.split("-").reverse().join("/")}`, detail: diff.join("; ") });
  res.json({ success: true });
});

app.delete("/api/pruning/:id", async (req, res) => {
  const ex = await queryOne<any>("SELECT * FROM pruning_log WHERE id = @id", { id: Number(req.params.id) || 0 });
  if (!ex) return res.status(404).json({ error: "Data tidak ditemukan" });
  if (!estateAllowed(req.user!, ex.estate)) return res.status(403).json({ error: "Akses estate ditolak" });
  await execute("DELETE FROM pruning_log WHERE id = @id", { id: ex.id });
  await logActivity(req, {
    module: "PRUNING",
    estate: ex.estate,
    aksi: "Hapus Pruning",
    objek: `${ex.blok} · ${ex.tanggal_iso.split("-").reverse().join("/")}`,
    detail: `${ex.pkk} pokok${ex.ha ? ` / ${ex.ha} Ha` : ""}${ex.keterangan ? ` (${ex.keterangan})` : ""}`,
  });
  res.json({ success: true });
});

// Warna Bebas: paint (or clear, warna null) a set of boxes.
app.put("/api/peta-blok/warna", async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 2000);
  const warna = req.body?.warna === null ? null : String(req.body?.warna ?? "");
  if (!ids.length) return res.status(400).json({ error: "Pilih blok" });
  if (warna !== null && !HEX.test(warna)) return res.status(400).json({ error: "Warna tidak valid" });
  const changed = await queryMany<{ label: string; estate: string | null }>(
    "UPDATE peta_blok SET warna = @warna WHERE id = ANY(@ids::int[]) AND kind = 'blok' AND warna IS DISTINCT FROM @warna RETURNING label, estate",
    { ids, warna: warna?.toLowerCase() ?? null }
  );
  if (changed.length) {
    const estates = [...new Set(changed.map((r) => r.estate).filter(Boolean))];
    const list = changed.map((r) => r.label);
    await logActivity(req, {
      module: "PUPUK",
      estate: estates.length === 1 ? estates[0] : null,
      aksi: warna ? "Warnai Peta Blok" : "Hapus Warna Peta Blok",
      objek: `${list.length} blok${warna ? ` → ${warna.toLowerCase()}` : ""}`,
      detail: list.slice(0, 80).join(", ") + (list.length > 80 ? ` +${list.length - 80} lainnya` : ""),
    });
  }
  res.json({ success: true });
});

// The progress legend: from which % each colour starts, its text and colour.
app.put("/api/peta-blok/legend", async (req, res) => {
  const jenis = req.body?.jenis === "pruning" ? "pruning" : "pupuk";
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).map((i: any) => ({
    dari: Number(i?.dari),
    label: String(i?.label ?? "").trim(),
    warna: String(i?.warna ?? ""),
  }));
  if (!items.length || items.length > 12) return res.status(400).json({ error: "Isi 1 - 12 warna" });
  const bad = items.find((i: any) => !Number.isFinite(i.dari) || i.dari < 0 || !HEX.test(i.warna));
  if (bad) return res.status(400).json({ error: "Batas % harus angka ≥ 0 dan warna harus dipilih" });
  if (!items.some((i: any) => i.dari === 0)) return res.status(400).json({ error: "Harus ada warna yang mulai dari 0%" });
  await withTransaction(async (c) => {
    await execute("DELETE FROM peta_legend WHERE jenis = @jenis", { jenis }, c);
    for (const i of items)
      await execute("INSERT INTO peta_legend (dari, label, warna, jenis) VALUES (@dari, @label, @warna, @jenis)", { ...i, warna: i.warna.toLowerCase(), jenis }, c);
  });
  await logActivity(req, { module: "PUPUK", estate: null, aksi: `Ubah Legenda Peta Blok (${jenis === "pruning" ? "Pruning" : "Pemupukan"})`, objek: items.map((i: any) => `${i.dari}%: ${i.warna}`).join(", ") });
  res.json({ success: true });
});

// ---- Inventory BBM (fuel: Solar & Bensin) - imported from Google Sheet, read-only history ----
// `lokasi` is the fixed physical stock site the sheet belongs to (Nilam/Zamrud/Firus for Solar;
// Nilam/WJA/KNS for Bensin). `estate` is a free-text sub-location/consumption tag from the raw
// sheet's own ESTATE column (only meaningful for Bensin - e.g. LUBAKAN, TAGANG, or a consuming
// estate like ZAMRUD/AKSS); for Solar it just mirrors `lokasi`.
app.get("/api/bbm/lokasi-options", (_req, res) => {
  res.json(BBM_LOKASI_OPTIONS);
});

// Sheet import artifacts that ended up in the ESTATE column but aren't actual estate/sub-location
// labels (e.g. a stock-in note like "BENSIN MASUK" recorded in the wrong column).
const BBM_ESTATE_JUNK = ["BENSIN MASUK", "STOCK AWAL", "PEMINJAMAN"];

// Known sub-locations that don't have any historical transactions yet, so they wouldn't otherwise
// appear in the distinct-estate query - added manually so they're selectable from the start.
const BBM_ESTATE_EXTRA: Record<string, string[]> = {
  ZAMRUD: ["ZAMRUD"],
  FIRUS: ["FIRUS"],
};

app.get("/api/bbm/estate-options", async (req, res) => {
  const { lokasi = "" } = req.query as Record<string, string>;
  if (lokasi && !estateAllowed(req.user!, lokasi)) return res.status(403).json({ error: "Akses ditolak" });
  // KNS and WJA supply a fixed pair of estates, same as their gudang (see GUDANG_TUJUAN).
  if (lokasi === "KNS" || lokasi === "WJA") return res.json(GUDANG_TUJUAN[lokasi]);
  const conditions = ["estate IS NOT NULL", "TRIM(estate) != ''"];
  const params: any = {};
  // Shared across Solar and Bensin on purpose: a sub-location (e.g. AKSS/UKM, only ever recorded
  // for Bensin so far) is a property of the site, not the fuel type, so it should be pickable for
  // Solar too even if no Solar transaction has used it yet.
  if (lokasi && BBM_LOKASI_OPTIONS.includes(lokasi)) {
    conditions.push("lokasi = @lokasi");
    params.lokasi = lokasi;
  }
  const rows = await queryMany<{ estate: string }>(
    `SELECT DISTINCT estate FROM bbm_log WHERE ${conditions.join(" AND ")} ORDER BY estate`,
    params
  );
  const fromData = rows.map((r) => r.estate).filter((e) => !BBM_ESTATE_JUNK.includes(e.toUpperCase()));
  const extra = BBM_ESTATE_EXTRA[lokasi] || [];
  const merged = Array.from(new Set([...fromData, ...extra])).sort();
  res.json(merged);
});

app.get("/api/bbm/alat-options", async (req, res) => {
  const { lokasi = "" } = req.query as Record<string, string>;
  if (lokasi && !estateAllowed(req.user!, lokasi)) return res.status(403).json({ error: "Akses ditolak" });
  const conditions = ["kode_kendaraan IS NOT NULL", "TRIM(kode_kendaraan) != ''"];
  const params: any = {};
  if (lokasi && BBM_LOKASI_OPTIONS.includes(lokasi)) {
    conditions.push("lokasi = @lokasi");
    params.lokasi = lokasi;
  }
  const rows = await queryMany<{ kode_kendaraan: string }>(
    `SELECT DISTINCT kode_kendaraan FROM bbm_log WHERE ${conditions.join(" AND ")} ORDER BY kode_kendaraan`,
    params
  );
  res.json(rows.map((r) => r.kode_kendaraan));
});

app.get("/api/bbm/summary", async (req, res) => {
  const { lokasi = "" } = req.query as Record<string, string>;
  // Estate users must pass their own lokasi (the frontend always does, since every BBM page is
  // lokasi-locked); a superuser can omit it to see everything.
  if (req.user!.role !== "superuser" && (!lokasi || !estateAllowed(req.user!, lokasi))) {
    return res.status(403).json({ error: "Akses ditolak" });
  }

  const params = lokasi ? { lokasi } : {};

  // Stok masuk/keluar totals per jenis+lokasi for a date range (the page passes its date filter,
  // or the current month); saldoTerakhir below is always the latest balance regardless of range.
  const { dateFrom = "", dateTo = "" } = req.query as Record<string, string>;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const flowConditions = [lokasi && "lokasi = @lokasi", isoDate.test(dateFrom) && "tanggal_iso >= @dateFrom", isoDate.test(dateTo) && "tanggal_iso <= @dateTo"].filter(Boolean);
  const perLokasi = await queryMany(
    `SELECT jenis_bbm, lokasi, COALESCE(SUM(diterima), 0)::float8 diterima, COALESCE(SUM(pemakaian), 0)::float8 pemakaian
     FROM bbm_log ${flowConditions.length ? "WHERE " + flowConditions.join(" AND ") : ""}
     GROUP BY jenis_bbm, lokasi ORDER BY jenis_bbm, lokasi`,
    { ...params, ...(isoDate.test(dateFrom) ? { dateFrom } : {}), ...(isoDate.test(dateTo) ? { dateTo } : {}) }
  );

  // Latest known saldo (running balance) per jenis_bbm+lokasi. Several rows can share the same
  // tanggal_iso (multiple dispensing events per day), so picking "the" latest needs a real
  // tie-break (insertion order via id) - a plain GROUP BY on the max date alone doesn't guarantee
  // which same-day row's saldo_stock comes back, so a window function picks it deterministically.
  const latestSaldo = (asOf?: string) =>
    queryMany(
      `SELECT jenis_bbm, lokasi, saldo_stock, tanggal, tanggal_iso FROM (
         SELECT jenis_bbm, lokasi, saldo_stock, tanggal, tanggal_iso,
                ROW_NUMBER() OVER (PARTITION BY jenis_bbm, lokasi ORDER BY tanggal_iso DESC, id DESC) AS rn
         FROM bbm_log
         WHERE saldo_stock IS NOT NULL ${lokasi ? "AND lokasi = @lokasi" : ""} ${asOf ? "AND tanggal_iso <= @asOf" : ""}
       ) sub
       WHERE rn = 1`,
      { ...params, ...(asOf ? { asOf } : {}) }
    );

  // saldoTerakhir is always today's real balance (new transactions continue from it). saldoPerTanggal
  // is the closing balance as of the filter's end date - what the stock cards show while filtered.
  const { asOf = "" } = req.query as Record<string, string>;
  const saldoTerakhir = await latestSaldo();
  const saldoPerTanggal = isoDate.test(asOf) ? await latestSaldo(asOf) : saldoTerakhir;

  res.json({ perLokasi, saldoTerakhir, saldoPerTanggal });
});

const INDO_MONTHS = [
  "JANUARI",
  "FEBRUARI",
  "MARET",
  "APRIL",
  "MEI",
  "JUNI",
  "JULI",
  "AGUSTUS",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DESEMBER",
];
const INDO_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function isoToIndoDate(iso: string): { tanggal: string; periode: string } {
  const [y, mo, d] = iso.split("-").map(Number);
  return {
    tanggal: `${d}-${INDO_MONTHS_SHORT[mo - 1]}-${y}`,
    periode: `${INDO_MONTHS[mo - 1]} ${y}`,
  };
}

// A keterangan naming another fuel ("BENSIN MASUK DARI ...") means the wrong Jenis BBM was picked:
// Bensin got typed into the Solar ledger while the form opened on SOLAR (src/lib/bbmJenis.ts). Bensin Campur
// (bensin mixed with 2T oil, at WJA) is its own fuel: "bensin campur" names it, a plain "bensin" the other one.
const BBM_DISEBUT: Record<string, RegExp> = { SOLAR: /\bsolar\b/i, BENSIN_CAMPUR: /\bbensin\s*campur(an)?\b/i, BENSIN: /\bbensin\b(?!\s*campur)/i };
const BBM_LABEL: Record<string, string> = { SOLAR: "Solar", BENSIN: "Bensin", BENSIN_CAMPUR: "Bensin Campur" };
function wrongJenisBbm(jenis: string, keterangan: unknown) {
  const t = String(keterangan ?? "");
  if (BBM_DISEBUT[jenis]?.test(t)) return "";
  const other = Object.keys(BBM_DISEBUT).find((k) => k !== jenis && BBM_DISEBUT[k].test(t));
  return other ? `Keterangan menyebut ${BBM_LABEL[other]}, tapi Jenis BBM ${BBM_LABEL[jenis] ?? jenis}. Ganti Jenis BBM ke ${BBM_LABEL[other]}.` : "";
}

// ---- Manual BBM transaction entry (mirrors the "Transaksi" flow on Inventory Gudang) ----
app.post("/api/bbm", async (req, res) => {
  const { jenis_bbm, lokasi, tanggal_iso, tipe, jumlah, keterangan, no_spb, estate, kode_kendaraan, hm_terakhir } = req.body;

  if (!BBM_JENIS.includes(jenis_bbm)) return res.status(400).json({ error: "Jenis BBM tidak valid" });
  if (!BBM_LOKASI_OPTIONS.includes(lokasi)) return res.status(400).json({ error: "Lokasi tidak valid" });
  if (!estateAllowed(req.user!, lokasi)) return res.status(403).json({ error: "Akses ditolak" });
  if (!["DITERIMA", "PEMAKAIAN"].includes(tipe)) return res.status(400).json({ error: "Tipe transaksi tidak valid" });
  if (!jumlah || jumlah <= 0) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
  if (!tanggal_iso || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal_iso)) return res.status(400).json({ error: "Tanggal tidak valid" });
  if (!estate || !String(estate).trim()) return res.status(400).json({ error: "Estate/sub-lokasi wajib dipilih" });
  const salahJenis = wrongJenisBbm(jenis_bbm, keterangan);
  if (salahJenis) return res.status(400).json({ error: salahJenis });
  const evidenceId = await claimEvidence(req, res);
  if (evidenceId === undefined) return;

  const lastSaldo = await saldoAsOf("BBM", lokasi, jenis_bbm, tanggal_iso);
  const saldoBaru = round3(tipe === "DITERIMA" ? lastSaldo + jumlah : lastSaldo - jumlah);
  const { tanggal, periode } = isoToIndoDate(tanggal_iso);

  const result = await queryOne<{ id: number }>(
    `INSERT INTO bbm_log
      (jenis_bbm, lokasi, estate, periode, tanggal, tanggal_iso, no_spb, stock_awal, diterima, pinjam, pemakaian, saldo_stock, keterangan, status_kepemilikan, kode_kendaraan, hm_terakhir, evidence_id)
     VALUES
      (@jenis_bbm, @lokasi, @estate, @periode, @tanggal, @tanggal_iso, @no_spb, NULL, @diterima, NULL, @pemakaian, @saldo_stock, @keterangan, NULL, @kode_kendaraan, @hm_terakhir, @evidenceId::uuid)
     RETURNING id`,
    {
      evidenceId,
      jenis_bbm,
      lokasi,
      estate,
      periode,
      tanggal,
      tanggal_iso,
      no_spb: no_spb || "",
      diterima: tipe === "DITERIMA" ? jumlah : null,
      pemakaian: tipe === "PEMAKAIAN" ? jumlah : null,
      saldo_stock: saldoBaru,
      keterangan: keterangan || "",
      kode_kendaraan: kode_kendaraan || "",
      hm_terakhir: hm_terakhir || "",
    }
  );
  await rechainSaldo("BBM", lokasi, jenis_bbm, tanggal_iso);

  await logActivity(req, {
    module: "BBM",
    estate: lokasi,
    aksi: tipe === "DITERIMA" ? "Stok Masuk" : "Stok Keluar",
    objek: `${String(jenis_bbm).replace("_", " ")} · ${tanggal}${no_spb ? ` · SPB ${no_spb}` : ""}`,
    detail: [
      `Jumlah: ${jumlah} LTR`,
      `Saldo: ${lastSaldo} → ${saldoBaru}`,
      tipe === "PEMAKAIAN" && estate && `Estate: ${estate}`,
      kode_kendaraan && `Kendaraan: ${kode_kendaraan}`,
      hm_terakhir && `HM: ${hm_terakhir}`,
      keterangan && `Keterangan: ${keterangan}`,
    ]
      .filter(Boolean)
      .join("; "),
  });
  res.json({ success: true, id: result!.id, saldo_stock: saldoBaru });
});

// Input Banyak: many Stok Masuk / Keluar of one jenis + lokasi on one date in one go (the day's
// usage), sharing one foto bukti. All or nothing: a row that doesn't pass (or would take the saldo
// below zero) refuses the whole batch and names the row (`row`, 0-based) so the form can mark it.
// The saldo runs on from the latest row, as for a single entry; the lokasi's ledger is locked while
// the rows are booked so another entry can't slip in between.
const BBM_BATCH_MAX = 200;
app.post("/api/bbm/batch", async (req, res) => {
  const { jenis_bbm, lokasi, tanggal_iso } = req.body ?? {};
  const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!BBM_JENIS.includes(jenis_bbm)) return res.status(400).json({ error: "Jenis BBM tidak valid" });
  if (!BBM_LOKASI_OPTIONS.includes(lokasi)) return res.status(400).json({ error: "Lokasi tidak valid" });
  if (!estateAllowed(req.user!, lokasi)) return res.status(403).json({ error: "Akses ditolak" });
  if (!ISO_DATE.test(tanggal_iso || "")) return res.status(400).json({ error: "Tanggal tidak valid" });
  if (!rows.length) return res.status(400).json({ error: "Belum ada baris yang diisi" });
  if (rows.length > BBM_BATCH_MAX) return res.status(400).json({ error: `Maksimal ${BBM_BATCH_MAX} baris sekali simpan` });

  // ke / item: a Stok Keluar sent into another estate's stock, booked as a Transfer.
  type BatchRow = { tipe: "DITERIMA" | "PEMAKAIAN"; jumlah: number; estate: string; no_spb: string; keterangan: string; kode_kendaraan: string; hm_terakhir: string; ke: string; item?: LoanItem };
  const clean: BatchRow[] = [];
  for (const [i, r] of rows.entries()) {
    const refuseRow = (error: string) => res.status(400).json({ error: `Baris ${i + 1}: ${error}`, row: i });
    const tipe = r?.tipe;
    const jumlah = Number(r?.jumlah);
    if (!["DITERIMA", "PEMAKAIAN"].includes(tipe)) return refuseRow("tipe transaksi tidak valid");
    if (!Number.isFinite(jumlah) || jumlah <= 0) return refuseRow("jumlah harus lebih dari 0");
    const keluar = tipe === "PEMAKAIAN";
    const estate = keluar ? String(r?.estate ?? "").trim() : lokasi;
    if (!estate) return refuseRow("estate / sub-lokasi wajib dipilih");
    const salahJenis = wrongJenisBbm(jenis_bbm, r?.keterangan);
    if (salahJenis) return refuseRow(salahJenis);
    const ke = keluar ? String(r?.ke ?? "").trim() : "";
    let item: LoanItem | undefined;
    if (ke) {
      const t = await batchTransferItem(req, "BBM", lokasi, ke, jenis_bbm, jumlah);
      if (typeof t === "string") return refuseRow(t);
      item = t;
    }
    clean.push({
      ke,
      item,
      tipe,
      jumlah: round3(jumlah),
      estate,
      no_spb: String(r?.no_spb ?? "").trim(),
      keterangan: String(r?.keterangan ?? "").trim(),
      kode_kendaraan: keluar ? String(r?.kode_kendaraan ?? "").trim() : "",
      hm_terakhir: keluar ? String(r?.hm_terakhir ?? "").trim() : "",
    });
  }
  const ev = await claimBatchEvidence(req, res, rows.length);
  if (!ev) return;

  const { tanggal, periode } = isoToIndoDate(tanggal_iso);
  let booked: { row: BatchRow; before: number; after: number }[];
  const transfers: LoanRow[] = [];
  try {
    booked = await withTransaction(async (client) => {
      await execute("SELECT pg_advisory_xact_lock(hashtext(@key))", { key: `bbm:${jenis_bbm}:${lokasi}` }, client);
      // The rows run on from the saldo of their date; what can go out is checked against the stock now.
      let saldo = await saldoAsOf("BBM", lokasi, jenis_bbm, tanggal_iso, client);
      let stock = (await latestSaldoRow("BBM", lokasi, jenis_bbm, client))?.saldo_stock ?? 0;
      const out = [];
      for (const [i, row] of clean.entries()) {
        const before = saldo;
        if (row.tipe === "PEMAKAIAN" && row.jumlah > stock) throw new BatchRowError(i, `Baris ${i + 1}: stok tinggal ${round3(stock).toLocaleString("id-ID")} LTR`);
        saldo = round3(row.tipe === "DITERIMA" ? before + row.jumlah : before - row.jumlah);
        stock = round3(row.tipe === "DITERIMA" ? stock + row.jumlah : stock - row.jumlah);
        if (row.ke) {
          const alasan = row.keterangan || `Kirim ke ${row.ke}`;
          transfers.push(await bookLoan(client, req, { module: "BBM", dari: lokasi, ke: row.ke, item: row.item!, qty: row.jumlah, alasan, tanggal: tanggal_iso, evidenceId: ev.of(i), transfer: true }));
          continue;
        }
        await execute(
          `INSERT INTO bbm_log
            (jenis_bbm, lokasi, estate, periode, tanggal, tanggal_iso, no_spb, diterima, pemakaian, saldo_stock, keterangan, kode_kendaraan, hm_terakhir, evidence_id)
           VALUES (@jenis_bbm, @lokasi, @estate, @periode, @tanggal, @tanggal_iso, @no_spb, @diterima, @pemakaian, @saldo, @keterangan, @kode_kendaraan, @hm_terakhir, @evidenceId::uuid)`,
          {
            jenis_bbm,
            lokasi,
            periode,
            tanggal,
            tanggal_iso,
            evidenceId: ev.of(i),
            ...row,
            diterima: row.tipe === "DITERIMA" ? row.jumlah : null,
            pemakaian: row.tipe === "PEMAKAIAN" ? row.jumlah : null,
            saldo,
          },
          client
        );
        out.push({ row, before, after: saldo });
      }
      await rechainSaldo("BBM", lokasi, jenis_bbm, tanggal_iso, client);
      return out;
    });
  } catch (e) {
    await ev.release();
    if (e instanceof BatchRowError) return res.status(400).json({ error: e.message, row: e.row });
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }

  for (const l of transfers) await logLoan(req, l, "Transfer Baru", transferLogDetail(l));
  await logActivities(
    req,
    booked.map(({ row, before, after }) => ({
      module: "BBM",
      estate: lokasi,
      aksi: row.tipe === "DITERIMA" ? "Stok Masuk" : "Stok Keluar",
      objek: `${String(jenis_bbm).replace("_", " ")} · ${tanggal}${row.no_spb ? ` · SPB ${row.no_spb}` : ""}`,
      detail: [
        `Jumlah: ${row.jumlah} LTR`,
        `Saldo: ${before} → ${after}`,
        row.tipe === "PEMAKAIAN" && `Estate: ${row.estate}`,
        row.kode_kendaraan && `Kendaraan: ${row.kode_kendaraan}`,
        row.hm_terakhir && `HM: ${row.hm_terakhir}`,
        row.keterangan && `Keterangan: ${row.keterangan}`,
        `Input Banyak (${booked.length + transfers.length} baris)`,
      ]
        .filter(Boolean)
        .join("; "),
    }))
  );
  const count = booked.length + transfers.length;
  res.json({ success: true, count, saldo_stock: (await latestSaldoRow("BBM", lokasi, jenis_bbm))?.saldo_stock ?? 0 });
});
class BatchRowError extends Error {
  row: number;
  constructor(row: number, message: string) {
    super(message);
    this.row = row;
  }
}

app.put("/api/bbm/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM bbm_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.lokasi)) return res.status(403).json({ error: "Akses ditolak" });
  if (editTooLate(req, res, "bbm", existing)) return;
  const newEvidence = await checkEditEvidence(req, res, existing.evidence_id);
  if (newEvidence === undefined) return;

  const { tanggal_iso, no_spb, diterima, pemakaian, saldo_stock, keterangan, estate, kode_kendaraan, hm_terakhir } = req.body;
  if (tanggal_iso && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal_iso)) return res.status(400).json({ error: "Tanggal tidak valid" });

  const { tanggal, periode } = tanggal_iso ? isoToIndoDate(tanggal_iso) : { tanggal: existing.tanggal, periode: existing.periode };

  const updated = {
    tanggal,
    tanggal_iso: tanggal_iso || existing.tanggal_iso,
    periode,
    no_spb: no_spb ?? "",
    // An empty field (sent as "" or null) stays empty: Number(null) would turn it into 0.
    diterima: diterima === "" || diterima == null ? null : Number(diterima),
    pemakaian: pemakaian === "" || pemakaian == null ? null : Number(pemakaian),
    saldo_stock: saldo_stock === undefined ? existing.saldo_stock : saldo_stock === "" || saldo_stock === null ? null : Number(saldo_stock),
    keterangan: keterangan ?? "",
    estate: estate ?? "",
    kode_kendaraan: kode_kendaraan ?? existing.kode_kendaraan ?? "",
    hm_terakhir: hm_terakhir ?? existing.hm_terakhir ?? "",
  };
  await execute(
    `UPDATE bbm_log SET
       tanggal = @tanggal, tanggal_iso = @tanggal_iso, periode = @periode, no_spb = @no_spb, diterima = @diterima, pemakaian = @pemakaian, saldo_stock = @saldo_stock,
       keterangan = @keterangan, estate = @estate, kode_kendaraan = @kode_kendaraan, hm_terakhir = @hm_terakhir
     WHERE id = @id`,
    { ...updated, id: req.params.id }
  );
  await afterSaldoEdit("BBM", existing, updated, existing.lokasi, existing.jenis_bbm);
  await logActivity(req, {
    module: "BBM",
    estate: existing.lokasi,
    aksi: "Edit Transaksi",
    objek: `${String(existing.jenis_bbm).replace("_", " ")} · ${existing.tanggal}${existing.no_spb ? ` · SPB ${existing.no_spb}` : ""}`,
    detail: describeChanges(existing, updated, {
      tanggal: "Tanggal",
      no_spb: "No. SPB",
      diterima: "Stok Masuk",
      pemakaian: "Stok Keluar",
      saldo_stock: "Saldo",
      keterangan: "Keterangan",
      estate: "Estate",
      kode_kendaraan: "Kode Kendaraan",
      hm_terakhir: "HM",
    }),
  });
  await useEditEvidence(newEvidence, [{ table: "bbm_log", where: "id = @id", params: { id: existing.id } }]);
  res.json({ success: true });
});

app.delete("/api/bbm/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM bbm_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.lokasi)) return res.status(403).json({ error: "Akses ditolak" });
  if (editTooLate(req, res, "bbm", existing)) return;

  await execute("DELETE FROM bbm_log WHERE id = @id", { id: req.params.id });
  if (existing.tanggal_iso) await rechainSaldo("BBM", existing.lokasi, existing.jenis_bbm, existing.tanggal_iso);
  await logActivity(req, {
    module: "BBM",
    estate: existing.lokasi,
    aksi: "Hapus Transaksi",
    objek: `${String(existing.jenis_bbm).replace("_", " ")} · ${existing.tanggal}${existing.no_spb ? ` · SPB ${existing.no_spb}` : ""}`,
    detail: [
      existing.diterima && `Stok Masuk: ${existing.diterima}`,
      existing.pemakaian && `Stok Keluar: ${existing.pemakaian}`,
      existing.saldo_stock !== null && `Saldo: ${existing.saldo_stock}`,
      existing.keterangan && `Keterangan: ${existing.keterangan}`,
    ]
      .filter(Boolean)
      .join("; "),
  });
  res.json({ success: true });
});

// ---- Inventory Pupuk (fertiliser), see schema.sql's pupuk_log ----
// Estates with an Inventory Pupuk. KNS and WJA had no rows in the source sheet and start empty.
const PUPUK_ESTATES = ["NILAM", "FIRUS", "ZAMRUD", "KNS", "WJA"];

function pupukFilters(q: Record<string, string>) {
  const conditions = ["estate = @estate"];
  const params: any = { estate: q.estate };
  if (q.jenis_pupuk) {
    conditions.push("jenis_pupuk = @jenis_pupuk");
    params.jenis_pupuk = q.jenis_pupuk;
  }
  if (q.divisi) {
    conditions.push("divisi = @divisi");
    params.divisi = q.divisi;
  }
  wordSearch(q.search || "", ["jenis_pupuk", "divisi", "blok", "no_embrace", "kode_barang", "keterangan"], conditions, params);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.dateFrom || "")) {
    conditions.push("tanggal_iso >= @dateFrom");
    params.dateFrom = q.dateFrom;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.dateTo || "")) {
    conditions.push("tanggal_iso <= @dateTo");
    params.dateTo = q.dateTo;
  }
  return { where: "WHERE " + conditions.join(" AND "), params };
}

function checkPupukEstate(req: express.Request, res: express.Response, estate: string) {
  if (!PUPUK_ESTATES.includes(estate)) {
    res.status(400).json({ error: "Estate tidak valid" });
    return false;
  }
  if (!estateAllowed(req.user!, estate)) {
    res.status(403).json({ error: "Akses ditolak" });
    return false;
  }
  return true;
}

const latestPupukSaldo = (estate: string, asOf?: string) =>
  queryMany<{ jenis_pupuk: string; saldo_stock: number; tanggal: string }>(
    `SELECT jenis_pupuk, saldo_stock, tanggal FROM (
       SELECT jenis_pupuk, saldo_stock, tanggal,
              ROW_NUMBER() OVER (PARTITION BY jenis_pupuk ORDER BY tanggal_iso DESC, id DESC) AS rn
       FROM pupuk_log WHERE estate = @estate AND saldo_stock IS NOT NULL ${asOf ? "AND tanggal_iso <= @asOf" : ""}
     ) sub WHERE rn = 1 ORDER BY jenis_pupuk`,
    { estate, ...(asOf ? { asOf } : {}) }
  );

app.get("/api/pupuk/summary", async (req, res) => {
  const q = req.query as Record<string, string>;
  if (!checkPupukEstate(req, res, q.estate)) return;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const flow = pupukFilters({ estate: q.estate, dateFrom: q.dateFrom, dateTo: q.dateTo });
  const perJenis = await queryMany(
    `SELECT jenis_pupuk, COALESCE(SUM(diterima), 0)::float8 diterima, COALESCE(SUM(keluar), 0)::float8 keluar
     FROM pupuk_log ${flow.where} GROUP BY jenis_pupuk ORDER BY jenis_pupuk`,
    flow.params
  );
  // Same split as BBM: saldoTerakhir is today's real balance (new entries continue from it);
  // saldoPerTanggal is the balance as of the date filter's end, which the cards show.
  const saldoTerakhir = await latestPupukSaldo(q.estate);
  const saldoPerTanggal = isoDate.test(q.asOf || "") ? await latestPupukSaldo(q.estate, q.asOf) : saldoTerakhir;
  res.json({ perJenis, saldoTerakhir, saldoPerTanggal });
});

app.get("/api/pupuk/options", async (req, res) => {
  const { estate = "" } = req.query as Record<string, string>;
  if (!checkPupukEstate(req, res, estate)) return;
  // Master pupuk (for this estate) plus any jenis this estate still has history of.
  const jenis = await queryMany<{ v: string }>(
    `SELECT nama v FROM master_pupuk WHERE ${OLI_AT_ESTATE} UNION SELECT DISTINCT jenis_pupuk FROM pupuk_log WHERE estate = @estate ORDER BY v`,
    { estate }
  );
  const divisi = await queryMany<{ v: string }>(
    "SELECT DISTINCT divisi v FROM pupuk_log WHERE estate = @estate AND divisi <> '' ORDER BY v",
    { estate }
  );
  // An estate with no pupuk history yet (KNS/WJA) is offered the divisi names used elsewhere.
  const divisiList = divisi.length
    ? divisi
    : await queryMany<{ v: string }>("SELECT DISTINCT divisi v FROM pupuk_log WHERE divisi <> '' ORDER BY v");
  res.json({ jenis: jenis.map((r) => r.v), divisi: divisiList.map((r) => r.v) });
});

app.get("/api/pupuk", async (req, res) => {
  const q = req.query as Record<string, string>;
  if (!checkPupukEstate(req, res, q.estate)) return;
  const { where, params } = pupukFilters(q);
  const totals = (await queryOne<any>(
    `SELECT COUNT(*)::int c, COALESCE(SUM(keluar), 0)::float8 keluar, COALESCE(SUM(diterima), 0)::float8 diterima FROM pupuk_log ${where}`,
    params
  ))!;
  const limit = Math.min(parseInt(q.pageSize) || 50, 500);
  const offset = (Math.max(parseInt(q.page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT *, (SELECT p.jenis FROM pinjaman p WHERE p.id = pupuk_log.pinjaman_id) AS pinjaman_jenis FROM pupuk_log ${where} ORDER BY NULLIF(tanggal_iso, '') DESC NULLS LAST, id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total: totals.c, keluarSum: totals.keluar, diterimaSum: totals.diterima, page: parseInt(q.page) || 1, pageSize: limit });
});

// A jenis pupuk must be in master pupuk for this estate (or already have history here): a typo would
// otherwise start a separate saldo chain.
const pupukJenisOk = async (estate: string, jenis: string) =>
  !!(await queryOne(
    `SELECT 1 FROM master_pupuk WHERE nama = @jenis AND ${OLI_AT_ESTATE} UNION ALL SELECT 1 FROM pupuk_log WHERE jenis_pupuk = @jenis AND estate = @estate LIMIT 1`,
    { jenis, estate }
  ));

const pupukObjek = (r: { jenis_pupuk: string; tanggal: string; blok?: string | null }) =>
  `${r.jenis_pupuk} · ${r.tanggal}${r.blok ? ` · Blok ${r.blok}` : ""}`;

const optNum = (v: any) => (v === "" || v === undefined || v === null ? null : Number(v));

app.post("/api/pupuk", async (req, res) => {
  const { estate, jenis_pupuk, tanggal_iso, tipe, jumlah, divisi, no_embrace, kode_barang, keterangan, blok, ha, pokok } = req.body;
  if (!checkPupukEstate(req, res, estate)) return;
  if (!jenis_pupuk || !String(jenis_pupuk).trim()) return res.status(400).json({ error: "Jenis pupuk wajib diisi" });
  if (!["MASUK", "KELUAR"].includes(tipe)) return res.status(400).json({ error: "Tipe transaksi tidak valid" });
  if (!jumlah || Number(jumlah) <= 0) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal_iso || "")) return res.status(400).json({ error: "Tanggal tidak valid" });
  const evidenceId = await claimEvidence(req, res);
  if (evidenceId === undefined) return;

  const jenis = String(jenis_pupuk).trim().toUpperCase();
  if (!(await pupukJenisOk(estate, jenis))) return res.status(400).json({ error: `Jenis pupuk ${jenis} tidak ada di Master Data Pupuk` });
  const lastSaldo = await saldoAsOf("PUPUK", estate, jenis, tanggal_iso);
  const qty = Number(jumlah);
  const saldoBaru = round3(tipe === "MASUK" ? lastSaldo + qty : lastSaldo - qty);
  const [y, m, d] = tanggal_iso.split("-");
  const tanggal = `${d}/${m}/${y}`;
  const periode = `${INDO_MONTHS[Number(m) - 1]} ${y}`;

  const row = await queryOne<{ id: number }>(
    `INSERT INTO pupuk_log (estate, jenis_pupuk, periode, tanggal, tanggal_iso, divisi, no_embrace, kode_barang, keluar, diterima, saldo_stock, keterangan, blok, ha, pokok, evidence_id)
     VALUES (@estate, @jenis, @periode, @tanggal, @tanggal_iso, @divisi, @no_embrace, @kode_barang, @keluar, @diterima, @saldo, @keterangan, @blok, @ha, @pokok, @evidenceId::uuid)
     RETURNING id`,
    {
      evidenceId,
      estate,
      jenis,
      periode,
      tanggal,
      tanggal_iso,
      divisi: divisi || "",
      no_embrace: no_embrace || "",
      kode_barang: kode_barang || "",
      keluar: tipe === "KELUAR" ? qty : null,
      diterima: tipe === "MASUK" ? qty : null,
      saldo: saldoBaru,
      keterangan: keterangan || (tipe === "MASUK" ? "PUPUK MASUK" : ""),
      blok: blok || "",
      ha: optNum(ha),
      pokok: optNum(pokok),
    }
  );
  await rechainSaldo("PUPUK", estate, jenis, tanggal_iso);
  await logActivity(req, {
    module: "PUPUK",
    estate,
    aksi: tipe === "MASUK" ? "Stok Masuk" : "Stok Keluar",
    objek: pupukObjek({ jenis_pupuk: jenis, tanggal, blok }),
    detail: [`Jumlah: ${qty} KG`, `Saldo: ${lastSaldo} → ${saldoBaru}`, divisi && `Divisi: ${divisi}`, keterangan && `Keterangan: ${keterangan}`]
      .filter(Boolean)
      .join("; "),
  });
  res.json({ success: true, id: row!.id, saldo_stock: saldoBaru });
});

app.put("/api/pupuk/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM pupuk_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  if (editTooLate(req, res, "pupuk", existing)) return;
  const newEvidence = await checkEditEvidence(req, res, existing.evidence_id);
  if (newEvidence === undefined) return;
  const b = req.body;
  if (b.tanggal_iso && !/^\d{4}-\d{2}-\d{2}$/.test(b.tanggal_iso)) return res.status(400).json({ error: "Tanggal tidak valid" });

  const iso = b.tanggal_iso || existing.tanggal_iso;
  const [y, m, d] = String(iso).split("-");
  const updated = {
    tanggal_iso: iso,
    tanggal: `${d}/${m}/${y}`,
    periode: `${INDO_MONTHS[Number(m) - 1]} ${y}`,
    divisi: b.divisi ?? existing.divisi ?? "",
    no_embrace: b.no_embrace ?? existing.no_embrace ?? "",
    kode_barang: b.kode_barang ?? existing.kode_barang ?? "",
    keluar: b.keluar === undefined ? existing.keluar : optNum(b.keluar),
    diterima: b.diterima === undefined ? existing.diterima : optNum(b.diterima),
    saldo_stock: b.saldo_stock === undefined ? existing.saldo_stock : optNum(b.saldo_stock),
    keterangan: b.keterangan ?? existing.keterangan ?? "",
    blok: b.blok ?? existing.blok ?? "",
    ha: b.ha === undefined ? existing.ha : optNum(b.ha),
    pokok: b.pokok === undefined ? existing.pokok : optNum(b.pokok),
  };
  await execute(
    `UPDATE pupuk_log SET tanggal_iso = @tanggal_iso, tanggal = @tanggal, periode = @periode, divisi = @divisi, no_embrace = @no_embrace,
       kode_barang = @kode_barang, keluar = @keluar, diterima = @diterima, saldo_stock = @saldo_stock, keterangan = @keterangan,
       blok = @blok, ha = @ha, pokok = @pokok
     WHERE id = @id`,
    { ...updated, id: req.params.id }
  );
  await afterSaldoEdit("PUPUK", existing, updated, existing.estate, existing.jenis_pupuk);
  await logActivity(req, {
    module: "PUPUK",
    estate: existing.estate,
    aksi: "Edit Transaksi",
    objek: pupukObjek(existing),
    detail: describeChanges(existing, updated, {
      tanggal: "Tanggal",
      divisi: "Divisi",
      no_embrace: "No. BPB",
      kode_barang: "Kode Barang",
      diterima: "Stok Masuk",
      keluar: "Stok Keluar",
      saldo_stock: "Saldo Stok",
      keterangan: "Keterangan",
      blok: "Blok",
      ha: "HA",
      pokok: "Pokok",
    }),
  });
  await useEditEvidence(newEvidence, [{ table: "pupuk_log", where: "id = @id", params: { id: existing.id } }]);
  res.json({ success: true });
});

app.delete("/api/pupuk/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM pupuk_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  if (editTooLate(req, res, "pupuk", existing)) return;
  await execute("DELETE FROM pupuk_log WHERE id = @id", { id: req.params.id });
  if (existing.tanggal_iso) await rechainSaldo("PUPUK", existing.estate, existing.jenis_pupuk, existing.tanggal_iso);
  await logActivity(req, {
    module: "PUPUK",
    estate: existing.estate,
    aksi: "Hapus Transaksi",
    objek: pupukObjek(existing),
    detail: [
      existing.diterima && `Stok Masuk: ${existing.diterima}`,
      existing.keluar && `Stok Keluar: ${existing.keluar}`,
      existing.saldo_stock !== null && `Saldo Stok: ${existing.saldo_stock}`,
      existing.keterangan && `Keterangan: ${existing.keterangan}`,
    ]
      .filter(Boolean)
      .join("; "),
  });
  res.json({ success: true });
});

// ---- Master obat (medicines/medical supplies for the clinics) ----
const OBAT_FIELDS = ["kode", "nama", "kategori", "jenis", "deskripsi", "satuan", "kemasan"] as const;
// kemasan + isi_kemasan: the pack the obat comes in (STRIP isi 10) - stock stays in `satuan` (biji),
// the forms convert (Stock In per strip, opname strip utuh + biji lepas). isi 0 = no pack.
const obatPayload = (body: any) => ({
  ...(Object.fromEntries(OBAT_FIELDS.map((f) => [f, String(body[f] ?? "").replace(/\s+/g, " ").trim()])) as Record<(typeof OBAT_FIELDS)[number], string>),
  isi_kemasan: Math.max(0, Math.floor(Number(body.isi_kemasan) || 0)),
  // Bahan habis pakai: cut per roll / pack when opened, never from a terapi (see schema.sql obat.bhp).
  bhp: body.bhp === true,
});

app.get("/api/obat/options", requireSuperuser, async (_req, res) => {
  const kategori = await queryMany<{ v: string }>("SELECT DISTINCT kategori v FROM obat WHERE kategori <> '' ORDER BY 1");
  const satuan = await queryMany<{ v: string }>("SELECT DISTINCT satuan v FROM obat WHERE satuan <> '' ORDER BY 1");
  const jenis = await queryMany<{ kategori: string; jenis: string }>("SELECT DISTINCT kategori, jenis FROM obat WHERE jenis <> '' ORDER BY 2");
  res.json({ kategori: kategori.map((r) => r.v), satuan: satuan.map((r) => r.v), jenis });
});

app.get("/api/obat", requireSuperuser, async (req, res) => {
  const { search = "", kategori = "", satuan = "", sortBy = "kode", sortDir = "asc", page = "1", pageSize = "50" } = req.query as Record<string, string>;
  const sortCol = ["kode", "nama", "kategori", "jenis", "satuan"].includes(sortBy) ? sortBy : "kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";
  const conditions: string[] = [];
  const params: any = {};
  addWordSearch(search, "", conditions, params, OBAT_SEARCH);
  if (kategori) {
    conditions.push("kategori = @kategori");
    params.kategori = kategori;
  }
  if (satuan) {
    conditions.push("satuan = @satuan");
    params.satuan = satuan;
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM obat ${where}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(`SELECT * FROM obat ${where} ORDER BY ${sortCol} ${dir}, kode LIMIT @limit OFFSET @offset`, { ...params, limit, offset });
  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

app.post("/api/obat", requireSuperuser, async (req, res) => {
  const o = obatPayload(req.body);
  if (!o.kode || !o.nama) return res.status(400).json({ error: "Kode dan nama wajib diisi" });
  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO obat (kode, nama, kategori, jenis, deskripsi, satuan, kemasan, isi_kemasan, bhp)
       VALUES (@kode, @nama, @kategori, @jenis, @deskripsi, @satuan, @kemasan, @isi_kemasan, @bhp) RETURNING id`,
      o
    );
    await logActivity(req, { module: "KLINIK", estate: null, aksi: "Tambah Obat", objek: `${o.kode} - ${o.nama}`, detail: `Kategori: ${o.kategori || "-"}; Satuan: ${o.satuan || "-"}${o.bhp ? "; Bahan habis pakai" : ""}` });
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Kode sudah digunakan obat lain" });
    throw e;
  }
});

app.put("/api/obat/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM obat WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const o = obatPayload(req.body);
  if (!o.kode || !o.nama) return res.status(400).json({ error: "Kode dan nama wajib diisi" });
  try {
    await execute(
      "UPDATE obat SET kode = @kode, nama = @nama, kategori = @kategori, jenis = @jenis, deskripsi = @deskripsi, satuan = @satuan, kemasan = @kemasan, isi_kemasan = @isi_kemasan, bhp = @bhp WHERE id = @id",
      { ...o, id: req.params.id }
    );
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Kode sudah digunakan obat lain" });
    throw e;
  }
  await logActivity(req, {
    module: "KLINIK",
    estate: null,
    aksi: "Edit Obat",
    objek: `${o.kode} - ${o.nama}`,
    detail: describeChanges(existing, o, { kode: "Kode", nama: "Nama", kategori: "Kategori", jenis: "Jenis", deskripsi: "Deskripsi", satuan: "Satuan", kemasan: "Kemasan", isi_kemasan: "Isi per kemasan", bhp: "Bahan habis pakai" }),
  });
  res.json({ success: true });
});

app.delete("/api/obat/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM obat WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  try {
    await execute("DELETE FROM obat WHERE id = @id", { id: req.params.id });
  } catch (e: any) {
    // Still held in a clinic's stock or its history.
    if (e.code === "23503") return res.status(409).json({ error: "Obat ini masih ada di stok/riwayat klinik" });
    throw e;
  }
  await logActivity(req, { module: "KLINIK", estate: null, aksi: "Hapus Obat", objek: `${existing.kode} - ${existing.nama}` });
  res.json({ success: true });
});

// ---- Inventory Klinik per estate ----
const KLINIK_OPTIONS = ["NILAM", "FIRUS", "ZAMRUD", "KNS", "WJA"];

// Days before expiry that count as "segera expired" on the Klinik page.
const EXPIRY_WARNING_DAYS = 30;

function checkKlinik(req: express.Request, res: express.Response, klinik: string) {
  if (!KLINIK_OPTIONS.includes(klinik)) {
    res.status(400).json({ error: "Klinik tidak valid" });
    return false;
  }
  if (!estateAllowed(req.user!, klinik)) {
    res.status(403).json({ error: "Akses ditolak" });
    return false;
  }
  return true;
}

// expired_date is stored as YYYY-MM-DD text, so it compares with CURRENT_DATE via ::date.
const EXPIRING_SQL = `(ks.expired_date IS NOT NULL AND ks.expired_date <> '' AND ks.expired_date::date <= CURRENT_DATE + ${EXPIRY_WARNING_DAYS})`;

// ---- Klinik batches (see schema.sql klinik_batch) ----
type Alloc = { exp: string; qty: number }; // exp '' = batch without expiry date
class StockError extends Error {}

// A movement is re-read and locked inside the transaction that reverses it: a double click or a retry of the
// same delete / edit must not take the stock back twice (the row was read before the transaction began).
async function lockMovement(client: PoolClient, table: string, old: { id: number; qty: unknown; type: unknown }) {
  const cur = await queryOne<{ qty: number; type: string }>(`SELECT qty, type FROM ${table} WHERE id = @id FOR UPDATE`, { id: old.id }, client);
  if (!cur) throw new StockError("Transaksi ini sudah dihapus. Muat ulang halaman.");
  if (Number(cur.qty) !== Number(old.qty) || cur.type !== old.type) throw new StockError("Transaksi ini baru saja diubah. Muat ulang halaman lalu ulangi.");
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const expText = (exp: string) => (exp ? exp.split("-").reverse().join("/") : "tanpa tanggal");
// Tujuan of a Stock Out that throws expired obat away; it is left out of Top Barang Keluar.
const TUJUAN_DIBUANG = "DIBUANG";

async function addToBatch(client: PoolClient, klinik: string, obat: string, exp: string, qty: number) {
  await execute(
    `INSERT INTO klinik_batch (klinik, obat_kode, expired_date, qty) VALUES (@klinik, @obat, @exp, @qty)
     ON CONFLICT (klinik, obat_kode, expired_date) DO UPDATE SET qty = klinik_batch.qty + EXCLUDED.qty`,
    { klinik, obat, exp, qty },
    client
  );
}

// Takes qty from one batch (exp given) or from the batches that expire first (FEFO, undated last).
async function takeFromBatches(client: PoolClient, klinik: string, obat: string, qty: number, exp?: string): Promise<Alloc[]> {
  const rows = await queryMany<{ id: number; expired_date: string; qty: number }>(
    `SELECT id, expired_date, qty FROM klinik_batch
     WHERE klinik = @klinik AND obat_kode = @obat AND qty > 0 ${exp !== undefined ? "AND expired_date = @exp" : ""}
     ORDER BY expired_date = '', expired_date, id FOR UPDATE`,
    { klinik, obat, exp: exp ?? "" },
    client
  );
  const available = rows.reduce((s, r) => s + r.qty, 0);
  if (available < qty) {
    throw new StockError(exp !== undefined ? `Stok batch expired ${expText(exp)} hanya ${available}` : `Stock tersedia hanya ${available}`);
  }
  const alloc: Alloc[] = [];
  let left = qty;
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(r.qty, left);
    left -= take;
    alloc.push({ exp: r.expired_date, qty: take });
    await execute("UPDATE klinik_batch SET qty = qty - @take WHERE id = @id", { take, id: r.id }, client);
  }
  await execute("DELETE FROM klinik_batch WHERE klinik = @klinik AND obat_kode = @obat AND qty <= 0", { klinik, obat }, client);
  return alloc;
}

// klinik_stock totals follow the batches.
async function syncKlinikStock(client: PoolClient, klinik: string, obat: string) {
  await execute(
    `INSERT INTO klinik_stock (klinik, obat_kode, buffer_stock, stock_tersedia) VALUES (@klinik, @obat, 0, 0)
     ON CONFLICT (klinik, obat_kode) DO NOTHING`,
    { klinik, obat },
    client
  );
  await execute(
    `UPDATE klinik_stock SET
       stock_tersedia = COALESCE((SELECT SUM(qty) FROM klinik_batch b WHERE b.klinik = @klinik AND b.obat_kode = @obat), 0),
       expired_date = (SELECT MIN(NULLIF(expired_date, '')) FROM klinik_batch b WHERE b.klinik = @klinik AND b.obat_kode = @obat AND b.qty > 0)
     WHERE klinik = @klinik AND obat_kode = @obat`,
    { klinik, obat },
    client
  );
}

// Applies one movement to the batches: IN adds to the batch of `exp`, OUT takes from `exp` or FEFO.
async function klinikApply(client: PoolClient, klinik: string, obat: string, type: "IN" | "OUT", qty: number, exp?: string): Promise<Alloc[]> {
  if (type === "IN") {
    await addToBatch(client, klinik, obat, exp ?? "", qty);
    return [{ exp: exp ?? "", qty }];
  }
  return takeFromBatches(client, klinik, obat, qty, exp);
}

// Undoes a stored movement on the batches it touched. A Stock In can only be undone while its batch
// still holds that stock - once part of it went out, the Stock Out has to be changed first (or a
// Koreksi used), otherwise the batches would no longer match what really happened. Rows from before
// batches (no alloc) use the nearest batch.
async function klinikReverse(client: PoolClient, tx: any) {
  const alloc: Alloc[] | null = tx.alloc;
  if (tx.type === "OUT") {
    const fallback = alloc
      ? ""
      : ((await queryOne<{ e: string }>(
          "SELECT expired_date e FROM klinik_batch WHERE klinik = @k AND obat_kode = @o ORDER BY expired_date = '', expired_date LIMIT 1",
          { k: tx.klinik, o: tx.obat_kode },
          client
        ))?.e ?? "");
    for (const a of alloc ?? [{ exp: fallback, qty: tx.qty }]) await addToBatch(client, tx.klinik, tx.obat_kode, a.exp, a.qty);
    return;
  }
  try {
    if (alloc) for (const a of alloc) await takeFromBatches(client, tx.klinik, tx.obat_kode, a.qty, a.exp);
    else await takeFromBatches(client, tx.klinik, tx.obat_kode, tx.qty);
  } catch (e) {
    if (e instanceof StockError) {
      throw new StockError("Stok dari transaksi ini sudah terpakai. Ubah/hapus dulu stok keluarnya, atau pakai Koreksi Stok per batch.");
    }
    throw e;
  }
}

// One Klinik Stock In / Out: batches, history row (with its alloc) and totals in one transaction.
async function recordKlinikMove(
  req: express.Request,
  m: {
    klinik: string;
    obat: string;
    type: "IN" | "OUT";
    qty: number;
    exp?: string;
    tujuan: string;
    penerima: string;
    note: string | null;
    is_correction: number;
    evidenceId?: string | null;
    // Obat expired / rusak / retur (tujuan DIBUANG): why, and MENUNGGU until a second account checks it.
    alasan?: string | null;
    status?: string | null;
  }
): Promise<string | null> {
  try {
    await withTransaction((client) => klinikMoveTx(client, req, m));
    return null;
  } catch (e) {
    if (e instanceof StockError) return e.message;
    throw e;
  }
}

type KlinikMove = Parameters<typeof recordKlinikMove>[1];
async function klinikMoveTx(client: PoolClient, req: express.Request, m: KlinikMove) {
  const alloc = await klinikApply(client, m.klinik, m.obat, m.type, m.qty, m.exp);
  await execute(
    `INSERT INTO klinik_stock_tx (klinik, obat_kode, type, qty, tujuan, penerima, note, is_correction, user_id, alloc, evidence_id, alasan, status)
     VALUES (@klinik, @obat, @type, @qty, @tujuan, @penerima, @note, @is_correction, @user_id, @alloc::jsonb, @evidenceId::uuid, @alasan, @status)`,
    { ...m, evidenceId: m.evidenceId ?? null, user_id: req.user!.id, alloc: JSON.stringify(alloc), alasan: m.alasan ?? null, status: m.status ?? null },
    client
  );
  await syncKlinikStock(client, m.klinik, m.obat);
}

// ---- Laporan Harian Klinik (KPI), see schema.sql klinik_kunjungan and klinikLaporan.ts ----
// The clinics a report covers: one (`klinik`) or every clinic the account may open.
function laporanKliniks(req: express.Request, res: express.Response, klinik: string): string[] | null {
  if (klinik && !KLINIK_OPTIONS.includes(klinik)) {
    res.status(400).json({ error: "Klinik tidak valid" });
    return null;
  }
  const list = KLINIK_OPTIONS.filter((k) => (!klinik || k === klinik) && estateAllowed(req.user!, k));
  if (!list.length) {
    res.status(403).json({ error: "Akses ditolak" });
    return null;
  }
  return list;
}
function laporanRange(q: Record<string, string>) {
  const from = ISO_DATE.test(q.dateFrom ?? "") ? q.dateFrom : "0000-01-01";
  const to = ISO_DATE.test(q.dateTo ?? "") ? q.dateTo : "9999-12-31";
  return { from, to };
}
// Free-typed labels (diagnosis, provider, nama obat) grouped by labelKey, shown with their most
// used spelling.
function groupLabels<T extends { label: string; n: number }>(rows: T[], add: (into: T, r: T) => void = () => {}) {
  const by = new Map<string, { spell: Map<string, number>; acc: T }>();
  for (const r of rows) {
    const k = labelKey(r.label) || r.label;
    const g = by.get(k);
    if (!g) by.set(k, { spell: new Map([[r.label, r.n]]), acc: { ...r } });
    else {
      g.spell.set(r.label, (g.spell.get(r.label) ?? 0) + r.n);
      g.acc.n += r.n;
      add(g.acc, r);
    }
  }
  return [...by.values()]
    .map((g) => ({ ...g.acc, label: [...g.spell].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

app.get("/api/klinik-laporan/summary", async (req, res) => {
  const q = req.query as Record<string, string>;
  const kliniks = laporanKliniks(req, res, q.klinik ?? "");
  if (!kliniks) return;
  const { from, to } = laporanRange(q);
  const p = { kliniks, from, to };
  const W = "klinik = ANY(@kliniks) AND tanggal_iso BETWEEN @from AND @to";
  const totals = await queryOne<any>(
    `SELECT COUNT(*)::int total, COUNT(DISTINCT tanggal_iso)::int hari,
       COUNT(*) FILTER (WHERE kecelakaan_kerja)::int kecelakaan, COUNT(*) FILTER (WHERE istirahat)::int istirahat,
       COALESCE(SUM(hari_istirahat) FILTER (WHERE istirahat), 0)::int hari_istirahat, COUNT(*) FILTER (WHERE rujukan)::int rujukan,
       COUNT(*) FILTER (WHERE jenis_kunjungan ILIKE 'mcu%')::int mcu,
       COUNT(DISTINCT lower(nama_pasien) || '|' || COALESCE(tanggal_lahir_iso, ''))::int pasien
     FROM klinik_kunjungan WHERE ${W}`,
    p
  );
  // The main dashboard only needs the totals of each clinic.
  if (q.lite) return res.json({ totals });
  const count = (col: string, extra = "") =>
    queryMany<{ label: string; n: number }>(`SELECT ${col} AS label, COUNT(*)::int n FROM klinik_kunjungan WHERE ${W} ${extra} GROUP BY 1 ORDER BY 2 DESC, 1`, p);
  const [jenis, status, divisi, kelamin, diagnosisRaw, providerRaw, perHari] = await Promise.all([
    count("NULLIF(jenis_kunjungan, '')"),
    count("NULLIF(status_pasien, '')"),
    count("COALESCE(NULLIF(divisi, ''), '(tidak diisi)')"),
    count("NULLIF(jenis_kelamin, '')"),
    count("NULLIF(diagnosis, '')"),
    count("COALESCE(NULLIF(provider, ''), '(tidak diisi)')", "AND rujukan"),
    queryMany<{ tanggal: string; n: number; kecelakaan: number }>(
      `SELECT tanggal_iso tanggal, COUNT(*)::int n, COUNT(*) FILTER (WHERE kecelakaan_kerja)::int kecelakaan
       FROM klinik_kunjungan WHERE ${W} GROUP BY 1 ORDER BY 1`,
      p
    ),
  ]);
  const obatRaw = await queryMany<{ label: string; kode: string; satuan: string; n: number; qty: number }>(
    `SELECT COALESCE(NULLIF(o.nama_obat, ''), o.obat_kode) label, mode() WITHIN GROUP (ORDER BY o.obat_kode) kode, mode() WITHIN GROUP (ORDER BY o.satuan) satuan,
       COUNT(DISTINCT o.kunjungan_id)::int n, COALESCE(SUM(o.qty), 0)::float8 qty
     FROM klinik_kunjungan_obat o JOIN klinik_kunjungan k ON k.id = o.kunjungan_id
     WHERE k.klinik = ANY(@kliniks) AND k.tanggal_iso BETWEEN @from AND @to AND COALESCE(NULLIF(o.nama_obat, ''), o.obat_kode) <> ''
     GROUP BY 1`,
    p
  );
  const kecelakaanList = await queryMany(
    `SELECT tanggal_iso, klinik, nama_pasien, jabatan, divisi, diagnosis, istirahat, hari_istirahat, rujukan, provider, detail_kejadian
     FROM klinik_kunjungan WHERE ${W} AND kecelakaan_kerja ORDER BY tanggal_iso DESC, id DESC LIMIT 200`,
    p
  );
  res.json({
    totals,
    jenis: jenis.filter((r) => r.label),
    status: status.filter((r) => r.label),
    divisi,
    kelamin: kelamin.filter((r) => r.label),
    diagnosis: groupLabels(diagnosisRaw.filter((r) => r.label).flatMap((r) => splitDiagnosis(r.label).map((label) => ({ label, n: r.n })))),
    provider: groupLabels(providerRaw.map((r) => ({ ...r, label: canonProvider(r.label) || r.label }))),
    obat: groupLabels(obatRaw, (into, r) => (into.qty += r.qty)).slice(0, 30),
    perHari,
    kecelakaanList,
  });
});

app.get("/api/klinik-laporan/kunjungan", async (req, res) => {
  const q = req.query as Record<string, string>;
  const kliniks = laporanKliniks(req, res, q.klinik ?? "");
  if (!kliniks) return;
  const { from, to } = laporanRange(q);
  const conditions = ["k.klinik = ANY(@kliniks)", "k.tanggal_iso BETWEEN @from AND @to"];
  const params: any = { kliniks, from, to };
  wordSearch(q.search ?? "", ["k.nama_pasien", "k.diagnosis", "k.divisi", "k.jabatan", "k.status_pasien", "k.jenis_kunjungan", "k.provider", "k.penanggung"], conditions, params);
  if (q.flag === "kecelakaan") conditions.push("k.kecelakaan_kerja");
  if (q.flag === "istirahat") conditions.push("k.istirahat");
  if (q.flag === "rujukan") conditions.push("k.rujukan");
  if (q.flag === "mcu") conditions.push("k.jenis_kunjungan ILIKE 'mcu%'");
  const where = conditions.join(" AND ");
  const total = (await queryOne<{ c: number }>(`SELECT COUNT(*)::int c FROM klinik_kunjungan k WHERE ${where}`, params))!.c;
  const limit = Math.min(parseInt(q.pageSize) || 50, 500);
  const offset = (Math.max(parseInt(q.page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    // No = the visit's number in its clinic and year, by date, as the sheet numbers its rows.
    `SELECT k.*, COALESCE((SELECT json_agg(json_build_object('obat_kode', o.obat_kode, 'nama_obat', o.nama_obat, 'qty', o.qty, 'satuan', o.satuan,
                             'master', m.kode IS NOT NULL, 'bhp', COALESCE(m.bhp, false),
                             'terpotong', (SELECT SUM(CASE WHEN t.type = 'OUT' THEN t.qty ELSE -t.qty END) FROM klinik_stock_tx t WHERE t.kunjungan_id = k.id AND t.obat_kode = o.obat_kode)) ORDER BY o.urut, o.id)
                           FROM klinik_kunjungan_obat o LEFT JOIN obat m ON m.kode = o.obat_kode WHERE o.kunjungan_id = k.id), '[]') AS obat,
       k.tanggal_iso <= COALESCE((SELECT MAX(tanggal) FROM opname WHERE module = 'KLINIK' AND estate = k.klinik AND status = 'APPROVED'), '') AS sebelum_opname
     FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY klinik, left(tanggal_iso, 4) ORDER BY tanggal_iso, id)::int AS nomor FROM klinik_kunjungan) k
     WHERE ${where} ORDER BY k.tanggal_iso DESC, k.id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total, page: parseInt(q.page) || 1, pageSize: limit });
});

// Klinik > Laporan Harian: one patient visit, the same columns as the Daily Report sheet. No,
// Periode, Kode tgl, Hari and Usia follow from the dates; the obat given (Terapi 1-8) are report only
// and do not move stock.
const JENIS_KUNJUNGAN = ["Rawat Jalan", "MCU", "Kontrol", "Rawat Inap"];
const STATUS_PASIEN = ["Pekerja", "Istri", "Anak", "Lainnya"];
function kunjunganPayload(b: any): { data?: Record<string, any>; obat?: { obat_kode: string; nama_obat: string; qty: number | null; satuan: string }[]; error?: string } {
  const t = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const tanggal_iso = t(b.tanggal_iso);
  if (!ISO_DATE.test(tanggal_iso)) return { error: "Tanggal tidak valid" };
  if (tanggal_iso > jakartaToday()) return { error: "Tanggal kunjungan tidak boleh lewat dari hari ini" };
  const nama_pasien = t(b.nama_pasien);
  if (!nama_pasien) return { error: "Nama pasien wajib diisi" };
  const jenis_kunjungan = t(b.jenis_kunjungan);
  if (!JENIS_KUNJUNGAN.includes(jenis_kunjungan)) return { error: "Jenis kunjungan wajib dipilih" };
  const jenis_kelamin = t(b.jenis_kelamin).toUpperCase();
  if (!["L", "P"].includes(jenis_kelamin)) return { error: "Jenis kelamin wajib dipilih" };
  const status_pasien = t(b.status_pasien);
  if (!STATUS_PASIEN.includes(status_pasien)) return { error: "Status pasien wajib dipilih" };
  const tanggal_lahir_iso = t(b.tanggal_lahir_iso) || null;
  if (tanggal_lahir_iso && (!ISO_DATE.test(tanggal_lahir_iso) || tanggal_lahir_iso > tanggal_iso)) return { error: "Tanggal lahir tidak valid" };
  const usia = b.usia === "" || b.usia === null || b.usia === undefined ? null : Number(b.usia);
  if (usia !== null && (!Number.isInteger(usia) || usia < 0 || usia > 120)) return { error: "Usia tidak valid" };
  const istirahat = !!b.istirahat;
  const hari_istirahat = istirahat ? Number(b.hari_istirahat) : 0;
  if (istirahat && (!Number.isInteger(hari_istirahat) || hari_istirahat < 1)) return { error: "Jumlah hari istirahat wajib diisi" };
  const rujukan = !!b.rujukan;
  const obatIn = Array.isArray(b.obat) ? b.obat : [];
  if (obatIn.length > 8) return { error: "Terapi paling banyak 8" };
  const obat = [];
  for (const o of obatIn) {
    const nama_obat = t(o?.nama_obat);
    const qtyRaw = t(o?.qty).replace(",", ".");
    if (!nama_obat && !qtyRaw) continue;
    if (!nama_obat) return { error: "Nama terapi wajib diisi untuk setiap jumlah" };
    const qty = qtyRaw === "" ? null : Number(qtyRaw);
    if (qty !== null && !(qty > 0)) return { error: `Qty ${nama_obat} tidak valid` };
    obat.push({ obat_kode: t(o?.obat_kode).toUpperCase(), nama_obat, qty, satuan: t(o?.satuan).toUpperCase() });
  }
  return {
    data: {
      tanggal_iso,
      jenis_kunjungan,
      nama_pasien,
      jenis_kelamin,
      tanggal_lahir_iso,
      usia,
      status_pasien,
      penanggung: t(b.penanggung),
      jabatan: t(b.jabatan),
      divisi: t(b.divisi),
      tempat_tinggal: t(b.tempat_tinggal),
      asal_pasien: t(b.asal_pasien),
      diagnosis: t(b.diagnosis),
      kecelakaan_kerja: !!b.kecelakaan_kerja,
      istirahat,
      hari_istirahat,
      rujukan,
      provider: rujukan ? canonProvider(t(b.provider)) : "",
      detail_kejadian: String(b.detail_kejadian ?? "").trim(),
    },
    obat,
  };
}
const KUNJUNGAN_COLS = ["tanggal_iso", "jenis_kunjungan", "nama_pasien", "jenis_kelamin", "tanggal_lahir_iso", "usia", "status_pasien", "penanggung", "jabatan", "divisi", "tempat_tinggal", "asal_pasien", "diagnosis", "kecelakaan_kerja", "istirahat", "hari_istirahat", "rujukan", "provider", "detail_kejadian"];
async function saveKunjunganObat(c: PoolClient, id: number, obat: NonNullable<ReturnType<typeof kunjunganPayload>["obat"]>) {
  await execute("DELETE FROM klinik_kunjungan_obat WHERE kunjungan_id = @id", { id }, c);
  if (obat.length)
    await execute(
      `INSERT INTO klinik_kunjungan_obat (kunjungan_id, urut, obat_kode, nama_obat, qty, satuan)
       SELECT @id, x.urut, x.obat_kode, x.nama_obat, x.qty, x.satuan
       FROM json_to_recordset(@rows::json) AS x(urut int, obat_kode text, nama_obat text, qty float8, satuan text)`,
      { id, rows: JSON.stringify(obat.map((o, i) => ({ ...o, urut: i + 1 }))) },
      c
    );
}
// ---- Nama obat -> master obat ----
// A terapi typed by hand ("PCT", "Vit C50", a misspelling) is matched to the master obat it means:
// its exact master name, or an alias in klinik_obat_alias (Super User: Cocokkan Nama Obat). Keys are
// lower-case letters and digits only, so spacing / case / punctuation don't matter.
const OBAT_KEY_SQL = (col: string) => `regexp_replace(lower(${col}), '[^a-z0-9]', '', 'g')`;
const obatKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
async function resolveTerapiKode<T extends { obat_kode: string; nama_obat: string }>(c: PoolClient, obat: T[]): Promise<T[]> {
  const keys = [...new Set(obat.map((o) => obatKey(o.nama_obat)).filter(Boolean))];
  if (!keys.length) return obat;
  const valid = new Set(
    (await queryMany<{ kode: string }>("SELECT kode FROM obat WHERE kode = ANY(@kodes::text[])", { kodes: obat.map((o) => o.obat_kode).filter(Boolean) }, c)).map((r) => r.kode)
  );
  const byKey = new Map(
    (
      await queryMany<{ k: string; kode: string }>(
        `SELECT ${OBAT_KEY_SQL("nama")} k, kode FROM obat WHERE ${OBAT_KEY_SQL("nama")} = ANY(@keys::text[])
         UNION ALL SELECT nama_key, obat_kode FROM klinik_obat_alias WHERE nama_key = ANY(@keys::text[])`,
        { keys },
        c
      )
    ).map((r) => [r.k, r.kode])
  );
  return obat.map((o) => (valid.has(o.obat_kode) ? o : { ...o, obat_kode: byKey.get(obatKey(o.nama_obat)) ?? "" }));
}
// Every saved terapi row with a hand-typed / stale code that a master name or alias now covers.
async function applyObatAlias(c?: PoolClient, key?: string) {
  const r = await queryOne<{ n: number }>(
    `WITH m AS (SELECT ${OBAT_KEY_SQL("nama")} k, kode FROM obat UNION ALL SELECT nama_key, obat_kode FROM klinik_obat_alias),
     u AS (UPDATE klinik_kunjungan_obat o SET obat_kode = m.kode FROM m
           WHERE m.k = ${OBAT_KEY_SQL("o.nama_obat")} ${key ? "AND m.k = @key" : ""} AND o.obat_kode IS DISTINCT FROM m.kode
             AND NOT EXISTS (SELECT 1 FROM obat x WHERE x.kode = o.obat_kode) RETURNING 1)
     SELECT COUNT(*)::int n FROM u`,
    { key: key ?? "" },
    c
  );
  return r?.n ?? 0;
}

// ---- Terapi -> Stock Out ----
// Every terapi of a kunjungan that names a master obat (obat_kode) is a Stock Out of the visit's
// clinic: FEFO from its batches, dated on the visit, penerima = the patient, linked by
// klinik_stock_tx.kunjungan_id, so the admin types it once (in Laporan Harian) and not again on the
// Stock Out page. Saving / editing a visit brings its Stock Out in line - an obat whose qty didn't
// change keeps its row - and deleting it puts the stock back. A manual Stock Out already entered for
// that patient (a similar spelling counts, namaMirip) and obat around the visit day is linked instead
// of booked again, so nothing is cut twice; when its qty differs from the terapi it stays as typed
// until the visit itself is edited. A visit on or before the day of the clinic's last approved stok
// opname is left alone: the count (done that day) has it.
type TerapiStok = { obat_kode: string; nama_obat: string; qty: number | null };
type KunjunganStokRef = { id: number; klinik: string; tanggal_iso: string; nama_pasien: string; diagnosis: string };
async function klinikOpnameDay(klinik: string, c?: PoolClient) {
  return (
    (await queryOne<{ t: string | null }>("SELECT MAX(tanggal) t FROM opname WHERE module = 'KLINIK' AND estate = @klinik AND status = 'APPROVED'", { klinik }, c))?.t ?? ""
  );
}
const AUTO_NOTE = "(Laporan Harian)";
// The visit's foto (bukti obat keluar) goes on the Stock Out rows it booked itself, so they show it in
// Stock Out too; a linked manual Stock Out keeps its own foto.
async function kunjunganFotoKeStok(id: number) {
  await execute(
    `UPDATE klinik_stock_tx t SET evidence_id = k.evidence_id FROM klinik_kunjungan k
      WHERE k.id = @id AND t.kunjungan_id = k.id AND t.note LIKE @auto AND t.evidence_id IS DISTINCT FROM k.evidence_id`,
    { id, auto: `%${AUTO_NOTE}` }
  );
}
// Unlinked manual Stock Out rows of this patient + obat from the day before to 14 days after the visit
// (an admin catching up enters them days later),
// nearest the visit day first, linked to it: one row with exactly the terapi qty, else the nearest
// rows until they make it (so a patient seen two days running keeps each day's row with its visit).
// Their total qty (0 = none).
async function linkManualStockOut(c: PoolClient, k: KunjunganStokRef, kode: string, qty: number) {
  const rows = await queryMany<{ id: number; qty: number; penerima: string }>(
    `SELECT id, qty, COALESCE(penerima, '') penerima FROM klinik_stock_tx
     WHERE klinik = @klinik AND obat_kode = @kode AND type = 'OUT' AND is_correction = 0 AND pinjaman_id IS NULL AND kunjungan_id IS NULL
       AND COALESCE(tujuan, '') <> 'DIBUANG' AND (created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN @tgl::date - 1 AND @tgl::date + 14
       AND (created_at AT TIME ZONE 'Asia/Jakarta')::date::text > @opname
     ORDER BY abs((created_at AT TIME ZONE 'Asia/Jakarta')::date - @tgl::date), id`,
    { klinik: k.klinik, kode, tgl: k.tanggal_iso, opname: await klinikOpnameDay(k.klinik, c) },
    c
  );
  const patient = rows.filter((r) => r.penerima.trim() && (namaKey(r.penerima) === namaKey(k.nama_pasien) || namaMirip(r.penerima, k.nama_pasien)));
  // One row with the terapi qty; else the nearest rows that together stay within it (a further row
  // may be the next visit's); else the nearest one (a qty typed differently on the two pages).
  const exact = patient.find((r) => r.qty === qty);
  const mine: typeof patient = exact ? [exact] : [];
  if (!exact) for (const r of patient) if (mine.reduce((s, x) => s + x.qty, 0) + r.qty <= qty) mine.push(r);
  if (!mine.length && patient.length) mine.push(patient[0]);
  if (!mine.length) return 0;
  const linked = await queryMany<{ qty: number }>(
    "UPDATE klinik_stock_tx SET kunjungan_id = @kid WHERE id = ANY(@ids::int[]) AND kunjungan_id IS NULL RETURNING qty",
    { kid: k.id, ids: mine.map((r) => r.id) },
    c
  );
  return linked.reduce((s, r) => s + r.qty, 0);
}
type StokSync = { kode: string; nama: string; qty: number; how: string };
// adjustManual: a linked manual Stock Out whose qty differs from the terapi is rebooked to the terapi
// (an edit of the visit); otherwise it stays as typed and is only reported.
// partial (Sinkron Stok of saved visits): each obat on its own - one without qty or with too little
// stock is reported ("tidak terpotong: ...") and the others are still cut. Without it (a visit being
// saved) such an obat refuses the save.
async function syncKunjunganStok(
  c: PoolClient,
  req: express.Request,
  k: KunjunganStokRef,
  obat: TerapiStok[],
  opts: { adjustManual?: boolean; partial?: boolean } = {}
): Promise<StokSync[]> {
  if (k.tanggal_iso <= (await klinikOpnameDay(k.klinik, c))) return [];
  const kodes = obat.map((o) => o.obat_kode).filter(Boolean);
  const master = new Map(
    (
      await queryMany<{ kode: string; nama: string; satuan: string; bhp: boolean }>(
        "SELECT kode, nama, COALESCE(satuan, '') satuan, bhp FROM obat WHERE kode = ANY(@kodes::text[])",
        { kodes },
        c
      )
    ).map((o) => [o.kode, o])
  );
  const done: StokSync[] = [];
  const want = new Map<string, number>();
  const skip = new Set<string>();
  for (const o of obat) {
    const m = master.get(o.obat_kode);
    if (!m) continue;
    // Bahan habis pakai: its stock is cut when a roll / pack is opened, the terapi is only a record.
    // Rows the visit booked before it was marked stay as they are.
    if (m.bhp) {
      skip.add(m.kode);
      continue;
    }
    const bad =
      o.qty === null
        ? `Qty ${o.nama_obat} wajib diisi - obat dari master memotong stok klinik`
        : !Number.isInteger(o.qty)
          ? `Qty ${o.nama_obat} harus bilangan bulat (${m.satuan || "satuan master"})`
          : "";
    if (bad && !opts.partial) throw new StockError(bad);
    if (bad) {
      skip.add(m.kode);
      done.push({ kode: m.kode, nama: m.nama, qty: o.qty ?? 0, how: `tidak terpotong: ${o.qty === null ? "qty kosong" : "qty harus bilangan bulat"}` });
      continue;
    }
    want.set(m.kode, (want.get(m.kode) ?? 0) + o.qty!);
  }
  const have = new Map<string, any[]>();
  for (const t of await queryMany<any>("SELECT * FROM klinik_stock_tx WHERE kunjungan_id = @id ORDER BY id", { id: k.id }, c))
    have.set(t.obat_kode, [...(have.get(t.obat_kode) ?? []), t]);
  const note = `Kunjungan ${k.tanggal_iso.split("-").reverse().join("/")}${k.diagnosis ? ` · ${k.diagnosis}` : ""} ${AUTO_NOTE}`;
  // The visit's own Stock Out rows follow its date and diagnosis (an edit may move the visit to another
  // day while its obat stay the same); the time of day is kept. Linked manual rows keep theirs.
  await execute(
    `UPDATE klinik_stock_tx SET note = @note,
       created_at = ((@tgl::date + (created_at AT TIME ZONE 'Asia/Jakarta')::time) AT TIME ZONE 'Asia/Jakarta')
     WHERE kunjungan_id = @id AND note LIKE @auto
       AND (note <> @note OR (created_at AT TIME ZONE 'Asia/Jakarta')::date <> @tgl::date)`,
    { note, tgl: k.tanggal_iso, id: k.id, auto: `%${AUTO_NOTE}` },
    c
  );

  const syncOne = async (kode: string): Promise<StokSync | null> => {
    const qty = want.get(kode) ?? 0;
    const rows = have.get(kode) ?? [];
    const booked = rows.reduce((s, r) => s + (r.type === "OUT" ? r.qty : -r.qty), 0);
    if (booked === qty) return null;
    const nama = master.get(kode)?.nama ?? kode;
    const manual = rows.some((r) => !String(r.note ?? "").endsWith(AUTO_NOTE));
    if (manual && !opts.adjustManual) return null;
    for (const r of rows) {
      await klinikReverse(c, r);
      await execute("DELETE FROM klinik_stock_tx WHERE id = @id", { id: r.id }, c);
    }
    // Nothing booked for this obat yet (a new visit, or an edit that fills in its qty): a manual Stock
    // Out the admin already entered is linked rather than cut a second time.
    const linked = qty > 0 && !rows.length ? await linkManualStockOut(c, k, kode, qty) : 0;
    if (linked) return { kode, nama, qty, how: linked === qty ? "dihubungkan" : `dihubungkan (Stock Out manual ${linked})` };
    if (qty > 0) {
      let alloc: Alloc[];
      try {
        alloc = await takeFromBatches(c, k.klinik, kode, qty);
      } catch (e) {
        if (e instanceof StockError) throw new StockError(e.message.replace("Stock tersedia hanya", `Stok ${nama} di Klinik ${k.klinik} hanya`));
        throw e;
      }
      await execute(
        `INSERT INTO klinik_stock_tx (klinik, obat_kode, type, qty, tujuan, penerima, note, is_correction, user_id, alloc, kunjungan_id)
         VALUES (@klinik, @kode, 'OUT', @qty, '', @penerima, @note, 0, @uid, @alloc::jsonb, @kid)`,
        { klinik: k.klinik, kode, qty, penerima: k.nama_pasien, note, uid: req.user!.id, alloc: JSON.stringify(alloc), kid: k.id },
        c
      );
    }
    await syncKlinikStock(c, k.klinik, kode);
    return { kode, nama, qty, how: qty === 0 ? "dikembalikan" : rows.length ? "diubah" : "dipotong" };
  };

  for (const kode of new Set([...want.keys(), ...have.keys()])) {
    if (skip.has(kode)) continue;
    if (!opts.partial) {
      const r = await syncOne(kode);
      if (r) done.push(r);
      continue;
    }
    // One obat that can't be cut is undone on its own; the visit's other obat stay.
    await c.query("SAVEPOINT obat_stok");
    try {
      const r = await syncOne(kode);
      if (r) done.push(r);
      await c.query("RELEASE SAVEPOINT obat_stok");
    } catch (e) {
      if (!(e instanceof StockError)) throw e;
      await c.query("ROLLBACK TO SAVEPOINT obat_stok");
      done.push({ kode, nama: master.get(kode)?.nama ?? kode, qty: want.get(kode) ?? 0, how: `tidak terpotong: ${e.message}` });
    }
  }
  return done;
}
// A visit's Stock Out goes back to the batches with it - unless the visit is on / before the last
// approved opname day (counted there): then the rows only lose their link.
async function dropKunjunganStok(c: PoolClient, k: { id: number; klinik: string; tanggal_iso: string }) {
  const rows = await queryMany<any>("SELECT * FROM klinik_stock_tx WHERE kunjungan_id = @id", { id: k.id }, c);
  if (!rows.length) return;
  if (k.tanggal_iso <= (await klinikOpnameDay(k.klinik, c))) {
    await execute("UPDATE klinik_stock_tx SET kunjungan_id = NULL WHERE kunjungan_id = @id", { id: k.id }, c);
    return;
  }
  for (const r of rows) await klinikReverse(c, r);
  await execute("DELETE FROM klinik_stock_tx WHERE kunjungan_id = @id", { id: k.id }, c);
  for (const kode of new Set(rows.map((r) => r.obat_kode))) await syncKlinikStock(c, k.klinik, kode);
}
// The Stock Out rows of a visit entered later carry the visit's day (txTime, see BACKDATE).
const atVisitDay = <T>(tanggal: string, fn: () => Promise<T>): Promise<T> => {
  if (tanggal >= jakartaToday()) return fn();
  const time = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour12: false });
  return txTime.run(`${tanggal}T${time}+07:00`, fn);
};
const stokSyncText = (d: StokSync[]) => {
  const moved = d.filter((x) => !x.how.startsWith("tidak terpotong"));
  return moved.length ? `Stok: ${moved.map((x) => `${x.nama} ${x.qty} ${x.how}`).join(", ")}` : "";
};

const kunjunganObjek = (d: Record<string, any>) => `${d.nama_pasien} · ${d.tanggal_iso.split("-").reverse().join("/")}`;
const kunjunganDetail = (d: Record<string, any>, obat: { nama_obat: string; qty: number | null; satuan: string }[]) =>
  [
    d.jenis_kunjungan,
    d.diagnosis && `Diagnosis: ${d.diagnosis}`,
    d.kecelakaan_kerja && "Kecelakaan kerja",
    d.istirahat && `Istirahat ${d.hari_istirahat} hari`,
    d.rujukan && `Rujukan${d.provider ? `: ${d.provider}` : ""}`,
    obat.length && `Terapi: ${obat.map((o) => `${o.nama_obat} ${o.qty ?? ""} ${o.satuan}`.trim()).join(", ")}`,
  ]
    .filter(Boolean)
    .join("; ");

// ---- Master Pasien (klinik_pasien): the patients of each estate's clinic, see pasien.ts ----
const PASIEN_FIELDS = ["nama", "jenis_kelamin", "tanggal_lahir_iso", "status_pasien", "penanggung", "jabatan", "divisi", "tempat_tinggal", "asal_pasien", "catatan"] as const;
const PASIEN_LABELS: Record<string, string> = {
  nama: "Nama", jenis_kelamin: "L/P", tanggal_lahir_iso: "Tanggal Lahir", status_pasien: "Status", penanggung: "Yang Menanggung", jabatan: "Jabatan",
  divisi: "Divisi", tempat_tinggal: "Tempat Tinggal", asal_pasien: "Asal Pasien", catatan: "Catatan",
};
const NAMA_KEY_SQL = (col: string) => `regexp_replace(lower(${col}), '[^a-z]', '', 'g')`;
function pasienPayload(b: any): { data?: Record<string, any>; error?: string } {
  const t = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const data: Record<string, any> = Object.fromEntries(PASIEN_FIELDS.map((f) => [f, t(b[f])]));
  if (!data.nama) return { error: "Nama pasien wajib diisi" };
  data.jenis_kelamin = data.jenis_kelamin.toUpperCase();
  if (data.jenis_kelamin && !["L", "P"].includes(data.jenis_kelamin)) return { error: "Jenis kelamin tidak valid" };
  if (data.status_pasien && !STATUS_PASIEN.includes(data.status_pasien)) return { error: "Status pasien tidak valid" };
  data.tanggal_lahir_iso = data.tanggal_lahir_iso || null;
  if (data.tanggal_lahir_iso && !ISO_DATE.test(data.tanggal_lahir_iso)) return { error: "Tanggal lahir tidak valid" };
  return { data };
}
const PASIEN_STATS = `(SELECT COUNT(*)::int FROM klinik_kunjungan k WHERE k.pasien_id = p.id) AS kunjungan,
  (SELECT MIN(tanggal_iso) FROM klinik_kunjungan k WHERE k.pasien_id = p.id) AS kunjungan_pertama,
  (SELECT MAX(tanggal_iso) FROM klinik_kunjungan k WHERE k.pasien_id = p.id) AS kunjungan_terakhir`;

app.get("/api/pasien", async (req, res) => {
  const q = req.query as Record<string, string>;
  const estates = laporanKliniks(req, res, q.estate ?? "");
  if (!estates) return;
  const conditions = ["p.estate = ANY(@estates)"];
  const params: any = { estates };
  wordSearch(q.search ?? "", ["p.nama", "p.penanggung", "p.jabatan", "p.divisi", "p.tempat_tinggal", "p.asal_pasien"], conditions, params);
  if (STATUS_PASIEN.includes(q.status)) {
    conditions.push("p.status_pasien = @status");
    params.status = q.status;
  }
  const where = conditions.join(" AND ");
  const sorts: Record<string, string> = { nama: "lower(p.nama)", estate: "p.estate", kunjungan: "kunjungan", kunjungan_terakhir: "kunjungan_terakhir", tanggal_lahir_iso: "p.tanggal_lahir_iso" };
  const sortCol = sorts[q.sortBy] ?? "lower(p.nama)";
  const dir = q.sortDir === "desc" ? "DESC" : "ASC";
  const total = (await queryOne<{ c: number }>(`SELECT COUNT(*)::int c FROM klinik_pasien p WHERE ${where}`, params))!.c;
  const limit = Math.min(parseInt(q.pageSize) || 50, 500);
  const offset = (Math.max(parseInt(q.page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT * FROM (SELECT p.*, ${PASIEN_STATS} FROM klinik_pasien p WHERE ${where}) p ORDER BY ${sortCol} ${dir} NULLS LAST, lower(p.nama), p.id LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total, page: parseInt(q.page) || 1, pageSize: limit });
});

// For Input Kunjungan's Nama Pasien: the estate's patients matching what was typed.
app.get("/api/pasien/pick", async (req, res) => {
  const { estate = "", search = "" } = req.query as Record<string, string>;
  if (!checkKlinik(req, res, estate)) return;
  const words = search.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const params: any = { estate };
  const conds = words.map((w, i) => ((params[`w${i}`] = `%${w}%`), `p.nama ILIKE @w${i}`));
  const data = await queryMany(
    `SELECT p.*, ${PASIEN_STATS} FROM klinik_pasien p WHERE p.estate = @estate ${conds.length ? `AND ${conds.join(" AND ")}` : ""}
     ORDER BY (lower(p.nama) LIKE lower(@starts)) DESC, kunjungan DESC, lower(p.nama) LIMIT 10`,
    { ...params, starts: `${search.trim()}%` }
  );
  res.json(data);
});

app.post("/api/pasien", async (req, res) => {
  const estate = String(req.body?.estate ?? "");
  if (!checkKlinik(req, res, estate)) return;
  const p = pasienPayload(req.body ?? {});
  if (p.error) return res.status(400).json({ error: p.error });
  const row = await queryOne<{ id: number }>(
    `INSERT INTO klinik_pasien (estate, ${PASIEN_FIELDS.join(", ")}) VALUES (@estate, ${PASIEN_FIELDS.map((f) => `@${f}`).join(", ")}) RETURNING id`,
    { ...p.data, estate }
  );
  await logActivity(req, { module: "KLINIK", estate, aksi: "Tambah Pasien", objek: p.data!.nama, detail: [p.data!.status_pasien, p.data!.divisi].filter(Boolean).join("; ") });
  res.json({ success: true, id: row!.id });
});

app.put("/api/pasien/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM klinik_pasien WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Pasien tidak ditemukan" });
  if (!estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  const p = pasienPayload(req.body ?? {});
  if (p.error) return res.status(400).json({ error: p.error });
  await execute(`UPDATE klinik_pasien SET ${PASIEN_FIELDS.map((f) => `${f} = @${f}`).join(", ")}, updated_at = now() WHERE id = @id`, { ...p.data, id: existing.id });
  await logActivity(req, { module: "KLINIK", estate: existing.estate, aksi: "Edit Pasien", objek: p.data!.nama, detail: describeChanges(existing, p.data!, PASIEN_LABELS) });
  res.json({ success: true });
});

// A patient with visits stays (the visits are the report); only one entered by mistake goes.
app.delete("/api/pasien/:id", async (req, res) => {
  const existing = await queryOne<any>(`SELECT p.*, ${PASIEN_STATS} FROM klinik_pasien p WHERE id = @id`, { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Pasien tidak ditemukan" });
  if (!estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  if (existing.kunjungan > 0) return res.status(400).json({ error: `Pasien ini punya ${existing.kunjungan} kunjungan, tidak bisa dihapus` });
  await execute("DELETE FROM klinik_pasien WHERE id = @id", { id: existing.id });
  await logActivity(req, { module: "KLINIK", estate: existing.estate, aksi: "Hapus Pasien", objek: existing.nama });
  res.json({ success: true });
});

// The patient of a saved visit: the one picked in the form, else the estate's patient with that name
// (birth year within a year) or born that day with a similar name, else a new one. Their details follow the latest visit.
async function resolvePasien(c: PoolClient, estate: string, d: Record<string, any>, pickedId: unknown): Promise<number> {
  let id: number | null = null;
  if (Number.isInteger(Number(pickedId)) && Number(pickedId) > 0) {
    id = (await queryOne<{ id: number }>("SELECT id FROM klinik_pasien WHERE id = @id AND estate = @estate", { id: Number(pickedId), estate }, c))?.id ?? null;
  }
  if (!id) {
    const same = await queryMany<{ id: number; tanggal_lahir_iso: string | null }>(
      `SELECT p.id, p.tanggal_lahir_iso FROM klinik_pasien p WHERE p.estate = @estate AND ${NAMA_KEY_SQL("p.nama")} = @key
       ORDER BY (SELECT COUNT(*) FROM klinik_kunjungan k WHERE k.pasien_id = p.id) DESC`,
      { estate, key: namaKey(d.nama_pasien) },
      c
    );
    id = same.find((p) => sameTahun(p.tanggal_lahir_iso, d.tanggal_lahir_iso))?.id ?? null;
  }
  // The same person typed with another spelling: born the same day, same L/P, a similar name.
  if (!id && d.tanggal_lahir_iso) {
    const born = await queryMany<{ id: number; nama: string }>(
      "SELECT id, nama FROM klinik_pasien WHERE estate = @estate AND tanggal_lahir_iso = @lahir AND jenis_kelamin = @jk",
      { estate, lahir: d.tanggal_lahir_iso, jk: d.jenis_kelamin },
      c
    );
    id = born.find((p) => namaMirip(p.nama, d.nama_pasien))?.id ?? null;
  }
  const fields = { jenis_kelamin: d.jenis_kelamin, status_pasien: d.status_pasien, penanggung: d.penanggung, jabatan: d.jabatan, divisi: d.divisi, tempat_tinggal: d.tempat_tinggal, asal_pasien: d.asal_pasien };
  if (!id) {
    return (await queryOne<{ id: number }>(
      `INSERT INTO klinik_pasien (estate, nama, tanggal_lahir_iso, ${Object.keys(fields).join(", ")}) VALUES (@estate, @nama, @lahir, ${Object.keys(fields).map((k) => `@${k}`).join(", ")}) RETURNING id`,
      { ...fields, estate, nama: d.nama_pasien, lahir: d.tanggal_lahir_iso },
      c
    ))!.id;
  }
  await execute(
    `UPDATE klinik_pasien SET ${Object.keys(fields).map((k) => `${k} = COALESCE(NULLIF(@${k}, ''), ${k})`).join(", ")},
       tanggal_lahir_iso = COALESCE(@lahir, tanggal_lahir_iso), updated_at = now() WHERE id = @id`,
    { ...fields, lahir: d.tanggal_lahir_iso, id },
    c
  );
  return id;
}

app.post("/api/klinik-laporan/kunjungan", async (req, res) => {
  const klinik = String(req.body?.klinik ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  const p = kunjunganPayload(req.body ?? {});
  if (p.error) return res.status(400).json({ error: p.error });
  // Foto is optional here (the sheet's Foto column is mostly empty); when sent it is claimed like a
  // transaction's.
  const evidenceId = req.body?.evidence_id ? await claimEvidence(req, res) : null;
  if (evidenceId === undefined) return;
  let stok: StokSync[] = [];
  let id: number;
  try {
    id = await atVisitDay(p.data!.tanggal_iso, () => withTransaction(async (c) => {
    const pasienId = await resolvePasien(c, klinik, p.data!, req.body?.pasien_id);
    p.obat = await resolveTerapiKode(c, p.obat!);
    const row = await queryOne<{ id: number }>(
      `INSERT INTO klinik_kunjungan (klinik, sumber, evidence_id, created_by, pasien_id, ${KUNJUNGAN_COLS.join(", ")})
       VALUES (@klinik, 'APP', @evidenceId::uuid, @by, @pasienId, ${KUNJUNGAN_COLS.map((k) => `@${k}`).join(", ")}) RETURNING id`,
      { ...p.data, klinik, evidenceId, pasienId, by: req.user!.nama || req.user!.username },
      c
    );
    await saveKunjunganObat(c, row!.id, p.obat!);
    stok = await syncKunjunganStok(c, req, { id: row!.id, klinik, ...(p.data as any) }, p.obat!);
    return row!.id;
  }));
  } catch (e) {
    await releaseEvidence(evidenceId);
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  await logActivity(req, {
    module: "KLINIK",
    estate: klinik,
    aksi: "Input Kunjungan",
    objek: kunjunganObjek(p.data!),
    detail: [kunjunganDetail(p.data!, p.obat!), stokSyncText(stok), evidenceId && "foto bukti obat keluar"].filter(Boolean).join("; "),
  });
  await kunjunganFotoKeStok(id);
  res.json({ success: true, id });
});

app.put("/api/klinik-laporan/kunjungan/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM klinik_kunjungan WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Kunjungan tidak ditemukan" });
  if (!estateAllowed(req.user!, existing.klinik)) return res.status(403).json({ error: "Akses ditolak" });
  if (editTooLate(req, res, "klinik", existing)) return;
  const p = kunjunganPayload(req.body ?? {});
  if (p.error) return res.status(400).json({ error: p.error });
  const newEvidence = await checkEditEvidence(req, res, existing.evidence_id);
  if (newEvidence === undefined) return;
  let stok: StokSync[] = [];
  try {
    await atVisitDay(p.data!.tanggal_iso, () => withTransaction(async (c) => {
    const pasienId = await resolvePasien(c, existing.klinik, p.data!, req.body?.pasien_id ?? existing.pasien_id);
    p.obat = await resolveTerapiKode(c, p.obat!);
    await execute(
      `UPDATE klinik_kunjungan SET ${KUNJUNGAN_COLS.map((k) => `${k} = @${k}`).join(", ")}, pasien_id = @pasienId, updated_at = now() WHERE id = @id`,
      { ...p.data, id: existing.id, pasienId },
      c
    );
    await saveKunjunganObat(c, existing.id, p.obat!);
    // The date crosses the last opname day: the rows booked for the old date go first, like a delete -
    // back to stock when they were after the opname, only unlinked when the opname counted them.
    // Then the visit is booked for its new date (nothing when that is on / before the opname).
    const opname = await klinikOpnameDay(existing.klinik, c);
    if ((existing.tanggal_iso <= opname) !== (p.data!.tanggal_iso <= opname)) await dropKunjunganStok(c, existing);
    stok = await syncKunjunganStok(c, req, { id: existing.id, klinik: existing.klinik, ...(p.data as any) }, p.obat!, { adjustManual: true });
  }));
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  await useEditEvidence(newEvidence, [{ table: "klinik_kunjungan", where: "id = @id", params: { id: existing.id } }]);
  await kunjunganFotoKeStok(existing.id);
  const labels: Record<string, string> = {
    tanggal_iso: "Tanggal", jenis_kunjungan: "Jenis Kunjungan", nama_pasien: "Nama", jenis_kelamin: "L/P", tanggal_lahir_iso: "Tanggal Lahir", usia: "Usia",
    status_pasien: "Status", penanggung: "Yang Menanggung", jabatan: "Jabatan", divisi: "Divisi", tempat_tinggal: "Tempat Tinggal", asal_pasien: "Asal Pasien",
    diagnosis: "Diagnosis", kecelakaan_kerja: "Kecelakaan Kerja", istirahat: "Istirahat", hari_istirahat: "Hari Istirahat", rujukan: "Rujukan", provider: "Provider", detail_kejadian: "Detail Kejadian",
  };
  await logActivity(req, {
    module: "KLINIK",
    estate: existing.klinik,
    aksi: "Edit Kunjungan",
    objek: kunjunganObjek(p.data!),
    detail: [describeChanges(existing, p.data!, labels), newEvidence && "Foto diganti", stokSyncText(stok)].filter(Boolean).join("; "),
  });
  res.json({ success: true });
});

app.delete("/api/klinik-laporan/kunjungan/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM klinik_kunjungan WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Kunjungan tidak ditemukan" });
  if (!estateAllowed(req.user!, existing.klinik)) return res.status(403).json({ error: "Akses ditolak" });
  if (editTooLate(req, res, "klinik", existing)) return;
  await withTransaction(async (c) => {
    await dropKunjunganStok(c, existing);
    await execute("DELETE FROM klinik_kunjungan WHERE id = @id", { id: existing.id }, c);
  });
  await releaseEvidence(existing.evidence_id);
  await logActivity(req, { module: "KLINIK", estate: existing.klinik, aksi: "Hapus Kunjungan", objek: kunjunganObjek(existing), detail: existing.diagnosis || "" });
  res.json({ success: true });
});

// Konsumsi Obat: how much of each master obat the clinic gave per month (Laporan Harian terapi - it
// goes back to January, Stock Out only to late September), to how many patients, and its stock now,
// for ordering / buffer stock. obat = one kode, else every obat given in the period. Terapi typed by
// hand that matches no master obat (Cocokkan Nama Obat) or has no qty isn't counted; the totals say how many.
app.get("/api/klinik-laporan/konsumsi-obat", async (req, res) => {
  const q = req.query as Record<string, string>;
  const kliniks = laporanKliniks(req, res, q.klinik ?? "");
  if (!kliniks) return;
  const { from, to } = laporanRange(q);
  const obat = String(q.obat ?? "");
  const params = { kliniks, from, to, obat };
  const scope = `k.klinik = ANY(@kliniks) AND k.tanggal_iso BETWEEN @from AND @to`;
  const rows = await queryMany(
    `SELECT o.obat_kode AS kode, m.nama, COALESCE(m.satuan, '') AS satuan, m.bhp, left(k.tanggal_iso, 7) AS bulan,
       COALESCE(SUM(o.qty), 0)::float8 AS qty, COUNT(DISTINCT k.id)::int AS pasien
     FROM klinik_kunjungan k JOIN klinik_kunjungan_obat o ON o.kunjungan_id = k.id JOIN obat m ON m.kode = o.obat_kode
     WHERE ${scope} ${obat ? "AND o.obat_kode = @obat" : ""}
     GROUP BY 1, 2, 3, 4, 5 ORDER BY 2, 5`,
    params
  );
  const totals = await queryOne<{ pasien: number; tanpa_master: number; tanpa_qty: number }>(
    `SELECT COUNT(DISTINCT k.id) FILTER (WHERE m.kode IS NOT NULL ${obat ? "AND o.obat_kode = @obat" : ""})::int AS pasien,
       COUNT(*) FILTER (WHERE m.kode IS NULL AND trim(o.nama_obat) NOT IN ('', '-'))::int AS tanpa_master,
       COUNT(*) FILTER (WHERE m.kode IS NOT NULL AND NOT m.bhp AND o.qty IS NULL ${obat ? "AND o.obat_kode = @obat" : ""})::int AS tanpa_qty
     FROM klinik_kunjungan k JOIN klinik_kunjungan_obat o ON o.kunjungan_id = k.id LEFT JOIN obat m ON m.kode = o.obat_kode
     WHERE ${scope}`,
    params
  );
  const stok = await queryMany<{ kode: string; stok: number }>(
    "SELECT obat_kode AS kode, SUM(stock_tersedia)::float8 AS stok FROM klinik_stock WHERE klinik = ANY(@kliniks) GROUP BY 1",
    { kliniks }
  );
  // Months that have any visit at all (so a month before the clinic's data starts isn't counted as 0).
  const bulanData = (
    await queryMany<{ b: string }>(`SELECT DISTINCT left(k.tanggal_iso, 7) AS b FROM klinik_kunjungan k WHERE ${scope} ORDER BY 1`, params)
  ).map((r) => r.b);
  res.json({ rows, totals, stok, bulanData });
});

// Konsumsi Obat detail: who got one obat (in one month, YYYY-MM, or the whole period) - the visits
// with their date, patient, diagnosis and qty, and whether it was cut from stock.
app.get("/api/klinik-laporan/konsumsi-obat/detail", async (req, res) => {
  const q = req.query as Record<string, string>;
  const kliniks = laporanKliniks(req, res, q.klinik ?? "");
  if (!kliniks) return;
  const { from, to } = laporanRange(q);
  const obat = String(q.obat ?? "");
  const bulan = /^\d{4}-\d{2}$/.test(q.bulan ?? "") ? q.bulan : "";
  if (!obat) return res.status(400).json({ error: "Pilih obat" });
  const data = await queryMany(
    `SELECT k.id, k.klinik, k.tanggal_iso, k.nama_pasien, k.jenis_kelamin, k.usia, k.status_pasien, k.jabatan, k.divisi, k.diagnosis,
       k.jenis_kunjungan, o.nama_obat, o.qty::float8 AS qty, o.satuan, COALESCE((SELECT m.bhp FROM obat m WHERE m.kode = o.obat_kode), false) AS bhp,
       k.tanggal_iso <= COALESCE((SELECT MAX(tanggal) FROM opname WHERE module = 'KLINIK' AND estate = k.klinik AND status = 'APPROVED'), '') AS sebelum_opname,
       (SELECT SUM(CASE WHEN t.type = 'OUT' THEN t.qty ELSE -t.qty END) FROM klinik_stock_tx t WHERE t.kunjungan_id = k.id AND t.obat_kode = o.obat_kode)::float8 AS terpotong
     FROM klinik_kunjungan k JOIN klinik_kunjungan_obat o ON o.kunjungan_id = k.id
     WHERE k.klinik = ANY(@kliniks) AND k.tanggal_iso BETWEEN @from AND @to AND o.obat_kode = @obat ${bulan ? "AND left(k.tanggal_iso, 7) = @bulan" : ""}
     ORDER BY k.tanggal_iso, k.id, o.urut`,
    { kliniks, from, to, obat, bulan }
  );
  res.json({ data });
});

// Superuser: Cocokkan Nama Obat - the typed terapi names of a clinic that match no master obat, most
// used first (the visits since the last opname are the ones that move stock once matched).
app.get("/api/klinik-laporan/obat-belum-cocok", async (req, res) => {
  if (req.user!.role !== "superuser") return res.status(403).json({ error: "Hanya Super User" });
  const klinik = String((req.query as any).klinik ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  const opname = await klinikOpnameDay(klinik);
  const rows = await queryMany(
    `SELECT ${OBAT_KEY_SQL("o.nama_obat")} AS key, (array_agg(o.nama_obat ORDER BY o.id DESC))[1] AS nama,
       string_agg(DISTINCT NULLIF(upper(o.satuan), ''), '/') AS satuan, COUNT(*)::int AS baris,
       COUNT(*) FILTER (WHERE k.tanggal_iso > @opname)::int AS sejak_opname, MAX(k.tanggal_iso) AS terakhir
     FROM klinik_kunjungan_obat o JOIN klinik_kunjungan k ON k.id = o.kunjungan_id
     WHERE k.klinik = @klinik AND ${OBAT_KEY_SQL("o.nama_obat")} <> '' AND NOT EXISTS (SELECT 1 FROM obat m WHERE m.kode = o.obat_kode)
     GROUP BY 1 ORDER BY sejak_opname DESC, baris DESC, 2`,
    { klinik, opname }
  );
  res.json({ opname, rows });
});
app.post("/api/klinik-laporan/obat-alias", async (req, res) => {
  if (req.user!.role !== "superuser") return res.status(403).json({ error: "Hanya Super User" });
  const nama = String(req.body?.nama ?? "").trim();
  const kode = String(req.body?.obat_kode ?? "");
  const key = obatKey(nama);
  if (!key) return res.status(400).json({ error: "Nama obat kosong" });
  const obat = await queryOne<{ nama: string }>("SELECT nama FROM obat WHERE kode = @kode", { kode });
  if (!obat) return res.status(400).json({ error: "Pilih obat dari master" });
  const updated = await withTransaction(async (c) => {
    await execute(
      `INSERT INTO klinik_obat_alias (nama_key, obat_kode, nama_contoh) VALUES (@key, @kode, @nama)
       ON CONFLICT (nama_key) DO UPDATE SET obat_kode = EXCLUDED.obat_kode, nama_contoh = EXCLUDED.nama_contoh`,
      { key, kode, nama },
      c
    );
    return applyObatAlias(c, key);
  });
  await logActivity(req, { module: "KLINIK", estate: null, aksi: "Cocokkan Nama Obat", objek: `${nama} → ${kode} ${obat.nama}`, detail: `${updated} baris terapi diperbarui` });
  res.json({ success: true, updated });
});

// Superuser: Sinkron Stok - every visit after the clinic's last approved opname brought in line
// with its terapi, each visit in its own transaction (a visit the stock can't cover is listed, the
// others go on). dryRun: the same, rolled back, to see what it would do.
class DryRun extends Error {}
app.post("/api/klinik-laporan/sinkron-stok", async (req, res) => {
  if (req.user!.role !== "superuser") return res.status(403).json({ error: "Hanya Super User" });
  const klinik = String(req.body?.klinik ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  const dryRun = req.body?.dryRun !== false;
  const opname = await klinikOpnameDay(klinik);
  const visits = await queryMany<any>(
    `SELECT k.id, k.klinik, k.tanggal_iso, k.nama_pasien, k.diagnosis FROM klinik_kunjungan k
     WHERE k.klinik = @klinik AND k.tanggal_iso > @opname
       AND (EXISTS (SELECT 1 FROM klinik_kunjungan_obat o JOIN obat m ON m.kode = o.obat_kode WHERE o.kunjungan_id = k.id)
            OR EXISTS (SELECT 1 FROM klinik_stock_tx t WHERE t.kunjungan_id = k.id))
     ORDER BY k.tanggal_iso, k.id`,
    { klinik, opname }
  );
  const out: { id: number; tanggal_iso: string; nama_pasien: string; stok?: StokSync[]; error?: string }[] = [];
  for (const v of visits) {
    const obat = await queryMany<TerapiStok>("SELECT obat_kode, nama_obat, qty FROM klinik_kunjungan_obat WHERE kunjungan_id = @id ORDER BY urut, id", { id: v.id });
    let stok: StokSync[] = [];
    try {
      await atVisitDay(v.tanggal_iso, () =>
        withTransaction(async (c) => {
          stok = await syncKunjunganStok(c, req, v, obat, { partial: true });
          if (dryRun) throw new DryRun();
        })
      );
    } catch (e) {
      if (e instanceof StockError) {
        out.push({ id: v.id, tanggal_iso: v.tanggal_iso, nama_pasien: v.nama_pasien, error: e.message });
        continue;
      }
      if (!(e instanceof DryRun)) throw e;
    }
    if (stok.length) out.push({ id: v.id, tanggal_iso: v.tanggal_iso, nama_pasien: v.nama_pasien, stok });
  }
  if (!dryRun && out.some((r) => stokSyncText(r.stok ?? [])))
    await logActivity(req, {
      module: "KLINIK",
      estate: klinik,
      aksi: "Sinkron Stok Laporan Harian",
      objek: `${out.filter((r) => stokSyncText(r.stok ?? [])).length} kunjungan sejak ${opname || "awal"}`,
      detail: out.filter((r) => stokSyncText(r.stok ?? [])).map((r) => `${r.nama_pasien} ${r.tanggal_iso}: ${stokSyncText(r.stok!)}`).join(" | ").slice(0, 2000),
    });
  res.json({ dryRun, opname, checked: visits.length, results: out });
});

// Suggestions for the form: what was typed before at this clinic (jabatan, tempat tinggal, ...), the
// standard diagnosis / provider names, and the master obat with its satuan.
app.get("/api/klinik-laporan/options", async (req, res) => {
  const klinik = String((req.query as any).klinik ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  const distinct = (col: string) =>
    queryMany<{ v: string }>(`SELECT ${col} v FROM klinik_kunjungan WHERE klinik = @klinik AND ${col} <> '' GROUP BY 1 ORDER BY COUNT(*) DESC, 1 LIMIT 200`, { klinik }).then((r) =>
      r.map((x) => x.v)
    );
  const [jabatan, divisi, tempat_tinggal, asal_pasien, diagnosisRaw, providerRaw, satuanRaw] = await Promise.all([
    distinct("jabatan"),
    distinct("divisi"),
    distinct("tempat_tinggal"),
    distinct("asal_pasien"),
    queryMany<{ label: string; n: number }>("SELECT diagnosis label, COUNT(*)::int n FROM klinik_kunjungan WHERE diagnosis <> '' GROUP BY 1", {}),
    queryMany<{ label: string; n: number }>("SELECT provider label, COUNT(*)::int n FROM klinik_kunjungan WHERE provider <> '' GROUP BY 1", {}),
    queryMany<{ v: string }>("SELECT upper(satuan) v FROM klinik_kunjungan_obat WHERE satuan <> '' GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 30", {}),
  ]);
  const obat = await queryMany<{ kode: string; nama: string; satuan: string; bhp: boolean; stok: number | null }>(
    `SELECT o.kode, o.nama, o.satuan, o.bhp, ks.stock_tersedia::float8 stok FROM obat o
     LEFT JOIN klinik_stock ks ON ks.obat_kode = o.kode AND ks.klinik = @klinik ORDER BY o.nama`,
    { klinik }
  );
  const uniq = (l: string[]) => [...new Set(l)];
  res.json({
    jabatan,
    divisi: uniq(["Divisi A", "Divisi B", "Divisi C", "Umum", ...divisi]),
    tempat_tinggal,
    asal_pasien,
    diagnosis: groupLabels(diagnosisRaw.flatMap((r) => splitDiagnosis(r.label).map((label) => ({ label, n: r.n })))).map((r) => r.label),
    provider: groupLabels(providerRaw.map((r) => ({ ...r, label: canonProvider(r.label) || r.label }))).map((r) => r.label),
    satuan: uniq([...obat.map((o) => (o.satuan ?? "").toUpperCase()).filter(Boolean), ...satuanRaw.map((r) => r.v)]),
    obat,
  });
});

// ---- Permintaan Obat (see schema.sql klinik_permintaan) ----
// Saran: every obat of the master (the klinik's stock row where it has one) with its stock, buffer and average use - Stock Out of the last 3 months
// (terapi of the Laporan Harian included; koreksi, pinjaman and obat thrown away / sent back left out) -
// and how much to ask: enough for `bulan` months of use, at least up to the buffer, minus the stock,
// rounded up to whole kemasan (BOX / BOTOL ...) where the obat has one. Urgensi: HIGH = out of stock or
// under half a month left, MEDIUM = at / under the buffer or under a month left, else LOW.
const PERMINTAAN_STATUS_LINE = ["MENUNGGU", "APPROVED", "SEBAGIAN", "DITOLAK"];
// A refusal for lack of a permission inside a transaction (answered 403, not 400).
class AksesError extends Error {}
const PERMINTAAN_URGENSI = ["HIGH", "MEDIUM", "LOW"];
const fmtQty = (n: number) => (Math.round(n * 100) / 100).toLocaleString("id-ID");

app.get("/api/klinik-permintaan/saran", async (req, res) => {
  const klinik = String(req.query.klinik ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  const bulan = Math.min(Math.max(Number(req.query.bulan) || 2, 0.5), 12);
  const rows = await queryMany<{
    kode: string;
    nama: string;
    jenis: string;
    satuan: string;
    kemasan: string | null;
    isi_kemasan: number | null;
    bhp: boolean;
    stok: number;
    buffer: number;
    expired_date: string | null;
    pakai: number;
    terdaftar: boolean;
  }>(
    `SELECT o.kode, o.nama, COALESCE(o.jenis, '') jenis, COALESCE(o.satuan, '') satuan, NULLIF(o.kemasan, '') kemasan, o.isi_kemasan, COALESCE(o.bhp, false) bhp,
       COALESCE(s.stock_tersedia, 0)::float8 stok, COALESCE(s.buffer_stock, 0)::float8 buffer, NULLIF(s.expired_date, '') expired_date, s.id IS NOT NULL terdaftar,
       COALESCE((SELECT SUM(t.qty) FROM klinik_stock_tx t
                 WHERE t.klinik = @klinik AND t.obat_kode = o.kode AND t.type = 'OUT' AND COALESCE(t.is_correction, 0) = 0
                   AND t.pinjaman_id IS NULL AND t.alasan IS NULL AND t.created_at >= now() - interval '90 days'), 0)::float8 pakai
     FROM obat o LEFT JOIN klinik_stock s ON s.obat_kode = o.kode AND s.klinik = @klinik
     ORDER BY o.nama`,
    { klinik }
  );
  res.json({
    bulan,
    rows: rows.map((r) => {
      const avg = r.pakai / 3;
      const target = Math.max(r.buffer, avg * bulan);
      const kurang = Math.max(0, target - r.stok);
      const kemasan = r.kemasan && r.isi_kemasan && r.isi_kemasan > 1 ? r.kemasan : null;
      const saran = kurang <= 0 ? 0 : kemasan ? Math.ceil(kurang / r.isi_kemasan!) : Math.ceil(kurang);
      const cukup = avg > 0 ? r.stok / avg : null;
      const urgensi = r.stok <= 0 || (cukup !== null && cukup < 0.5) ? "HIGH" : (r.buffer > 0 && r.stok <= r.buffer) || (cukup !== null && cukup < 1) ? "MEDIUM" : "LOW";
      return {
        ...r,
        rata_bulan: Math.round(avg * 100) / 100,
        cukup_bulan: cukup === null ? null : Math.round(cukup * 10) / 10,
        satuan_minta: kemasan ?? r.satuan,
        saran,
        urgensi,
        stok_text: r.stok <= 0 ? "KOSONG" : `${fmtQty(r.stok)} ${r.satuan}`.trim(),
      };
    }),
  });
});

// The klinik's requests, newest first, with how many items and how far they are fulfilled.
app.get("/api/klinik-permintaan", async (req, res) => {
  const klinik = String(req.query.klinik ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  const rows = await queryMany(
    `SELECT p.id, p.klinik, p.nomor, p.tanggal, p.periode, p.departemen, p.status, p.catatan, p.created_by, p.created_at, p.diajukan_at, p.approval, p.tolak,
       COUNT(l.id)::int items,
       COUNT(l.id) FILTER (WHERE l.status = 'APPROVED')::int approved,
       COUNT(l.id) FILTER (WHERE l.status = 'SEBAGIAN')::int sebagian,
       COUNT(l.id) FILTER (WHERE l.status = 'DITOLAK')::int ditolak,
       COUNT(l.id) FILTER (WHERE l.tanggal_pemenuhan IS NOT NULL)::int terpenuhi,
       COUNT(l.id) FILTER (WHERE l.urgensi = 'HIGH')::int high
     FROM klinik_permintaan p LEFT JOIN klinik_permintaan_line l ON l.permintaan_id = p.id
     WHERE p.klinik = @klinik GROUP BY p.id ORDER BY p.tanggal DESC, p.id DESC`,
    { klinik }
  );
  // Signatories for a new request: the klinik's last ones.
  const last = await queryOne<{ ttd: any }>("SELECT ttd FROM klinik_permintaan WHERE klinik = @klinik ORDER BY id DESC LIMIT 1", { klinik });
  res.json({ rows, ttd: last?.ttd ?? null });
});

// Requests waiting for this account's signature: of its kliniks, sent, with an unsigned box it may sign (in any
// order) and no box signed by it yet.
app.get("/api/klinik-permintaan/menunggu", async (req, res) => {
  const u = req.user!;
  const kliniks = KLINIK_OPTIONS.filter((k) => estateAllowed(u, k));
  const rows = await queryMany<any>(
    `SELECT p.id, p.klinik, p.nomor, p.tanggal, p.periode, p.departemen, p.status, p.created_by, p.diajukan_at, p.approval, p.ttd,
       (SELECT COUNT(*) FROM klinik_permintaan_line l WHERE l.permintaan_id = p.id)::int items,
       (SELECT COUNT(*) FROM klinik_permintaan_line l WHERE l.permintaan_id = p.id AND l.urgensi = 'HIGH')::int high
     FROM klinik_permintaan p WHERE p.status = 'DIAJUKAN' AND p.klinik = ANY(@kliniks) ORDER BY p.diajukan_at, p.id`,
    { kliniks }
  );
  res.json({
    rows: rows
      .map((r) => ({ ...r, bisa: TTD_LEVELS.filter((k) => !r.approval?.[k] && bolehTtd(u, k)) }))
      .filter((r) => r.bisa.length && !(u.role !== "superuser" && TTD_LEVELS.some((k) => r.approval?.[k]?.user_id === u.id))),
  });
});

app.get("/api/klinik-permintaan/:id", async (req, res) => {
  const p = await queryOne<any>("SELECT * FROM klinik_permintaan WHERE id = @id", { id: Number(req.params.id) || 0 });
  if (!p) return res.status(404).json({ error: "Permintaan tidak ditemukan" });
  if (!checkKlinik(req, res, p.klinik)) return;
  const lines = await queryMany("SELECT * FROM klinik_permintaan_line WHERE permintaan_id = @id ORDER BY urut, id", { id: p.id });
  res.json({ ...p, lines });
});

type PLine = { obat_kode: string | null; nama: string; satuan: string; jumlah: number; urgensi: string; stok: number | null; stok_text: string; keterangan: string };
function permintaanBody(req: express.Request): { error?: string; head?: any; lines?: PLine[] } {
  const b = req.body ?? {};
  const tanggal = String(b.tanggal ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return { error: "Tanggal tidak valid" };
  const lines: PLine[] = (Array.isArray(b.lines) ? b.lines : []).slice(0, 500).map((l: any) => ({
    obat_kode: l?.obat_kode ? String(l.obat_kode) : null,
    nama: String(l?.nama ?? "").trim().slice(0, 200),
    satuan: String(l?.satuan ?? "").trim().slice(0, 30),
    jumlah: Number(l?.jumlah),
    urgensi: PERMINTAAN_URGENSI.includes(l?.urgensi) ? l.urgensi : "MEDIUM",
    stok: l?.stok === null || l?.stok === undefined || l?.stok === "" ? null : Number(l.stok),
    stok_text: String(l?.stok_text ?? "").trim().slice(0, 60),
    keterangan: String(l?.keterangan ?? "").trim().slice(0, 300),
  }));
  if (!lines.length) return { error: "Isi minimal satu obat" };
  const bad = lines.find((l) => !l.nama || !Number.isFinite(l.jumlah) || l.jumlah <= 0);
  if (bad) return { error: bad.nama ? `${bad.nama}: jumlah harus lebih dari 0` : "Ada baris tanpa nama obat" };
  const orang = (o: any) => ({ nama: String(o?.nama ?? "").trim().slice(0, 100), jabatan: String(o?.jabatan ?? "").trim().slice(0, 100) });
  const t = b.ttd ?? {};
  return {
    head: {
      tanggal,
      periode: String(b.periode ?? tanggal.slice(0, 4)).trim().slice(0, 40),
      departemen: String(b.departemen ?? "").trim().slice(0, 80),
      catatan: String(b.catatan ?? "").trim().slice(0, 500),
      ttd: JSON.stringify({ dibuat: orang(t.dibuat), diketahui: orang(t.diketahui), disetujui1: orang(t.disetujui1), disetujui2: orang(t.disetujui2) }),
    },
    lines,
  };
}
async function savePermintaanLines(c: PoolClient, id: number, lines: PLine[]) {
  await execute("DELETE FROM klinik_permintaan_line WHERE permintaan_id = @id", { id }, c);
  await execute(
    `INSERT INTO klinik_permintaan_line (permintaan_id, urut, obat_kode, nama, satuan, jumlah, urgensi, stok, stok_text, keterangan)
     SELECT @id, u, k, n, s, j, g, st, sx, ket
     FROM unnest(@urut::int[], @kode::text[], @nama::text[], @satuan::text[], @jumlah::float8[], @urg::text[], @stok::float8[], @stx::text[], @ket::text[]) AS x(u, k, n, s, j, g, st, sx, ket)`,
    {
      id,
      urut: lines.map((_, i) => i + 1),
      kode: lines.map((l) => l.obat_kode),
      nama: lines.map((l) => l.nama),
      satuan: lines.map((l) => l.satuan),
      jumlah: lines.map((l) => l.jumlah),
      urg: lines.map((l) => l.urgensi),
      stok: lines.map((l) => (l.stok !== null && Number.isFinite(l.stok) ? l.stok : null)),
      stx: lines.map((l) => l.stok_text),
      ket: lines.map((l) => l.keterangan),
    },
    c
  );
}

app.post("/api/klinik-permintaan", async (req, res) => {
  const klinik = String(req.body?.klinik ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  const v = permintaanBody(req);
  if (v.error) return res.status(400).json({ error: v.error });
  const u = req.user!;
  const ajukan = req.body?.ajukan === true;
  const made = await withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('klinik_permintaan_nomor'))");
    const tahun = v.head.tanggal.slice(0, 4);
    const urut = ((await queryOne<{ n: number }>("SELECT COALESCE(MAX(urut), 0)::int n FROM klinik_permintaan WHERE klinik = @klinik AND left(tanggal, 4) = @tahun", { klinik, tahun }, c))?.n ?? 0) + 1;
    const nomor = `${String(urut).padStart(3, "0")}/PMT-OBAT/KLINIK-${klinik}/${v.head.tanggal.slice(5, 7)}/${tahun}`;
    const p = await queryOne<{ id: number; nomor: string }>(
      `INSERT INTO klinik_permintaan (klinik, urut, nomor, tanggal, periode, departemen, status, catatan, ttd, user_id, created_by, diajukan_at)
       VALUES (@klinik, @urut, @nomor, @tanggal, @periode, @departemen, @status, @catatan, @ttd::jsonb, @uid, @nama, ${ajukan ? "now()" : "NULL"})
       RETURNING id, nomor`,
      { klinik, urut, nomor, ...v.head, status: ajukan ? "DIAJUKAN" : "DRAFT", uid: u.id, nama: u.nama },
      c
    );
    await savePermintaanLines(c, p!.id, v.lines!);
    return p!;
  });
  await logActivity(req, {
    module: "KLINIK",
    estate: klinik,
    aksi: ajukan ? "Ajukan Permintaan Obat" : "Buat Permintaan Obat",
    objek: `${made.nomor} · ${v.lines!.length} item`,
    detail: v.lines!.slice(0, 60).map((l) => `${l.nama} ${fmtQty(l.jumlah)} ${l.satuan}`).join("; "),
  });
  res.json({ success: true, id: made.id, nomor: made.nomor });
});

// Edit a draft (or send it with ajukan); a request already sent only takes its fulfilment.
app.put("/api/klinik-permintaan/:id", async (req, res) => {
  const p = await queryOne<any>("SELECT * FROM klinik_permintaan WHERE id = @id", { id: Number(req.params.id) || 0 });
  if (!p) return res.status(404).json({ error: "Permintaan tidak ditemukan" });
  if (!checkKlinik(req, res, p.klinik)) return;
  if (p.status !== "DRAFT") return res.status(400).json({ error: "Permintaan sudah diajukan; yang bisa diubah hanya pemenuhannya" });
  const v = permintaanBody(req);
  if (v.error) return res.status(400).json({ error: v.error });
  const ajukan = req.body?.ajukan === true;
  await withTransaction(async (c) => {
    await execute(
      `UPDATE klinik_permintaan SET tanggal = @tanggal, periode = @periode, departemen = @departemen, catatan = @catatan, ttd = @ttd::jsonb,
         status = @status, diajukan_at = ${ajukan ? "now()" : "NULL"}, approval = '{}'::jsonb${ajukan ? ", tolak = NULL" : ""}, updated_at = now() WHERE id = @id`,
      { ...v.head, status: ajukan ? "DIAJUKAN" : "DRAFT", id: p.id },
      c
    );
    await savePermintaanLines(c, p.id, v.lines!);
  });
  await logActivity(req, {
    module: "KLINIK",
    estate: p.klinik,
    aksi: ajukan ? "Ajukan Permintaan Obat" : "Ubah Permintaan Obat",
    objek: `${p.nomor} · ${v.lines!.length} item`,
    detail: v.lines!.slice(0, 60).map((l) => `${l.nama} ${fmtQty(l.jumlah)} ${l.satuan}`).join("; "),
  });
  res.json({ success: true });
});

// Fulfilment of a sent request, per item: status approval, how much came and when. The status (and its alasan) is
// set with Approve Permintaan Obat or by a Diketahui / Disetujui signer, already while it is being signed;
// Sebagian / Ditolak need an alasan. Dipenuhi / tanggal with Input Klinik, once all four boxes are signed.
app.put("/api/klinik-permintaan/:id/pemenuhan", async (req, res) => {
  const p = await queryOne<any>("SELECT * FROM klinik_permintaan WHERE id = @id", { id: Number(req.params.id) || 0 });
  if (!p) return res.status(404).json({ error: "Permintaan tidak ditemukan" });
  if (!checkKlinik(req, res, p.klinik)) return;
  if (p.status === "DRAFT") return res.status(400).json({ error: "Ajukan permintaan dulu sebelum mencatat pemenuhan" });
  const items = (Array.isArray(req.body?.lines) ? req.body.lines : []).slice(0, 500);
  const u = req.user!;
  const bolehApprove = u.role === "superuser" || ["klinik.permintaan_approve", ...TTD_ITEM_PERMS].some((x) => u.perms.includes(x));
  const bolehInput = u.role === "superuser" || u.perms.includes("klinik.input");
  const done: string[] = [];
  try {
    await withTransaction(async (c) => {
      for (const it of items) {
        const l = await queryOne<any>("SELECT * FROM klinik_permintaan_line WHERE id = @id AND permintaan_id = @pid", { id: Number(it?.id) || 0, pid: p.id }, c);
        if (!l) continue;
        const status = PERMINTAAN_STATUS_LINE.includes(it?.status) ? it.status : l.status;
        // The alasan belongs to Sebagian / Ditolak only.
        const alasan = status === "SEBAGIAN" || status === "DITOLAK" ? String(it?.alasan ?? l.alasan ?? "").trim().slice(0, 300) : "";
        // The approved amount follows the status: all of it, none, or (Sebagian) what was typed.
        const disetujuiIn = it?.disetujui === "" || it?.disetujui === null || it?.disetujui === undefined ? l.disetujui : Number(it.disetujui);
        const disetujui = status === "APPROVED" ? l.jumlah : status === "DITOLAK" ? 0 : status === "SEBAGIAN" ? disetujuiIn : null;
        const dipenuhi = it?.dipenuhi === undefined ? l.dipenuhi : it.dipenuhi === "" || it.dipenuhi === null ? null : Number(it.dipenuhi);
        if (dipenuhi !== null && (!Number.isFinite(dipenuhi) || dipenuhi < 0)) throw new Error(`${l.nama}: jumlah dipenuhi tidak valid`);
        const tgl = it?.tanggal_pemenuhan === undefined ? l.tanggal_pemenuhan : it.tanggal_pemenuhan ? String(it.tanggal_pemenuhan) : null;
        if (tgl && !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) throw new Error(`${l.nama}: tanggal pemenuhan tidak valid`);
        const approvalBerubah = status !== l.status || alasan !== (l.alasan ?? "") || disetujui !== l.disetujui;
        const pemenuhanBerubah = dipenuhi !== l.dipenuhi || tgl !== l.tanggal_pemenuhan;
        if (!approvalBerubah && !pemenuhanBerubah) continue;
        if (approvalBerubah && !bolehApprove)
          throw new AksesError(`${l.nama}: status approval hanya bisa diubah akun dengan hak Approve Permintaan Obat atau penanda tangan Diketahui / Disetujui`);
        if (approvalBerubah && p.status === "DISETUJUI") throw new Error(`${l.nama}: permintaan sudah disetujui lengkap (final); approval item tidak bisa diubah lagi`);
        if (approvalBerubah && (l.approval_level ?? 0) > itemRank(u))
          throw new AksesError(
            `${l.nama}: sudah diputuskan ${l.approval_oleh ?? ""} (${ITEM_RANK_LABEL[l.approval_level]}); hanya level yang sama atau lebih tinggi yang bisa mengubahnya`
          );
        if (pemenuhanBerubah && p.status !== "DISETUJUI")
          throw new Error(`${l.nama}: jumlah / tanggal pemenuhan diisi setelah keempat kotak ditandatangani (belum: ${TTD_LEVELS.filter((k) => !p.approval?.[k]).map((k) => TTD_LEVEL_LABEL[k]).join(", ")})`);
        if (pemenuhanBerubah && !bolehInput) throw new AksesError(`${l.nama}: jumlah / tanggal pemenuhan hanya bisa diisi akun dengan hak Input Klinik`);
        if (approvalBerubah && status === "SEBAGIAN" && (disetujui === null || !Number.isFinite(disetujui) || disetujui <= 0 || disetujui >= l.jumlah))
          throw new Error(`${l.nama}: isi jumlah yang disetujui (lebih dari 0 dan kurang dari ${fmtQty(l.jumlah)} ${l.satuan})`);
        if (approvalBerubah && (status === "SEBAGIAN" || status === "DITOLAK") && alasan.length < 3)
          throw new Error(`${l.nama}: isi alasan ${status === "DITOLAK" ? "penolakan" : "kenapa hanya disetujui sebagian"}`);
        await execute(
          `UPDATE klinik_permintaan_line SET status = @status, alasan = @alasan, disetujui = @disetujui, dipenuhi = @dipenuhi, tanggal_pemenuhan = @tgl
             ${approvalBerubah ? ", approval_oleh = @oleh, approval_at = now(), approval_level = @rank" : ""} WHERE id = @id`,
          { status, alasan, disetujui, dipenuhi, tgl, oleh: u.nama, rank: itemRank(u), id: l.id },
          c
        );
        done.push(
          `${l.nama}: ${status}${approvalBerubah && disetujui !== null ? ` disetujui ${fmtQty(disetujui)} dari ${fmtQty(l.jumlah)} ${l.satuan}` : ""}${approvalBerubah ? ` [${ITEM_RANK_LABEL[itemRank(u)]}]` : ""}${alasan ? ` (alasan: ${alasan})` : ""}${dipenuhi !== null ? ` ${fmtQty(dipenuhi)} ${l.satuan}` : ""}${tgl ? ` (${tgl.split("-").reverse().join("/")})` : ""}`
        );
      }
    });
  } catch (e: any) {
    return res.status(e instanceof AksesError ? 403 : 400).json({ error: e?.message ?? "Gagal menyimpan" });
  }
  if (done.length) await logActivity(req, { module: "KLINIK", estate: p.klinik, aksi: "Pemenuhan Permintaan Obat", objek: `${p.nomor} · ${done.length} item`, detail: done.slice(0, 60).join("; ") });
  res.json({ success: true, saved: done.length });
});

// ---- Tanda tangan Permintaan Obat: the four boxes of the form, signed in any order (see schema.sql approval) ----
const TTD_LEVELS = ["dibuat", "diketahui", "disetujui1", "disetujui2"] as const;
const TTD_LEVEL_LABEL: Record<string, string> = { dibuat: "Dibuat oleh", diketahui: "Diketahui", disetujui1: "Disetujui 1", disetujui2: "Disetujui 2" };
const ttdBerikut = (approval: any) => TTD_LEVELS.find((k) => !approval?.[k]) ?? null;
const bolehTtd = (u: SessionUser, level: string) => u.role === "superuser" || u.perms.includes(`klinik.ttd_${level}`);

// Sign (SETUJU) or refuse (TOLAK, with alasan) a box (body.level, else the first unsigned one the account may sign),
// in any order. One account signs one box of a request (a Super User may sign any). The fourth signature makes it
// DISETUJUI; a refusal sends it back to the klinik as a draft.
app.post("/api/klinik-permintaan/:id/ttd", async (req, res) => {
  const u = req.user!;
  const p = await queryOne<any>("SELECT * FROM klinik_permintaan WHERE id = @id", { id: Number(req.params.id) || 0 });
  if (!p) return res.status(404).json({ error: "Permintaan tidak ditemukan" });
  if (!checkKlinik(req, res, p.klinik)) return;
  if (p.status !== "DIAJUKAN") return res.status(400).json({ error: p.status === "DRAFT" ? "Permintaan belum diajukan" : "Permintaan sudah ditandatangani lengkap" });
  const level = req.body?.level ? String(req.body.level) : TTD_LEVELS.find((k) => !p.approval?.[k] && bolehTtd(u, k));
  if (!level || !(TTD_LEVELS as readonly string[]).includes(level)) return res.status(403).json({ error: "Tidak ada kotak yang bisa ditandatangani akun ini" });
  if (p.approval?.[level]) return res.status(409).json({ error: `Kotak ${TTD_LEVEL_LABEL[level]} sudah ditandatangani ${p.approval[level].nama}` });
  if (!bolehTtd(u, level)) return res.status(403).json({ error: `Akun ini tidak punya hak Tanda tangan Permintaan Obat (${TTD_LEVEL_LABEL[level]})` });
  if (u.role !== "superuser" && TTD_LEVELS.some((k) => p.approval?.[k]?.user_id === u.id))
    return res.status(403).json({ error: "Akun ini sudah menandatangani permintaan ini di kotak lain; satu orang satu tanda tangan" });
  const jabatan = String(p.ttd?.[level]?.jabatan ?? "");
  if (req.body?.aksi === "TOLAK") {
    const alasan = String(req.body?.alasan ?? "").trim().slice(0, 500);
    if (alasan.length < 3) return res.status(400).json({ error: "Isi alasan penolakan" });
    const tolak = { level, nama: u.nama, jabatan, alasan, at: new Date().toISOString() };
    await execute("UPDATE klinik_permintaan SET status = 'DRAFT', diajukan_at = NULL, approval = '{}'::jsonb, tolak = @tolak::jsonb, updated_at = now() WHERE id = @id", {
      tolak: JSON.stringify(tolak),
      id: p.id,
    });
    await logActivity(req, { module: "KLINIK", estate: p.klinik, aksi: "Tolak Permintaan Obat", objek: p.nomor, detail: `${TTD_LEVEL_LABEL[level]} · alasan: ${alasan}` });
    return res.json({ success: true, status: "DRAFT" });
  }
  const approval = { ...(p.approval ?? {}), [level]: { nama: u.nama, jabatan, user_id: u.id, at: new Date().toISOString() } };
  const lengkap = !ttdBerikut(approval);
  const otomatis = await withTransaction(async (c) => {
    await execute(
      "UPDATE klinik_permintaan SET approval = @approval::jsonb, status = @status, updated_at = now() WHERE id = @id",
      { approval: JSON.stringify(approval), status: lengkap ? "DISETUJUI" : "DIAJUKAN", id: p.id },
      c
    );
    // The fourth signature closes it: an item nobody decided is approved in full by that signer.
    if (!lengkap) return [] as { nama: string }[];
    return queryMany<{ nama: string }>(
      `UPDATE klinik_permintaan_line SET status = 'APPROVED', disetujui = jumlah, alasan = '', approval_oleh = @oleh, approval_at = now(), approval_level = @rank
        WHERE permintaan_id = @id AND status = 'MENUNGGU' RETURNING nama`,
      { oleh: u.nama, rank: itemRank(u), id: p.id },
      c
    );
  });
  await logActivity(req, {
    module: "KLINIK",
    estate: p.klinik,
    aksi: "Tanda Tangan Permintaan Obat",
    objek: p.nomor,
    detail: `${TTD_LEVEL_LABEL[level]}${jabatan ? ` (${jabatan})` : ""}${lengkap ? ` · lengkap, final${otomatis.length ? ` · ${otomatis.length} item yang masih menunggu otomatis Approved` : ""}` : ` · belum: ${TTD_LEVELS.filter((k) => !approval[k]).map((k) => TTD_LEVEL_LABEL[k]).join(", ")}`}`,
  });
  res.json({ success: true, status: lengkap ? "DISETUJUI" : "DIAJUKAN" });
});

app.delete("/api/klinik-permintaan/:id", async (req, res) => {
  const p = await queryOne<any>("SELECT * FROM klinik_permintaan WHERE id = @id", { id: Number(req.params.id) || 0 });
  if (!p) return res.status(404).json({ error: "Permintaan tidak ditemukan" });
  if (!checkKlinik(req, res, p.klinik)) return;
  if (p.status !== "DRAFT" && req.user!.role !== "superuser") return res.status(400).json({ error: "Permintaan yang sudah diajukan hanya bisa dihapus Super User" });
  await execute("DELETE FROM klinik_permintaan WHERE id = @id", { id: p.id });
  await logActivity(req, { module: "KLINIK", estate: p.klinik, aksi: "Hapus Permintaan Obat", objek: p.nomor, detail: `Status ${p.status}` });
  res.json({ success: true });
});

// Rekap Permintaan: every requested item of the account's kliniks (or one), as the request spreadsheet.
app.get("/api/klinik-permintaan-rekap", async (req, res) => {
  const klinik = String(req.query.klinik ?? "");
  const kliniks = KLINIK_OPTIONS.filter((k) => (!klinik || k === klinik) && estateAllowed(req.user!, k));
  const where = ["p.klinik = ANY(@kliniks)", "p.status <> 'DRAFT'"];
  const params: Record<string, any> = { kliniks };
  if (/^\d{4}(-\d{2})?$/.test(String(req.query.periode ?? ""))) {
    where.push("p.tanggal LIKE @periode");
    params.periode = `${req.query.periode}%`;
  }
  if (PERMINTAAN_STATUS_LINE.includes(String(req.query.status))) {
    where.push("l.status = @status");
    params.status = req.query.status;
  }
  const rows = await queryMany(
    `SELECT l.id, p.id permintaan_id, p.nomor, p.tanggal, p.klinik, l.nama, l.satuan, l.jumlah, l.urgensi, l.status, l.alasan, l.disetujui, l.dipenuhi, l.tanggal_pemenuhan, l.keterangan, l.stok_text
     FROM klinik_permintaan_line l JOIN klinik_permintaan p ON p.id = l.permintaan_id
     WHERE ${where.join(" AND ")} ORDER BY p.tanggal DESC, p.id DESC, l.urut`,
    params
  );
  res.json({ rows });
});

app.get("/api/klinik-stock/summary", async (req, res) => {
  const { klinik = "" } = req.query as Record<string, string>;
  if (!checkKlinik(req, res, klinik)) return;
  const row = await queryOne<any>(
    `SELECT COUNT(*)::int "totalItems", COALESCE(SUM(stock_tersedia), 0)::int "totalStock",
       COUNT(*) FILTER (WHERE stock_tersedia <= buffer_stock AND buffer_stock > 0)::int "lowStock",
       COUNT(*) FILTER (WHERE stock_tersedia <= 0)::int "outOfStock",
       COUNT(*) FILTER (WHERE ${EXPIRING_SQL})::int "expiring"
     FROM klinik_stock ks WHERE klinik = @klinik`,
    { klinik }
  );
  res.json(row);
});

app.get("/api/klinik-stock", async (req, res) => {
  const { klinik = "", search = "", kategori = "", status = "", stock = "", sortBy = "kode", sortDir = "asc", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;
  if (!checkKlinik(req, res, klinik)) return;

  const sortCols: Record<string, string> = {
    kode: "o.kode",
    nama: "o.nama",
    kategori: "o.kategori",
    jenis: "o.jenis",
    stock_tersedia: "ks.stock_tersedia",
    buffer_stock: "ks.buffer_stock",
    expired_date: "NULLIF(ks.expired_date, '')",
  };
  const sortCol = sortCols[sortBy] ?? "o.kode";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  const conditions = ["ks.klinik = @klinik"];
  const params: any = { klinik };
  addWordSearch(search, "o.", conditions, params, OBAT_SEARCH);
  if (kategori) {
    conditions.push("o.kategori = @kategori");
    params.kategori = kategori;
  }
  if (status === "AMAN") conditions.push("ks.stock_tersedia > 0");
  else if (status === "BUFFER STOCK") conditions.push("ks.stock_tersedia <= 0");
  if (stock === "menipis") conditions.push("ks.stock_tersedia <= ks.buffer_stock AND ks.buffer_stock > 0");
  if (stock === "habis") conditions.push("ks.stock_tersedia <= 0");
  if (stock === "tersedia") conditions.push("ks.stock_tersedia > 0");
  if (stock === "expired") conditions.push(EXPIRING_SQL);

  const joinSql = `FROM klinik_stock ks JOIN obat o ON o.kode = ks.obat_kode WHERE ${conditions.join(" AND ")}`;
  const total = (await queryOne<any>(`SELECT COUNT(*) c ${joinSql}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT ks.id, o.id obat_id, o.kode, o.nama, o.kategori, o.jenis, o.deskripsi, o.satuan, o.kemasan, o.isi_kemasan, ks.buffer_stock, ks.stock_tersedia,
            ks.expired_date, ks.catatan,
            CASE WHEN ks.stock_tersedia > 0 THEN 'AMAN' ELSE 'BUFFER STOCK' END AS keterangan,
            COALESCE((SELECT json_agg(json_build_object('id', b.id, 'expired_date', b.expired_date, 'qty', b.qty)
                                      ORDER BY b.expired_date = '', b.expired_date)
                      FROM klinik_batch b WHERE b.klinik = ks.klinik AND b.obat_kode = ks.obat_kode AND b.qty > 0), '[]') AS batches
     ${joinSql} ORDER BY ${sortCol} ${dir} NULLS LAST, o.kode LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  const kategoriOptions = (await queryMany<{ v: string }>("SELECT DISTINCT kategori v FROM obat WHERE kategori <> '' ORDER BY 1")).map((r) => r.v);
  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit, kategoriOptions });
});

// Picker list for the transaction form: every obat with its stock in this clinic (0 if not held yet).
app.get("/api/klinik-stock/pick", async (req, res) => {
  const { klinik = "", search = "", page = "1", pageSize = "50" } = req.query as Record<string, string>;
  if (!checkKlinik(req, res, klinik)) return;
  const conditions: string[] = [];
  const params: any = { klinik };
  addWordSearch(search, "o.", conditions, params, OBAT_SEARCH);
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const joinSql = `FROM obat o LEFT JOIN klinik_stock ks ON ks.obat_kode = o.kode AND ks.klinik = @klinik ${where}`;
  const total = (await queryOne<any>(`SELECT COUNT(*) c ${joinSql}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT o.id, o.kode, o.nama, o.satuan, o.kemasan, o.isi_kemasan, COALESCE(ks.buffer_stock, 0) buffer_stock, COALESCE(ks.stock_tersedia, 0) stock_tersedia,
            CASE WHEN COALESCE(ks.stock_tersedia, 0) > 0 THEN 'AMAN' ELSE 'BUFFER STOCK' END AS keterangan
     ${joinSql} ORDER BY (COALESCE(ks.stock_tersedia, 0) > 0) DESC, o.kode LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit });
});

// Stock In: `expired_date` = the batch ('' / absent = no expiry). Stock Out: `expired_date` picks a
// batch, absent = FEFO; tujuan "DIBUANG" = expired obat thrown away.
app.post("/api/klinik-stock/transactions", async (req, res) => {
  const { klinik, obat_kode, type, qty, tujuan, penerima, note, expired_date } = req.body;
  if (!checkKlinik(req, res, klinik)) return;
  if (!["IN", "OUT"].includes(type) || !Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Invalid payload" });
  if (expired_date && !ISO_DATE.test(expired_date)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
  const obat = await queryOne<any>("SELECT kode, nama FROM obat WHERE kode = @obat_kode", { obat_kode });
  if (!obat) return res.status(404).json({ error: "Obat tidak ditemukan di master data" });

  if (tujuan === TUJUAN_DIBUANG) return res.status(400).json({ error: "Obat expired / rusak dikeluarkan lewat tab Expired & Rusak (Tarik), supaya diperiksa orang kedua" });
  const exp = type === "IN" ? expired_date || "" : typeof expired_date === "string" ? expired_date : undefined;
  const evidenceId = await claimEvidence(req, res);
  if (evidenceId === undefined) return;
  const err = await recordKlinikMove(req, {
    klinik,
    obat: obat_kode,
    type,
    qty,
    exp,
    tujuan: type === "OUT" && tujuan === TUJUAN_DIBUANG ? TUJUAN_DIBUANG : "",
    penerima: penerima || "",
    note: note || null,
    is_correction: 0,
    evidenceId,
  });
  if (err) {
    await releaseEvidence(evidenceId);
    return res.status(400).json({ error: err });
  }

  await logActivity(req, {
    module: "KLINIK",
    estate: klinik,
    aksi: type === "IN" ? "Stok Masuk" : tujuan === TUJUAN_DIBUANG ? "Buang Obat Expired" : "Stok Keluar",
    objek: `${obat.kode} - ${obat.nama}`,
    detail: [movementDetail(qty, undefined, penerima, note), exp !== undefined && `Batch expired: ${expText(exp)}`].filter(Boolean).join("; "),
  });
  res.json({ success: true });
});

// Batches of one obat in one clinic (for the transaction form).
app.get("/api/klinik-stock/batches", async (req, res) => {
  const { klinik = "", obat_kode = "" } = req.query as Record<string, string>;
  if (!checkKlinik(req, res, klinik)) return;
  const rows = await queryMany(
    `SELECT id, expired_date, qty FROM klinik_batch WHERE klinik = @klinik AND obat_kode = @obat_kode AND qty > 0
     ORDER BY expired_date = '', expired_date`,
    { klinik, obat_kode }
  );
  res.json(rows);
});

// ---- Obat / BHP expired, rusak or retur (Klinik): pulled out of its batch with a photo (quarantined:
// it can't go to a patient any more), then checked by a second account with Approve Klinik - Setujui
// (goes on the Berita Acara Pemusnahan) or Tolak (the stock goes back to its batch). ----
const KLINIK_TARIK_ALASAN: Record<string, string> = { EXPIRED: "Expired", RUSAK: "Rusak", RETUR: "Retur ke supplier" };

// Batches past their expiry date that still hold stock: to be pulled.
app.get("/api/klinik-stock/expired", async (req, res) => {
  const klinik = String(req.query.klinik ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  const rows = await queryMany(
    `SELECT b.obat_kode AS kode, o.nama, o.satuan, b.expired_date, b.qty
       FROM klinik_batch b JOIN obat o ON o.kode = b.obat_kode
      WHERE b.klinik = @klinik AND b.qty > 0 AND b.expired_date <> '' AND b.expired_date < @today
      ORDER BY b.expired_date, o.nama`,
    { klinik, today: jakartaToday() }
  );
  res.json(rows);
});

// What was pulled out (and the obat thrown away before this check), newest first; periode = 'YYYY-MM'.
app.get("/api/klinik-stock/tarik", async (req, res) => {
  const { klinik = "", status = "", periode = "" } = req.query as Record<string, string>;
  if (!checkKlinik(req, res, klinik)) return;
  const cond = ["t.klinik = @klinik", "t.type = 'OUT'", "t.tujuan = 'DIBUANG'"];
  if (["MENUNGGU", "DITOLAK"].includes(status)) cond.push("t.status = @status");
  if (status === "DISETUJUI") cond.push("COALESCE(t.status, 'DISETUJUI') = 'DISETUJUI'");
  if (/^\d{4}-\d{2}$/.test(periode)) cond.push("to_char(t.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') = @periode");
  const rows = await queryMany(
    `SELECT t.id, t.created_at, t.obat_kode AS kode, o.nama, o.satuan, t.qty, t.alloc, t.note, t.alasan, t.status, t.evidence_id, t.user_id,
            COALESCE(u.nama, u.username, '') AS oleh, COALESCE(p.nama, p.username) AS diperiksa_nama, t.diperiksa_at, t.diperiksa_catatan
       FROM klinik_stock_tx t JOIN obat o ON o.kode = t.obat_kode
       LEFT JOIN users u ON u.id = t.user_id LEFT JOIN users p ON p.id = t.diperiksa_oleh
      WHERE ${cond.join(" AND ")} ORDER BY t.created_at DESC, t.id DESC LIMIT 500`,
    { klinik, status, periode }
  );
  res.json(rows);
});

app.post("/api/klinik-stock/tarik", async (req, res) => {
  const b = req.body ?? {};
  const klinik = String(b.klinik ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  const qty = Number(b.qty);
  const alasan = String(b.alasan ?? "");
  const note = String(b.note ?? "").trim();
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Jumlah harus bilangan bulat lebih dari 0" });
  if (!KLINIK_TARIK_ALASAN[alasan]) return res.status(400).json({ error: "Pilih alasannya: Expired, Rusak atau Retur" });
  if (!note) return res.status(400).json({ error: "Isi keterangannya" });
  const exp = typeof b.expired_date === "string" ? b.expired_date : undefined;
  if (exp === undefined) return res.status(400).json({ error: "Pilih batch-nya" });
  if (exp && !ISO_DATE.test(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
  const obat = await queryOne<any>("SELECT kode, nama, satuan FROM obat WHERE kode = @kode", { kode: String(b.obat_kode ?? "") });
  if (!obat) return res.status(404).json({ error: "Obat tidak ditemukan di master data" });
  // The photo (tanggal expired / kerusakan and the qty visible) is what the pemeriksa checks it against.
  const evidenceId = await claimEvidence(req, res);
  if (evidenceId === undefined) return;
  const err = await recordKlinikMove(req, {
    klinik,
    obat: obat.kode,
    type: "OUT",
    qty,
    exp,
    tujuan: TUJUAN_DIBUANG,
    penerima: "",
    note,
    is_correction: 0,
    evidenceId,
    alasan,
    status: "MENUNGGU",
  });
  if (err) {
    await releaseEvidence(evidenceId);
    return res.status(400).json({ error: err });
  }
  await logActivity(req, {
    module: "KLINIK",
    estate: klinik,
    aksi: `Tarik Obat ${KLINIK_TARIK_ALASAN[alasan]}`,
    objek: `${obat.kode} - ${obat.nama}`,
    detail: `${qty} ${obat.satuan} · batch ${expText(exp)} · ${note} · menunggu pemeriksaan`,
  });
  res.json({ success: true });
});

app.put("/api/klinik-stock/tarik/:id/periksa", async (req, res) => {
  const setuju = req.body?.setuju === true;
  const catatan = String(req.body?.catatan ?? "").trim();
  if (!setuju && !catatan) return res.status(400).json({ error: "Tulis alasan penolakannya" });
  let t: any;
  try {
    await withTransaction(async (client) => {
      t = await queryOne(
        "SELECT t.*, o.nama, o.satuan FROM klinik_stock_tx t JOIN obat o ON o.kode = t.obat_kode WHERE t.id = @id AND t.tujuan = 'DIBUANG' FOR UPDATE OF t",
        { id: req.params.id },
        client
      );
      if (!t) throw new StockError("Data tidak ditemukan");
      if (!estateAllowed(req.user!, t.klinik)) throw new StockError("Akses ditolak");
      if (t.status !== "MENUNGGU") throw new StockError("Sudah diperiksa");
      if (t.user_id === req.user!.id) throw new StockError("Yang memeriksa harus orang lain, bukan yang menginput");
      // Tolak: the stock goes back to the batches it was taken from.
      if (!setuju) {
        await klinikReverse(client, t);
        await syncKlinikStock(client, t.klinik, t.obat_kode);
      }
      await execute(
        "UPDATE klinik_stock_tx SET status = @status, diperiksa_oleh = @uid, diperiksa_at = now(), diperiksa_catatan = @catatan WHERE id = @id",
        { status: setuju ? "DISETUJUI" : "DITOLAK", uid: req.user!.id, catatan, id: t.id },
        client
      );
    });
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  await logActivity(req, {
    module: "KLINIK",
    estate: t.klinik,
    aksi: `${setuju ? "Setujui" : "Tolak"} Tarik Obat ${KLINIK_TARIK_ALASAN[t.alasan] ?? ""}`.trim(),
    objek: `${t.obat_kode} - ${t.nama}`,
    detail: `${t.qty} ${t.satuan}${setuju ? "" : " · stok kembali ke batch-nya"}${catatan ? ` · ${catatan}` : ""}`,
  });
  res.json({ success: true });
});

// Fix a batch's expiry date (typo); a batch that ends up on an existing date is merged into it.
app.put("/api/klinik-stock/batch/:id", requireSuperuser, async (req, res) => {
  const batch = await queryOne<any>("SELECT * FROM klinik_batch WHERE id = @id", { id: req.params.id });
  if (!batch) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, batch.klinik)) return res.status(403).json({ error: "Akses ditolak" });
  const exp = String(req.body.expired_date ?? "");
  if (exp && !ISO_DATE.test(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
  // `qty` (optional) moves only part of the batch to the other date ("Pisah batch": stock that turned
  // out to have several expiry dates); the total stays the same, so no stock transaction is booked.
  const qty = req.body.qty === undefined ? batch.qty : req.body.qty;
  if (!Number.isInteger(qty) || qty <= 0 || qty > batch.qty) return res.status(400).json({ error: `Jumlah dipisah harus 1 - ${batch.qty}` });
  if (exp === batch.expired_date) return res.json({ success: true });
  const split = qty < batch.qty;
  await withTransaction(async (client) => {
    if (split) await execute("UPDATE klinik_batch SET qty = qty - @qty WHERE id = @id", { id: batch.id, qty }, client);
    else await execute("DELETE FROM klinik_batch WHERE id = @id", { id: batch.id }, client);
    await addToBatch(client, batch.klinik, batch.obat_kode, exp, qty);
    await syncKlinikStock(client, batch.klinik, batch.obat_kode);
  });
  const obat = await queryOne<any>("SELECT nama FROM obat WHERE kode = @k", { k: batch.obat_kode });
  await logActivity(req, {
    module: "KLINIK",
    estate: batch.klinik,
    aksi: split ? "Pisah Batch" : "Edit Batch",
    objek: `${batch.obat_kode} - ${obat?.nama ?? ""}`,
    detail: split
      ? `${qty} dari batch ${expText(batch.expired_date)} (${batch.qty}) dipindah ke ${expText(exp)}`
      : `Expired: ${expText(batch.expired_date)} → ${expText(exp)}; Jumlah: ${batch.qty}`,
  });
  res.json({ success: true });
});

// Koreksi (stock opname) counts one batch: `expired_date` names it ('' = no expiry; a date that has
// no batch yet adds one).
app.post("/api/klinik-stock/correction", requireSuperuser, async (req, res) => {
  const { klinik, obat_kode, actual_qty, note } = req.body;
  const exp = String(req.body.expired_date ?? "");
  if (!checkKlinik(req, res, klinik)) return;
  if (!Number.isInteger(actual_qty) || actual_qty < 0) return res.status(400).json({ error: "Invalid payload" });
  if (!String(note ?? "").trim()) return res.status(400).json({ error: "Isi alasan koreksinya" });
  if (exp && !ISO_DATE.test(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
  const obat = await queryOne<any>("SELECT kode, nama FROM obat WHERE kode = @obat_kode", { obat_kode });
  if (!obat) return res.status(404).json({ error: "Obat tidak ditemukan di master data" });

  const before =
    (await queryOne<{ q: number }>("SELECT qty q FROM klinik_batch WHERE klinik = @klinik AND obat_kode = @obat_kode AND expired_date = @exp", {
      klinik,
      obat_kode,
      exp,
    }))?.q ?? 0;
  const delta = actual_qty - before;
  if (delta !== 0) {
    const err = await recordKlinikMove(req, {
      klinik,
      obat: obat_kode,
      type: delta > 0 ? "IN" : "OUT",
      qty: Math.abs(delta),
      exp,
      tujuan: "",
      penerima: "",
      note: `Koreksi Stok (Opname) batch ${expText(exp)}${note ? `: ${note}` : ""}`,
      is_correction: 1,
    });
    if (err) return res.status(400).json({ error: err });
  }
  await logActivity(req, {
    module: "KLINIK",
    estate: klinik,
    aksi: "Koreksi Stok",
    objek: `${obat.kode} - ${obat.nama}`,
    detail: `Batch ${expText(exp)}: ${before} → ${actual_qty} (selisih ${delta > 0 ? "+" : ""}${delta})${note ? `; Catatan: ${note}` : ""}`,
  });
  res.json({ success: true, delta });
});

// Buffer and note of one clinic stock row. The quantity only changes through Stock In/Out/Koreksi
// (so every change has a history row) and expiry dates live on the batches (PUT batch/:id).
app.put("/api/klinik-stock/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM klinik_stock WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.klinik)) return res.status(403).json({ error: "Akses ditolak" });
  const { buffer_stock, catatan } = req.body;
  const next = { buffer_stock: Number(buffer_stock) || 0, catatan: String(catatan ?? "").trim() };
  await execute("UPDATE klinik_stock SET buffer_stock = @buffer_stock, catatan = @catatan WHERE id = @id", {
    ...next,
    id: req.params.id,
  });
  const obat = await queryOne<any>("SELECT nama FROM obat WHERE kode = @k", { k: existing.obat_kode });
  await logActivity(req, {
    module: "KLINIK",
    estate: existing.klinik,
    aksi: "Edit Stok",
    objek: `${existing.obat_kode} - ${obat?.nama ?? ""}`,
    detail: describeChanges(existing, next, { buffer_stock: "Buffer", catatan: "Catatan" }),
  });
  res.json({ success: true });
});

// The whole expiry breakdown of one clinic stock row at once (Edit Stok Klinik): `batches` is the
// list the stock should be split into. The same total only rearranges the batches (a wrong or
// several expiry dates) and books nothing; a different total is a Koreksi, booked per expiry date.
app.put("/api/klinik-stock/:id/batches", requireSuperuser, async (req, res) => {
  const row = await queryOne<any>("SELECT * FROM klinik_stock WHERE id = @id", { id: req.params.id });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, row.klinik)) return res.status(403).json({ error: "Akses ditolak" });
  const list = Array.isArray(req.body.batches) ? req.body.batches : null;
  const note = String(req.body.note ?? "").trim();
  if (!list) return res.status(400).json({ error: "Invalid payload" });
  const want = new Map<string, number>();
  for (const b of list) {
    const exp = String(b?.expired_date ?? "");
    if (exp && !ISO_DATE.test(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
    if (!Number.isInteger(b?.qty) || b.qty < 0) return res.status(400).json({ error: "Jumlah harus bilangan bulat positif" });
    if (b.qty > 0) want.set(exp, (want.get(exp) ?? 0) + b.qty);
  }
  const have = new Map(
    (await queryMany<{ expired_date: string; qty: number }>("SELECT expired_date, qty FROM klinik_batch WHERE klinik = @k AND obat_kode = @o AND qty > 0", {
      k: row.klinik,
      o: row.obat_kode,
    })).map((b) => [b.expired_date, b.qty])
  );
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const text = (m: Map<string, number>) =>
    [...m].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map(([e, q]) => `${expText(e)}: ${q}`).join(", ") || "kosong";
  const before = sum(have);
  const after = sum(want);
  const obat = await queryOne<any>("SELECT nama FROM obat WHERE kode = @k", { k: row.obat_kode });
  const objek = `${row.obat_kode} - ${obat?.nama ?? ""}`;

  if (after === before) {
    if (text(have) === text(want)) return res.json({ success: true });
    await withTransaction(async (client) => {
      await execute("DELETE FROM klinik_batch WHERE klinik = @k AND obat_kode = @o", { k: row.klinik, o: row.obat_kode }, client);
      for (const [exp, qty] of want) await addToBatch(client, row.klinik, row.obat_kode, exp, qty);
      await syncKlinikStock(client, row.klinik, row.obat_kode);
    });
    await logActivity(req, { module: "KLINIK", estate: row.klinik, aksi: "Atur Batch", objek, detail: `${text(have)} → ${text(want)}` });
    return res.json({ success: true });
  }

  if (req.user!.role !== "superuser")
    return res.status(403).json({ error: `Total berubah (${before} → ${after}) dan itu Koreksi Stok, yang hanya bisa dilakukan Super User; selisih stok lewat Stok Opname` });
  if (!note) return res.status(400).json({ error: "Isi alasan koreksi" });
  const exps = [...new Set([...have.keys(), ...want.keys()])];
  try {
    await withTransaction(async (client) => {
      for (const exp of exps) {
        const delta = (want.get(exp) ?? 0) - (have.get(exp) ?? 0);
        if (!delta) continue;
        await klinikMoveTx(client, req, {
          klinik: row.klinik,
          obat: row.obat_kode,
          type: delta > 0 ? "IN" : "OUT",
          qty: Math.abs(delta),
          exp,
          tujuan: "",
          penerima: "",
          note: `Koreksi Stok (Opname) batch ${expText(exp)}: ${note}`,
          is_correction: 1,
        });
      }
    });
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  await logActivity(req, {
    module: "KLINIK",
    estate: row.klinik,
    aksi: "Koreksi Stok",
    objek,
    detail: `${text(have)} → ${text(want)} (total ${before} → ${after}); Catatan: ${note}`,
  });
  res.json({ success: true });
});

app.delete("/api/klinik-stock/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM klinik_stock WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.klinik)) return res.status(403).json({ error: "Akses ditolak" });
  await withTransaction(async (client) => {
    await execute("DELETE FROM klinik_batch WHERE klinik = @k AND obat_kode = @o", { k: existing.klinik, o: existing.obat_kode }, client);
    await execute("DELETE FROM klinik_stock WHERE id = @id", { id: req.params.id }, client);
  });
  const obat = await queryOne<any>("SELECT nama FROM obat WHERE kode = @k", { k: existing.obat_kode });
  await logActivity(req, {
    module: "KLINIK",
    estate: existing.klinik,
    aksi: "Hapus Item",
    objek: `${existing.obat_kode} - ${obat?.nama ?? ""}`,
    detail: `Stock Tersedia: ${existing.stock_tersedia}`,
  });
  res.json({ success: true });
});

// ---- Stock In / Stock Out history of a gudang (KNS/WJA/Zamrud/Firus) or klinik ----
// One set of handlers for both ledgers; `master` is the table holding the item names.
type LedgerRoute = { path: string; ledger: StockLedger; master: string; options: string[]; module: LogModule };
const LEDGER_ROUTES: LedgerRoute[] = [
  { path: "gudang-stock", ledger: GUDANG_LEDGER, master: "items", options: GUDANG_STOCK_OPTIONS, module: "BARANG" },
  { path: "klinik-stock", ledger: KLINIK_LEDGER, master: "obat", options: KLINIK_OPTIONS, module: "KLINIK" },
];

for (const lr of LEDGER_ROUTES) {
  const { ledger: l, master } = lr;

  app.get(`/api/${lr.path}/history`, async (req, res) => {
    const { scope = "", type = "", kode = "", search = "", dateFrom = "", dateTo = "", tz = "", page = "1", pageSize = "50" } = req.query as Record<string, string>;
    if (!lr.options.includes(scope)) return res.status(400).json({ error: "Lokasi tidak valid" });
    if (!estateAllowed(req.user!, scope)) return res.status(403).json({ error: "Akses ditolak" });
    // One item's Riwayat (kode) lists its Stock In and Out together, each with the saldo after it.
    if (!["IN", "OUT"].includes(type) && !(kode && type === "")) return res.status(400).json({ error: "Tipe tidak valid" });

    const conditions = [`t.${l.scope} = @scope`, ...(type ? ["t.type = @type"] : [])];
    const params: any = { scope, type, kode, tz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : "Asia/Jakarta" };
    if (kode) conditions.push(`t.${l.item} = @kode`);
    addWordSearch(search, "m.", conditions, params, [...(master === "obat" ? OBAT_SEARCH : ["satuan"]), "t.penerima", "t.tujuan", "t.note"]);
    if (dateFrom) {
      conditions.push("(t.created_at AT TIME ZONE @tz)::date >= @dateFrom::date");
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      conditions.push("(t.created_at AT TIME ZONE @tz)::date <= @dateTo::date");
      params.dateTo = dateTo;
    }
    // The stock right after each movement: the stock now minus every later movement of that item here
    // (so it matches the stock even when older history was imported without its movements).
    const saldoSql = `(SELECT s.stock_tersedia FROM ${l.stock} s WHERE s.${l.scope} = t.${l.scope} AND s.${l.item} = t.${l.item})
      - COALESCE((SELECT SUM(CASE WHEN y.type = 'IN' THEN y.qty ELSE -y.qty END) FROM ${l.tx} y
                  WHERE y.${l.scope} = t.${l.scope} AND y.${l.item} = t.${l.item} AND (y.created_at, y.id) > (t.created_at, t.id)), 0)`;
    const fromSql = `FROM ${l.tx} t JOIN ${master} m ON m.kode = t.${l.item} LEFT JOIN users u ON u.id = t.user_id WHERE ${conditions.join(" AND ")}`;
    const agg = (await queryOne<any>(
      `SELECT COUNT(*)::int c, COALESCE(SUM(t.qty), 0)::float8 q, COALESCE(SUM(t.qty) FILTER (WHERE t.type = 'IN'), 0)::float8 qin,
         COALESCE(SUM(t.qty) FILTER (WHERE t.type = 'OUT'), 0)::float8 qout ${fromSql}`,
      params
    ))!;
    const limit = Math.min(parseInt(pageSize) || 50, 500);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
    const data = await queryMany(
      `SELECT t.id, t.created_at, t.input_at, t.type, t.qty, t.tujuan, t.penerima, t.note, t.is_correction, t.evidence_id, t.pinjaman_id,
              ${l === GUDANG_LEDGER ? "t.transfer_from_id IS NOT NULL" : "false"} AS is_transfer,
              ${l === KLINIK_LEDGER ? "t.alloc" : "NULL"} AS alloc, ROUND((${saldoSql})::numeric, 3)::float8 AS saldo,
              m.kode, m.nama, m.satuan, COALESCE(u.nama, u.username, '') AS input_oleh
       ${fromSql} ORDER BY t.created_at DESC, t.id DESC LIMIT @limit OFFSET @offset`,
      { ...params, limit, offset }
    );
    res.json({ data, total: agg.c, qtySum: agg.q, inSum: agg.qin, outSum: agg.qout, page: parseInt(page), pageSize: limit });
  });

  // Edit a movement's qty/tujuan/penerima/note; the stock is adjusted by the qty difference.
  app.put(`/api/${lr.path}/history/:id`, requireSuperuser, async (req, res) => {
    const existing = await queryOne<any>(`SELECT * FROM ${l.tx} WHERE id = @id`, { id: req.params.id });
    if (!existing) return res.status(404).json({ error: "Not found" });
    // Only the estates the account has: a KNS admin can't change WJA's movements by id.
    if (!estateAllowed(req.user!, existing[l.scope])) return res.status(403).json({ error: "Akses ditolak" });
    if (editTooLate(req, res, l === KLINIK_LEDGER ? "klinik" : "gudang", existing)) return;
    if (existing.transfer_from_id) return res.status(400).json({ error: TRANSFER_LOCKED });
    const newEvidence = await checkEditEvidence(req, res, existing.evidence_id);
    if (newEvidence === undefined) return;
    const { qty, tujuan, penerima, note } = req.body;
    if (!validQty(l, qty) || qty <= 0) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
    // An older row keeps the tujuan it already had.
    if (l === GUDANG_LEDGER && tujuan && !GUDANG_TUJUAN[existing.gudang].includes(tujuan) && tujuan !== existing.tujuan) {
      return res.status(400).json({ error: `Gudang ${existing.gudang} hanya bisa menyuplai ${GUDANG_TUJUAN[existing.gudang].join(", ")}` });
    }

    if (l === KLINIK_LEDGER) {
      // Klinik: undo the old movement on its batches and apply the new qty (IN: its batch, or a new
      // expiry date; OUT: FEFO again; Koreksi: the same batch).
      const exp: string | undefined =
        existing.type === "IN" || existing.is_correction
          ? typeof req.body.expired_date === "string" && existing.type === "IN"
            ? req.body.expired_date
            : existing.alloc?.[0]?.exp ?? ""
          : undefined;
      if (exp && !ISO_DATE.test(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
      try {
        await withTransaction(async (client) => {
          await lockMovement(client, l.tx, existing);
          await klinikReverse(client, existing);
          const alloc = await klinikApply(client, existing.klinik, existing.obat_kode, existing.type, qty, exp);
          await execute(
            `UPDATE klinik_stock_tx SET qty = @qty, penerima = @penerima, note = @note, alloc = @alloc::jsonb WHERE id = @id`,
            { qty, penerima: penerima ?? "", note: note || null, alloc: JSON.stringify(alloc), id: existing.id },
            client
          );
          await syncKlinikStock(client, existing.klinik, existing.obat_kode);
        });
      } catch (e) {
        if (e instanceof StockError) return res.status(400).json({ error: e.message });
        throw e;
      }
    } else {
    const sign = existing.type === "IN" ? 1 : -1;
    const delta = round3(sign * (qty - existing.qty));
    try {
    await withTransaction(async (client) => {
      await lockMovement(client, l.tx, existing);
      await execute(`UPDATE ${l.tx} SET qty = @qty, tujuan = @tujuan, penerima = @penerima, note = @note WHERE id = @id`, {
        qty,
        tujuan: tujuan ?? "",
        penerima: penerima ?? "",
        note: note || null,
        id: existing.id,
      }, client);
      await execute(
        `UPDATE ${l.stock} SET stock_tersedia = ROUND((stock_tersedia + @delta)::numeric, 3) WHERE ${l.scope} = @scope AND ${l.item} = @item`,
        { delta, scope: existing[l.scope], item: existing[l.item] },
        client
      );
      await ledgerStockCheck(client, l, existing[l.scope], existing[l.item]);
    });
    } catch (e) {
      if (e instanceof StockError) return res.status(400).json({ error: e.message });
      throw e;
    }
    }
    const m = await queryOne<any>(`SELECT nama FROM ${master} WHERE kode = @k`, { k: existing[l.item] });
    await logActivity(req, {
      module: lr.module,
      estate: existing[l.scope],
      aksi: existing.type === "IN" ? "Edit Stok Masuk" : "Edit Stok Keluar",
      objek: `${existing[l.item]} - ${m?.nama ?? ""}`,
      detail: describeChanges(
        existing,
        { qty, tujuan: tujuan ?? "", penerima: penerima ?? "", note: note || null },
        { qty: "Jumlah", tujuan: "Tujuan", penerima: "Penerima", note: "Catatan" }
      ),
    });
    await useEditEvidence(newEvidence, [{ table: l.tx, where: "id = @id", params: { id: existing.id } }]);
    res.json({ success: true });
  });

  // Delete a movement and reverse its effect on the stock.
  app.delete(`/api/${lr.path}/history/:id`, requireSuperuser, async (req, res) => {
    const existing = await queryOne<any>(`SELECT * FROM ${l.tx} WHERE id = @id`, { id: req.params.id });
    if (!existing) return res.status(404).json({ error: "Not found" });
    // Only the estates the account has: a KNS admin can't change WJA's movements by id.
    if (!estateAllowed(req.user!, existing[l.scope])) return res.status(403).json({ error: "Akses ditolak" });
    if (editTooLate(req, res, l === KLINIK_LEDGER ? "klinik" : "gudang", existing)) return;
    if (existing.transfer_from_id) return res.status(400).json({ error: TRANSFER_LOCKED });
    const diBa = l === KLINIK_LEDGER && existing.tujuan === TUJUAN_DIBUANG ? await baAktifUntuk("KLINIK", existing.id) : null;
    if (diBa) return res.status(400).json({ error: `Obat ini ada di Berita Acara ${diBa}; batalkan BA-nya dulu` });
    try {
      await withTransaction(async (client) => {
        await lockMovement(client, l.tx, existing);
        if (l === KLINIK_LEDGER) await klinikReverse(client, existing);
        await execute(`DELETE FROM ${l.tx} WHERE id = @id`, { id: existing.id }, client);
        if (l === KLINIK_LEDGER) await syncKlinikStock(client, existing.klinik, existing.obat_kode);
        else
          await execute(
            `UPDATE ${l.stock} SET stock_tersedia = ROUND((stock_tersedia - @delta)::numeric, 3) WHERE ${l.scope} = @scope AND ${l.item} = @item`,
            { delta: existing.type === "IN" ? existing.qty : -existing.qty, scope: existing[l.scope], item: existing[l.item] },
            client
          );
        if (l !== KLINIK_LEDGER) await ledgerStockCheck(client, l, existing[l.scope], existing[l.item]);
      });
    } catch (e) {
      if (e instanceof StockError) return res.status(400).json({ error: e.message });
      throw e;
    }
    const m = await queryOne<any>(`SELECT nama FROM ${master} WHERE kode = @k`, { k: existing[l.item] });
    await logActivity(req, {
      module: lr.module,
      estate: existing[l.scope],
      aksi: existing.type === "IN" ? "Hapus Stok Masuk" : "Hapus Stok Keluar",
      objek: `${existing[l.item]} - ${m?.nama ?? ""}`,
      detail: `Jumlah: ${existing.qty}${existing.penerima ? `; Penerima: ${existing.penerima}` : ""}${existing.note ? `; Catatan: ${existing.note}` : ""}`,
    });
    res.json({ success: true });
  });
}

// ---- Log Aktivitas User (superuser): who acted / logged in over a period ----
// Built from activity_log (every add/edit/delete/transaction, all modules) and login_log. Every
// account is listed, so the ones without a single action in the period stand out.
// Accounts seen in the last 30 minutes (online = the last 5), newest first, with the page they were on.
app.get("/api/user-online", async (_req, res) => {
  const data = await queryMany(
    `SELECT id, username, nama, role, estates, last_seen_at, last_page, last_seen_at > now() - interval '5 minutes' AS online
       FROM users WHERE last_seen_at > now() - interval '30 minutes' ORDER BY last_seen_at DESC`
  );
  res.json(data);
});

app.get("/api/user-activity", requireSuperuser, async (req, res) => {
  const { dateFrom = "", dateTo = "", tz = "" } = req.query as Record<string, string>;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(dateFrom) || !iso.test(dateTo)) return res.status(400).json({ error: "Periode tidak valid" });
  const params = { dateFrom, dateTo, tz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : "Asia/Jakarta" };
  const day = (col: string) => `(${col} AT TIME ZONE @tz)::date`;
  const inRange = (col: string) => `${day(col)} BETWEEN @dateFrom::date AND @dateTo::date`;

  const users = await queryMany(
    `SELECT u.id, u.username, u.nama, u.role, u.estates, u.perms,
            (SELECT MAX(created_at) FROM login_log l WHERE l.user_id = u.id) AS last_login,
            (SELECT MAX(created_at) FROM activity_log a WHERE a.user_id = u.id) AS last_action
     FROM users u ORDER BY u.nama`
  );
  const perUser = await queryMany(
    `SELECT user_id, COUNT(*)::int aksi, COUNT(DISTINCT ${day("created_at")})::int hari_aktif,
            COUNT(*) FILTER (WHERE aksi = 'Stok Masuk')::int stok_masuk,
            COUNT(*) FILTER (WHERE aksi = 'Stok Keluar')::int stok_keluar,
            COUNT(*) FILTER (WHERE aksi = 'Koreksi Stok')::int koreksi,
            COUNT(*) FILTER (WHERE module = 'BARANG')::int m_gudang,
            COUNT(*) FILTER (WHERE module = 'BBM')::int m_bbm,
            COUNT(*) FILTER (WHERE module = 'PUPUK')::int m_pupuk,
            COUNT(*) FILTER (WHERE module = 'KLINIK')::int m_klinik,
            COUNT(*) FILTER (WHERE module = 'OLI')::int m_oli
     FROM activity_log WHERE user_id IS NOT NULL AND ${inRange("created_at")} GROUP BY user_id`,
    params
  );
  const logins = await queryMany(
    `SELECT user_id, COUNT(*)::int login FROM login_log WHERE ${inRange("created_at")} GROUP BY user_id`,
    params
  );
  const daily = await queryMany(
    `SELECT user_id, to_char(${day("created_at")}, 'YYYY-MM-DD') tanggal, COUNT(*)::int aksi
     FROM activity_log WHERE user_id IS NOT NULL AND ${inRange("created_at")} GROUP BY 1, 2 ORDER BY 2`,
    params
  );
  res.json({ users, perUser, logins, daily });
});

// ---- Activity log listing: separate logs per module, scoped to the caller's estate ----
app.get("/api/activity-log", async (req, res) => {
  const { module = "", estate = "", estates = "", aksi = "", search = "", dateFrom = "", dateTo = "", tz = "", page = "1", pageSize = "50" } =
    req.query as Record<string, string>;
  if (!["BARANG", "BBM", "PUPUK", "KLINIK", "OLI", "KOPERASI", "KENDARAAN", "PRUNING", "SOP"].includes(module)) return res.status(400).json({ error: "Modul tidak valid" });

  const conditions = ["module = @module"];
  const params: any = { module };

  // Estate accounts only ever see their own estates' log; anyone may narrow to one estate. The Daftar SOP
  // belongs to no estate: its whole log is seen by whoever may see the list.
  if (module === "SOP") {
    // (no estate condition)
  } else if (estate && estateAllowed(req.user!, estate)) {
    conditions.push("estate = @estate");
    params.estate = estate;
  } else if (req.user!.role !== "superuser" || estates) {
    // Own estates, or the dashboard's pick of them (a superuser keeps the rows of no estate: master data).
    conditions.push(`(estate = ANY(@estates::text[])${req.user!.role === "superuser" ? " OR estate IS NULL OR estate = ''" : ""})`);
    params.estates = listEstates(req.user!, "", estates);
  }
  if (aksi) {
    conditions.push("aksi = @aksi");
    params.aksi = aksi;
  }
  if (search) {
    conditions.push("(objek ILIKE @search OR detail ILIKE @search OR nama ILIKE @search OR username ILIKE @search)");
    params.search = `%${search}%`;
  }
  // Date filters are calendar days in the viewer's own time zone (sent by the browser as an IANA
  // name), so "today" means today where they are, not in UTC.
  params.tz = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : "Asia/Jakarta";
  if (dateFrom) {
    conditions.push("(created_at AT TIME ZONE @tz)::date >= @dateFrom::date");
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push("(created_at AT TIME ZONE @tz)::date <= @dateTo::date");
    params.dateTo = dateTo;
  }

  const where = "WHERE " + conditions.join(" AND ");
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM activity_log ${where}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  const aksiOptions = (
    await queryMany<{ aksi: string }>("SELECT DISTINCT aksi FROM activity_log WHERE module = @module ORDER BY aksi", { module })
  ).map((r) => r.aksi);

  res.json({ data, total: Number(total), page: parseInt(page), pageSize: limit, aksiOptions });
});

// Superusers may correct or remove a log entry's text. This only touches the log itself - the
// stock data the entry describes is left as is.
app.put("/api/activity-log/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne("SELECT id FROM activity_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { aksi, objek, detail } = req.body;
  if (!String(aksi ?? "").trim()) return res.status(400).json({ error: "Aksi tidak boleh kosong" });

  await execute("UPDATE activity_log SET aksi = @aksi, objek = @objek, detail = @detail WHERE id = @id", {
    id: req.params.id,
    aksi: String(aksi).trim(),
    objek: String(objek ?? "").trim(),
    detail: String(detail ?? "").trim(),
  });
  res.json({ success: true });
});

app.delete("/api/activity-log/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne("SELECT id FROM activity_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await execute("DELETE FROM activity_log WHERE id = @id", { id: req.params.id });
  res.json({ success: true });
});

app.get("/api/bbm", async (req, res) => {
  const {
    search = "",
    jenis_bbm = "",
    lokasi = "",
    kode_kendaraan = "",
    dateFrom = "",
    dateTo = "",
    sortBy = "tanggal_iso",
    sortDir = "desc",
    page = "1",
    pageSize = "50",
  } = req.query as Record<string, string>;

  // Estate users must pass their own lokasi (the frontend always does); a superuser can omit it.
  if (req.user!.role !== "superuser" && (!lokasi || !estateAllowed(req.user!, lokasi))) {
    return res.status(403).json({ error: "Akses ditolak" });
  }

  const validSort = ["tanggal_iso", "lokasi", "jenis_bbm", "pemakaian", "diterima", "saldo_stock"];
  const sortCol = validSort.includes(sortBy) ? sortBy : "tanggal_iso";
  const dir = sortDir === "asc" ? "ASC" : "DESC";

  const conditions: string[] = [];
  const params: any = {};

  wordSearch(search, ["jenis_bbm", "estate", "no_spb", "kode_kendaraan", "keterangan"], conditions, params);
  if (jenis_bbm && BBM_JENIS.includes(jenis_bbm)) {
    conditions.push("jenis_bbm = @jenis_bbm");
    params.jenis_bbm = jenis_bbm;
  }
  if (lokasi && BBM_LOKASI_OPTIONS.includes(lokasi)) {
    conditions.push("lokasi = @lokasi");
    params.lokasi = lokasi;
  }
  if (kode_kendaraan) {
    conditions.push("kode_kendaraan = @kode_kendaraan");
    params.kode_kendaraan = kode_kendaraan;
  }
  if (dateFrom) {
    conditions.push("tanggal_iso >= @dateFrom");
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push("tanggal_iso <= @dateTo");
    params.dateTo = dateTo;
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const total = (await queryOne<any>(`SELECT COUNT(*) c FROM bbm_log ${where}`, params))!.c;
  const pemakaianSum = (await queryOne<any>(`SELECT SUM(pemakaian) s FROM bbm_log ${where}`, params))!.s || 0;
  const diterimaSum = (await queryOne<any>(`SELECT SUM(diterima) s FROM bbm_log ${where}`, params))!.s || 0;

  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  // total_hm = this reading minus the same vehicle's previous HM/KM reading (hours/km worked since its
  // last refuel). Computed over the whole table before filtering, so the previous reading is found
  // even when it falls outside the current page/filter. hm_terakhir is free text like "4373.7 h".
  const data = await queryMany(
    `SELECT b.*, (SELECT p.jenis FROM pinjaman p WHERE p.id = b.pinjaman_id) AS pinjaman_jenis, CASE WHEN h.cur >= h.prev THEN (h.cur - h.prev)::float8 END AS total_hm
     FROM bbm_log b
     LEFT JOIN (
       SELECT id, cur, LAG(cur) OVER (PARTITION BY kode_kendaraan ORDER BY tanggal_iso, id) AS prev
       FROM (
         SELECT id, kode_kendaraan, tanggal_iso, substring(hm_terakhir from '(\\d+(?:\\.\\d+)?)')::numeric AS cur
         FROM bbm_log
         WHERE kode_kendaraan <> '' AND hm_terakhir ~ '\\d'
       ) x
     ) h ON h.id = b.id
     ${where} ORDER BY b.${sortCol} ${dir} NULLS LAST, b.id ${dir} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );

  res.json({
    data,
    total: Number(total),
    pemakaianSum: Number(pemakaianSum),
    diterimaSum: Number(diterimaSum),
    page: parseInt(page),
    pageSize: limit,
  });
});

// ---- Stok Opname (see schema.sql opname / opname_line and the lock middleware near the top) ----
// Flow: create (snapshot of the system stock) -> count (stok_fisik per line, DRAFT) -> submit ->
// approve (one Koreksi per line whose count differs) or send back to DRAFT; DRAFT/SUBMITTED can be
// cancelled. Every module uses the same five estates.
const OPNAME_MODULES: OpnameModule[] = ["GUDANG", "KLINIK", "BBM", "PUPUK", "OLI"];
const OPNAME_LOG_MODULE: Record<OpnameModule, LogModule> = { GUDANG: "BARANG", KLINIK: "KLINIK", BBM: "BBM", PUPUK: "PUPUK", OLI: "OLI" };
// Bensin Campur: bensin mixed with 2T oil (bought as such at WJA), its own ledger; shown only where it is used.
const BBM_JENIS = ["SOLAR", "BENSIN", "BENSIN_CAMPUR"];
// Nilam items, klinik batches and BBM saldo (INTEGER) are whole numbers; other gudang and pupuk take decimals.
const opnameWhole = (o: { module: string; estate: string }) => o.module === "KLINIK" || o.module === "BBM" || (o.module === "GUDANG" && o.estate === "NILAM");

type OpnameAction = "view" | "opname" | "approve";
// view = the module's Lihat, Opname or Approve permission; the others need that exact permission.
function opnameCan(user: SessionUser, module: string, action: OpnameAction) {
  if (user.role === "superuser") return true;
  const m = module.toLowerCase();
  return (action === "view" ? ["view", "opname", "approve"] : [action]).some((a) => user.perms.includes(`${m}.${a}`));
}

type OpnameRow = { id: number; module: OpnameModule; estate: string; status: string; tanggal: string; submitted_by: number | null; [k: string]: any };
type OpnameLine = {
  id?: number;
  kode: string;
  nama: string;
  satuan: string;
  exp: string;
  // Klinik: expiry found on the batch when it differs from `exp` (see schema.sql opname_line).
  exp_fisik?: string | null;
  stok_sistem: number;
  stok_fisik?: number | null;
  keterangan?: string;
};
// The batch a klinik line ends up in once approved, and how the log names it.
const lineExp = (l: OpnameLine) => l.exp_fisik ?? l.exp;
const batchText = (l: OpnameLine) => (l.exp_fisik != null && l.exp_fisik !== l.exp ? `${expText(l.exp)} → ${expText(l.exp_fisik)}` : expText(l.exp));

// Loads an opname the account may act on, or answers the request itself and returns null.
async function loadOpname(req: express.Request, res: express.Response, action: OpnameAction, client?: PoolClient) {
  const o = await queryOne<OpnameRow>(`SELECT * FROM opname WHERE id = @id${client ? " FOR UPDATE" : ""}`, { id: Number(req.params.id) || 0 }, client);
  if (!o) {
    res.status(404).json({ error: "Stok opname tidak ditemukan" });
    return null;
  }
  if (!estateAllowed(req.user!, o.estate) || !opnameCan(req.user!, o.module, action)) {
    res.status(403).json({ error: "Akses ditolak" });
    return null;
  }
  return o;
}

// Answers a request with an error and returns null, for the early exits inside a transaction.
function refuse(res: express.Response, status: number, error: string): null {
  res.status(status).json({ error });
  return null;
}

const opnameName = (o: { module: OpnameModule; estate: string }) => `${OPNAME_MODULE_LABEL[o.module]} ${o.estate}`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

// The system stock of a location, one line per thing to count.
async function opnameSnapshot(module: OpnameModule, estate: string, client?: PoolClient): Promise<OpnameLine[]> {
  if (module === "GUDANG" && estate === "NILAM") {
    return queryMany(
      `SELECT kode, nama, COALESCE(satuan, '') satuan, '' exp, COALESCE(stock_tersedia, 0)::float8 stok_sistem FROM items ORDER BY kode`,
      {},
      client
    );
  }
  if (module === "GUDANG") {
    return queryMany(
      `SELECT gs.item_kode kode, i.nama, COALESCE(i.satuan, '') satuan, '' exp, gs.stock_tersedia::float8 stok_sistem
       FROM gudang_stock gs JOIN items i ON i.kode = gs.item_kode WHERE gs.gudang = @estate ORDER BY i.kode`,
      { estate },
      client
    );
  }
  if (module === "KLINIK") {
    // Every batch in stock, plus a no-expiry line for obat the clinic holds without any stock left.
    return queryMany(
      `SELECT * FROM (
         SELECT b.obat_kode kode, o.nama, COALESCE(o.satuan, '') satuan, b.expired_date exp, b.qty::float8 stok_sistem
         FROM klinik_batch b JOIN obat o ON o.kode = b.obat_kode WHERE b.klinik = @estate AND b.qty > 0
         UNION ALL
         SELECT ks.obat_kode, o.nama, COALESCE(o.satuan, ''), '', 0
         FROM klinik_stock ks JOIN obat o ON o.kode = ks.obat_kode
         WHERE ks.klinik = @estate AND NOT EXISTS (SELECT 1 FROM klinik_batch b WHERE b.klinik = ks.klinik AND b.obat_kode = ks.obat_kode AND b.qty > 0)
       ) x ORDER BY kode, exp = '', exp`,
      { estate },
      client
    );
  }
  if (module === "BBM") {
    return queryMany(
      `SELECT j kode, replace(j, '_', ' ') nama, 'LTR' satuan, '' exp,
         COALESCE((SELECT saldo_stock FROM bbm_log WHERE jenis_bbm = j AND lokasi = @estate AND saldo_stock IS NOT NULL
                   ORDER BY tanggal_iso DESC, id DESC LIMIT 1), 0)::float8 stok_sistem
       FROM unnest(@jenis::text[]) j
       -- Bensin Campur only where it has been used.
       WHERE j <> 'BENSIN_CAMPUR' OR EXISTS (SELECT 1 FROM bbm_log WHERE jenis_bbm = j AND lokasi = @estate)`,
      { estate, jenis: BBM_JENIS },
      client
    );
  }
  if (module === "OLI") {
    // Every jenis in master oli (plus any this estate still has history of), this estate's saldo or 0.
    return queryMany(
      `SELECT j kode, j nama, 'LTR' satuan, '' exp,
         COALESCE((SELECT saldo_stock FROM oli_log WHERE jenis_oli = j AND estate = @estate AND saldo_stock IS NOT NULL
                   ORDER BY tanggal_iso DESC, id DESC LIMIT 1), 0)::float8 stok_sistem
       FROM (SELECT nama j FROM master_oli WHERE ${OLI_AT_ESTATE} UNION SELECT DISTINCT jenis_oli FROM oli_log WHERE estate = @estate) x ORDER BY j`,
      { estate },
      client
    );
  }
  // Every jenis in master pupuk (plus any this estate still has history of), this estate's saldo or 0,
  // so an estate without pupuk history yet still gets its lines to count.
  return queryMany(
    `SELECT j kode, j nama, 'KG' satuan, '' exp,
       COALESCE((SELECT saldo_stock FROM pupuk_log WHERE jenis_pupuk = j AND estate = @estate AND saldo_stock IS NOT NULL
                 ORDER BY tanggal_iso DESC, id DESC LIMIT 1), 0)::float8 stok_sistem
     FROM (SELECT nama j FROM master_pupuk WHERE ${OLI_AT_ESTATE} UNION SELECT DISTINCT jenis_pupuk FROM pupuk_log WHERE estate = @estate) x ORDER BY j`,
    { estate },
    client
  );
}

// The running-balance ledgers (no movement table, a saldo per row): table, jenis and estate column.
const SALDO_LEDGER = {
  BBM: { table: "bbm_log", jenis: "jenis_bbm", estate: "lokasi", out: "pemakaian" },
  PUPUK: { table: "pupuk_log", jenis: "jenis_pupuk", estate: "estate", out: "keluar" },
  OLI: { table: "oli_log", jenis: "jenis_oli", estate: "estate", out: "pemakaian" },
} as const;
type SaldoModule = keyof typeof SALDO_LEDGER;
const isSaldoModule = (m: OpnameModule): m is SaldoModule => m in SALDO_LEDGER;

// The saldo a row dated `iso` runs on from: the last saldo row up to and including that day (a new
// row goes after the rows already on its date).
const saldoAsOf = async (module: SaldoModule, estate: string, jenis: string, iso: string, client?: PoolClient) => {
  const t = SALDO_LEDGER[module];
  const r = await queryOne<{ saldo_stock: number }>(
    `SELECT saldo_stock FROM ${t.table} WHERE ${t.jenis} = @jenis AND ${t.estate} = @estate AND saldo_stock IS NOT NULL AND tanggal_iso <= @iso
     ORDER BY tanggal_iso DESC, id DESC LIMIT 1`,
    { estate, jenis, iso },
    client
  );
  return r?.saldo_stock ?? 0;
};

// Rebuilds the running saldo of one estate + jenis from `fromIso` on, in (tanggal_iso, id) order, so
// a backdated, edited or deleted row moves every saldo after it (a row used to take the saldo of
// the latest row at the time it was booked, and nothing after it followed). A row booked in the app
// runs on from the row before it: saldo = before + diterima + pinjam - keluar/pemakaian. A row with
// a fixed saldo (dari_sheet: the sheet's own saldo from the import, or one typed by hand in Edit)
// keeps it, and a Stok Opname row (koreksi) keeps the counted saldo - its koreksi becomes the count
// minus the saldo before it.
async function rechainSaldo(module: SaldoModule, estate: string, jenis: string, fromIso: string, client?: PoolClient): Promise<number> {
  if (!client) return withTransaction((c) => rechainSaldo(module, estate, jenis, fromIso, c));
  const t = SALDO_LEDGER[module];
  const key = { estate, jenis, iso: fromIso };
  await execute("SELECT pg_advisory_xact_lock(hashtext(@k))", { k: `saldo:${module}:${estate}:${jenis}` }, client);
  let prev =
    (
      await queryOne<{ s: number }>(
        `SELECT saldo_stock::float8 s FROM ${t.table} WHERE ${t.jenis} = @jenis AND ${t.estate} = @estate AND saldo_stock IS NOT NULL AND tanggal_iso < @iso
         ORDER BY tanggal_iso DESC, id DESC LIMIT 1`,
        key,
        client
      )
    )?.s ?? 0;
  const rows = await queryMany<{ id: number; imported: boolean; i: number; p: number; o: number; k: number | null; s: number | null }>(
    `SELECT id, dari_sheet imported, COALESCE(diterima, 0)::float8 i, COALESCE(pinjam, 0)::float8 p, COALESCE(${t.out}, 0)::float8 o,
       koreksi::float8 k, saldo_stock::float8 s
     FROM ${t.table} WHERE ${t.jenis} = @jenis AND ${t.estate} = @estate AND tanggal_iso >= @iso ORDER BY tanggal_iso, id FOR UPDATE`,
    key,
    client
  );
  const changed: { id: number; s: number | null; k: number | null }[] = [];
  for (const r of rows) {
    if (r.imported) {
      if (r.s !== null) prev = r.s;
      continue;
    }
    if (r.k !== null && r.s !== null) {
      const k = round3(r.s - prev);
      if (k !== r.k) changed.push({ id: r.id, s: r.s, k });
      prev = r.s;
      continue;
    }
    const s = round3(prev + r.i + r.p - r.o);
    if (s !== r.s) changed.push({ id: r.id, s, k: r.k });
    prev = s;
  }
  if (changed.length) {
    await execute(
      `UPDATE ${t.table} l SET saldo_stock = x.s, koreksi = x.k FROM json_to_recordset(@rows::json) AS x(id int, s float8, k float8) WHERE l.id = x.id`,
      { rows: JSON.stringify(changed) },
      client
    );
  }
  return changed.length;
}
const minIso = (...d: (string | null | undefined)[]) => d.filter((x): x is string => !!x).sort()[0];

// After an Edit of a BBM / pupuk / oli row: a saldo typed by hand becomes fixed (the rows after run
// on from it); a changed jumlah or tanggal on a row whose saldo was fixed (an imported sheet row)
// lets it run on from the row before, so the edit moves the saldo. Then the saldo is rebuilt.
async function afterSaldoEdit(module: SaldoModule, existing: any, updated: any, estate: string, jenis: string) {
  const t = SALDO_LEDGER[module];
  const n = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));
  const saldoTyped = n(updated.saldo_stock) !== n(existing.saldo_stock);
  const moved =
    n(updated.diterima) !== n(existing.diterima) || n(updated[t.out]) !== n(existing[t.out]) || (updated.tanggal_iso ?? existing.tanggal_iso) !== existing.tanggal_iso;
  const fixed = saldoTyped && n(updated.saldo_stock) !== null ? true : moved ? false : existing.dari_sheet;
  if (fixed !== existing.dari_sheet) await execute(`UPDATE ${t.table} SET dari_sheet = @f WHERE id = @id`, { f: fixed, id: existing.id });
  const from = minIso(existing.tanggal_iso, updated.tanggal_iso);
  if (from) await rechainSaldo(module, estate, jenis, from);
}

// Latest BBM / pupuk / oli saldo row of one jenis (the running balance new entries continue from).
const latestSaldoRow = (module: SaldoModule, estate: string, jenis: string, client?: PoolClient) => {
  const t = SALDO_LEDGER[module];
  return queryOne<{ saldo_stock: number }>(
    `SELECT saldo_stock FROM ${t.table} WHERE ${t.jenis} = @jenis AND ${t.estate} = @estate AND saldo_stock IS NOT NULL ORDER BY tanggal_iso DESC, id DESC LIMIT 1`,
    { estate, jenis },
    client
  );
};

// One line as it stands now (for a line added during the count); null = not in the master data.
async function opnameCurrent(module: OpnameModule, estate: string, kode: string, exp: string): Promise<OpnameLine | null> {
  if (module === "GUDANG") {
    const r = await queryOne<any>(
      `SELECT i.kode, i.nama, COALESCE(i.satuan, '') satuan, ${
        estate === "NILAM" ? "COALESCE(i.stock_tersedia, 0)" : "COALESCE(gs.stock_tersedia, 0)"
      }::float8 stok_sistem
       FROM items i LEFT JOIN gudang_stock gs ON gs.item_kode = i.kode AND gs.gudang = @estate WHERE i.kode = @kode`,
      { estate, kode }
    );
    return r ? { ...r, exp: "" } : null;
  }
  if (module === "KLINIK") {
    const r = await queryOne<any>(
      `SELECT o.kode, o.nama, COALESCE(o.satuan, '') satuan, COALESCE(b.qty, 0)::float8 stok_sistem
       FROM obat o LEFT JOIN klinik_batch b ON b.obat_kode = o.kode AND b.klinik = @estate AND b.expired_date = @exp WHERE o.kode = @kode`,
      { estate, kode, exp }
    );
    return r ? { ...r, exp } : null;
  }
  if (module === "BBM" && !BBM_JENIS.includes(kode)) return null;
  if (!isSaldoModule(module)) return null;
  if (module === "OLI" && !(await queryOne(`SELECT 1 FROM master_oli WHERE nama = @kode AND ${OLI_AT_ESTATE}`, { kode, estate }))) return null;
  const last = await latestSaldoRow(module, estate, kode);
  return { kode, nama: kode, satuan: module === "PUPUK" ? "KG" : "LTR", exp: "", stok_sistem: last?.saldo_stock ?? 0 };
}

// Books the count of one line as a Koreksi. Returns the stock before (the count is the stock after).
async function applyOpnameLine(client: PoolClient, req: express.Request, o: OpnameRow, line: OpnameLine & { stok_fisik: number }) {
  const note = `Koreksi Stok (Opname #${o.id})${line.keterangan ? `: ${line.keterangan}` : ""}`;
  const actual = line.stok_fisik;
  if (o.module === "GUDANG" && o.estate === "NILAM") {
    const item = await queryOne<{ id: number }>("SELECT id FROM items WHERE kode = @kode", { kode: line.kode }, client);
    if (!item) throw new StockError(`Barang ${line.kode} sudah tidak ada di master data`);
    return nilamCorrection(client, item.id, actual, note);
  }
  if (o.module === "GUDANG") return ledgerCorrection(client, req, GUDANG_LEDGER, o.estate, line.kode, actual, note);
  if (o.module === "KLINIK") {
    const before =
      (await queryOne<{ q: number }>(
        "SELECT qty q FROM klinik_batch WHERE klinik = @k AND obat_kode = @o AND expired_date = @exp FOR UPDATE",
        { k: o.estate, o: line.kode, exp: line.exp },
        client
      ))?.q ?? 0;
    const delta = actual - before;
    if (delta !== 0) {
      await klinikMoveTx(client, req, {
        klinik: o.estate,
        obat: line.kode,
        type: delta > 0 ? "IN" : "OUT",
        qty: Math.abs(delta),
        exp: line.exp,
        tujuan: "",
        penerima: "",
        note: `Koreksi Stok (Opname #${o.id}) batch ${expText(line.exp)}${line.keterangan ? `: ${line.keterangan}` : ""}`,
        is_correction: 1,
      });
    }
    return before;
  }

  // BBM / pupuk / oli: a saldo row dated the opname day, or after the latest row so it becomes the saldo.
  if (!isSaldoModule(o.module)) throw new Error(`Modul ${o.module} tidak punya saldo berjalan`);
  const t = SALDO_LEDGER[o.module];
  const before = (await latestSaldoRow(o.module, o.estate, line.kode, client))?.saldo_stock ?? 0;
  const delta = round3(actual - before);
  if (delta === 0) return before;
  const lastIso =
    (await queryOne<{ d: string | null }>(
      `SELECT MAX(tanggal_iso) d FROM ${t.table} WHERE ${t.jenis} = @jenis AND ${t.estate} = @estate`,
      { jenis: line.kode, estate: o.estate },
      client
    ))?.d ?? "";
  const iso = lastIso > o.tanggal ? lastIso : o.tanggal;
  if (o.module === "BBM") {
    const { tanggal, periode } = isoToIndoDate(iso);
    await execute(
      `INSERT INTO bbm_log (jenis_bbm, lokasi, estate, periode, tanggal, tanggal_iso, no_spb, saldo_stock, keterangan, kode_kendaraan, hm_terakhir, koreksi)
       VALUES (@jenis, @estate, @estate, @periode, @tanggal, @iso, '', @saldo, @note, '', '', @delta)`,
      { jenis: line.kode, estate: o.estate, periode, tanggal, iso, saldo: actual, note, delta },
      client
    );
  } else if (o.module === "OLI") {
    const [y, m, d] = iso.split("-");
    await execute(
      `INSERT INTO oli_log (estate, jenis_oli, periode, tanggal, tanggal_iso, no_embrace, saldo_stock, keterangan, koreksi)
       VALUES (@estate, @jenis, @periode, @tanggal, @iso, '', @saldo, @note, @delta)`,
      { estate: o.estate, jenis: line.kode, periode: `${INDO_MONTHS[Number(m) - 1]} ${y}`, tanggal: `${d}/${m}/${y}`, iso, saldo: actual, note, delta },
      client
    );
  } else {
    const [y, m, d] = iso.split("-");
    await execute(
      `INSERT INTO pupuk_log (estate, jenis_pupuk, periode, tanggal, tanggal_iso, divisi, no_embrace, kode_barang, saldo_stock, keterangan, blok, koreksi)
       VALUES (@estate, @jenis, @periode, @tanggal, @iso, '', '', '', @saldo, @note, '', @delta)`,
      { estate: o.estate, jenis: line.kode, periode: `${INDO_MONTHS[Number(m) - 1]} ${y}`, tanggal: `${d}/${m}/${y}`, iso, saldo: actual, note, delta },
      client
    );
  }
  await rechainSaldo(o.module, o.estate, line.kode, iso, client);
  return before;
}

type CountedLine = OpnameLine & { id: number; stok_fisik: number };

// Books every count of an opname as Koreksi in a handful of set-based statements, so approving a few
// hundred lines is as quick as approving one (a statement per line meant a database round trip per
// line). Returns each line's stock before, in the order of `lines`. BBM / pupuk have at most a few
// lines and keep the per-line path.
async function applyOpnameLines(client: PoolClient, req: express.Request, o: OpnameRow, lines: CountedLine[]): Promise<number[]> {
  if (isSaldoModule(o.module)) {
    const befores: number[] = [];
    for (const line of lines) befores.push(round3(await applyOpnameLine(client, req, o, line)));
    return befores;
  }
  const kodes = [...new Set(lines.map((l) => l.kode))];
  const note = (l: CountedLine) => `Koreksi Stok (Opname #${o.id})${l.keterangan ? `: ${l.keterangan}` : ""}`;
  const base = { estate: o.estate, kodes, uid: req.user!.id };

  if (o.module === "GUDANG" && o.estate === "NILAM") {
    const cur = await queryMany<{ kode: string; id: number; stock: number }>(
      "SELECT kode, id, COALESCE(stock_tersedia, 0)::float8 stock FROM items WHERE kode = ANY(@kodes::text[]) FOR UPDATE",
      base,
      client
    );
    const byKode = new Map(cur.map((r) => [r.kode, r]));
    const missing = kodes.find((k) => !byKode.has(k));
    if (missing) throw new StockError(`Barang ${missing} sudah tidak ada di master data`);
    const rows = lines.map((l) => {
      const it = byKode.get(l.kode)!;
      const delta = l.stok_fisik - it.stock;
      return { id: it.id, actual: l.stok_fisik, delta, qin: Math.max(delta, 0), qout: Math.max(-delta, 0), note: note(l) };
    });
    const moved = rows.filter((r) => r.delta !== 0);
    if (moved.length) {
      await execute(
        `INSERT INTO transactions (item_id, tujuan, type, qty, note, is_correction)
         SELECT x.id, '', CASE WHEN x.delta > 0 THEN 'IN' ELSE 'OUT' END, ABS(x.delta), x.note, 1
         FROM json_to_recordset(@rows::json) AS x(id int, delta int, note text)`,
        { rows: JSON.stringify(moved) },
        client
      );
    }
    await execute(
      `UPDATE items it SET stock_tersedia = x.actual, stock_in = it.stock_in + x.qin, stock_out = it.stock_out + x.qout,
         keterangan = CASE WHEN x.delta = 0 THEN it.keterangan WHEN x.actual > 0 THEN 'AMAN' ELSE 'BUFFER STOCK' END,
         stock_fisik = x.actual, selisih_stock = x.delta
       FROM json_to_recordset(@rows::json) AS x(id int, actual int, delta int, qin int, qout int)
       WHERE it.id = x.id`,
      { rows: JSON.stringify(rows) },
      client
    );
    return lines.map((l) => byKode.get(l.kode)!.stock);
  }

  if (o.module === "GUDANG") {
    const cur = await queryMany<{ kode: string; stock: number }>(
      "SELECT item_kode kode, stock_tersedia::float8 stock FROM gudang_stock WHERE gudang = @estate AND item_kode = ANY(@kodes::text[]) FOR UPDATE",
      base,
      client
    );
    const stock = new Map(cur.map((r) => [r.kode, r.stock]));
    const befores = lines.map((l) => stock.get(l.kode) ?? 0);
    const moved = lines
      .map((l, i) => ({ kode: l.kode, delta: round3(l.stok_fisik - befores[i]), note: note(l) }))
      .filter((r) => r.delta !== 0);
    if (moved.length) {
      const p = { ...base, rows: JSON.stringify(moved) };
      await execute(
        `INSERT INTO gudang_stock (gudang, item_kode, buffer_stock, stock_tersedia)
         SELECT @estate, x.kode, 0, 0 FROM json_to_recordset(@rows::json) AS x(kode text) ON CONFLICT (gudang, item_kode) DO NOTHING`,
        p,
        client
      );
      await execute(
        `INSERT INTO gudang_stock_tx (gudang, item_kode, type, qty, tujuan, penerima, note, is_correction, user_id)
         SELECT @estate, x.kode, CASE WHEN x.delta > 0 THEN 'IN' ELSE 'OUT' END, ABS(x.delta), '', '', x.note, 1, @uid
         FROM json_to_recordset(@rows::json) AS x(kode text, delta float8, note text)`,
        p,
        client
      );
      await execute(
        `UPDATE gudang_stock gs SET stock_tersedia = ROUND((gs.stock_tersedia + x.delta)::numeric, 3)
         FROM json_to_recordset(@rows::json) AS x(kode text, delta float8)
         WHERE gs.gudang = @estate AND gs.item_kode = x.kode`,
        p,
        client
      );
    }
    return befores;
  }

  // Klinik: each line is one batch (obat + expiry); the batch is set to the count, klinik_stock follows.
  // A line whose expiry was corrected (exp_fisik) empties its old batch and sets the new one to the count.
  const cur = await queryMany<{ kode: string; exp: string; qty: number }>(
    "SELECT obat_kode kode, expired_date exp, qty FROM klinik_batch WHERE klinik = @estate AND obat_kode = ANY(@kodes::text[]) FOR UPDATE",
    base,
    client
  );
  const qty = new Map(cur.map((r) => [`${r.kode}|${r.exp}`, r.qty]));
  const sets = lines.flatMap((l, i) => {
    const note = `Koreksi Stok (Opname #${o.id}) batch ${batchText(l)}${l.keterangan ? `: ${l.keterangan}` : ""}`;
    const to = lineExp(l);
    return to === l.exp
      ? [{ i, kode: l.kode, exp: l.exp, actual: l.stok_fisik, note }]
      : [
          { i, kode: l.kode, exp: l.exp, actual: 0, note },
          { i, kode: l.kode, exp: to, actual: l.stok_fisik, note },
        ];
  });
  const befores = lines.map(() => 0);
  const moved = sets
    .map((s) => {
      const before = qty.get(`${s.kode}|${s.exp}`) ?? 0;
      befores[s.i] += before;
      return { kode: s.kode, exp: s.exp, actual: s.actual, delta: s.actual - before, note: s.note };
    })
    .filter((r) => r.delta !== 0);
  if (moved.length) {
    const p = { ...base, rows: JSON.stringify(moved), changed: [...new Set(moved.map((r) => r.kode))] };
    await execute(
      `INSERT INTO klinik_batch (klinik, obat_kode, expired_date, qty)
       SELECT @estate, x.kode, x.exp, x.actual FROM json_to_recordset(@rows::json) AS x(kode text, exp text, actual int)
       ON CONFLICT (klinik, obat_kode, expired_date) DO UPDATE SET qty = EXCLUDED.qty`,
      p,
      client
    );
    await execute("DELETE FROM klinik_batch WHERE klinik = @estate AND obat_kode = ANY(@changed::text[]) AND qty <= 0", p, client);
    await execute(
      `INSERT INTO klinik_stock_tx (klinik, obat_kode, type, qty, tujuan, penerima, note, is_correction, user_id, alloc)
       SELECT @estate, x.kode, CASE WHEN x.delta > 0 THEN 'IN' ELSE 'OUT' END, ABS(x.delta), '', '', x.note, 1, @uid,
              jsonb_build_array(jsonb_build_object('exp', x.exp, 'qty', ABS(x.delta)))
       FROM json_to_recordset(@rows::json) AS x(kode text, exp text, delta int, note text)`,
      p,
      client
    );
    await execute(
      `INSERT INTO klinik_stock (klinik, obat_kode, buffer_stock, stock_tersedia)
       SELECT @estate, k, 0, 0 FROM unnest(@changed::text[]) k ON CONFLICT (klinik, obat_kode) DO NOTHING`,
      p,
      client
    );
    await execute(
      `UPDATE klinik_stock ks SET
         stock_tersedia = COALESCE((SELECT SUM(qty) FROM klinik_batch b WHERE b.klinik = ks.klinik AND b.obat_kode = ks.obat_kode), 0),
         expired_date = (SELECT MIN(NULLIF(expired_date, '')) FROM klinik_batch b WHERE b.klinik = ks.klinik AND b.obat_kode = ks.obat_kode AND b.qty > 0)
       WHERE ks.klinik = @estate AND ks.obat_kode = ANY(@changed::text[])`,
      p,
      client
    );
  }
  return befores;
}

async function logOpname(req: express.Request, o: OpnameRow, aksi: string, detail = "") {
  await logActivity(req, { module: OPNAME_LOG_MODULE[o.module], estate: o.estate, aksi, objek: `Stok Opname #${o.id} - ${opnameName(o)}`, detail });
}

// The team / witness names of an opname: one per line or comma, tidied.
const namaList = (v: unknown) => String(v ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
// The people of an opname one by one (see schema.sql opname.pihak): every one with nama and jabatan, at least two
// counters and one saksi, a pemegang, and the account that approves (one with Approve Opname of the module and the
// estate). Returns the error text, or the pihak with the joined names for tim / saksi / pemegang.
type Orang = { nama: string; jabatan: string };
async function opnamePihak(b: any, module: string, estate: string): Promise<string | { pihak: any; tim: string; saksi: string; pemegang: string }> {
  const orang = (x: any): Orang => ({ nama: String(x?.nama ?? "").trim().slice(0, 100), jabatan: String(x?.jabatan ?? "").trim().slice(0, 100) });
  const daftar = (v: any) => (Array.isArray(v) ? v.map(orang).filter((o) => o.nama) : []);
  const p = b?.pihak ?? {};
  const tim = daftar(p.tim);
  const saksi = daftar(p.saksi);
  const pemegang = orang(p.pemegang);
  if (tim.length < 2) return "Isi tim penghitung minimal 2 orang";
  if (!saksi.length) return "Isi minimal satu saksi";
  if (!pemegang.nama) return "Isi nama pemegang gudang / stok";
  const tanpa = [...tim, ...saksi, pemegang].find((o) => !o.jabatan);
  if (tanpa) return `Isi jabatan ${tanpa.nama}`;
  const uid = Number(p.penyetuju?.user_id) || 0;
  if (!uid) return "Pilih siapa yang menyetujui (approval)";
  const u = await queryOne<any>("SELECT id, nama, role, estate, estates, perms FROM users WHERE id = @id", { id: uid });
  const boleh = u && (u.role === "superuser" || (parseList(u.perms, ALL_PERMS).includes(`${module.toLowerCase()}.approve`) && parseList(u.estates ?? u.estate, ESTATES).includes(estate)));
  if (!boleh) return "Akun penyetuju tidak punya hak Approve Opname untuk modul dan estate ini";
  const penyetuju = { user_id: u.id, nama: u.nama, jabatan: String(p.penyetuju?.jabatan ?? "").trim().slice(0, 100) };
  if (!penyetuju.jabatan) return "Isi jabatan penyetuju";
  return {
    pihak: { tim, saksi, pemegang, penyetuju },
    tim: tim.map((o) => o.nama).join(", "),
    saksi: saksi.map((o) => o.nama).join(", "),
    pemegang: pemegang.nama,
  };
}
const pihakTeks = (p: any) =>
  `tim: ${p.tim.map((o: Orang) => `${o.nama} (${o.jabatan})`).join(", ")}; saksi: ${p.saksi.map((o: Orang) => `${o.nama} (${o.jabatan})`).join(", ")}; pemegang: ${p.pemegang.nama} (${p.pemegang.jabatan}); disetujui oleh: ${p.penyetuju.nama} (${p.penyetuju.jabatan})`;
// Hitung buta: while the count runs, stok sistem (and so the selisih) is hidden from whoever counts;
// an approver / Super User sees it, everyone sees it once the count is finished (dibuka_at).
const opnameHidden = (u: SessionUser, o: OpnameRow) =>
  !!o.hitung_buta && !o.dibuka_at && o.status === "DRAFT" && u.role !== "superuser" && !opnameCan(u, o.module, "approve");

const OPNAME_COUNTS = `COUNT(l.id)::int total, COUNT(l.stok_fisik)::int dihitung,
  COUNT(*) FILTER (WHERE l.stok_fisik IS NOT NULL AND ROUND((l.stok_fisik - l.stok_sistem)::numeric, 3) <> 0)::int selisih`;

app.get("/api/stock-opname", async (req, res) => {
  const { module = "", estate = "", estates = "", status = "", page = "1", pageSize = "25" } = req.query as Record<string, string>;
  const u = req.user!;
  const params: any = {
    mods: OPNAME_MODULES.filter((m) => opnameCan(u, m, "view") && (!module || m === module)),
    estates: listEstates(u, estate, estates),
  };
  const conditions = ["o.module = ANY(@mods::text[])", "o.estate = ANY(@estates::text[])"];
  if (status === "OPEN") conditions.push("o.status IN ('DRAFT', 'SUBMITTED')");
  else if (status) {
    conditions.push("o.status = @status");
    params.status = status;
  }
  const where = "WHERE " + conditions.join(" AND ");
  const total = (await queryOne<{ c: number }>(`SELECT COUNT(*)::int c FROM opname o ${where}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 25, 200);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT o.*, ${OPNAME_COUNTS} FROM opname o LEFT JOIN opname_line l ON l.opname_id = o.id ${where}
     GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  for (const r of data as any[]) if (opnameHidden(u, r)) r.selisih = null;
  res.json({ data, total, page: parseInt(page) || 1, pageSize: limit });
});

app.post("/api/stock-opname", async (req, res) => {
  const { module, estate, tanggal, catatan } = req.body ?? {};
  if (!OPNAME_MODULES.includes(module)) return res.status(400).json({ error: "Modul tidak valid" });
  const ph = await opnamePihak(req.body, module, estate);
  if (typeof ph === "string") return res.status(400).json({ error: ph });
  if (!(ESTATES as readonly string[]).includes(estate)) return res.status(400).json({ error: "Estate tidak valid" });
  if (!ISO_DATE.test(tanggal || "")) return res.status(400).json({ error: "Tanggal tidak valid" });
  if (!estateAllowed(req.user!, estate) || !opnameCan(req.user!, module, "opname")) return res.status(403).json({ error: "Akses ditolak" });

  const u = req.user!;
  let o: OpnameRow;
  let count = 0;
  try {
    o = await withTransaction(async (client) => {
      const row = (await queryOne<OpnameRow>(
        `INSERT INTO opname (module, estate, tanggal, catatan, created_by, created_by_nama, tim, saksi, pemegang, pihak, hitung_buta)
         VALUES (@module, @estate, @tanggal, @catatan, @uid, @unama, @tim, @saksi, @pemegang, @pihak::jsonb, @buta) RETURNING *`,
        {
          module,
          estate,
          tanggal,
          catatan: String(catatan ?? "").trim(),
          uid: u.id,
          unama: u.nama,
          tim: ph.tim,
          saksi: ph.saksi,
          pemegang: ph.pemegang,
          pihak: JSON.stringify(ph.pihak),
          buta: req.body?.hitung_buta !== false,
        },
        client
      ))!;
      const lines = await opnameSnapshot(module, estate, client);
      count = lines.length;
      await execute(
        `INSERT INTO opname_line (opname_id, kode, nama, satuan, exp, stok_sistem)
         SELECT @id, x.kode, x.nama, x.satuan, x.exp, x.stok_sistem
         FROM json_to_recordset(@lines::json) AS x(kode text, nama text, satuan text, exp text, stok_sistem float8)`,
        { id: row.id, lines: JSON.stringify(lines) },
        client
      );
      return row;
    });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: `${opnameName({ module, estate })} masih punya stok opname yang belum selesai` });
    throw e;
  }
  await logOpname(req, o, "Buat Stok Opname", `Tanggal: ${isoToDisplay(tanggal)}; ${count} item; ${pihakTeks(ph.pihak)}${o.hitung_buta ? "; hitung buta" : ""}; transaksi stok dikunci`);
  res.json({ success: true, id: o.id });
});

// Who may approve an opname of a module / estate: accounts with its Approve Opname and that estate, and Super Users.
app.get("/api/stock-opname/penyetuju", async (req, res) => {
  const module = String(req.query.module ?? "");
  const estate = String(req.query.estate ?? "");
  if (!OPNAME_MODULES.includes(module as any) || !(ESTATES as readonly string[]).includes(estate)) return res.status(400).json({ error: "Modul / estate tidak valid" });
  if (!estateAllowed(req.user!, estate) || !opnameCan(req.user!, module, "view")) return res.status(403).json({ error: "Akses ditolak" });
  const users = await queryMany<any>("SELECT id, nama, username, role, estate, estates, perms FROM users ORDER BY role <> 'superuser', nama");
  res.json(
    users
      .filter((u) => u.role === "superuser" || (parseList(u.perms, ALL_PERMS).includes(`${module.toLowerCase()}.approve`) && parseList(u.estates ?? u.estate, ESTATES).includes(estate)))
      .map((u) => ({ id: u.id, nama: u.nama, superuser: u.role === "superuser" }))
  );
});

app.get("/api/stock-opname/:id", async (req, res) => {
  const o = await loadOpname(req, res, "view");
  if (!o) return;
  // Klinik lines carry the obat's pack, so a count can be typed as strip utuh + biji lepas.
  const lines = await queryMany(
    `SELECT l.*, COALESCE(ob.kemasan, '') kemasan, COALESCE(ob.isi_kemasan, 0) isi_kemasan
     FROM opname_line l LEFT JOIN obat ob ON @klinik AND ob.kode = l.kode
     WHERE l.opname_id = @id ORDER BY l.ditambahkan, l.id`,
    { id: o.id, klinik: o.module === "KLINIK" }
  );
  // Hitung buta: the counter gets no stok sistem until the count is finished.
  const hidden = opnameHidden(req.user!, o);
  if (hidden) for (const l of lines as any[]) l.stok_sistem = null;
  res.json({ opname: { ...o, disembunyikan: hidden }, lines });
});

// Saves counts (stok_fisik null = not counted) and notes while DRAFT.
app.put("/api/stock-opname/:id", async (req, res) => {
  const { lines = [], catatan } = req.body ?? {};
  if (!Array.isArray(lines)) return res.status(400).json({ error: "Data tidak valid" });
  const isSuper = req.user!.role === "superuser";
  let adjusted: { line: OpnameLine; before: number; after: number }[] = [];
  let ok: OpnameRow | null;
  try {
  ok = await withTransaction(async (client) => {
    const o = await loadOpname(req, res, "opname", client);
    if (!o) return null;
    // The counter changes a DRAFT; a superuser may also correct a submitted or an approved opname.
    if (o.status !== "DRAFT" && !(isSuper && (o.status === "SUBMITTED" || o.status === "APPROVED")))
      return refuse(res, 400, "Opname ini sudah diajukan, tidak bisa diubah");
    const whole = opnameWhole(o);
    const rows: { id: number; stok_fisik: number | null; keterangan: string }[] = [];
    for (const l of lines) {
      const v = l?.stok_fisik;
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || (whole && !Number.isInteger(v)))) {
        return refuse(res, 400, whole ? "Stok fisik harus bilangan bulat, minimal 0" : "Stok fisik harus angka, minimal 0");
      }
      rows.push({ id: Number(l.id), stok_fisik: v === null ? null : round3(v), keterangan: String(l.keterangan ?? "").trim() });
    }
    // Klinik: the expiry found on a batch (sent only when changed; null = as in the system). Not on an
    // approved opname - its stock already sits in the batch it was approved into.
    const expRows: { id: number; exp: string | null }[] = [];
    for (const l of lines) {
      if (!l || !("exp_fisik" in l)) continue;
      const e = l.exp_fisik;
      if (o.module !== "KLINIK" || o.status === "APPROVED") return refuse(res, 400, "Tanggal expired tidak bisa diubah di opname ini");
      if (e !== null && (typeof e !== "string" || (e !== "" && !ISO_DATE.test(e)))) return refuse(res, 400, "Tanggal expired tidak valid");
      expRows.push({ id: Number(l.id), exp: e });
    }
    // Approved: the stock already carries the count, so a changed count moves it by the difference.
    if (o.status === "APPROVED" && rows.length) {
      await refuseIfLocationOpen(o, client);
      const old = new Map(
        (await queryMany<OpnameLine & { id: number }>("SELECT * FROM opname_line WHERE opname_id = @oid", { oid: o.id }, client)).map((l) => [l.id, l])
      );
      for (const row of rows) {
        const line = old.get(row.id);
        if (!line) continue;
        if (line.stok_fisik === null || row.stok_fisik === null) {
          if (line.stok_fisik === row.stok_fisik) continue;
          // Thrown (not refuse) so corrections already booked in this loop roll back too.
          throw new StockError(`${line.nama}: baris yang tidak dihitung saat disetujui tidak bisa diisi / dikosongkan lagi`);
        }
        const delta = round3(row.stok_fisik - line.stok_fisik!);
        if (!delta) continue;
        const r2 = await opnameAdjust(client, req, o, { ...line, keterangan: row.keterangan }, delta, `Edit Stok Opname #${o.id}`);
        adjusted.push({ line, ...r2 });
      }
    }
    if (rows.length) {
      await execute(
        `UPDATE opname_line l SET stok_fisik = x.stok_fisik, keterangan = x.keterangan,
           dihitung_oleh = CASE WHEN l.stok_fisik IS DISTINCT FROM x.stok_fisik THEN @uid ELSE l.dihitung_oleh END,
           dihitung_oleh_nama = CASE WHEN l.stok_fisik IS DISTINCT FROM x.stok_fisik THEN @unama ELSE l.dihitung_oleh_nama END,
           dihitung_at = CASE WHEN l.stok_fisik IS DISTINCT FROM x.stok_fisik THEN now() ELSE l.dihitung_at END
         FROM json_to_recordset(@rows::json) AS x(id int, stok_fisik float8, keterangan text)
         WHERE l.id = x.id AND l.opname_id = @oid`,
        { rows: JSON.stringify(rows), oid: o.id, uid: req.user!.id, unama: req.user!.nama },
        client
      );
    }
    if (expRows.length) {
      await execute(
        `UPDATE opname_line l SET exp_fisik = NULLIF(x.exp, l.exp)
         FROM json_to_recordset(@rows::json) AS x(id int, exp text)
         WHERE l.id = x.id AND l.opname_id = @oid`,
        { rows: JSON.stringify(expRows), oid: o.id },
        client
      );
      // Two lines ending in the same batch would each set it to their own count.
      const dup = await queryOne<{ nama: string; e: string }>(
        `SELECT MIN(nama) nama, COALESCE(exp_fisik, exp) e FROM opname_line WHERE opname_id = @oid
         GROUP BY kode, COALESCE(exp_fisik, exp) HAVING COUNT(*) > 1 LIMIT 1`,
        { oid: o.id },
        client
      );
      if (dup) throw new StockError(`${dup.nama}: batch expired ${expText(dup.e)} sudah ada di baris lain, hitung di baris itu`);
      // Nor a batch another line moves away from (X -> Y while Y -> Z, or a swap): approval empties
      // that batch, which would wipe this line's count.
      const chain = await queryOne<{ nama: string; e: string }>(
        `SELECT a.nama, a.exp_fisik e FROM opname_line a JOIN opname_line b
           ON b.opname_id = a.opname_id AND b.kode = a.kode AND b.id <> a.id AND b.exp = a.exp_fisik AND b.exp_fisik IS NOT NULL
         WHERE a.opname_id = @oid AND a.exp_fisik IS NOT NULL LIMIT 1`,
        { oid: o.id },
        client
      );
      if (chain) throw new StockError(`${chain.nama}: batch expired ${expText(chain.e)} sedang dipindah ke tanggal lain di baris lain; koreksi tanggalnya satu per satu`);
    }
    if (typeof catatan === "string") await execute("UPDATE opname SET catatan = @c WHERE id = @id", { c: catatan.trim(), id: o.id }, client);
    return o;
  });
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (!ok) return;
  if (ok.status !== "DRAFT") await logOpnameAdjust(req, ok, adjusted, "Edit Stok Opname");
  res.json({ success: true, adjusted: adjusted.length });
});

// An approved opname changing the stock again (edit / delete) must not collide with an open opname of
// the same location (that one locks its stock).
async function refuseIfLocationOpen(o: OpnameRow, client: PoolClient) {
  const other = await queryOne<{ id: number }>(
    "SELECT id FROM opname WHERE module = @m AND estate = @e AND status IN ('DRAFT', 'SUBMITTED') AND id <> @id LIMIT 1",
    { m: o.module, e: o.estate, id: o.id },
    client
  );
  if (other) throw new LocationOpenError(`${OPNAME_MODULE_LABEL[o.module]} ${o.estate} sedang Stok Opname #${other.id}; selesaikan itu dulu`);
}
class LocationOpenError extends StockError {}

// Moves the stock of one opname line by `delta` from where it is now (a superuser correcting or
// deleting an approved opname), booked as a Koreksi. Returns the stock before and after.
async function opnameAdjust(client: PoolClient, req: express.Request, o: OpnameRow, orig: OpnameLine, delta: number, label: string) {
  // The stock sits in the batch the approval put it in.
  const line = { ...orig, exp: lineExp(orig), exp_fisik: null };
  const now = await opnameCurrent(o.module, o.estate, line.kode, line.exp);
  if (!now) throw new StockError(`${line.kode} sudah tidak ada di master data`);
  const before = round3(now.stok_sistem);
  const after = round3(before + delta);
  if (after < 0 && !isSaldoModule(o.module)) throw new StockError(`${line.nama}: stok sekarang ${before}, tidak cukup untuk dikurangi ${-delta}`);
  await applyOpnameLine(client, req, o, { ...line, stok_fisik: after, keterangan: `${label}${line.keterangan ? ` - ${line.keterangan}` : ""}` });
  return { before, after };
}

async function logOpnameAdjust(req: express.Request, o: OpnameRow, changes: { line: OpnameLine; before: number; after: number }[], aksi: string) {
  await logActivities(
    req,
    changes.map(({ line, before, after }) => ({
      module: OPNAME_LOG_MODULE[o.module],
      estate: o.estate,
      aksi: "Koreksi Stok",
      objek: isSaldoModule(o.module) ? line.kode : `${line.kode} - ${line.nama}`,
      detail: `${aksi} #${o.id}${o.module === "KLINIK" ? `; Batch ${expText(lineExp(line))}` : ""}: ${before} → ${after} (selisih ${signed(round3(after - before))})`,
    }))
  );
}

// Superuser only: removes an opname. An approved one is undone first - every correction it booked
// (stok fisik - stok sistem at approval) is booked back against the stock as it is now - unless
// keep_stock is set (the stock was used since, so undoing would go below zero): then only the record goes.
app.post("/api/stock-opname/:id/delete", async (req, res) => {
  if (req.user!.role !== "superuser") return res.status(403).json({ error: "Hanya Super User yang bisa menghapus stok opname" });
  const alasan = String(req.body?.catatan ?? "").trim();
  if (!alasan) return res.status(400).json({ error: "Alasan penghapusan wajib diisi" });
  const keepStock = req.body?.keep_stock === true;
  let done: { o: OpnameRow; undone: { line: OpnameLine; before: number; after: number }[] } | null;
  try {
    done = await withTransaction(async (client) => {
      const o = await loadOpname(req, res, "view", client);
      if (!o) return null;
      const undone: { line: OpnameLine; before: number; after: number }[] = [];
      if (o.status === "APPROVED" && !keepStock) {
        await refuseIfLocationOpen(o, client);
        const lines = await queryMany<OpnameLine & { id: number; stok_fisik: number }>(
          "SELECT * FROM opname_line WHERE opname_id = @id AND stok_fisik IS NOT NULL ORDER BY id",
          { id: o.id },
          client
        );
        for (const line of lines) {
          const booked = round3(line.stok_fisik - line.stok_sistem);
          if (!booked) continue;
          undone.push({ line, ...(await opnameAdjust(client, req, o, { ...line, keterangan: alasan }, -booked, `Hapus Stok Opname #${o.id}`)) });
        }
      }
      await execute("DELETE FROM opname WHERE id = @id", { id: o.id }, client);
      return { o, undone };
    });
  } catch (e) {
    // 409 = another opname of the location is open (finish that first); 400 = the stock was used since,
    // so the client may offer deleting only the record (keep_stock).
    if (e instanceof LocationOpenError) return res.status(409).json({ error: e.message });
    if (e instanceof StockError) return res.status(400).json({ error: e.message, can_keep_stock: true });
    throw e;
  }
  if (!done) return;
  await logOpnameAdjust(req, done.o, done.undone, "Hapus Stok Opname");
  await logOpname(
    req,
    done.o,
    "Hapus Stok Opname",
    `Status: ${done.o.status}; Alasan: ${alasan}${
      done.o.status !== "APPROVED" ? "" : keepStock ? "; stok tidak diubah (koreksi tidak dibalik)" : `; ${done.undone.length} koreksi dibalik`
    }`
  );
  res.json({ success: true, undone: done.undone.length });
});

// A barang / obat batch / jenis pupuk found during the count that isn't in the snapshot.
app.post("/api/stock-opname/:id/lines", async (req, res) => {
  const o = await loadOpname(req, res, "opname");
  if (!o) return;
  if (o.status !== "DRAFT") return res.status(400).json({ error: "Opname ini sudah diajukan, tidak bisa diubah" });
  if (o.module === "BBM") return res.status(400).json({ error: "BBM selalu berisi Solar dan Bensin (dan Bensin Campur di lokasi yang memakainya)" });
  let kode = String(req.body?.kode ?? "").trim();
  if (o.module === "PUPUK" || o.module === "OLI") kode = kode.toUpperCase();
  const exp = o.module === "KLINIK" ? String(req.body?.exp ?? "") : "";
  if (!kode) return res.status(400).json({ error: "Barang wajib dipilih" });
  if (exp && !ISO_DATE.test(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
  const cur = await opnameCurrent(o.module, o.estate, kode, exp);
  if (!cur) return res.status(404).json({ error: "Tidak ditemukan di master data" });
  if (
    o.module === "KLINIK" &&
    (await queryOne("SELECT 1 FROM opname_line WHERE opname_id = @oid AND kode = @kode AND exp_fisik = @exp", { oid: o.id, kode: cur.kode, exp }))
  )
    return res.status(409).json({ error: "Batch dengan tanggal expired itu sudah ada di daftar opname" });
  try {
    const line = await queryOne(
      `INSERT INTO opname_line (opname_id, kode, nama, satuan, exp, stok_sistem, ditambahkan)
       VALUES (@oid, @kode, @nama, @satuan, @exp, @stok_sistem, true) RETURNING *`,
      { oid: o.id, kode: cur.kode, nama: cur.nama, satuan: cur.satuan, exp: cur.exp, stok_sistem: cur.stok_sistem }
    );
    res.json(line);
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Sudah ada di daftar opname" });
    throw e;
  }
});

app.delete("/api/stock-opname/:id/lines/:lineId", async (req, res) => {
  const o = await loadOpname(req, res, "opname");
  if (!o) return;
  if (o.status !== "DRAFT") return res.status(400).json({ error: "Opname ini sudah diajukan, tidak bisa diubah" });
  const r = await execute("DELETE FROM opname_line WHERE id = @lid AND opname_id = @oid AND ditambahkan", { lid: Number(req.params.lineId) || 0, oid: o.id });
  if (!r.rowCount) return res.status(400).json({ error: "Hanya baris yang ditambahkan saat opname yang bisa dihapus" });
  res.json({ success: true });
});

app.post("/api/stock-opname/:id/submit", async (req, res) => {
  const u = req.user!;
  const done = await withTransaction(async (client) => {
    const o = await loadOpname(req, res, "opname", client);
    if (!o) return null;
    if (o.status !== "DRAFT") return refuse(res, 400, "Opname ini sudah diajukan");
    const c = (await queryOne<{ total: number; dihitung: number; selisih: number }>(
      `SELECT ${OPNAME_COUNTS} FROM opname_line l WHERE l.opname_id = @id`,
      { id: o.id },
      client
    ))!;
    if (!c.dihitung) return refuse(res, 400, "Belum ada stok fisik yang diisi");
    if (namaList(o.tim).length < 2 || !namaList(o.saksi).length || !String(o.pemegang ?? "").trim())
      return refuse(res, 400, "Lengkapi tim penghitung (minimal 2 orang), saksi dan pemegang gudang dulu");
    if (o.hitung_buta && !o.dibuka_at) return refuse(res, 400, 'Klik "Selesai hitung" dulu untuk membuka stok sistem, lalu isi alasan setiap selisih');
    // Every selisih is explained before it goes for approval.
    const tanpaAlasan = await queryMany<{ nama: string }>(
      `SELECT nama FROM opname_line WHERE opname_id = @id AND stok_fisik IS NOT NULL
         AND ROUND((stok_fisik - stok_sistem)::numeric, 3) <> 0 AND TRIM(keterangan) = '' ORDER BY id`,
      { id: o.id },
      client
    );
    if (tanpaAlasan.length)
      return refuse(
        res,
        400,
        `${tanpaAlasan.length} item selisih belum ada alasannya: ${tanpaAlasan.slice(0, 5).map((x) => x.nama).join(", ")}${tanpaAlasan.length > 5 ? ", ..." : ""}`
      );
    await execute(
      `UPDATE opname SET status = 'SUBMITTED', submitted_by = @uid, submitted_by_nama = @unama, submitted_at = now() WHERE id = @id`,
      { uid: u.id, unama: u.nama, id: o.id },
      client
    );
    return { o, c };
  });
  if (!done) return;
  await logOpname(req, done.o, "Ajukan Stok Opname", `Dihitung ${done.c.dihitung} dari ${done.c.total} item; ${done.c.selisih} item selisih`);
  res.json({ success: true });
});

// Log Stok Opname: every opname step (buat, tim, selesai hitung, ajukan, kembalikan, setujui, batal, hapus)
// and the koreksi stok it booked, across the modules / estates the account may see the opnames of.
// opname = one opname's history.
app.get("/api/stock-opname-log", async (req, res) => {
  const q = req.query as Record<string, string>;
  const u = req.user!;
  const mods = OPNAME_MODULES.filter((m) => opnameCan(u, m, "view") && (!q.module || m === q.module)).map((m) => OPNAME_LOG_MODULE[m]);
  const params: any = { mods, estates: listEstates(u, q.estate ?? "", "") };
  const cond = ["module = ANY(@mods::text[])", "estate = ANY(@estates::text[])", "(objek LIKE 'Stok Opname #%' OR detail ~ 'Opname #[0-9]+')"];
  if (q.opname) {
    cond.push("(objek ~ @re OR detail ~ @re)");
    params.re = `Opname #${Number(q.opname) || 0}([^0-9]|$)`;
  }
  if (q.search) {
    cond.push("(objek ILIKE @s OR detail ILIKE @s OR nama ILIKE @s OR aksi ILIKE @s)");
    params.s = `%${q.search}%`;
  }
  const where = "WHERE " + cond.join(" AND ");
  const limit = Math.min(parseInt(q.pageSize) || 50, 200);
  const offset = (Math.max(parseInt(q.page) || 1, 1) - 1) * limit;
  const total = (await queryOne<{ c: number }>(`SELECT COUNT(*)::int c FROM activity_log ${where}`, params))!.c;
  const data = await queryMany(
    `SELECT id, created_at, module, estate, aksi, objek, detail, nama, username FROM activity_log ${where} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total });
});

// Tim / saksi / pemegang / penyetuju before approval (filled or corrected later; opnames from before had none).
app.put("/api/stock-opname/:id/info", async (req, res) => {
  const done = await withTransaction(async (client) => {
    const o = await loadOpname(req, res, "opname", client);
    if (!o) return null;
    // Before approval: a DRAFT, or a submitted one (the penyetuju can still be changed).
    if (o.status !== "DRAFT" && o.status !== "SUBMITTED") return refuse(res, 400, "Opname ini sudah selesai");
    const ph = await opnamePihak(req.body, o.module, o.estate);
    if (typeof ph === "string") return refuse(res, 400, ph);
    await execute("UPDATE opname SET tim = @tim, saksi = @saksi, pemegang = @pemegang, pihak = @pihak::jsonb WHERE id = @id", { tim: ph.tim, saksi: ph.saksi, pemegang: ph.pemegang, pihak: JSON.stringify(ph.pihak), id: o.id }, client);
    return { o, ph };
  });
  if (!done) return;
  await logOpname(req, done.o, "Edit Tim Stok Opname", pihakTeks(done.ph.pihak));
  res.json({ success: true });
});

// Hitung buta: the count is finished - stok sistem opens so every selisih can be explained (rekonsiliasi).
app.post("/api/stock-opname/:id/buka", async (req, res) => {
  const o = await withTransaction(async (client) => {
    const o = await loadOpname(req, res, "opname", client);
    if (!o) return null;
    if (o.status !== "DRAFT") return refuse(res, 400, "Opname ini sudah diajukan");
    if (o.dibuka_at) return o;
    const c = (await queryOne<{ total: number; dihitung: number }>(`SELECT ${OPNAME_COUNTS} FROM opname_line l WHERE l.opname_id = @id`, { id: o.id }, client))!;
    if (!c.dihitung) return refuse(res, 400, "Belum ada stok fisik yang diisi");
    await execute("UPDATE opname SET dibuka_at = now(), dibuka_oleh_nama = @n WHERE id = @id", { n: req.user!.nama, id: o.id }, client);
    return o;
  });
  if (!o) return;
  await logOpname(req, o, "Selesai Hitung Stok Opname", "Stok sistem dibuka untuk rekonsiliasi selisih");
  res.json({ success: true });
});

// Send a submitted opname back to the counter with a reason.
app.post("/api/stock-opname/:id/return", async (req, res) => {
  const catatan = String(req.body?.catatan ?? "").trim();
  if (!catatan) return res.status(400).json({ error: "Alasan wajib diisi" });
  const o = await withTransaction(async (client) => {
    const o = await loadOpname(req, res, "approve", client);
    if (!o) return null;
    if (o.status !== "SUBMITTED") return refuse(res, 400, "Opname ini tidak sedang menunggu approval");
    await execute(
      `UPDATE opname SET status = 'DRAFT', catatan_review = @c, submitted_by = NULL, submitted_by_nama = NULL, submitted_at = NULL WHERE id = @id`,
      { c: catatan, id: o.id },
      client
    );
    return o;
  });
  if (!o) return;
  await logOpname(req, o, "Kembalikan Stok Opname", `Alasan: ${catatan}`);
  res.json({ success: true });
});

app.post("/api/stock-opname/:id/approve", async (req, res) => {
  const u = req.user!;
  type Change = { line: OpnameLine; before: number; after: number };
  let done: { o: OpnameRow; changes: Change[]; counted: number } | null;
  try {
    done = await withTransaction(async (client) => {
      const o = await loadOpname(req, res, "approve", client);
      if (!o) return null;
      if (o.status !== "SUBMITTED") return refuse(res, 400, "Opname ini tidak sedang menunggu approval");
      // Addressed to one account: only it (or a Super User) approves.
      const tujuan = (o as any).pihak?.penyetuju;
      if (tujuan?.user_id && tujuan.user_id !== u.id && u.role !== "superuser")
        return refuse(res, 403, `Opname ini ditujukan ke ${tujuan.nama}${tujuan.jabatan ? ` (${tujuan.jabatan})` : ""} untuk approval`);
      // The count is checked by someone else; a superuser may approve their own.
      if (o.submitted_by === u.id && u.role !== "superuser") return refuse(res, 403, "Opname yang Anda ajukan sendiri harus disetujui orang lain");
      // Nor by someone who counted it.
      if (u.role !== "superuser" && (await queryOne("SELECT 1 FROM opname_line WHERE opname_id = @id AND dihitung_oleh = @uid LIMIT 1", { id: o.id, uid: u.id }, client)))
        return refuse(res, 403, "Anda ikut menghitung opname ini, jadi harus disetujui orang lain");
      const lines = await queryMany<OpnameLine & { id: number; stok_fisik: number }>(
        "SELECT * FROM opname_line WHERE opname_id = @id AND stok_fisik IS NOT NULL ORDER BY id",
        { id: o.id },
        client
      );
      const befores = await applyOpnameLines(client, req, o, lines);
      await execute(
        `UPDATE opname_line l SET stok_sistem = x.b FROM json_to_recordset(@rows::json) AS x(id int, b float8) WHERE l.id = x.id`,
        { rows: JSON.stringify(lines.map((l, i) => ({ id: l.id, b: befores[i] }))) },
        client
      );
      const changes: Change[] = lines
        .map((line, i) => ({ line, before: befores[i], after: line.stok_fisik }))
        .filter((c) => c.before !== c.after);
      await execute(
        `UPDATE opname SET status = 'APPROVED', approved_by = @uid, approved_by_nama = @unama, approved_at = now(), catatan_review = '' WHERE id = @id`,
        { uid: u.id, unama: u.nama, id: o.id },
        client
      );
      return { o, changes, counted: lines.length };
    });
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (!done) return;
  const { o, changes } = done;
  await logActivities(
    req,
    changes.map(({ line, before, after }) => ({
      module: OPNAME_LOG_MODULE[o.module],
      estate: o.estate,
      aksi: "Koreksi Stok",
      objek: isSaldoModule(o.module) ? line.kode : `${line.kode} - ${line.nama}`,
      detail: `Stok Opname #${o.id}${o.module === "KLINIK" ? `; Batch ${batchText(line)}` : ""}: ${before} → ${after} (selisih ${signed(round3(after - before))})${
        line.keterangan ? `; Catatan: ${line.keterangan}` : ""
      }`,
    }))
  );
  await logOpname(req, o, "Setujui Stok Opname", `${done.counted} item dihitung; ${changes.length} item dikoreksi; transaksi stok dibuka`);
  res.json({ success: true, corrected: changes.length });
});

// DRAFT: by the counter or an approver; SUBMITTED: by an approver. Nothing is booked.
app.post("/api/stock-opname/:id/cancel", async (req, res) => {
  const catatan = String(req.body?.catatan ?? "").trim();
  const o = await withTransaction(async (client) => {
    const o = await loadOpname(req, res, "view", client);
    if (!o) return null;
    if (o.status !== "DRAFT" && o.status !== "SUBMITTED") return refuse(res, 400, "Opname ini sudah selesai");
    const u = req.user!;
    const allowed = opnameCan(u, o.module, "approve") || (o.status === "DRAFT" && opnameCan(u, o.module, "opname"));
    if (!allowed) return refuse(res, 403, "Akses ditolak");
    await execute("UPDATE opname SET status = 'BATAL', catatan_review = @c WHERE id = @id", { c: catatan, id: o.id }, client);
    return o;
  });
  if (!o) return;
  await logOpname(req, o, "Batalkan Stok Opname", `${catatan ? `Alasan: ${catatan}; ` : ""}transaksi stok dibuka`);
  res.json({ success: true });
});

// ---- Inventory Oli (lubricant), see schema.sql's oli_log ----
// Same shape as Inventory Pupuk: a running saldo per estate + jenis oli. Nilam was imported from its
// "STOK OLI" sheet; the other estates start empty.
const OLI_ESTATES = ["NILAM", "FIRUS", "ZAMRUD", "KNS", "WJA"];
// A master oli jenis is used at @estate: listed for it, or for every estate (estates '').
const OLI_AT_ESTATE = "(estates = '' OR @estate = ANY(string_to_array(estates, ',')))";

function checkOliEstate(req: express.Request, res: express.Response, estate: string) {
  if (!OLI_ESTATES.includes(estate)) {
    res.status(400).json({ error: "Estate tidak valid" });
    return false;
  }
  if (!estateAllowed(req.user!, estate)) {
    res.status(403).json({ error: "Akses ditolak" });
    return false;
  }
  return true;
}

function oliFilters(q: Record<string, string>) {
  const conditions = ["estate = @estate"];
  const params: any = { estate: q.estate };
  if (q.jenis_oli) {
    conditions.push("jenis_oli = @jenis_oli");
    params.jenis_oli = q.jenis_oli;
  }
  wordSearch(q.search || "", ["jenis_oli", "no_embrace", "keterangan"], conditions, params);
  if (ISO_DATE.test(q.dateFrom || "")) {
    conditions.push("tanggal_iso >= @dateFrom");
    params.dateFrom = q.dateFrom;
  }
  if (ISO_DATE.test(q.dateTo || "")) {
    conditions.push("tanggal_iso <= @dateTo");
    params.dateTo = q.dateTo;
  }
  return { where: "WHERE " + conditions.join(" AND "), params };
}

const latestOliSaldo = (estate: string, asOf?: string) =>
  queryMany<{ jenis_oli: string; saldo_stock: number; tanggal: string }>(
    `SELECT jenis_oli, saldo_stock, tanggal FROM (
       SELECT jenis_oli, saldo_stock, tanggal,
              ROW_NUMBER() OVER (PARTITION BY jenis_oli ORDER BY tanggal_iso DESC, id DESC) AS rn
       FROM oli_log WHERE estate = @estate AND saldo_stock IS NOT NULL ${asOf ? "AND tanggal_iso <= @asOf" : ""}
     ) sub WHERE rn = 1 ORDER BY jenis_oli`,
    { estate, ...(asOf ? { asOf } : {}) }
  );

app.get("/api/oli/summary", async (req, res) => {
  const q = req.query as Record<string, string>;
  if (!checkOliEstate(req, res, q.estate)) return;
  const flow = oliFilters({ estate: q.estate, dateFrom: q.dateFrom, dateTo: q.dateTo });
  const perJenis = await queryMany(
    `SELECT jenis_oli, COALESCE(SUM(diterima), 0)::float8 diterima, COALESCE(SUM(pemakaian), 0)::float8 pemakaian
     FROM oli_log ${flow.where} GROUP BY jenis_oli ORDER BY jenis_oli`,
    flow.params
  );
  // Same split as pupuk: saldoTerakhir is today's balance, saldoPerTanggal the balance at the filter's end.
  const saldoTerakhir = await latestOliSaldo(q.estate);
  const saldoPerTanggal = ISO_DATE.test(q.asOf || "") ? await latestOliSaldo(q.estate, q.asOf) : saldoTerakhir;
  res.json({ perJenis, saldoTerakhir, saldoPerTanggal });
});

app.get("/api/oli/options", async (req, res) => {
  const { estate = "" } = req.query as Record<string, string>;
  if (!checkOliEstate(req, res, estate)) return;
  // The jenis in master oli used at this estate; transactions may only use these.
  const rows = await queryMany<{ v: string }>(`SELECT nama v FROM master_oli WHERE ${OLI_AT_ESTATE} ORDER BY nama`, { estate });
  res.json({ jenis: rows.map((r) => r.v) });
});

app.get("/api/oli", async (req, res) => {
  const q = req.query as Record<string, string>;
  if (!checkOliEstate(req, res, q.estate)) return;
  const { where, params } = oliFilters(q);
  const totals = (await queryOne<any>(
    `SELECT COUNT(*)::int c, COALESCE(SUM(pemakaian), 0)::float8 pemakaian, COALESCE(SUM(diterima), 0)::float8 diterima FROM oli_log ${where}`,
    params
  ))!;
  const limit = Math.min(parseInt(q.pageSize) || 50, 500);
  const offset = (Math.max(parseInt(q.page) || 1, 1) - 1) * limit;
  const data = await queryMany(`SELECT *, (SELECT p.jenis FROM pinjaman p WHERE p.id = oli_log.pinjaman_id) AS pinjaman_jenis FROM oli_log ${where} ORDER BY NULLIF(tanggal_iso, '') DESC NULLS LAST, id DESC LIMIT @limit OFFSET @offset`, {
    ...params,
    limit,
    offset,
  });
  res.json({ data, total: totals.c, pemakaianSum: totals.pemakaian, diterimaSum: totals.diterima, page: parseInt(q.page) || 1, pageSize: limit });
});

const oliObjek = (r: { jenis_oli: string; tanggal: string }) => `${r.jenis_oli} · ${r.tanggal}`;
const oliDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return { tanggal: `${d}/${m}/${y}`, periode: `${INDO_MONTHS[Number(m) - 1]} ${y}` };
};

// Oli masuk or pemakaian; like pupuk, pemakaian may exceed the saldo (the form warns instead).
app.post("/api/oli", async (req, res) => {
  const { estate, jenis_oli, tanggal_iso, tipe, jumlah, no_embrace, keterangan } = req.body;
  if (!checkOliEstate(req, res, estate)) return;
  if (!jenis_oli || !String(jenis_oli).trim()) return res.status(400).json({ error: "Jenis oli wajib diisi" });
  if (!["MASUK", "PEMAKAIAN"].includes(tipe)) return res.status(400).json({ error: "Tipe transaksi tidak valid" });
  const qty = Number(jumlah);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
  if (!ISO_DATE.test(tanggal_iso || "")) return res.status(400).json({ error: "Tanggal tidak valid" });

  const jenis = String(jenis_oli).trim().toUpperCase();
  if (!(await queryOne(`SELECT 1 FROM master_oli WHERE nama = @jenis AND ${OLI_AT_ESTATE}`, { jenis, estate }))) {
    return res.status(400).json({ error: `Jenis oli ${jenis} belum ada di Master Data Oli untuk estate ${estate}` });
  }
  const evidenceId = await claimEvidence(req, res);
  if (evidenceId === undefined) return;
  const lastSaldo = await saldoAsOf("OLI", estate, jenis, tanggal_iso);
  const saldoBaru = round3(tipe === "MASUK" ? lastSaldo + qty : lastSaldo - qty);
  const { tanggal, periode } = oliDate(tanggal_iso);
  const row = await queryOne<{ id: number }>(
    `INSERT INTO oli_log (estate, jenis_oli, periode, tanggal, tanggal_iso, no_embrace, diterima, pemakaian, saldo_stock, keterangan, evidence_id)
     VALUES (@estate, @jenis, @periode, @tanggal, @tanggal_iso, @no_embrace, @diterima, @pemakaian, @saldo, @keterangan, @evidenceId::uuid)
     RETURNING id`,
    {
      evidenceId,
      estate,
      jenis,
      periode,
      tanggal,
      tanggal_iso,
      no_embrace: no_embrace || "",
      diterima: tipe === "MASUK" ? qty : null,
      pemakaian: tipe === "PEMAKAIAN" ? qty : null,
      saldo: saldoBaru,
      keterangan: keterangan || (tipe === "MASUK" ? "OLI MASUK" : ""),
    }
  );
  await rechainSaldo("OLI", estate, jenis, tanggal_iso);
  await logActivity(req, {
    module: "OLI",
    estate,
    aksi: tipe === "MASUK" ? "Stok Masuk" : "Stok Keluar",
    objek: oliObjek({ jenis_oli: jenis, tanggal }),
    detail: [`Jumlah: ${qty} LTR`, `Saldo: ${lastSaldo} → ${saldoBaru}`, no_embrace && `No. BPB: ${no_embrace}`, keterangan && `Keterangan: ${keterangan}`]
      .filter(Boolean)
      .join("; "),
  });
  res.json({ success: true, id: row!.id, saldo_stock: saldoBaru });
});

app.put("/api/oli/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM oli_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  if (editTooLate(req, res, "oli", existing)) return;
  const newEvidence = await checkEditEvidence(req, res, existing.evidence_id);
  if (newEvidence === undefined) return;
  const b = req.body;
  if (b.tanggal_iso && !ISO_DATE.test(b.tanggal_iso)) return res.status(400).json({ error: "Tanggal tidak valid" });
  const iso = b.tanggal_iso || existing.tanggal_iso;
  const updated = {
    tanggal_iso: iso,
    ...(iso ? oliDate(iso) : { tanggal: existing.tanggal, periode: existing.periode }),
    no_embrace: b.no_embrace ?? existing.no_embrace ?? "",
    diterima: b.diterima === undefined ? existing.diterima : optNum(b.diterima),
    pemakaian: b.pemakaian === undefined ? existing.pemakaian : optNum(b.pemakaian),
    saldo_stock: b.saldo_stock === undefined ? existing.saldo_stock : optNum(b.saldo_stock),
    keterangan: b.keterangan ?? existing.keterangan ?? "",
  };
  await execute(
    `UPDATE oli_log SET tanggal_iso = @tanggal_iso, tanggal = @tanggal, periode = @periode, no_embrace = @no_embrace,
       diterima = @diterima, pemakaian = @pemakaian, saldo_stock = @saldo_stock, keterangan = @keterangan
     WHERE id = @id`,
    { ...updated, id: req.params.id }
  );
  await afterSaldoEdit("OLI", existing, updated, existing.estate, existing.jenis_oli);
  await logActivity(req, {
    module: "OLI",
    estate: existing.estate,
    aksi: "Edit Transaksi",
    objek: oliObjek(existing),
    detail: describeChanges(existing, updated, {
      tanggal: "Tanggal",
      no_embrace: "No. BPB",
      diterima: "Stok Masuk",
      pemakaian: "Pemakaian",
      saldo_stock: "Saldo Stok",
      keterangan: "Keterangan",
    }),
  });
  await useEditEvidence(newEvidence, [{ table: "oli_log", where: "id = @id", params: { id: existing.id } }]);
  res.json({ success: true });
});

app.delete("/api/oli/:id", requireSuperuser, async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM oli_log WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  if (editTooLate(req, res, "oli", existing)) return;
  await execute("DELETE FROM oli_log WHERE id = @id", { id: req.params.id });
  if (existing.tanggal_iso) await rechainSaldo("OLI", existing.estate, existing.jenis_oli, existing.tanggal_iso);
  await logActivity(req, {
    module: "OLI",
    estate: existing.estate,
    aksi: "Hapus Transaksi",
    objek: oliObjek(existing),
    detail: [
      existing.diterima && `Stok Masuk: ${existing.diterima}`,
      existing.pemakaian && `Pemakaian: ${existing.pemakaian}`,
      existing.saldo_stock !== null && `Saldo Stok: ${existing.saldo_stock}`,
      existing.keterangan && `Keterangan: ${existing.keterangan}`,
    ]
      .filter(Boolean)
      .join("; "),
  });
  res.json({ success: true });
});

// A renamed jenis oli / pupuk: loans and opname lines carry the jenis name as their kode, and a return or
// an approval books under it; renamed with the ledger so they don't start a ghost chain under the old name.
// A name the ledger already uses (not in master) is refused: merging two saldo chains isn't a rename.
async function renameSaldoJenis(module: "OLI" | "PUPUK", old: string, nama: string, c: PoolClient) {
  const t = SALDO_LEDGER[module];
  if (await queryOne(`SELECT 1 FROM ${t.table} WHERE ${t.jenis} = @nama LIMIT 1`, { nama }, c))
    throw Object.assign(new Error("dup"), { code: "23505" });
  await execute("UPDATE pinjaman SET kode = @nama, nama = @nama WHERE module = @module AND kode = @old", { module, old, nama }, c);
  await execute(
    "UPDATE opname_line l SET kode = @nama, nama = @nama FROM opname o WHERE o.id = l.opname_id AND o.module = @module AND l.kode = @old",
    { module, old, nama },
    c
  );
}

// ---- Master data oli (see schema.sql master_oli) ----
const masterOliPayload = (b: any) => ({
  kode: String(b?.kode ?? "").trim().toUpperCase(),
  nama: String(b?.nama ?? "").trim().toUpperCase(),
  satuan: String(b?.satuan ?? "").trim().toUpperCase() || "LTR",
  keterangan: String(b?.keterangan ?? "").trim(),
  // The estates it is used in ('' = all), in the estates' order.
  estates: ESTATES.filter((e) => (Array.isArray(b?.estates) ? b.estates : []).includes(e)).join(","),
});

app.get("/api/master-oli", async (req, res) => {
  const { search = "" } = req.query as Record<string, string>;
  const conditions: string[] = [];
  const params: any = {};
  wordSearch(search, ["kode", "nama", "keterangan"], conditions, params);
  const data = await queryMany(
    `SELECT m.*, (SELECT COUNT(*)::int FROM oli_log l WHERE l.jenis_oli = m.nama) transaksi
     FROM master_oli m ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY m.kode`,
    params
  );
  res.json({ data, total: data.length });
});

app.post("/api/master-oli", async (req, res) => {
  const o = masterOliPayload(req.body);
  if (!o.kode || !o.nama) return res.status(400).json({ error: "Kode dan nama jenis oli wajib diisi" });
  try {
    const row = await queryOne<{ id: number }>(
      "INSERT INTO master_oli (kode, nama, satuan, keterangan, estates) VALUES (@kode, @nama, @satuan, @keterangan, @estates) RETURNING id",
      o
    );
    await logActivity(req, { module: "OLI", estate: null, aksi: "Tambah Jenis Oli", objek: `${o.kode} - ${o.nama}`, detail: `Satuan: ${o.satuan}; Estate: ${o.estates || "semua"}` });
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Kode atau nama jenis oli sudah dipakai" });
    throw e;
  }
});

// A renamed jenis is renamed in the oli ledger too, so its saldo and history stay with it.
app.put("/api/master-oli/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM master_oli WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const o = masterOliPayload(req.body);
  if (!o.kode || !o.nama) return res.status(400).json({ error: "Kode dan nama jenis oli wajib diisi" });
  try {
    await withTransaction(async (c) => {
      await execute("UPDATE master_oli SET kode = @kode, nama = @nama, satuan = @satuan, keterangan = @keterangan, estates = @estates WHERE id = @id", { ...o, id: existing.id }, c);
      if (o.nama !== existing.nama) {
        await execute("UPDATE oli_log SET jenis_oli = @nama WHERE jenis_oli = @old", { nama: o.nama, old: existing.nama }, c);
        await renameSaldoJenis("OLI", existing.nama, o.nama, c);
      }
    });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Kode atau nama jenis oli sudah dipakai" });
    throw e;
  }
  await logActivity(req, {
    module: "OLI",
    estate: null,
    aksi: "Edit Jenis Oli",
    objek: `${o.kode} - ${o.nama}`,
    detail: describeChanges(existing, o, { kode: "Kode", nama: "Nama", satuan: "Satuan", keterangan: "Keterangan", estates: "Estate" }),
  });
  res.json({ success: true });
});

app.delete("/api/master-oli/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM master_oli WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const used = await queryOne("SELECT 1 FROM oli_log WHERE jenis_oli = @n LIMIT 1", { n: existing.nama });
  if (used) return res.status(409).json({ error: "Jenis oli ini sudah punya transaksi, tidak bisa dihapus" });
  await execute("DELETE FROM master_oli WHERE id = @id", { id: existing.id });
  await logActivity(req, { module: "OLI", estate: null, aksi: "Hapus Jenis Oli", objek: `${existing.kode} - ${existing.nama}` });
  res.json({ success: true });
});

// ---- Master data pupuk (see schema.sql master_pupuk), same shape as master oli without a satuan ----
const masterPupukPayload = (b: any) => ({
  kode: String(b?.kode ?? "").trim().toUpperCase(),
  nama: String(b?.nama ?? "").trim().toUpperCase(),
  keterangan: String(b?.keterangan ?? "").trim(),
  estates: ESTATES.filter((e) => (Array.isArray(b?.estates) ? b.estates : []).includes(e)).join(","),
});

app.get("/api/master-pupuk", async (req, res) => {
  const { search = "" } = req.query as Record<string, string>;
  const conditions: string[] = [];
  const params: any = {};
  wordSearch(search, ["kode", "nama", "keterangan"], conditions, params);
  const data = await queryMany(
    `SELECT m.*, (SELECT COUNT(*)::int FROM pupuk_log l WHERE l.jenis_pupuk = m.nama) transaksi
     FROM master_pupuk m ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY m.kode`,
    params
  );
  res.json({ data, total: data.length });
});

app.post("/api/master-pupuk", async (req, res) => {
  const o = masterPupukPayload(req.body);
  if (!o.kode || !o.nama) return res.status(400).json({ error: "Kode dan nama jenis pupuk wajib diisi" });
  try {
    const row = await queryOne<{ id: number }>(
      "INSERT INTO master_pupuk (kode, nama, keterangan, estates) VALUES (@kode, @nama, @keterangan, @estates) RETURNING id",
      o
    );
    await logActivity(req, { module: "PUPUK", estate: null, aksi: "Tambah Jenis Pupuk", objek: `${o.kode} - ${o.nama}`, detail: `Estate: ${o.estates || "semua"}` });
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Kode atau nama jenis pupuk sudah dipakai" });
    throw e;
  }
});

// A renamed jenis is renamed in the pupuk ledger too, so its saldo and history stay with it.
app.put("/api/master-pupuk/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM master_pupuk WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const o = masterPupukPayload(req.body);
  if (!o.kode || !o.nama) return res.status(400).json({ error: "Kode dan nama jenis pupuk wajib diisi" });
  try {
    await withTransaction(async (c) => {
      await execute("UPDATE master_pupuk SET kode = @kode, nama = @nama, keterangan = @keterangan, estates = @estates WHERE id = @id", { ...o, id: existing.id }, c);
      if (o.nama !== existing.nama) {
        await execute("UPDATE pupuk_log SET jenis_pupuk = @nama WHERE jenis_pupuk = @old", { nama: o.nama, old: existing.nama }, c);
        await renameSaldoJenis("PUPUK", existing.nama, o.nama, c);
      }
    });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "Kode atau nama jenis pupuk sudah dipakai" });
    throw e;
  }
  await logActivity(req, {
    module: "PUPUK",
    estate: null,
    aksi: "Edit Jenis Pupuk",
    objek: `${o.kode} - ${o.nama}`,
    detail: describeChanges(existing, o, { kode: "Kode", nama: "Nama", keterangan: "Keterangan", estates: "Estate" }),
  });
  res.json({ success: true });
});

app.delete("/api/master-pupuk/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM master_pupuk WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const used = await queryOne("SELECT 1 FROM pupuk_log WHERE jenis_pupuk = @n LIMIT 1", { n: existing.nama });
  if (used) return res.status(409).json({ error: "Jenis pupuk ini sudah punya transaksi, tidak bisa dihapus" });
  await execute("DELETE FROM master_pupuk WHERE id = @id", { id: existing.id });
  await logActivity(req, { module: "PUPUK", estate: null, aksi: "Hapus Jenis Pupuk", objek: `${existing.kode} - ${existing.nama}` });
  res.json({ success: true });
});

// ---- Input Banyak for the other inventories (see /api/bbm/batch) ----
// Many Stok Masuk / Keluar in one go with one foto bukti, each booked exactly as its single-entry
// route books it, all inside one transaction: a row that doesn't pass refuses the whole batch and
// is named (`row`, 0-based) so the form can mark it. Gudang / Klinik movements are timestamped when
// saved (they have no date of their own); pupuk / oli take the batch's date.
function batchInput(req: express.Request, res: express.Response): any[] | null {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) {
    res.status(400).json({ error: "Belum ada baris yang diisi" });
    return null;
  }
  if (rows.length > BBM_BATCH_MAX) {
    res.status(400).json({ error: `Maksimal ${BBM_BATCH_MAX} baris sekali simpan` });
    return null;
  }
  return rows;
}
const refuseRow = (res: express.Response, i: number, error: string) => res.status(400).json({ error: `Baris ${i + 1}: ${error}`, row: i });

// Runs the booking; a BatchRowError (or a StockError thrown for row `at`) refuses it and gives the
// foto bukti back. Returns false when the answer has been sent.
async function bookBatch(res: express.Response, evidenceIds: string[], book: (client: PoolClient, at: (i: number) => void) => Promise<void>) {
  let current = 0;
  try {
    await withTransaction((client) => book(client, (i) => (current = i)));
    return true;
  } catch (e) {
    for (const id of evidenceIds) await releaseEvidence(id);
    if (e instanceof BatchRowError) {
      res.status(400).json({ error: e.message, row: e.row });
      return false;
    }
    if (e instanceof StockError) {
      res.status(400).json({ error: `Baris ${current + 1}: ${e.message}`, row: current });
      return false;
    }
    throw e;
  }
}

const NILAM_TUJUAN = ["NILAM", ...GUDANG_STOCK_OPTIONS];

// Gudang Nilam (items): like POST /api/transactions, a Stok Keluar to another estate also books its
// Stok Masuk there (addTransfer).
app.post("/api/transactions/batch", requireEstate("NILAM"), async (req, res) => {
  const rows = batchInput(req, res);
  if (!rows) return;
  const items = new Map(
    (await queryMany<any>("SELECT * FROM items WHERE kode = ANY(@kodes::text[])", { kodes: rows.map((r) => String(r?.item_kode ?? "")) })).map((i) => [i.kode, i])
  );
  type R = { item: any; type: "IN" | "OUT"; qty: number; tujuan: string; penerima: string; note: string };
  const clean: R[] = [];
  for (const [i, r] of rows.entries()) {
    const item = items.get(String(r?.item_kode ?? ""));
    const qty = Number(r?.qty);
    const tujuan = String(r?.tujuan ?? "");
    if (!item) return refuseRow(res, i, "barang tidak ditemukan di master data");
    if (!["IN", "OUT"].includes(r?.type)) return refuseRow(res, i, "tipe transaksi tidak valid");
    if (!Number.isFinite(qty) || qty <= 0) return refuseRow(res, i, "jumlah harus lebih dari 0");
    if (r.type === "OUT" && !NILAM_TUJUAN.includes(tujuan)) return refuseRow(res, i, "tujuan wajib dipilih");
    clean.push({ item, type: r.type, qty, tujuan: r.type === "OUT" ? tujuan : "", penerima: String(r?.penerima ?? "").trim(), note: String(r?.note ?? "").trim() });
  }
  const ev = await claimBatchEvidence(req, res, rows.length);
  if (!ev) return;

  const transfers: TransferChange[] = [];
  const ok = await bookBatch(res, ev.ids, async (client, at) => {
    for (const [i, r] of clean.entries()) {
      at(i);
      if (r.type === "OUT") {
        const cur = (await queryOne<{ s: number }>("SELECT stock_tersedia s FROM items WHERE id = @id FOR UPDATE", { id: r.item.id }, client))!;
        if (r.qty > cur.s) throw new BatchRowError(i, `Baris ${i + 1}: stok ${r.item.kode} tinggal ${cur.s}`);
      }
      const tx = await queryOne<{ id: number }>(
        `INSERT INTO transactions (item_id, tujuan, type, qty, note, penerima, evidence_id)
         VALUES (@item_id, @tujuan, @type, @qty, @note, @penerima, @evidenceId::uuid) RETURNING id`,
        { item_id: r.item.id, tujuan: r.tujuan, type: r.type, qty: r.qty, note: r.note || null, penerima: r.penerima, evidenceId: ev.of(i) },
        client
      );
      const mirror = await mirrorTransaction(client, r.item, r.type, r.tujuan, r.qty, r.note || null, r.penerima);
      await execute(`UPDATE ${mirror.source} SET evidence_id = @evidenceId::uuid WHERE id = @id`, { evidenceId: ev.of(i), id: mirror.id }, client);
      await execute("UPDATE transactions SET mirror_source = @s, mirror_id = @m WHERE id = @id", { s: mirror.source, m: mirror.id, id: tx!.id }, client);
      await applyStockEffect(client, r.item.id, r.type, r.qty, 1);
      transfers.push(r.type === "OUT" ? await addTransfer(client, req, tx!.id, r.item.kode, r.tujuan, r.qty, r.penerima, r.note, ev.of(i)) : null);
    }
  });
  if (!ok) return;
  await logActivities(
    req,
    clean.map((r) => ({
      module: "BARANG" as const,
      estate: "NILAM",
      aksi: r.type === "IN" ? "Stok Masuk" : "Stok Keluar",
      objek: `${r.item.kode} - ${r.item.nama}`,
      detail: `${movementDetail(r.qty, r.tujuan, r.penerima, r.note)}; Input Banyak (${clean.length} baris)`,
    }))
  );
  for (const [i, r] of clean.entries()) await logTransfer(req, `${r.item.kode} - ${r.item.nama}`, null, transfers[i]);
  res.json({ success: true, count: clean.length });
});

// Gudang KNS / WJA / Zamrud / Firus (gudang_stock): like POST /api/gudang-stock/transactions.
app.post("/api/gudang-stock/transactions/batch", async (req, res) => {
  const { gudang } = req.body ?? {};
  if (!GUDANG_STOCK_OPTIONS.includes(gudang)) return res.status(400).json({ error: "Gudang tidak valid" });
  if (!estateAllowed(req.user!, gudang)) return res.status(403).json({ error: "Akses ditolak" });
  const rows = batchInput(req, res);
  if (!rows) return;
  const items = new Map(
    (await queryMany<any>("SELECT kode, nama FROM items WHERE kode = ANY(@kodes::text[])", { kodes: rows.map((r) => String(r?.item_kode ?? "")) })).map((i) => [i.kode, i])
  );
  type R = { item: any; type: "IN" | "OUT"; qty: number; tujuan: string; penerima: string; note: string };
  const clean: R[] = [];
  for (const [i, r] of rows.entries()) {
    const item = items.get(String(r?.item_kode ?? ""));
    const tujuan = String(r?.tujuan ?? "");
    if (!item) return refuseRow(res, i, "barang tidak ditemukan di master data");
    if (!["IN", "OUT"].includes(r?.type)) return refuseRow(res, i, "tipe transaksi tidak valid");
    if (!validQty(GUDANG_LEDGER, r?.qty) || r.qty <= 0) return refuseRow(res, i, "jumlah harus lebih dari 0");
    if (r.type === "OUT" && !GUDANG_TUJUAN[gudang].includes(tujuan)) return refuseRow(res, i, `tujuan harus ${GUDANG_TUJUAN[gudang].join(" / ")}`);
    clean.push({ item, type: r.type, qty: round3(r.qty), tujuan: r.type === "OUT" ? tujuan : "", penerima: String(r?.penerima ?? "").trim(), note: String(r?.note ?? "").trim() });
  }
  const ev = await claimBatchEvidence(req, res, rows.length);
  if (!ev) return;

  const ok = await bookBatch(res, ev.ids, async (client, at) => {
    for (const [i, r] of clean.entries()) {
      at(i);
      const before = await applyMovement(client, req, GUDANG_LEDGER, {
        scope: gudang,
        item: r.item.kode,
        type: r.type,
        qty: r.qty,
        tujuan: r.tujuan,
        penerima: r.penerima,
        note: r.note || null,
        is_correction: 0,
        evidenceId: ev.of(i),
      });
      if (r.type === "OUT" && r.qty > before) throw new BatchRowError(i, `Baris ${i + 1}: stok ${r.item.kode} tinggal ${before}`);
    }
  });
  if (!ok) return;
  await logActivities(
    req,
    clean.map((r) => ({
      module: "BARANG" as const,
      estate: gudang,
      aksi: r.type === "IN" ? "Stok Masuk" : "Stok Keluar",
      objek: `${r.item.kode} - ${r.item.nama}`,
      detail: `${movementDetail(r.qty, r.tujuan, r.penerima, r.note)}; Input Banyak (${clean.length} baris)`,
    }))
  );
  res.json({ success: true, count: clean.length });
});

// Klinik: like POST /api/klinik-stock/transactions. Stok Masuk goes to the batch of its expiry date,
// Stok Keluar / Buang takes the batches that expire first (FEFO).
app.post("/api/klinik-stock/transactions/batch", async (req, res) => {
  const { klinik } = req.body ?? {};
  if (!checkKlinik(req, res, klinik)) return;
  const rows = batchInput(req, res);
  if (!rows) return;
  const obat = new Map(
    (await queryMany<any>("SELECT kode, nama FROM obat WHERE kode = ANY(@kodes::text[])", { kodes: rows.map((r) => String(r?.obat_kode ?? "")) })).map((o) => [o.kode, o])
  );
  type R = { obat: any; type: "IN" | "OUT"; qty: number; exp?: string; buang: boolean; penerima: string; note: string; ke: string; item?: LoanItem };
  const clean: R[] = [];
  for (const [i, r] of rows.entries()) {
    const o = obat.get(String(r?.obat_kode ?? ""));
    const exp = String(r?.expired_date ?? "");
    if (!o) return refuseRow(res, i, "obat tidak ditemukan di master data");
    if (!["IN", "OUT"].includes(r?.type)) return refuseRow(res, i, "tipe transaksi tidak valid");
    if (!Number.isInteger(r?.qty) || r.qty <= 0) return refuseRow(res, i, "jumlah harus bilangan bulat lebih dari 0");
    if (exp && !ISO_DATE.test(exp)) return refuseRow(res, i, "tanggal expired tidak valid");
    // Obat expired / rusak goes through Tarik (tab Expired & Rusak), with a second account's check.
    if (r.type === "OUT" && r.buang === true) return refuseRow(res, i, "obat expired / rusak dikeluarkan lewat tab Expired & Rusak (Tarik), bukan Input Banyak");
    const buang = false;
    const ke = r.type === "OUT" && !buang ? String(r?.ke ?? "").trim() : "";
    let item: LoanItem | undefined;
    if (ke) {
      const t = await batchTransferItem(req, "KLINIK", klinik, ke, o.kode, r.qty);
      if (typeof t === "string") return refuseRow(res, i, t);
      item = t;
    }
    clean.push({ obat: o, type: r.type, qty: r.qty, exp: r.type === "IN" ? exp : undefined, buang, penerima: buang ? "" : String(r?.penerima ?? "").trim(), note: String(r?.note ?? "").trim(), ke, item });
  }
  const ev = await claimBatchEvidence(req, res, rows.length);
  if (!ev) return;

  const transfers: LoanRow[] = [];
  const ok = await bookBatch(res, ev.ids, async (client, at) => {
    for (const [i, r] of clean.entries()) {
      at(i);
      if (r.ke) {
        const alasan = r.note || `Kirim ke Klinik ${r.ke}`;
        transfers.push(await bookLoan(client, req, { module: "KLINIK", dari: klinik, ke: r.ke, item: r.item!, qty: r.qty, alasan, tanggal: txTime.getStore()?.slice(0, 10) ?? jakartaToday(), evidenceId: ev.of(i), transfer: true }));
        continue;
      }
      await klinikMoveTx(client, req, {
        klinik,
        obat: r.obat.kode,
        type: r.type,
        qty: r.qty,
        exp: r.exp,
        tujuan: r.buang ? TUJUAN_DIBUANG : "",
        penerima: r.penerima,
        note: r.note || null,
        is_correction: 0,
        evidenceId: ev.of(i),
      });
    }
  });
  if (!ok) return;
  for (const l of transfers) await logLoan(req, l, "Transfer Baru", transferLogDetail(l));
  await logActivities(
    req,
    clean.filter((r) => !r.ke).map((r) => ({
      module: "KLINIK" as const,
      estate: klinik,
      aksi: r.type === "IN" ? "Stok Masuk" : r.buang ? "Buang Obat Expired" : "Stok Keluar",
      objek: `${r.obat.kode} - ${r.obat.nama}`,
      detail: [movementDetail(r.qty, undefined, r.penerima, r.note), r.exp !== undefined && `Batch expired: ${expText(r.exp)}`, `Input Banyak (${clean.length} baris)`]
        .filter(Boolean)
        .join("; "),
    }))
  );
  res.json({ success: true, count: clean.length });
});

// Pupuk / oli: saldo rows on the batch's date, each jenis running on from its latest saldo (like the
// single entry, keluar / pemakaian may take it below zero). The estate's ledger is locked meanwhile.
app.post("/api/pupuk/batch", async (req, res) => {
  const { estate, tanggal_iso } = req.body ?? {};
  if (!checkPupukEstate(req, res, estate)) return;
  if (!ISO_DATE.test(tanggal_iso || "")) return res.status(400).json({ error: "Tanggal tidak valid" });
  const rows = batchInput(req, res);
  if (!rows) return;
  type R = { jenis: string; tipe: "MASUK" | "KELUAR"; qty: number; divisi: string; blok: string; ha: number | null; pokok: number | null; keterangan: string; ke: string; item?: LoanItem };
  const clean: R[] = [];
  for (const [i, r] of rows.entries()) {
    const jenis = String(r?.jenis_pupuk ?? "").trim().toUpperCase();
    const qty = Number(r?.jumlah);
    if (!jenis) return refuseRow(res, i, "jenis pupuk wajib diisi");
    if (!(await pupukJenisOk(estate, jenis))) return refuseRow(res, i, `jenis pupuk ${jenis} tidak ada di Master Data Pupuk`);
    if (!["MASUK", "KELUAR"].includes(r?.tipe)) return refuseRow(res, i, "tipe transaksi tidak valid");
    if (!Number.isFinite(qty) || qty <= 0) return refuseRow(res, i, "jumlah harus lebih dari 0");
    const keluar = r.tipe === "KELUAR";
    const ha = keluar ? optNum(r?.ha) : null;
    const pokok = keluar ? optNum(r?.pokok) : null;
    if ((ha !== null && !Number.isFinite(ha)) || (pokok !== null && !Number.isFinite(pokok))) return refuseRow(res, i, "HA / pokok harus angka");
    const ke = keluar ? String(r?.ke ?? "").trim() : "";
    let item: LoanItem | undefined;
    if (ke) {
      const t = await batchTransferItem(req, "PUPUK", estate, ke, jenis, qty);
      if (typeof t === "string") return refuseRow(res, i, t);
      item = t;
    }
    clean.push({
      ke,
      item,
      jenis,
      tipe: r.tipe,
      qty: round3(qty),
      divisi: keluar ? String(r?.divisi ?? "").trim() : "",
      blok: keluar ? String(r?.blok ?? "").trim().toUpperCase().replace(/\./g, "") : "",
      ha,
      pokok,
      keterangan: String(r?.keterangan ?? "").trim() || (r.tipe === "MASUK" ? "PUPUK MASUK" : ""),
    });
  }
  const ev = await claimBatchEvidence(req, res, rows.length);
  if (!ev) return;

  const [y, m, d] = tanggal_iso.split("-");
  const tanggal = `${d}/${m}/${y}`;
  const periode = `${INDO_MONTHS[Number(m) - 1]} ${y}`;
  const saldo: { before: number; after: number }[] = [];
  const transfers: LoanRow[] = [];
  const ok = await bookBatch(res, ev.ids, async (client, at) => {
    await execute("SELECT pg_advisory_xact_lock(hashtext(@key))", { key: `pupuk:${estate}` }, client);
    const run = new Map<string, number>();
    for (const [i, r] of clean.entries()) {
      at(i);
      if (!run.has(r.jenis)) run.set(r.jenis, await saldoAsOf("PUPUK", estate, r.jenis, tanggal_iso, client));
      const before = run.get(r.jenis)!;
      const after = round3(r.tipe === "MASUK" ? before + r.qty : before - r.qty);
      run.set(r.jenis, after);
      saldo.push({ before, after });
      if (r.ke) {
        const alasan = r.keterangan || `Kirim ke ${r.ke}`;
        transfers.push(await bookLoan(client, req, { module: "PUPUK", dari: estate, ke: r.ke, item: r.item!, qty: r.qty, alasan, tanggal: tanggal_iso, evidenceId: ev.of(i), transfer: true }));
        continue;
      }
      await execute(
        `INSERT INTO pupuk_log (estate, jenis_pupuk, periode, tanggal, tanggal_iso, divisi, no_embrace, kode_barang, keluar, diterima, saldo_stock, keterangan, blok, ha, pokok, evidence_id)
         VALUES (@estate, @jenis, @periode, @tanggal, @tanggal_iso, @divisi, '', '', @keluar, @diterima, @after, @keterangan, @blok, @ha, @pokok, @evidenceId::uuid)`,
        { estate, periode, tanggal, tanggal_iso, evidenceId: ev.of(i), ...r, after, keluar: r.tipe === "KELUAR" ? r.qty : null, diterima: r.tipe === "MASUK" ? r.qty : null },
        client
      );
    }
    for (const jenis of run.keys()) await rechainSaldo("PUPUK", estate, jenis, tanggal_iso, client);
  });
  if (!ok) return;
  for (const l of transfers) await logLoan(req, l, "Transfer Baru", transferLogDetail(l));
  await logActivities(
    req,
    clean.flatMap((r, i) => (r.ke ? [] : [{ r, i }])).map(({ r, i }) => ({
      module: "PUPUK" as const,
      estate,
      aksi: r.tipe === "MASUK" ? "Stok Masuk" : "Stok Keluar",
      objek: pupukObjek({ jenis_pupuk: r.jenis, tanggal, blok: r.blok }),
      detail: [`Jumlah: ${r.qty} KG`, `Saldo: ${saldo[i].before} → ${saldo[i].after}`, r.divisi && `Divisi: ${r.divisi}`, r.keterangan && `Keterangan: ${r.keterangan}`, `Input Banyak (${clean.length} baris)`]
        .filter(Boolean)
        .join("; "),
    }))
  );
  res.json({ success: true, count: clean.length });
});

app.post("/api/oli/batch", async (req, res) => {
  const { estate, tanggal_iso } = req.body ?? {};
  if (!checkOliEstate(req, res, estate)) return;
  if (!ISO_DATE.test(tanggal_iso || "")) return res.status(400).json({ error: "Tanggal tidak valid" });
  const rows = batchInput(req, res);
  if (!rows) return;
  const known = new Set((await queryMany<{ nama: string }>(`SELECT nama FROM master_oli WHERE ${OLI_AT_ESTATE}`, { estate })).map((o) => o.nama));
  type R = { jenis: string; tipe: "MASUK" | "PEMAKAIAN"; qty: number; no_embrace: string; keterangan: string; ke: string; item?: LoanItem };
  const clean: R[] = [];
  for (const [i, r] of rows.entries()) {
    const jenis = String(r?.jenis_oli ?? "").trim().toUpperCase();
    const qty = Number(r?.jumlah);
    if (!known.has(jenis)) return refuseRow(res, i, `jenis oli ${jenis || "-"} belum ada di Master Data Oli`);
    if (!["MASUK", "PEMAKAIAN"].includes(r?.tipe)) return refuseRow(res, i, "tipe transaksi tidak valid");
    if (!Number.isFinite(qty) || qty <= 0) return refuseRow(res, i, "jumlah harus lebih dari 0");
    const ke = r.tipe === "PEMAKAIAN" ? String(r?.ke ?? "").trim() : "";
    let item: LoanItem | undefined;
    if (ke) {
      const t = await batchTransferItem(req, "OLI", estate, ke, jenis, qty);
      if (typeof t === "string") return refuseRow(res, i, t);
      item = t;
    }
    clean.push({ ke, item, jenis, tipe: r.tipe, qty: round3(qty), no_embrace: String(r?.no_embrace ?? "").trim(), keterangan: String(r?.keterangan ?? "").trim() || (r.tipe === "MASUK" ? "OLI MASUK" : "") });
  }
  const ev = await claimBatchEvidence(req, res, rows.length);
  if (!ev) return;

  const { tanggal, periode } = oliDate(tanggal_iso);
  const saldo: { before: number; after: number }[] = [];
  const transfers: LoanRow[] = [];
  const ok = await bookBatch(res, ev.ids, async (client, at) => {
    await execute("SELECT pg_advisory_xact_lock(hashtext(@key))", { key: `oli:${estate}` }, client);
    const run = new Map<string, number>();
    for (const [i, r] of clean.entries()) {
      at(i);
      if (!run.has(r.jenis)) run.set(r.jenis, await saldoAsOf("OLI", estate, r.jenis, tanggal_iso, client));
      const before = run.get(r.jenis)!;
      const after = round3(r.tipe === "MASUK" ? before + r.qty : before - r.qty);
      run.set(r.jenis, after);
      saldo.push({ before, after });
      if (r.ke) {
        const alasan = r.keterangan || `Kirim ke ${r.ke}`;
        transfers.push(await bookLoan(client, req, { module: "OLI", dari: estate, ke: r.ke, item: r.item!, qty: r.qty, alasan, tanggal: tanggal_iso, evidenceId: ev.of(i), transfer: true }));
        continue;
      }
      await execute(
        `INSERT INTO oli_log (estate, jenis_oli, periode, tanggal, tanggal_iso, no_embrace, diterima, pemakaian, saldo_stock, keterangan, evidence_id)
         VALUES (@estate, @jenis, @periode, @tanggal, @tanggal_iso, @no_embrace, @diterima, @pemakaian, @after, @keterangan, @evidenceId::uuid)`,
        { estate, periode, tanggal, tanggal_iso, evidenceId: ev.of(i), ...r, after, diterima: r.tipe === "MASUK" ? r.qty : null, pemakaian: r.tipe === "PEMAKAIAN" ? r.qty : null },
        client
      );
    }
    for (const jenis of run.keys()) await rechainSaldo("OLI", estate, jenis, tanggal_iso, client);
  });
  if (!ok) return;
  for (const l of transfers) await logLoan(req, l, "Transfer Baru", transferLogDetail(l));
  await logActivities(
    req,
    clean.flatMap((r, i) => (r.ke ? [] : [{ r, i }])).map(({ r, i }) => ({
      module: "OLI" as const,
      estate,
      aksi: r.tipe === "MASUK" ? "Stok Masuk" : "Stok Keluar",
      objek: oliObjek({ jenis_oli: r.jenis, tanggal }),
      detail: [`Jumlah: ${r.qty} LTR`, `Saldo: ${saldo[i].before} → ${saldo[i].after}`, r.no_embrace && `No. BPB: ${r.no_embrace}`, r.keterangan && `Keterangan: ${r.keterangan}`, `Input Banyak (${clean.length} baris)`]
        .filter(Boolean)
        .join("; "),
    }))
  );
  res.json({ success: true, count: clean.length });
});

// ---- Pinjaman antar estate (see schema.sql pinjaman) ----
// Estate A lends estate B stock of one item: A gets a Stok Keluar and B a Stok Masuk at once (no
// confirmation step). B returns the same item, all at once or in parts, which books the reverse
// until the loan is LUNAS; a loan nothing came back on yet can be cancelled (Batal = full return).
// Only the lending estate (module Input permission there) records a loan; a return or cancel may be
// recorded by either of the two estates.
// A Transfer (jenis TRANSFER) is the same pair of rows with nothing coming back: stock one estate
// sends another for good (e.g. Firus -> Nilam, or BBM from the Nilam depot into Zamrud's tank).
type LoanModule = OpnameModule;
type LoanRow = {
  id: number;
  module: LoanModule;
  kode: string;
  nama: string;
  satuan: string;
  dari_estate: string;
  ke_estate: string;
  qty: number;
  qty_kembali: number;
  status: "DIPINJAM" | "LUNAS" | "BATAL" | "TRANSFER";
  jenis: "PINJAM" | "TRANSFER";
  alasan: string;
  tanggal_iso: string;
};
const loanLabel = (l: Pick<LoanRow, "id" | "jenis">) => `${l.jenis === "TRANSFER" ? "Transfer" : "Pinjaman"} #${l.id}`;
const loanPerm = (m: LoanModule, a: "view" | "input") => `${m.toLowerCase()}.${a}`;
const canLoan = (user: SessionUser, m: LoanModule, a: "view" | "input") => user.role === "superuser" || user.perms.includes(loanPerm(m, a));
// Nilam's gudang (items) and Klinik count whole units; the other gudang, BBM, pupuk and oli decimals.
const loanWhole = (m: LoanModule, a: string, b: string) => m === "KLINIK" || (m === "GUDANG" && (a === "NILAM" || b === "NILAM"));
const jakartaToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

type LoanItem = { kode: string; nama: string; satuan: string; stok: number };

// What the lender has of `kode` now (and its name / satuan); null = not in the master data.
async function loanItem(module: LoanModule, estate: string, kode: string, client?: PoolClient): Promise<LoanItem | null | undefined> {
  if (module === "GUDANG") {
    return queryOne<LoanItem>(
      `SELECT i.kode, i.nama, COALESCE(i.satuan, '') satuan,
         ${estate === "NILAM" ? "COALESCE(i.stock_tersedia, 0)" : "COALESCE(gs.stock_tersedia, 0)"}::float8 stok
       FROM items i LEFT JOIN gudang_stock gs ON gs.item_kode = i.kode AND gs.gudang = @estate WHERE i.kode = @kode`,
      { estate, kode },
      client
    );
  }
  if (module === "KLINIK") {
    return queryOne<LoanItem>(
      `SELECT o.kode, o.nama, COALESCE(o.satuan, '') satuan, COALESCE(ks.stock_tersedia, 0)::float8 stok
       FROM obat o LEFT JOIN klinik_stock ks ON ks.obat_kode = o.kode AND ks.klinik = @estate WHERE o.kode = @kode`,
      { estate, kode },
      client
    );
  }
  if (module === "BBM" && !BBM_JENIS.includes(kode)) return null;
  if (module === "OLI" && !(await queryOne(`SELECT 1 FROM master_oli WHERE nama = @kode AND ${OLI_AT_ESTATE}`, { kode, estate }, client))) return null;
  const stok = (await latestSaldoRow(module as SaldoModule, estate, kode, client))?.saldo_stock ?? 0;
  return { kode, nama: kode, satuan: module === "PUPUK" ? "KG" : "LTR", stok };
}

// One side of a loan movement: `type` OUT at the estate giving, IN at the estate receiving. Klinik
// OUT takes the batches expiring first and returns them, so the IN side can add the same batches.
async function loanMove(
  client: PoolClient,
  req: express.Request,
  l: {
    module: LoanModule;
    estate: string;
    kode: string;
    type: "IN" | "OUT";
    qty: number;
    note: string;
    pinjamanId: number;
    evidenceId: string | null;
    alloc?: Alloc[];
    // BBM / pupuk / oli: the date of the row (a transfer dated by the form); absent = today.
    iso?: string;
  }
): Promise<Alloc[] | undefined> {
  const short = (have: number) => new StockError(`Stok ${l.kode} di ${l.estate} hanya ${round3(have)}`);
  if (l.module === "GUDANG" && l.estate === "NILAM") {
    const item = await queryOne<any>("SELECT * FROM items WHERE kode = @kode FOR UPDATE", { kode: l.kode }, client);
    if (!item) throw new StockError(`Barang ${l.kode} tidak ada di master data`);
    if (l.type === "OUT" && item.stock_tersedia < l.qty) throw short(item.stock_tersedia);
    const tx = await queryOne<{ id: number }>(
      `INSERT INTO transactions (item_id, tujuan, type, qty, note, penerima, pinjaman_id, evidence_id)
       VALUES (@item_id, 'PINJAMAN', @type, @qty, @note, '', @pid, @ev::uuid) RETURNING id`,
      { item_id: item.id, type: l.type, qty: l.qty, note: l.note, pid: l.pinjamanId, ev: l.evidenceId },
      client
    );
    const mirror = await mirrorTransaction(client, item, l.type, "PINJAMAN", l.qty, l.note, "");
    await execute(`UPDATE ${mirror.source} SET pinjaman_id = @pid, evidence_id = @ev::uuid WHERE id = @id`, { pid: l.pinjamanId, ev: l.evidenceId, id: mirror.id }, client);
    await execute("UPDATE transactions SET mirror_source = @s, mirror_id = @m WHERE id = @id", { s: mirror.source, m: mirror.id, id: tx!.id }, client);
    await applyStockEffect(client, item.id, l.type, l.qty, 1);
    return undefined;
  }
  if (l.module === "GUDANG") {
    const before = await applyMovement(client, req, GUDANG_LEDGER, {
      scope: l.estate,
      item: l.kode,
      type: l.type,
      qty: l.qty,
      tujuan: "PINJAMAN",
      penerima: "",
      note: l.note,
      is_correction: 0,
      pinjamanId: l.pinjamanId,
      evidenceId: l.evidenceId,
    });
    if (l.type === "OUT" && before < l.qty) throw short(before);
    return undefined;
  }
  if (l.module === "KLINIK") {
    let alloc: Alloc[];
    if (l.type === "OUT") alloc = await takeFromBatches(client, l.estate, l.kode, l.qty);
    else {
      alloc = l.alloc ?? [{ exp: "", qty: l.qty }];
      for (const a of alloc) await addToBatch(client, l.estate, l.kode, a.exp, a.qty);
    }
    await execute(
      `INSERT INTO klinik_stock_tx (klinik, obat_kode, type, qty, tujuan, penerima, note, is_correction, user_id, alloc, pinjaman_id, evidence_id)
       VALUES (@klinik, @obat, @type, @qty, 'PINJAMAN', '', @note, 0, @uid, @alloc::jsonb, @pid, @ev::uuid)`,
      {
        klinik: l.estate,
        obat: l.kode,
        type: l.type,
        qty: l.qty,
        note: l.note,
        uid: req.user!.id,
        alloc: JSON.stringify(alloc),
        pid: l.pinjamanId,
        ev: l.evidenceId,
      },
      client
    );
    await syncKlinikStock(client, l.estate, l.kode);
    return alloc;
  }

  // BBM / pupuk / oli: a saldo row with the qty in `pinjam`, dated today (or after the latest row so
  // it becomes the saldo). A BBM Stok Keluar can't exceed the saldo, like on the BBM page.
  const module = l.module as SaldoModule;
  const t = SALDO_LEDGER[module];
  const now = (await latestSaldoRow(module, l.estate, l.kode, client))?.saldo_stock ?? 0;
  const signed = l.type === "IN" ? l.qty : -l.qty;
  const lastIso =
    (
      await queryOne<{ d: string | null }>(
        `SELECT MAX(tanggal_iso) d FROM ${t.table} WHERE ${t.jenis} = @jenis AND ${t.estate} = @estate`,
        { jenis: l.kode, estate: l.estate },
        client
      )
    )?.d ?? "";
  const today = jakartaToday();
  const iso = l.iso ?? (lastIso > today ? lastIso : today);
  const before = l.iso ? await saldoAsOf(module, l.estate, l.kode, iso, client) : now;
  // A BBM Stok Keluar can't exceed the saldo - on its own day and on every later row, which it lowers
  // too (a loan / transfer dated back), not just today's.
  if (module === "BBM" && l.type === "OUT") {
    const later = await queryOne<{ m: number | null }>(
      `SELECT MIN(saldo_stock)::float8 m FROM ${t.table} WHERE ${t.jenis} = @jenis AND ${t.estate} = @estate AND tanggal_iso > @iso AND saldo_stock IS NOT NULL`,
      { jenis: l.kode, estate: l.estate, iso },
      client
    );
    const lowest = Math.min(before, later?.m ?? before);
    if (lowest < l.qty) throw short(lowest);
  }
  const p = { estate: l.estate, jenis: l.kode, iso, saldo: round3(before + signed), pinjam: signed, note: l.note, pid: l.pinjamanId, ev: l.evidenceId };
  if (module === "BBM") {
    const { tanggal, periode } = isoToIndoDate(iso);
    await execute(
      `INSERT INTO bbm_log (jenis_bbm, lokasi, estate, periode, tanggal, tanggal_iso, no_spb, pinjam, saldo_stock, keterangan, kode_kendaraan, hm_terakhir, pinjaman_id, evidence_id)
       VALUES (@jenis, @estate, @estate, @periode, @tanggal, @iso, '', @pinjam, @saldo, @note, '', '', @pid, @ev::uuid)`,
      { ...p, tanggal, periode },
      client
    );
    if (l.iso) await rechainSaldo(module, l.estate, l.kode, iso, client);
    return undefined;
  }
  const [y, m, d] = iso.split("-");
  const date = { periode: `${INDO_MONTHS[Number(m) - 1]} ${y}`, tanggal: `${d}/${m}/${y}` };
  if (module === "OLI") {
    await execute(
      `INSERT INTO oli_log (estate, jenis_oli, periode, tanggal, tanggal_iso, no_embrace, pinjam, saldo_stock, keterangan, pinjaman_id, evidence_id)
       VALUES (@estate, @jenis, @periode, @tanggal, @iso, '', @pinjam, @saldo, @note, @pid, @ev::uuid)`,
      { ...p, ...date },
      client
    );
  } else {
    await execute(
      `INSERT INTO pupuk_log (estate, jenis_pupuk, periode, tanggal, tanggal_iso, divisi, no_embrace, kode_barang, pinjam, saldo_stock, keterangan, blok, pinjaman_id, evidence_id)
       VALUES (@estate, @jenis, @periode, @tanggal, @iso, '', '', '', @pinjam, @saldo, @note, '', @pid, @ev::uuid)`,
      { ...p, ...date },
      client
    );
  }
  if (l.iso) await rechainSaldo(module, l.estate, l.kode, iso, client);
  return undefined;
}

const loanObjek = (l: Pick<LoanRow, "id" | "jenis" | "kode" | "nama">) => `${loanLabel(l)} - ${l.kode === l.nama ? l.nama : `${l.kode} - ${l.nama}`}`;
const fmtLoanQty = (n: number, satuan: string) => `${round3(n).toLocaleString("id-ID")} ${satuan}`;

// Moves `qty` of loan `l`'s item from `from` to `to` (the loan itself, or a return the other way).
async function loanTransfer(
  client: PoolClient,
  req: express.Request,
  l: LoanRow,
  from: string,
  to: string,
  qty: number,
  outNote: string,
  inNote: string,
  evidenceId: string | null,
  iso?: string
) {
  const base = { module: l.module, kode: l.kode, qty, pinjamanId: l.id, evidenceId, iso };
  const alloc = await loanMove(client, req, { ...base, estate: from, type: "OUT", note: outNote });
  await loanMove(client, req, { ...base, estate: to, type: "IN", note: inNote, alloc });
}

// One Pinjaman / Transfer: its row, the lender's Stok Keluar and the borrower's Stok Masuk.
async function bookLoan(
  client: PoolClient,
  req: express.Request,
  b: { module: LoanModule; dari: string; ke: string; item: LoanItem; qty: number; alasan: string; tanggal: string; evidenceId: string | null; transfer: boolean }
): Promise<LoanRow> {
  const l = (await queryOne<LoanRow>(
    `INSERT INTO pinjaman (module, kode, nama, satuan, dari_estate, ke_estate, qty, alasan, tanggal_iso, user_id, evidence_id, jenis, status)
     VALUES (@module, @kode, @nama, @satuan, @dari, @ke, @qty, @alasan, @tanggal, @uid, @ev::uuid, @jenis, @status) RETURNING *`,
    {
      module: b.module,
      kode: b.item.kode,
      nama: b.item.nama,
      satuan: b.item.satuan,
      dari: b.dari,
      ke: b.ke,
      qty: round3(b.qty),
      alasan: b.alasan,
      tanggal: b.tanggal,
      uid: req.user!.id,
      ev: b.evidenceId,
      jenis: b.transfer ? "TRANSFER" : "PINJAM",
      status: b.transfer ? "TRANSFER" : "DIPINJAM",
    },
    client
  ))!;
  await loanTransfer(
    client,
    req,
    l,
    b.dari,
    b.ke,
    l.qty,
    b.transfer ? `Transfer ke ${b.ke} (Transfer #${l.id}): ${b.alasan}` : `Dipinjamkan ke ${b.ke} (Pinjaman #${l.id}): ${b.alasan}`,
    b.transfer ? `Transfer dari ${b.dari} (Transfer #${l.id}): ${b.alasan}` : `Pinjam dari ${b.dari} (Pinjaman #${l.id}): ${b.alasan}`,
    b.evidenceId,
    b.tanggal
  );
  return l;
}

// Input Banyak from Nilam: a Stok Keluar row with a Tujuan (another estate) is booked as a Transfer,
// so that estate's stock goes up at once. Checks the row's Tujuan; the item, or an error for the row.
async function batchTransferItem(req: express.Request, m: LoanModule, dari: string, ke: string, kode: string, qty: number): Promise<LoanItem | string> {
  if (!(ESTATES as readonly string[]).includes(ke) || ke === dari) return "tujuan tidak valid";
  if (!canLoan(req.user!, m, "input")) return "akun ini tidak bisa mencatat transfer";
  if (loanWhole(m, dari, ke) && !Number.isInteger(qty)) return "jumlah transfer harus bilangan bulat";
  return (await loanItem(m, dari, kode)) ?? "barang tidak ditemukan di master data";
}
const transferLogDetail = (l: LoanRow) => `${l.dari_estate} mengirim ${fmtLoanQty(l.qty, l.satuan)} ke ${l.ke_estate} (${l.tanggal_iso}); Keterangan: ${l.alasan}; Input Banyak`;

// Logged in both estates' activity log.
async function logLoan(req: express.Request, l: LoanRow, aksi: string, detail: string) {
  const objek = loanObjek(l);
  const module = OPNAME_LOG_MODULE[l.module];
  await logActivities(req, [
    { module, estate: l.dari_estate, aksi, objek, detail },
    { module, estate: l.ke_estate, aksi, objek, detail },
  ]);
}

app.get("/api/pinjaman", async (req, res) => {
  const { module = "", estate = "", estates: picked = "", status = "", page = "1", pageSize = "50" } = req.query as Record<string, string>;
  const u = req.user!;
  const modules = OPNAME_MODULES_LIST.filter((m) => canLoan(u, m, "view") && (!module || m === module));
  const estates = listEstates(u, estate, picked);
  if (!modules.length || !estates.length) return res.json({ data: [], total: 0 });
  const conditions = ["p.module = ANY(@modules::text[])", "(p.dari_estate = ANY(@estates::text[]) OR p.ke_estate = ANY(@estates::text[]))"];
  if (status === "OPEN") conditions.push("p.status = 'DIPINJAM'");
  else if (["LUNAS", "BATAL", "TRANSFER"].includes(status)) conditions.push("p.status = @status");
  const where = `WHERE ${conditions.join(" AND ")}`;
  const params = { modules, estates, status };
  const total = (await queryOne<{ c: number }>(`SELECT COUNT(*)::int c FROM pinjaman p ${where}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 200);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT p.*, COALESCE(u.nama, u.username, '') AS dibuat_oleh,
       COALESCE((SELECT json_agg(json_build_object('qty', k.qty, 'tanggal_iso', k.tanggal_iso, 'note', k.note, 'batal', k.batal,
                   'oleh', COALESCE(ku.nama, ku.username, ''), 'evidence_id', k.evidence_id, 'created_at', k.created_at) ORDER BY k.id)
                 FROM pinjaman_kembali k LEFT JOIN users ku ON ku.id = k.user_id WHERE k.pinjaman_id = p.id), '[]') AS kembali
     FROM pinjaman p LEFT JOIN users u ON u.id = p.user_id ${where}
     ORDER BY (p.status = 'DIPINJAM') DESC, p.id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total });
});

// Log Pinjaman: every event in time order, newest first - a loan or transfer made, a return (KEMBALI,
// or LUNAS when it brings the loan's returns up to its qty) and a cancellation - so what got cleared
// and when shows without opening each loan. `ringkasan` = the monitoring counts over the same filter.
app.get("/api/pinjaman/log", async (req, res) => {
  const { module = "", estates: picked = "", aksi = "", page = "1", pageSize = "50" } = req.query as Record<string, string>;
  const u = req.user!;
  const modules = OPNAME_MODULES_LIST.filter((m) => canLoan(u, m, "view") && (!module || m === module));
  const estates = listEstates(u, "", picked);
  const empty = { data: [], total: 0, ringkasan: { open: 0, telat: 0, lunas30: 0, transfer30: 0, rata_hari: null } };
  if (!modules.length || !estates.length) return res.json(empty);
  const scope = "p.module = ANY(@modules::text[]) AND (p.dari_estate = ANY(@estates::text[]) OR p.ke_estate = ANY(@estates::text[]))";
  const events = `
    SELECT p.id AS pinjaman_id, p.jenis AS aksi, p.qty, p.tanggal_iso, p.created_at, p.alasan AS note, p.evidence_id, p.user_id, 0 AS ord
      FROM pinjaman p WHERE ${scope}
    UNION ALL
    SELECT k.pinjaman_id, CASE WHEN k.batal THEN 'BATAL' WHEN k.kumulatif >= p.qty - 0.0005 THEN 'LUNAS' ELSE 'KEMBALI' END,
           k.qty, k.tanggal_iso, k.created_at, k.note, k.evidence_id, k.user_id, k.id
      FROM (SELECT k.*, SUM(CASE WHEN k.batal THEN 0 ELSE k.qty END) OVER (PARTITION BY k.pinjaman_id ORDER BY k.id) AS kumulatif
              FROM pinjaman_kembali k) k
      JOIN pinjaman p ON p.id = k.pinjaman_id WHERE ${scope}`;
  const where = ["PINJAM", "TRANSFER", "KEMBALI", "LUNAS", "BATAL"].includes(aksi) ? "WHERE e.aksi = @aksi" : "";
  const params = { modules, estates, aksi };
  const total = (await queryOne<{ c: number }>(`SELECT COUNT(*)::int c FROM (${events}) e ${where}`, params))!.c;
  const limit = Math.min(parseInt(pageSize) || 50, 200);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT e.*, p.module, p.kode, p.nama, p.satuan, p.dari_estate, p.ke_estate, p.qty AS qty_pinjam, p.tanggal_iso AS tanggal_pinjam,
            COALESCE(us.nama, us.username, '') AS oleh
       FROM (${events}) e JOIN pinjaman p ON p.id = e.pinjaman_id LEFT JOIN users us ON us.id = e.user_id ${where}
      ORDER BY e.created_at DESC, e.pinjaman_id DESC, e.ord DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  // Days a loan took to clear = from the loan's date to the date of the return that made it lunas.
  const ringkasan = await queryOne(
    `SELECT COUNT(*) FILTER (WHERE p.status = 'DIPINJAM')::int AS open,
            COUNT(*) FILTER (WHERE p.status = 'DIPINJAM' AND p.tanggal_iso::date <= CURRENT_DATE - @late::int)::int AS telat,
            COUNT(*) FILTER (WHERE p.status = 'LUNAS' AND l.tgl::date >= CURRENT_DATE - 30)::int AS lunas30,
            COUNT(*) FILTER (WHERE p.status = 'TRANSFER' AND p.tanggal_iso::date >= CURRENT_DATE - 30)::int AS transfer30,
            ROUND(AVG(l.tgl::date - p.tanggal_iso::date) FILTER (WHERE p.status = 'LUNAS' AND l.tgl::date >= CURRENT_DATE - 90))::int AS rata_hari
       FROM pinjaman p
       LEFT JOIN LATERAL (SELECT MAX(k.tanggal_iso) AS tgl FROM pinjaman_kembali k WHERE k.pinjaman_id = p.id AND NOT k.batal) l ON true
      WHERE ${scope}`,
    { modules, estates, late: 14 } // = LOAN_LATE_DAYS (useOpenPinjaman.ts)
  );
  res.json({ data, total, ringkasan });
});

// The items the lender can lend: its stock of that module (only stock > 0 for gudang / klinik).
app.get("/api/pinjaman/barang", async (req, res) => {
  const { module = "", estate = "", search = "", all = "" } = req.query as Record<string, string>;
  const m = module as LoanModule;
  // all=1: every barang with stock (Input Banyak lists them all), else the first 30 that match.
  const limit = all === "1" ? 5000 : 30;
  if (!OPNAME_MODULES_LIST.includes(m)) return res.status(400).json({ error: "Modul tidak valid" });
  if (!(ESTATES as readonly string[]).includes(estate)) return res.status(400).json({ error: "Estate tidak valid" });
  if (!canLoan(req.user!, m, "input") || !estateAllowed(req.user!, estate)) return res.status(403).json({ error: "Akses ditolak" });
  const like = `%${search}%`;
  if (m === "GUDANG") {
    const data =
      estate === "NILAM"
        ? await queryMany(
            `SELECT kode, nama, COALESCE(satuan, '') satuan, stock_tersedia::float8 stok FROM items
             WHERE stock_tersedia > 0 AND (@search = '' OR kode ILIKE @like OR nama ILIKE @like) ORDER BY nama LIMIT @limit`,
            { search, like, limit }
          )
        : await queryMany(
            `SELECT i.kode, i.nama, COALESCE(i.satuan, '') satuan, gs.stock_tersedia::float8 stok FROM gudang_stock gs JOIN items i ON i.kode = gs.item_kode
             WHERE gs.gudang = @estate AND gs.stock_tersedia > 0 AND (@search = '' OR i.kode ILIKE @like OR i.nama ILIKE @like) ORDER BY i.nama LIMIT @limit`,
            { estate, search, like, limit }
          );
    return res.json(data);
  }
  if (m === "KLINIK") {
    return res.json(
      await queryMany(
        `SELECT o.kode, o.nama, COALESCE(o.satuan, '') satuan, ks.stock_tersedia::float8 stok FROM klinik_stock ks JOIN obat o ON o.kode = ks.obat_kode
         WHERE ks.klinik = @estate AND ks.stock_tersedia > 0 AND (@search = '' OR o.kode ILIKE @like OR o.nama ILIKE @like) ORDER BY o.nama LIMIT @limit`,
        { estate, search, like, limit }
      )
    );
  }
  const jenis =
    m === "BBM"
      ? BBM_JENIS
      : m === "OLI"
        ? (await queryMany<{ v: string }>("SELECT nama v FROM master_oli ORDER BY nama")).map((r) => r.v)
        : (await queryMany<{ v: string }>(`SELECT nama v FROM master_pupuk WHERE ${OLI_AT_ESTATE} UNION SELECT DISTINCT jenis_pupuk FROM pupuk_log WHERE estate = @estate ORDER BY 1`, { estate })).map((r) => r.v);
  const data: LoanItem[] = [];
  for (const j of jenis) {
    const it = await loanItem(m, estate, j);
    if (it && (!search || it.nama.toLowerCase().includes(search.toLowerCase()))) data.push(it);
  }
  res.json(data);
});

app.post("/api/pinjaman", async (req, res) => {
  const { module, dari, ke, kode } = req.body;
  const alasan = String(req.body.alasan ?? "").trim();
  const qty = Number(req.body.qty);
  const u = req.user!;
  const m = module as LoanModule;
  const transfer = req.body.jenis === "TRANSFER";
  const word = transfer ? "Transfer" : "Pinjaman";
  // A loan / transfer entered later is dated back: BBM / pupuk / oli rows follow tanggal_iso, gudang /
  // klinik movements take it through txTime (BACKDATE, which also checks the stok opname).
  const tanggal = ISO_DATE.test(String(req.body.tanggal_iso ?? "")) ? String(req.body.tanggal_iso) : jakartaToday();
  if (tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak boleh di masa depan" });
  if (!OPNAME_MODULES_LIST.includes(m)) return res.status(400).json({ error: "Modul tidak valid" });
  if (!(ESTATES as readonly string[]).includes(dari) || !(ESTATES as readonly string[]).includes(ke)) return res.status(400).json({ error: "Estate tidak valid" });
  if (dari === ke) return res.status(400).json({ error: "Estate tujuan harus beda dengan estate asal" });
  if (!canLoan(u, m, "input") || !estateAllowed(u, dari))
    return res.status(403).json({ error: `${word} hanya bisa dicatat oleh estate yang mengirim barang` });
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
  if (loanWhole(m, dari, ke) && !Number.isInteger(qty)) return res.status(400).json({ error: "Jumlah harus bilangan bulat" });
  if (!alasan) return res.status(400).json({ error: transfer ? "Keterangan wajib diisi" : "Alasan wajib diisi" });
  const item = await loanItem(m, dari, String(kode ?? ""));
  if (!item) return res.status(404).json({ error: "Barang tidak ditemukan di master data" });
  const evidenceId = await claimEvidence(req, res);
  if (evidenceId === undefined) return;

  let loan: LoanRow;
  try {
    loan = await withTransaction((client) => bookLoan(client, req, { module: m, dari, ke, item, qty, alasan, tanggal, evidenceId, transfer }));
  } catch (e) {
    await releaseEvidence(evidenceId);
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  await logLoan(
    req,
    loan,
    transfer ? "Transfer Baru" : "Pinjaman Baru",
    transfer
      ? `${dari} mengirim ${fmtLoanQty(loan.qty, loan.satuan)} ke ${ke} (${tanggal}); Keterangan: ${alasan}`
      : `${dari} meminjamkan ${fmtLoanQty(loan.qty, loan.satuan)} ke ${ke} (${tanggal}); Alasan: ${alasan}`
  );
  res.json({ success: true, id: loan.id });
});

// Input Banyak Pinjaman: many barang lent by one estate to another at once, one foto bukti. Each row
// is its own Pinjaman (returned on its own later), all saved or none - a row the stock can't cover
// is refused with its number.
app.post("/api/pinjaman/batch", async (req, res) => {
  const { module, dari, ke } = req.body ?? {};
  const u = req.user!;
  const m = module as LoanModule;
  if (!OPNAME_MODULES_LIST.includes(m)) return res.status(400).json({ error: "Modul tidak valid" });
  if (!(ESTATES as readonly string[]).includes(dari) || !(ESTATES as readonly string[]).includes(ke)) return res.status(400).json({ error: "Estate tidak valid" });
  if (dari === ke) return res.status(400).json({ error: "Estate peminjam harus beda dengan estate yang meminjamkan" });
  if (!canLoan(u, m, "input") || !estateAllowed(u, dari)) return res.status(403).json({ error: "Pinjaman hanya bisa dicatat oleh estate yang meminjamkan" });
  const rows = batchInput(req, res);
  if (!rows) return;
  const clean: { item: LoanItem; qty: number; alasan: string }[] = [];
  for (const [i, r] of rows.entries()) {
    const qty = Number(r?.qty);
    const alasan = String(r?.alasan ?? "").trim();
    const item = await loanItem(m, dari, String(r?.kode ?? ""));
    if (!item) return refuseRow(res, i, "barang tidak ditemukan di master data");
    if (!Number.isFinite(qty) || qty <= 0) return refuseRow(res, i, "jumlah harus lebih dari 0");
    if (loanWhole(m, dari, ke) && !Number.isInteger(qty)) return refuseRow(res, i, "jumlah harus bilangan bulat");
    if (!alasan) return refuseRow(res, i, "alasan wajib diisi");
    clean.push({ item, qty, alasan });
  }
  const evidenceId = await claimEvidence(req, res);
  if (evidenceId === undefined) return;

  const loans: LoanRow[] = [];
  const tanggal = ISO_DATE.test(String(req.body.tanggal_iso ?? "")) ? String(req.body.tanggal_iso) : jakartaToday();

  const ok = await bookBatch(res, evidenceId ? [evidenceId] : [], async (client, at) => {
    for (const [i, r] of clean.entries()) {
      at(i);
      loans.push(await bookLoan(client, req, { module: m, dari, ke, item: r.item, qty: r.qty, alasan: r.alasan, tanggal, evidenceId, transfer: false }));
    }
  });
  if (!ok) return;
  for (const l of loans)
    await logLoan(req, l, "Pinjaman Baru", `${dari} meminjamkan ${fmtLoanQty(l.qty, l.satuan)} ke ${ke} (${tanggal}); Alasan: ${l.alasan}; Input Banyak (${loans.length} baris)`);
  res.json({ success: true, count: loans.length });
});

// A return (may be partial) or a cancel: the borrower gives the qty back to the lender.
async function loanBack(req: express.Request, res: express.Response, batal: boolean) {
  const u = req.user!;
  const note = String(req.body.note ?? "").trim();
  const l = await queryOne<LoanRow>("SELECT * FROM pinjaman WHERE id = @id", { id: req.params.id });
  if (!l) return res.status(404).json({ error: "Pinjaman tidak ditemukan" });
  if (!canLoan(u, l.module, "input") || !(estateAllowed(u, l.dari_estate) || estateAllowed(u, l.ke_estate)))
    return res.status(403).json({ error: "Akses ditolak" });
  if (l.jenis === "TRANSFER") return res.status(400).json({ error: "Transfer tidak dikembalikan. Kirim balik dengan transfer baru, atau minta Super User menghapusnya." });
  if (l.status !== "DIPINJAM") return res.status(400).json({ error: `Pinjaman ini sudah ${l.status === "LUNAS" ? "lunas" : "dibatalkan"}` });
  const sisa = round3(l.qty - l.qty_kembali);
  if (batal && l.qty_kembali > 0) return res.status(400).json({ error: "Sudah ada pengembalian, pinjaman tidak bisa dibatalkan. Kembalikan sisanya." });
  if (batal && !note) return res.status(400).json({ error: "Alasan pembatalan wajib diisi" });
  const qty = batal ? sisa : Number(req.body.qty);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
  if (qty > sisa) return res.status(400).json({ error: `Sisa pinjaman hanya ${fmtLoanQty(sisa, l.satuan)}` });
  if (loanWhole(l.module, l.dari_estate, l.ke_estate) && !Number.isInteger(qty)) return res.status(400).json({ error: "Jumlah harus bilangan bulat" });

  const lunas = round3(l.qty_kembali + qty) >= l.qty;
  const tag = `Pinjaman #${l.id}${note ? `: ${note}` : ""}`;
  // A return needs its foto bukti; a cancel (wrong input) doesn't.
  const evidenceId = batal ? null : await claimEvidence(req, res);
  if (evidenceId === undefined) return;
  try {
    await withTransaction(async (client) => {
      const cur = await queryOne<{ status: string; qty_kembali: number }>("SELECT status, qty_kembali FROM pinjaman WHERE id = @id FOR UPDATE", { id: l.id }, client);
      if (cur!.status !== "DIPINJAM" || cur!.qty_kembali !== l.qty_kembali) throw new StockError("Pinjaman ini baru saja berubah, muat ulang halaman");
      await loanTransfer(
        client,
        req,
        l,
        l.ke_estate,
        l.dari_estate,
        qty,
        batal ? `Batal pinjam dari ${l.dari_estate} (${tag})` : `Kembalikan pinjaman ke ${l.dari_estate} (${tag})`,
        batal ? `Batal dipinjamkan ke ${l.ke_estate} (${tag})` : `Pengembalian pinjaman dari ${l.ke_estate} (${tag})`,
        evidenceId
      );
      await execute(
        `INSERT INTO pinjaman_kembali (pinjaman_id, qty, tanggal_iso, note, batal, user_id, evidence_id)
         VALUES (@id, @qty, @today, @note, @batal, @uid, @ev::uuid)`,
        { id: l.id, qty, today: jakartaToday(), note, batal, uid: u.id, ev: evidenceId },
        client
      );
      await execute(
        "UPDATE pinjaman SET qty_kembali = @k, status = @s WHERE id = @id",
        { id: l.id, k: batal ? 0 : round3(l.qty_kembali + qty), s: batal ? "BATAL" : lunas ? "LUNAS" : "DIPINJAM" },
        client
      );
    });
  } catch (e) {
    await releaseEvidence(evidenceId);
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
  await logLoan(
    req,
    l,
    batal ? "Batal Pinjaman" : "Pengembalian Pinjaman",
    batal
      ? `${fmtLoanQty(qty, l.satuan)} kembali ke ${l.dari_estate}; Alasan: ${note}`
      : `${l.ke_estate} mengembalikan ${fmtLoanQty(qty, l.satuan)} ke ${l.dari_estate}; ${lunas ? "Lunas" : `sisa ${fmtLoanQty(sisa - qty, l.satuan)}`}${note ? `; Catatan: ${note}` : ""}`
  );
  res.json({ success: true });
}

app.post("/api/pinjaman/:id/kembali", (req, res) => loanBack(req, res, false));
app.post("/api/pinjaman/:id/batal", (req, res) => loanBack(req, res, true));

// Superuser only: removes a finished loan (Dibatalkan / Lunas) with every movement row it booked in
// both estates. Everything lent has come back by then, so the stock ends where it is: Nilam's items
// counters are booked back, and a BBM / pupuk / oli saldo row between the loan and its return drops the
// loan's qty again (it was counted in there). An open loan is cancelled or returned first.
app.post("/api/pinjaman/:id/delete", async (req, res) => {
  if (req.user!.role !== "superuser") return res.status(403).json({ error: "Hanya Super User yang bisa menghapus pinjaman" });
  const alasan = String(req.body?.catatan ?? "").trim();
  if (!alasan) return res.status(400).json({ error: "Alasan penghapusan wajib diisi" });
  const l = await withTransaction(async (client) => {
    const l = await queryOne<LoanRow>("SELECT * FROM pinjaman WHERE id = @id FOR UPDATE", { id: Number(req.params.id) || 0 }, client);
    if (!l) return refuse(res, 404, "Pinjaman tidak ditemukan");
    if (l.status === "DIPINJAM") return refuse(res, 400, "Pinjaman ini belum kembali. Batalkan atau kembalikan dulu, baru bisa dihapus.");
    // A stok opname approved after the loan counted the stock with the loan in it: taking the loan's rows
    // out afterwards would leave one side off by its qty (the count stays, the movement goes).
    const counted = await queryOne<{ estate: string; tanggal: string }>(
      "SELECT estate, tanggal FROM opname WHERE module = @module AND estate = ANY(@estates::text[]) AND status = 'APPROVED' AND tanggal >= @tgl ORDER BY tanggal DESC LIMIT 1",
      { module: l.module, estates: [l.dari_estate, l.ke_estate], tgl: l.tanggal_iso },
      client
    );
    if (counted)
      return refuse(
        res,
        400,
        `Sudah ada stok opname ${counted.estate} tanggal ${counted.tanggal.split("-").reverse().join("/")} setelah pinjaman ini, yang sudah menghitung stoknya. Menghapus pinjaman akan membuat saldo meleset; koreksi lewat stok opname / koreksi stok saja.`
      );
    // A transfer never came back: send it back first (refused when the receiving estate has used
    // it), so removing every row of both sides below leaves the stock as before the transfer.
    if (l.jenis === "TRANSFER") {
      const back = `Hapus ${loanLabel(l)}: ${alasan}`;
      await loanTransfer(client, req, l, l.ke_estate, l.dari_estate, l.qty, back, back, null, isSaldoModule(l.module) ? l.tanggal_iso : undefined);
    }
    const pid = { pid: l.id };
    if (l.module === "GUDANG") {
      const txs = await queryMany<{ item_id: number; type: "IN" | "OUT"; qty: number }>(
        "SELECT item_id, type, qty FROM transactions WHERE pinjaman_id = @pid ORDER BY id",
        pid,
        client
      );
      for (const t of txs) await applyStockEffect(client, t.item_id, t.type, t.qty, -1);
      for (const t of ["transactions", "stock_in_log", "stock_out_log", "gudang_stock_tx"]) await execute(`DELETE FROM ${t} WHERE pinjaman_id = @pid`, pid, client);
    } else if (l.module === "KLINIK") {
      await execute("DELETE FROM klinik_stock_tx WHERE pinjaman_id = @pid", pid, client);
    } else {
      const t = SALDO_LEDGER[l.module as SaldoModule];
      const rows = await queryMany<{ id: number; iso: string; estate: string; jenis: string; pinjam: number }>(
        `SELECT id, tanggal_iso iso, ${t.estate} estate, ${t.jenis} jenis, pinjam FROM ${t.table} WHERE pinjaman_id = @pid ORDER BY tanggal_iso, id`,
        pid,
        client
      );
      await execute(`DELETE FROM ${t.table} WHERE pinjaman_id = @pid`, pid, client);
      // The saldo of every row after the loan's rows no longer carries them.
      const from = new Map<string, { estate: string; jenis: string; iso: string }>();
      for (const r of rows) {
        const k = `${r.estate}|${r.jenis}`;
        if (!from.has(k) || r.iso < from.get(k)!.iso) from.set(k, r);
      }
      for (const f of from.values()) await rechainSaldo(l.module as SaldoModule, f.estate, f.jenis, f.iso, client);
    }
    await execute("DELETE FROM pinjaman_kembali WHERE pinjaman_id = @pid", pid, client);
    await execute("DELETE FROM pinjaman WHERE id = @pid", pid, client);
    return l;
  });
  if (!l) return;
  await logLoan(
    req,
    l,
    l.jenis === "TRANSFER" ? "Hapus Transfer" : "Hapus Pinjaman",
    `${l.jenis === "TRANSFER" ? `Stok kembali ke ${l.dari_estate}` : `Status: ${l.status === "LUNAS" ? "Lunas" : "Dibatalkan"}`}; ${fmtLoanQty(l.qty, l.satuan)} ${l.dari_estate} → ${l.ke_estate}; Alasan: ${alasan}`
  );
  res.json({ success: true });
});

// ---- Perbandingan pemakaian antar estate (Dashboard tab "Perbandingan") ----
// What left each estate's stock per period: Gudang / Klinik Stok Keluar, BBM pemakaian, pupuk
// keluar, oli pemakaian. Koreksi, pinjaman, obat dibuang and a Nilam Stok Keluar that was a transfer
// into another estate's gudang (counted there when it goes out) are left out. Gudang / Klinik items
// have mixed satuan, so without one barang chosen they compare the number of Stok Keluar.
const CMP_MODULES = ["GUDANG", "KLINIK", "BBM", "PUPUK", "OLI"] as const;
type CmpModule = (typeof CMP_MODULES)[number];
const ISO_TEXT = (col: string) => `CASE WHEN ${col} LIKE '____-__-__' THEN ${col}::date END`;

function cmpSource(module: CmpModule, kode: string): string {
  const jak = "(t.created_at AT TIME ZONE 'Asia/Jakarta')::date";
  const item = kode ? "AND t.kode_ = @kode" : "";
  if (module === "GUDANG") {
    return `
      SELECT 'NILAM' estate, ${ISO_TEXT("s.tanggal_keluar_iso")} d, s.qty::float8 qty FROM stock_out_log s
      WHERE s.pinjaman_id IS NULL ${kode ? "AND s.kode = @kode" : ""}
        AND NOT EXISTS (SELECT 1 FROM transactions x JOIN gudang_stock_tx g ON g.transfer_from_id = x.id
                        WHERE x.mirror_source = 'stock_out_log' AND x.mirror_id = s.id)
      UNION ALL
      SELECT t.gudang, ${jak}, t.qty::float8 FROM (SELECT *, item_kode kode_ FROM gudang_stock_tx) t
      WHERE t.type = 'OUT' AND t.is_correction = 0 AND t.pinjaman_id IS NULL ${item}`;
  }
  if (module === "KLINIK") {
    return `
      SELECT t.klinik, ${jak}, t.qty::float8 FROM (SELECT *, obat_kode kode_ FROM klinik_stock_tx) t
      WHERE t.type = 'OUT' AND t.is_correction = 0 AND t.pinjaman_id IS NULL AND COALESCE(t.tujuan, '') <> 'DIBUANG' ${item}`;
  }
  if (module === "BBM") {
    return `SELECT lokasi, ${ISO_TEXT("tanggal_iso")}, pemakaian::float8 FROM bbm_log WHERE pemakaian > 0 AND jenis_bbm = @kode`;
  }
  if (module === "PUPUK") {
    return `SELECT estate, ${ISO_TEXT("tanggal_iso")}, keluar::float8 FROM pupuk_log WHERE keluar > 0 ${kode ? "AND jenis_pupuk = @kode" : ""}`;
  }
  return `SELECT estate, ${ISO_TEXT("tanggal_iso")}, pemakaian::float8 FROM oli_log WHERE pemakaian > 0 ${kode ? "AND jenis_oli = @kode" : ""}`;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

app.get("/api/perbandingan", async (req, res) => {
  const { module = "", estates = "", dateFrom = "", dateTo = "", kode = "" } = req.query as Record<string, string>;
  const m = module as CmpModule;
  if (!CMP_MODULES.includes(m)) return res.status(400).json({ error: "Modul tidak valid" });
  if (!canLoan(req.user!, m, "view")) return res.status(403).json({ error: "Akses ditolak" });
  if (!ISO_DATE.test(dateFrom) || !ISO_DATE.test(dateTo) || dateFrom > dateTo) return res.status(400).json({ error: "Periode tidak valid" });
  if (m === "BBM" && !BBM_JENIS.includes(kode)) return res.status(400).json({ error: "Pilih Solar, Bensin atau Bensin Campur" });
  const wanted = (estates ? estates.split(",") : [...ESTATES]).filter((e) => (ESTATES as readonly string[]).includes(e) && estateAllowed(req.user!, e));
  if (!wanted.length) return res.json({ unit: "", metric: "qty", bucket: "month", perEstate: [], prev: [], series: [] });

  // The period before, of the same length, for the change column.
  const days = Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000) + 1;
  const prevFrom = addDays(dateFrom, -days);
  const prevTo = addDays(dateFrom, -1);
  // Up to ~2 months the trend is per week, longer per month.
  const bucket = days <= 62 ? "week" : "month";
  const metric = (m === "GUDANG" || m === "KLINIK") && !kode ? "trx" : "qty";

  const rows = await queryMany<{ estate: string; b: string | null; cur: boolean; qty: number; n: number }>(
    `WITH src(estate, d, qty) AS (${cmpSource(m, kode)})
     SELECT estate, CASE WHEN d >= @from::date THEN to_char(date_trunc('${bucket}', d), 'YYYY-MM-DD') END b,
            d >= @from::date cur, SUM(qty)::float8 qty, COUNT(*)::int n
     FROM src WHERE estate = ANY(@estates::text[]) AND d BETWEEN @prevFrom::date AND @to::date
     GROUP BY 1, 2, 3`,
    { estates: wanted, from: dateFrom, to: dateTo, prevFrom, kode }
  );
  const val = (r: { qty: number; n: number }) => (metric === "trx" ? r.n : round3(r.qty));
  const total = (cur: boolean) =>
    wanted.map((estate) => ({ estate, value: round3(rows.filter((r) => r.estate === estate && r.cur === cur).reduce((s, r) => s + val(r), 0)) }));
  const series = rows
    .filter((r) => r.cur && r.b)
    .map((r) => ({ bucket: r.b!, estate: r.estate, value: val(r) }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  let unit = metric === "trx" ? "transaksi" : m === "PUPUK" ? "KG" : m === "BBM" || m === "OLI" ? "LTR" : "";
  if (metric === "qty" && (m === "GUDANG" || m === "KLINIK"))
    unit = (await queryOne<{ s: string }>(`SELECT COALESCE(satuan, '') s FROM ${m === "GUDANG" ? "items" : "obat"} WHERE kode = @kode`, { kode }))?.s ?? "";
  res.json({ unit, metric, bucket, prevFrom, prevTo, perEstate: total(true), prev: total(false), series });
});

// Barang to compare: Gudang / Klinik search the master data; pupuk / oli list their jenis.
app.get("/api/perbandingan/barang", async (req, res) => {
  const { module = "", search = "" } = req.query as Record<string, string>;
  const m = module as CmpModule;
  if (!CMP_MODULES.includes(m)) return res.status(400).json({ error: "Modul tidak valid" });
  if (!canLoan(req.user!, m, "view")) return res.status(403).json({ error: "Akses ditolak" });
  const like = `%${search}%`;
  if (m === "GUDANG" || m === "KLINIK") {
    const table = m === "GUDANG" ? "items" : "obat";
    return res.json(
      await queryMany(
        `SELECT kode, nama, COALESCE(satuan, '') satuan FROM ${table}
         WHERE @search = '' OR kode ILIKE @like OR nama ILIKE @like ORDER BY nama LIMIT 20`,
        { search, like }
      )
    );
  }
  if (m === "BBM") return res.json(BBM_JENIS.map((j) => ({ kode: j, nama: j.replace("_", " "), satuan: "LTR" })));
  const list =
    m === "OLI"
      ? await queryMany<{ v: string }>("SELECT nama v FROM master_oli ORDER BY nama")
      : await queryMany<{ v: string }>("SELECT DISTINCT jenis_pupuk v FROM pupuk_log WHERE jenis_pupuk <> '' ORDER BY 1");
  res.json(list.map((r) => ({ kode: r.v, nama: r.v, satuan: m === "PUPUK" ? "KG" : "LTR" })));
});

// ---- Pemakaian per bulan (Gudang / BBM / Pupuk / Oli of one estate) ----
// How much of each barang / jenis left the estate's stock per month, the monthly average and the
// stock now - the same "pemakaian" as Perbandingan (no koreksi, pinjaman / transfer, nor a Nilam Stok
// Keluar that went into another estate's gudang). BBM can also be grouped per alat / kendaraan.
const PAKAI_MODULES = ["GUDANG", "BBM", "PUPUK", "OLI"] as const;
type PakaiModule = (typeof PAKAI_MODULES)[number];

// One row per Stok Keluar: kode (the group key), nama, satuan, info (shown under the nama), d (YYYY-MM-DD),
// qty, and for the detail list id, ref (no. dokumen), tujuan, penerima, ket.
function pakaiSource(module: PakaiModule, estate: string, alat: boolean): string {
  if (module === "GUDANG" && estate === "NILAM") {
    return `SELECT s.kode, COALESCE(i.nama, s.nama, s.kode) nama, COALESCE(i.satuan, s.satuan, '') satuan, s.kode info,
        s.tanggal_keluar_iso d, s.qty::float8 qty, s.id, COALESCE(NULLIF(s.no_embrace_gudang, ''), s.no_request, '') ref,
        concat_ws(' · ', NULLIF(s.tujuan, ''), NULLIF(s.divisi, '')) tujuan, COALESCE(s.penerima, '') penerima, COALESCE(s.keterangan, '') ket
      FROM stock_out_log s LEFT JOIN items i ON i.kode = s.kode
      WHERE s.kode IS NOT NULL AND s.pinjaman_id IS NULL AND s.tanggal_keluar_iso LIKE '____-__-__'
        AND NOT EXISTS (SELECT 1 FROM transactions x JOIN gudang_stock_tx g ON g.transfer_from_id = x.id
                        WHERE x.mirror_source = 'stock_out_log' AND x.mirror_id = s.id)`;
  }
  if (module === "GUDANG") {
    return `SELECT t.item_kode kode, COALESCE(i.nama, t.item_kode) nama, COALESCE(i.satuan, '') satuan, t.item_kode info,
        to_char((t.created_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') d, t.qty::float8 qty, t.id, '' ref,
        COALESCE(t.tujuan, '') tujuan, COALESCE(t.penerima, '') penerima, COALESCE(t.note, '') ket
      FROM gudang_stock_tx t LEFT JOIN items i ON i.kode = t.item_kode
      WHERE t.gudang = @estate AND t.type = 'OUT' AND t.is_correction = 0 AND t.pinjaman_id IS NULL`;
  }
  if (module === "BBM") {
    const unit = "COALESCE(NULLIF(trim(kode_kendaraan), ''), '(tanpa kode alat)')";
    return `SELECT ${alat ? `jenis_bbm || '|' || ${unit}` : "jenis_bbm"} kode, ${alat ? unit : "replace(jenis_bbm, '_', ' ')"} nama, 'LTR' satuan,
        ${alat ? "jenis_bbm" : "''"} info, tanggal_iso d, pemakaian::float8 qty, id, COALESCE(no_spb, '') ref,
        concat_ws(' · ', NULLIF(kode_kendaraan, ''), NULLIF(estate, '')) tujuan, COALESCE(hm_terakhir, '') penerima, COALESCE(keterangan, '') ket
      FROM bbm_log WHERE lokasi = @estate AND pemakaian > 0 AND tanggal_iso LIKE '____-__-__'`;
  }
  if (module === "PUPUK") {
    return `SELECT jenis_pupuk kode, jenis_pupuk nama, 'KG' satuan, '' info, tanggal_iso d, keluar::float8 qty, id, COALESCE(no_embrace, '') ref,
        concat_ws(' · ', NULLIF(divisi, ''), NULLIF(blok, '')) tujuan, '' penerima, COALESCE(keterangan, '') ket
      FROM pupuk_log WHERE estate = @estate AND keluar > 0 AND tanggal_iso LIKE '____-__-__'`;
  }
  return `SELECT l.jenis_oli kode, l.jenis_oli nama, COALESCE(m.satuan, 'LTR') satuan, '' info, l.tanggal_iso d, l.pemakaian::float8 qty, l.id,
      COALESCE(l.no_embrace, '') ref, '' tujuan, '' penerima, COALESCE(l.keterangan, '') ket
    FROM oli_log l LEFT JOIN master_oli m ON m.nama = l.jenis_oli
    WHERE l.estate = @estate AND l.pemakaian > 0 AND l.tanggal_iso LIKE '____-__-__'`;
}

function pakaiQuery(req: express.Request, res: express.Response) {
  const q = req.query as Record<string, string>;
  const m = q.module as PakaiModule;
  if (!PAKAI_MODULES.includes(m)) return void res.status(400).json({ error: "Modul tidak valid" });
  if (!canLoan(req.user!, m, "view")) return void res.status(403).json({ error: "Akses ditolak" });
  const estate = String(q.estate ?? "");
  if (!(ESTATES as readonly string[]).includes(estate)) return void res.status(400).json({ error: "Estate tidak valid" });
  if (!estateAllowed(req.user!, estate)) return void res.status(403).json({ error: "Akses ditolak" });
  const alat = m === "BBM" && q.group === "alat";
  const { from, to } = laporanRange(q);
  return { m, estate, alat, src: pakaiSource(m, estate, alat), params: { estate, from, to, kode: String(q.kode ?? "") } };
}

app.get("/api/pemakaian", async (req, res) => {
  const p = pakaiQuery(req, res);
  if (!p) return;
  const { m, estate, alat, src, params } = p;
  const rows = await queryMany(
    `WITH src AS (${src})
     SELECT kode, nama, satuan, info, left(d, 7) bulan, SUM(qty)::float8 qty, COUNT(*)::int trx
     FROM src WHERE d BETWEEN @from AND @to GROUP BY 1, 2, 3, 4, 5 ORDER BY 2, 5`,
    params
  );
  // The first month with any pemakaian at this estate: months before it aren't 0, just no data yet.
  const mulai = (await queryOne<{ b: string | null }>(`WITH src AS (${src}) SELECT left(MIN(d), 7) b FROM src`, params))?.b ?? null;
  let stok: { kode: string; stok: number }[] = [];
  if (m === "GUDANG" && estate === "NILAM") stok = await queryMany("SELECT kode, stock_tersedia::float8 stok FROM items");
  else if (m === "GUDANG") stok = await queryMany("SELECT item_kode kode, stock_tersedia::float8 stok FROM gudang_stock WHERE gudang = @estate", { estate });
  else if (m === "PUPUK") stok = (await latestPupukSaldo(estate)).map((r) => ({ kode: r.jenis_pupuk, stok: Number(r.saldo_stock) }));
  else if (m === "OLI") stok = (await latestOliSaldo(estate)).map((r) => ({ kode: r.jenis_oli, stok: Number(r.saldo_stock) }));
  else if (!alat)
    stok = await queryMany(
      `SELECT jenis_bbm kode, saldo_stock::float8 stok FROM (
         SELECT jenis_bbm, saldo_stock, ROW_NUMBER() OVER (PARTITION BY jenis_bbm ORDER BY tanggal_iso DESC, id DESC) rn
         FROM bbm_log WHERE lokasi = @estate AND saldo_stock IS NOT NULL) s WHERE rn = 1`,
      { estate }
    );
  res.json({ rows, stok, mulai });
});

// The Stok Keluar rows behind one figure: one kode in one month (YYYY-MM) or the whole period.
app.get("/api/pemakaian/detail", async (req, res) => {
  const p = pakaiQuery(req, res);
  if (!p) return;
  if (!p.params.kode) return res.status(400).json({ error: "Pilih barang" });
  const bulan = /^\d{4}-\d{2}$/.test(String(req.query.bulan ?? "")) ? String(req.query.bulan) : "";
  const data = await queryMany(
    `WITH src AS (${p.src})
     SELECT id, d tanggal_iso, ref, tujuan, penerima, ket, qty FROM src
     WHERE kode = @kode AND d BETWEEN @from AND @to ${bulan ? "AND left(d, 7) = @bulan" : ""}
     ORDER BY d, id LIMIT 2000`,
    { ...p.params, bulan }
  );
  res.json({ data });
});

// ---- Chat (see schema.sql chat_*): DM, a room per estate, groups made by a Super User ----
// The rooms an account is in: its DMs and groups, and the estate rooms of its estates (made when first needed).
const CHAT_ROOMS_SQL = `
  SELECT r.id FROM chat_room r
   WHERE (r.jenis IN ('DM', 'GRUP') AND EXISTS (SELECT 1 FROM chat_member m WHERE m.room_id = r.id AND m.user_id = @uid))
      OR (r.jenis = 'ESTATE' AND r.estate = ANY(@estates::text[]))`;
async function chatEstateRooms(user: SessionUser) {
  const own = ESTATES.filter((e) => estateAllowed(user, e)) as string[];
  if (own.length)
    await execute(
      `INSERT INTO chat_room (jenis, nama, estate) SELECT 'ESTATE', 'Estate ' || e, e FROM unnest(@own::text[]) e ON CONFLICT (estate) DO NOTHING`,
      { own }
    );
  return own;
}
async function chatRoomOf(req: express.Request, res: express.Response) {
  const own = ESTATES.filter((e) => estateAllowed(req.user!, e)) as string[];
  const room = await queryOne<any>(`SELECT r.* FROM chat_room r WHERE r.id = @id AND r.id IN (${CHAT_ROOMS_SQL})`, { id: Number(req.params.id) || 0, uid: req.user!.id, estates: own });
  if (!room) res.status(404).json({ error: "Percakapan tidak ditemukan" });
  return room;
}

// The account's rooms, newest activity first: name (a DM is named after the other person), last message, unread.
app.get("/api/chat/rooms", async (req, res) => {
  const u = req.user!;
  const own = await chatEstateRooms(u);
  const rows = await queryMany(
    `SELECT r.id, r.jenis, r.estate,
            CASE WHEN r.jenis = 'DM' THEN COALESCE(NULLIF(o.nama, ''), o.username) ELSE r.nama END AS nama,
            o.id AS lawan_id, o.last_seen_at > now() - interval '5 minutes' AS lawan_online,
            lm.id AS last_id, lm.isi AS last_isi, lm.evidence_id IS NOT NULL AS last_foto, lm.created_at AS last_at,
            COALESCE(NULLIF(lu.nama, ''), lu.username) AS last_nama, lm.user_id = @uid AS last_saya,
            (SELECT COUNT(*)::int FROM chat_message x WHERE x.room_id = r.id AND x.user_id <> @uid AND x.id > COALESCE(cr.last_read_id, 0)) AS unread,
            (SELECT COUNT(*)::int FROM chat_member m WHERE m.room_id = r.id) AS n_member
       FROM chat_room r
       LEFT JOIN chat_read cr ON cr.room_id = r.id AND cr.user_id = @uid
       LEFT JOIN LATERAL (SELECT u2.* FROM chat_member m JOIN users u2 ON u2.id = m.user_id WHERE r.jenis = 'DM' AND m.room_id = r.id AND m.user_id <> @uid LIMIT 1) o ON true
       LEFT JOIN LATERAL (SELECT * FROM chat_message x WHERE x.room_id = r.id ORDER BY x.id DESC LIMIT 1) lm ON true
       LEFT JOIN users lu ON lu.id = lm.user_id
      WHERE r.id IN (${CHAT_ROOMS_SQL})
      ORDER BY COALESCE(lm.created_at, r.created_at) DESC`,
    { uid: u.id, estates: own }
  );
  res.json(rows);
});

// Unread total and the newest unread messages (for the pop-up), polled by every open tab.
app.get("/api/chat/unread", async (req, res) => {
  const u = req.user!;
  const own = ESTATES.filter((e) => estateAllowed(u, e)) as string[];
  const after = Number(req.query.after) || 0;
  const total = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int n FROM chat_message x LEFT JOIN chat_read cr ON cr.room_id = x.room_id AND cr.user_id = @uid
      WHERE x.room_id IN (${CHAT_ROOMS_SQL}) AND x.user_id <> @uid AND x.id > COALESCE(cr.last_read_id, 0)`,
    { uid: u.id, estates: own }
  );
  const baru = after
    ? await queryMany(
        `SELECT x.id, x.room_id, x.isi, x.evidence_id IS NOT NULL AS foto, COALESCE(NULLIF(su.nama, ''), su.username) AS dari,
                CASE WHEN r.jenis = 'DM' THEN NULL ELSE r.nama END AS room_nama
           FROM chat_message x JOIN chat_room r ON r.id = x.room_id JOIN users su ON su.id = x.user_id
           LEFT JOIN chat_read cr ON cr.room_id = x.room_id AND cr.user_id = @uid
          WHERE x.room_id IN (${CHAT_ROOMS_SQL}) AND x.user_id <> @uid AND x.id > @after AND x.id > COALESCE(cr.last_read_id, 0)
          ORDER BY x.id DESC LIMIT 5`,
        { uid: u.id, estates: own, after }
      )
    : [];
  const max = await queryOne<{ m: number }>(`SELECT COALESCE(MAX(x.id), 0)::int m FROM chat_message x WHERE x.room_id IN (${CHAT_ROOMS_SQL})`, { uid: u.id, estates: own });
  res.json({ total: total!.n, baru, max: max!.m });
});

// People to chat with (and whether they are online).
app.get("/api/chat/users", async (req, res) => {
  res.json(
    await queryMany(
      `SELECT id, username, nama, role, estates, last_seen_at > now() - interval '5 minutes' AS online FROM users WHERE id <> @uid ORDER BY (last_seen_at > now() - interval '5 minutes') DESC NULLS LAST, COALESCE(NULLIF(nama, ''), username)`,
      { uid: req.user!.id }
    )
  );
});

// The DM room with one account (made the first time).
app.post("/api/chat/dm", async (req, res) => {
  const other = await queryOne<{ id: number }>("SELECT id FROM users WHERE id = @id", { id: Number(req.body?.user_id) || 0 });
  if (!other || other.id === req.user!.id) return res.status(400).json({ error: "Pengguna tidak valid" });
  const key = [req.user!.id, other.id].sort((a, b) => a - b).join("-");
  const room = await withTransaction(async (c) => {
    const r = await queryOne<{ id: number }>(
      "INSERT INTO chat_room (jenis, dm_key, created_by) VALUES ('DM', @key, @uid) ON CONFLICT (dm_key) DO UPDATE SET dm_key = EXCLUDED.dm_key RETURNING id",
      { key, uid: req.user!.id },
      c
    );
    await execute("INSERT INTO chat_member (room_id, user_id) VALUES (@r, @a), (@r, @b) ON CONFLICT DO NOTHING", { r: r!.id, a: req.user!.id, b: other.id }, c);
    return r!;
  });
  res.json(room);
});

// A group of chosen accounts (Super User).
app.post("/api/chat/grup", requireSuperuser, async (req, res) => {
  const nama = String(req.body?.nama ?? "").trim();
  const ids = [...new Set([req.user!.id, ...(Array.isArray(req.body?.user_ids) ? req.body.user_ids : []).map(Number).filter((n: number) => n > 0)])];
  if (!nama) return res.status(400).json({ error: "Isi nama grup" });
  if (ids.length < 2) return res.status(400).json({ error: "Pilih minimal satu anggota" });
  const room = await withTransaction(async (c) => {
    const r = await queryOne<{ id: number }>("INSERT INTO chat_room (jenis, nama, created_by) VALUES ('GRUP', @nama, @uid) RETURNING id", { nama, uid: req.user!.id }, c);
    await execute("INSERT INTO chat_member (room_id, user_id) SELECT @r, u.id FROM users u WHERE u.id = ANY(@ids::int[])", { r: r!.id, ids }, c);
    return r!;
  });
  res.json(room);
});

// Messages of a room: the last 60 (or those after `after` / before `before`), with who read how far.
app.get("/api/chat/rooms/:id/messages", async (req, res) => {
  const room = await chatRoomOf(req, res);
  if (!room) return;
  const after = Number(req.query.after) || 0;
  const before = Number(req.query.before) || 0;
  const rows = await queryMany(
    `SELECT * FROM (
       SELECT x.id, x.user_id, COALESCE(NULLIF(u.nama, ''), u.username) AS nama, x.isi, x.evidence_id, x.link_url, x.link_label, x.created_at
         FROM chat_message x JOIN users u ON u.id = x.user_id
        WHERE x.room_id = @room ${after ? "AND x.id > @after" : ""} ${before ? "AND x.id < @before" : ""}
        ORDER BY x.id DESC LIMIT 60) t ORDER BY id`,
    { room: room.id, after, before }
  );
  const reads = await queryMany(
    `SELECT cr.user_id, cr.last_read_id, COALESCE(NULLIF(u.nama, ''), u.username) AS nama FROM chat_read cr JOIN users u ON u.id = cr.user_id WHERE cr.room_id = @room AND cr.user_id <> @uid`,
    { room: room.id, uid: req.user!.id }
  );
  res.json({ messages: rows, reads });
});

app.post("/api/chat/rooms/:id/messages", async (req, res) => {
  const room = await chatRoomOf(req, res);
  if (!room) return;
  const isi = String(req.body?.isi ?? "").trim().slice(0, 4000);
  const linkUrl = typeof req.body?.link_url === "string" && req.body.link_url.startsWith("/") ? req.body.link_url.slice(0, 300) : null;
  const linkLabel = linkUrl ? String(req.body?.link_label ?? "").slice(0, 120) : null;
  if (!isi && !req.body?.evidence_id && !linkUrl) return res.status(400).json({ error: "Pesan kosong" });
  const evidence = req.body?.evidence_id ? await claimEvidence(req, res) : null;
  if (evidence === undefined) return;
  const row = await queryOne<{ id: number }>(
    "INSERT INTO chat_message (room_id, user_id, isi, evidence_id, link_url, link_label) VALUES (@room, @uid, @isi, @ev::uuid, @url, @label) RETURNING id",
    { room: room.id, uid: req.user!.id, isi, ev: evidence, url: linkUrl, label: linkLabel }
  );
  // Sending means having read everything before it.
  await execute(
    `INSERT INTO chat_read (room_id, user_id, last_read_id) VALUES (@room, @uid, @id)
     ON CONFLICT (room_id, user_id) DO UPDATE SET last_read_id = GREATEST(chat_read.last_read_id, EXCLUDED.last_read_id)`,
    { room: room.id, uid: req.user!.id, id: row!.id }
  );
  res.json({ id: row!.id });
});

app.post("/api/chat/rooms/:id/read", async (req, res) => {
  const room = await chatRoomOf(req, res);
  if (!room) return;
  const id = Number(req.body?.last_id) || 0;
  await execute(
    `INSERT INTO chat_read (room_id, user_id, last_read_id) VALUES (@room, @uid, @id)
     ON CONFLICT (room_id, user_id) DO UPDATE SET last_read_id = GREATEST(chat_read.last_read_id, EXCLUDED.last_read_id)`,
    { room: room.id, uid: req.user!.id, id }
  );
  res.json({ success: true });
});

// ---- Berita Acara Pemusnahan (see schema.sql berita_acara): Klinik obat / BHP and Koperasi barang rusak ----
type BaModul = "KLINIK" | "KOPERASI";
const BA_ALASAN: Record<string, string> = { EXPIRED: "Kedaluwarsa", RUSAK: "Rusak", RETUR: "Retur ke supplier" };
// The nomor of a BA of an active (not BATAL) Berita Acara that holds this row, or null.
async function baAktifUntuk(modul: BaModul, refId: number, client?: PoolClient) {
  const r = await queryOne<{ nomor: string }>(
    "SELECT b.nomor FROM berita_acara_item i JOIN berita_acara b ON b.id = i.ba_id WHERE i.modul = @modul AND i.ref_id = @id AND b.status <> 'BATAL' LIMIT 1",
    { modul, id: refId },
    client
  );
  return r?.nomor ?? null;
}
// Who may work on a BA of this modul / unit: Klinik = its estate + Input Klinik (Edit for Batal), Koperasi =
// Input Koperasi (Edit for Batal). Sends the refusal and returns false.
function baBoleh(req: express.Request, res: express.Response, modul: string, unit: string, aksi: "view" | "input" | "edit") {
  const u = req.user!;
  if (modul !== "KLINIK" && modul !== "KOPERASI") return void res.status(400).json({ error: "Modul tidak valid" }), false;
  const okUnit = modul === "KLINIK" ? KLINIK_OPTIONS.includes(unit) && estateAllowed(u, unit) : unit === KOPERASI && estateAllowed(u, KOPERASI);
  if (!okUnit) return void res.status(403).json({ error: "Akses ditolak" }), false;
  const perm = `${modul.toLowerCase()}.${aksi}`;
  if (u.role !== "superuser" && !u.perms.includes(perm)) return void res.status(403).json({ error: `Akun ini tidak punya hak ${permLabel(perm)}` }), false;
  return true;
}
const baLog = (req: express.Request, ba: { modul: string; unit: string; nomor: string }, aksi: string, detail: string) =>
  logActivity(req, { module: ba.modul === "KLINIK" ? "KLINIK" : "KOPERASI", estate: ba.unit, aksi, objek: `BA ${ba.nomor}`, detail });
const BA_COLS = `b.id, b.modul, b.unit, b.nomor, b.tanggal, b.isian, b.items, b.status, b.created_at, COALESCE(u.nama, u.username, '') AS dibuat_nama,
  b.disetujui_nama, b.disetujui_jabatan, b.disetujui_tgl, b.evidence_id, b.selesai_tgl, b.selesai_catatan, b.foto_musnah, b.batal_alasan, b.ttd`;
// Tanda tangan BA: who signs at the destruction, and whether a BA is signed in the app (made after it was).
const BA_TTD_MUSNAH = ["pelaksana", "saksi1", "saksi2"];
const BA_PERAN_LABEL: Record<string, string> = { pj: "Yang menyerahkan", pelaksana: "Pelaksana", saksi1: "Saksi 1", saksi2: "Saksi 2", mengetahui: "Mengetahui / menyetujui" };
const baDigital = (ba: { ttd: any }) => !!ba.ttd?.pj;
// Units whose BAs an account with Setujui Berita Acara approves: its kliniks, and the koperasi with Nilam.
const baUnitSetuju = (u: SessionUser) =>
  u.role === "superuser" || u.perms.includes("ba.setujui")
    ? [...KLINIK_OPTIONS.filter((k) => estateAllowed(u, k)).map((k) => ({ modul: "KLINIK", unit: k })), ...(estateAllowed(u, KOPERASI) ? [{ modul: "KOPERASI", unit: KOPERASI }] : [])]
    : [];

app.get("/api/berita-acara", async (req, res) => {
  const modul = String(req.query.modul ?? "");
  const unit = String(req.query.unit ?? "");
  if (!baBoleh(req, res, modul, unit, "view")) return;
  const data = await queryMany(`SELECT ${BA_COLS} FROM berita_acara b LEFT JOIN users u ON u.id = b.dibuat_oleh WHERE b.modul = @modul AND b.unit = @unit ORDER BY b.id DESC LIMIT 200`, { modul, unit });
  const terpakai = (
    await queryMany<{ ref_id: number }>("SELECT i.ref_id FROM berita_acara_item i JOIN berita_acara b ON b.id = i.ba_id WHERE b.modul = @modul AND b.unit = @unit AND b.status <> 'BATAL'", { modul, unit })
  ).map((r) => r.ref_id);
  res.json({ data, terpakai });
});

app.post("/api/berita-acara", async (req, res) => {
  const b = req.body ?? {};
  const modul = String(b.modul ?? "") as BaModul;
  const unit = String(b.unit ?? "");
  if (!baBoleh(req, res, modul, unit, "input")) return;
  if (!isIsoDate(b.tanggal)) return res.status(400).json({ error: "Tanggal pemusnahan tidak valid" });
  const ids = [...new Set((Array.isArray(b.ref_ids) ? b.ref_ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0))] as number[];
  if (!ids.length) return res.status(400).json({ error: "Pilih minimal satu barang" });
  const isian = b.isian && typeof b.isian === "object" ? b.isian : {};
  const nama = (k: string) => String(isian?.[k]?.nama ?? "").trim();
  if (!nama("pj") || !nama("saksi1") || !nama("saksi2")) return res.status(400).json({ error: "Isi nama yang menyerahkan dan kedua saksi" });
  try {
    const ba = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('berita_acara'))");
      // The rows: approved, of this unit, not on another active BA. Snapshot for the letter.
      const rows =
        modul === "KLINIK"
          ? await queryMany(
              `SELECT t.id, t.obat_kode AS kode, o.nama, o.satuan, t.qty, t.alloc, t.note, t.alasan, t.created_at, COALESCE(p.nama, p.username) AS diperiksa_nama
                 FROM klinik_stock_tx t JOIN obat o ON o.kode = t.obat_kode LEFT JOIN users p ON p.id = t.diperiksa_oleh
                WHERE t.id = ANY(@ids::int[]) AND t.klinik = @unit AND t.type = 'OUT' AND t.tujuan = 'DIBUANG' AND COALESCE(t.status, 'DISETUJUI') = 'DISETUJUI' ORDER BY t.created_at, t.id`,
              { ids, unit },
              client
            )
          : await queryMany(
              `SELECT t.id, t.barang_kode AS kode, b.nama, b.satuan, t.qty, t.total, t.tanggal_iso, t.keterangan, t.alasan, COALESCE(u.nama, u.username, '') AS oleh, COALESCE(p.nama, p.username) AS diperiksa_nama
                 FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode LEFT JOIN users u ON u.id = t.user_id LEFT JOIN users p ON p.id = t.diperiksa_oleh
                WHERE t.id = ANY(@ids::int[]) AND t.koperasi = @unit AND t.jenis = 'RUSAK' AND COALESCE(t.status, 'DISETUJUI') = 'DISETUJUI' ORDER BY t.tanggal_iso, t.id`,
              { ids, unit },
              client
            );
      if (rows.length !== ids.length) throw new StockError("Ada barang yang belum disetujui pemeriksa atau bukan dari unit ini; muat ulang halaman");
      const dipakai = await queryOne<{ nomor: string }>(
        "SELECT b.nomor FROM berita_acara_item i JOIN berita_acara b ON b.id = i.ba_id WHERE i.modul = @modul AND i.ref_id = ANY(@ids::int[]) AND b.status <> 'BATAL' LIMIT 1",
        { modul, ids },
        client
      );
      if (dipakai) throw new StockError(`Ada barang yang sudah masuk Berita Acara ${dipakai.nomor}`);
      const dmy = (iso: string) => iso.split("-").reverse().join("/");
      const jkt = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
      const items = rows.map((t: any) =>
        modul === "KLINIK"
          ? {
              id: t.id, nama: t.nama, kode: t.kode, satuan: t.satuan, qty: Number(t.qty),
              tgl: (t.alloc ?? []).map((a: any) => (a.exp ? dmy(a.exp) : "-")).join(", ") || "-",
              alasan: BA_ALASAN[t.alasan ?? ""] ?? "Kedaluwarsa", keterangan: t.note ?? "",
              info: `ditarik ${dmy(jkt(t.created_at))}${t.diperiksa_nama ? ` · diperiksa ${t.diperiksa_nama}` : ""}`,
            }
          : {
              id: t.id, nama: t.nama, kode: t.kode, satuan: t.satuan, qty: Number(t.qty), tgl: dmy(t.tanggal_iso),
              alasan: t.alasan === "EXPIRED" ? "Kedaluwarsa" : "Rusak", keterangan: t.keterangan,
              info: `oleh ${t.oleh || "-"}${t.diperiksa_nama ? ` · diperiksa ${t.diperiksa_nama}` : ""}`, nilai: Number(t.total),
            }
      );
      const tahun = Number(b.tanggal.slice(0, 4));
      const urut = (await queryOne<{ n: number }>("SELECT COALESCE(MAX(urut), 0) + 1 AS n FROM berita_acara WHERE modul = @modul AND unit = @unit AND tahun = @tahun", { modul, unit, tahun }, client))!.n;
      const nomor = `${String(urut).padStart(3, "0")}/BA-PMS/${modul === "KLINIK" ? `KLINIK-${unit}` : "KOPERASI"}/${b.tanggal.slice(5, 7)}/${tahun}`;
      const r = await queryOne<{ id: number }>(
        `INSERT INTO berita_acara (modul, unit, tahun, urut, nomor, tanggal, isian, items, dibuat_oleh, ttd)
         VALUES (@modul, @unit, @tahun, @urut, @nomor, @tanggal, @isian::jsonb, @items::jsonb, @uid, @ttd::jsonb) RETURNING id`,
        {
          modul, unit, tahun, urut, nomor, tanggal: b.tanggal, isian: JSON.stringify(isian), items: JSON.stringify(items), uid: req.user!.id,
          // Yang menyerahkan signs by making it, with the account.
          ttd: JSON.stringify({ pj: { cara: "AKUN", nama: req.user!.nama, jabatan: String(isian?.pj?.jabatan ?? ""), user_id: req.user!.id, at: new Date().toISOString() } }),
        },
        client
      );
      for (const id of ids) await execute("INSERT INTO berita_acara_item (ba_id, modul, ref_id) VALUES (@ba, @modul, @id)", { ba: r!.id, modul, id }, client);
      return { id: r!.id, nomor, n: items.length };
    });
    await baLog(req, { modul, unit, nomor: ba.nomor }, "Buat Berita Acara", `${ba.n} barang · rencana pemusnahan ${b.tanggal} · ditandatangani yang menyerahkan, menunggu persetujuan`);
    res.json(ba);
  } catch (e) {
    if (e instanceof StockError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

// Persetujuan via WhatsApp: the admin sent the BA to the manager / perwakilan, who replied YA (setuju) or TIDAK
// (tolak, the BA is cancelled); the capture of the reply is the proof. The other way to the in-app signature.
app.put("/api/berita-acara/:id/setuju", async (req, res) => {
  const ba = await queryOne<any>("SELECT * FROM berita_acara WHERE id = @id", { id: req.params.id });
  if (!ba) return res.status(404).json({ error: "Berita acara tidak ditemukan" });
  if (!baBoleh(req, res, ba.modul, ba.unit, "input")) return;
  if (ba.status !== "MENUNGGU") return res.status(409).json({ error: "Berita acara ini tidak sedang menunggu persetujuan" });
  const b = req.body ?? {};
  const tolak = b.tolak === true;
  const nama = String(b.nama ?? "").trim();
  if (!nama) return res.status(400).json({ error: "Isi nama manager / perwakilan yang menjawab" });
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal jawaban tidak valid" });
  const alasan = String(b.alasan ?? "").trim().slice(0, 500);
  if (tolak && alasan.length < 3) return res.status(400).json({ error: "Tulis alasan penolakan dari balasan WhatsApp" });
  if (!b.evidence_id) return res.status(400).json({ error: "Lampirkan capture balasan WhatsApp-nya" });
  const evidence = await claimEvidence(req, res);
  if (evidence === undefined) return;
  const jabatan = String(b.jabatan ?? "").trim();
  if (tolak) {
    await execute("UPDATE berita_acara SET status = 'BATAL', batal_oleh = @uid, batal_alasan = @alasan, evidence_id = @ev::uuid WHERE id = @id", {
      uid: req.user!.id,
      alasan: `Ditolak ${nama} via WhatsApp: ${alasan}`,
      ev: evidence,
      id: ba.id,
    });
    await baLog(req, ba, "Tolak Berita Acara", `${nama}${jabatan ? ` (${jabatan})` : ""} menjawab TIDAK via WhatsApp tanggal ${b.tanggal}: ${alasan} · bukti capture terlampir`);
    return res.json({ success: true });
  }
  // A BA signed in the app gets the WhatsApp answer in its Mengetahui box.
  const ttd = baDigital(ba) ? { ...ba.ttd, mengetahui: { cara: "WA", nama, jabatan, at: new Date().toISOString(), tanggal: b.tanggal, input_nama: req.user!.nama } } : ba.ttd;
  await execute(
    `UPDATE berita_acara SET status = 'DISETUJUI', disetujui_nama = @nama, disetujui_jabatan = @jabatan, disetujui_tgl = @tgl, evidence_id = @ev::uuid, disetujui_input_oleh = @uid, ttd = @ttd::jsonb WHERE id = @id`,
    { nama, jabatan, tgl: b.tanggal, ev: evidence, uid: req.user!.id, ttd: JSON.stringify(ttd ?? {}), id: ba.id }
  );
  await baLog(req, ba, "Persetujuan Berita Acara", `${nama}${jabatan ? ` (${jabatan})` : ""} menjawab YA via WhatsApp tanggal ${b.tanggal} · bukti capture terlampir`);
  res.json({ success: true });
});

// Selesai: the barang were destroyed (after the approval); an optional photo of it.
app.put("/api/berita-acara/:id/selesai", async (req, res) => {
  const ba = await queryOne<any>("SELECT * FROM berita_acara WHERE id = @id", { id: req.params.id });
  if (!ba) return res.status(404).json({ error: "Berita acara tidak ditemukan" });
  if (!baBoleh(req, res, ba.modul, ba.unit, "input")) return;
  if (ba.status !== "DISETUJUI") return res.status(409).json({ error: ba.status === "MENUNGGU" ? "Berita acara ini belum disetujui manager" : "Berita acara ini sudah ditutup / dibatalkan" });
  const kurang = baDigital(ba) ? BA_TTD_MUSNAH.filter((k) => !ba.ttd?.[k]) : [];
  if (kurang.length) return res.status(400).json({ error: `Belum ditandatangani: ${kurang.map((k) => BA_PERAN_LABEL[k]).join(", ")}` });
  const b = req.body ?? {};
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal pemusnahan tidak valid" });
  const foto = b.evidence_id ? await claimEvidence(req, res) : null;
  if (foto === undefined) return;
  await execute(`UPDATE berita_acara SET status = 'SELESAI', selesai_tgl = @tgl, selesai_catatan = @cat, foto_musnah = @foto::uuid, selesai_oleh = @uid WHERE id = @id`, {
    tgl: b.tanggal,
    cat: String(b.catatan ?? "").trim(),
    foto,
    uid: req.user!.id,
    id: ba.id,
  });
  await baLog(req, ba, "Tutup Berita Acara", `barang dimusnahkan tanggal ${b.tanggal}${b.catatan ? ` · ${String(b.catatan).trim()}` : ""}${foto ? " · foto terlampir" : ""}`);
  res.json({ success: true });
});

// Persetujuan: how many documents wait for this account (the reminder at login and the menu's badge).
app.get("/api/persetujuan/jumlah", async (req, res) => {
  const u = req.user!;
  let permintaan = 0;
  if (u.role === "superuser" || TTD_PERMS.some((x) => u.perms.includes(x))) {
    const rows = await queryMany<{ approval: any }>("SELECT approval FROM klinik_permintaan WHERE status = 'DIAJUKAN' AND klinik = ANY(@kliniks)", {
      kliniks: KLINIK_OPTIONS.filter((k) => estateAllowed(u, k)),
    });
    permintaan = rows.filter(
      (r) => TTD_LEVELS.some((k) => !r.approval?.[k] && bolehTtd(u, k)) && !(u.role !== "superuser" && TTD_LEVELS.some((k) => r.approval?.[k]?.user_id === u.id))
    ).length;
  }
  const units = baUnitSetuju(u);
  const ba = units.length
    ? (
        await queryOne<{ n: number }>(
          `SELECT COUNT(*)::int n FROM berita_acara WHERE status = 'MENUNGGU' AND ttd ? 'pj' AND (modul || ':' || unit) = ANY(@units::text[])
             AND (@su OR (ttd->'pj'->>'user_id') IS DISTINCT FROM @uid::text)`,
          { units: units.map((x) => `${x.modul}:${x.unit}`), su: u.role === "superuser", uid: String(u.id) }
        )
      )!.n
    : 0;
  res.json({ permintaan, ba, total: permintaan + ba });
});

// The BAs waiting for this account's approval (Setujui Berita Acara, of its units).
app.get("/api/berita-acara/menunggu", async (req, res) => {
  const units = baUnitSetuju(req.user!);
  if (!units.length) return res.json({ data: [] });
  const data = await queryMany(
    `SELECT ${BA_COLS} FROM berita_acara b LEFT JOIN users u ON u.id = b.dibuat_oleh
      WHERE b.status = 'MENUNGGU' AND b.ttd ? 'pj' AND (b.modul || ':' || b.unit) = ANY(@units::text[]) ORDER BY b.created_at, b.id`,
    { units: units.map((x) => `${x.modul}:${x.unit}`) }
  );
  res.json({ data: data.filter((b: any) => req.user!.role === "superuser" || b.ttd?.pj?.user_id !== req.user!.id) });
});

// Mengetahui / menyetujui in the app: SETUJU (status DISETUJUI, ready to destroy) or TOLAK with an alasan (the
// BA is cancelled and its barang free for another). Not by the account that made it (a Super User may).
app.put("/api/berita-acara/:id/persetujuan", async (req, res) => {
  const u = req.user!;
  const ba = await queryOne<any>("SELECT * FROM berita_acara WHERE id = @id", { id: req.params.id });
  if (!ba) return res.status(404).json({ error: "Berita acara tidak ditemukan" });
  if (!baUnitSetuju(u).some((x) => x.modul === ba.modul && x.unit === ba.unit)) return res.status(403).json({ error: "Akun ini tidak punya hak Setujui Berita Acara Pemusnahan untuk unit ini" });
  if (ba.status !== "MENUNGGU") return res.status(409).json({ error: "Berita acara ini tidak sedang menunggu persetujuan" });
  if (u.role !== "superuser" && ba.ttd?.pj?.user_id === u.id) return res.status(403).json({ error: "Pembuat berita acara tidak bisa menyetujuinya sendiri" });
  const jabatan = String(ba.isian?.mengetahui?.jabatan ?? "");
  if (req.body?.aksi === "TOLAK") {
    const alasan = String(req.body?.alasan ?? "").trim().slice(0, 500);
    if (alasan.length < 3) return res.status(400).json({ error: "Isi alasan penolakan" });
    await execute("UPDATE berita_acara SET status = 'BATAL', batal_oleh = @uid, batal_alasan = @alasan WHERE id = @id", { uid: u.id, alasan: `Ditolak ${u.nama}: ${alasan}`, id: ba.id });
    await baLog(req, ba, "Tolak Berita Acara", alasan);
    return res.json({ success: true });
  }
  const ttd = { ...(ba.ttd ?? {}), mengetahui: { cara: "AKUN", nama: u.nama, jabatan, user_id: u.id, at: new Date().toISOString() } };
  await execute(
    `UPDATE berita_acara SET status = 'DISETUJUI', ttd = @ttd::jsonb, disetujui_nama = @nama, disetujui_jabatan = @jabatan, disetujui_tgl = @tgl, disetujui_input_oleh = @uid WHERE id = @id`,
    { ttd: JSON.stringify(ttd), nama: u.nama, jabatan, tgl: jakartaToday(), uid: u.id, id: ba.id }
  );
  await baLog(req, ba, "Setujui Berita Acara", `ditandatangani ${u.nama}${jabatan ? ` (${jabatan})` : ""} di aplikasi`);
  res.json({ success: true });
});

// Tanda tangan at the destruction (DISETUJUI): pelaksana / saksi1 / saksi2, by the account signing (AKUN) or
// drawn on the screen (LAYAR, with the name on the BA); signing again replaces it.
app.put("/api/berita-acara/:id/ttd", async (req, res) => {
  const u = req.user!;
  const ba = await queryOne<any>("SELECT * FROM berita_acara WHERE id = @id", { id: req.params.id });
  if (!ba) return res.status(404).json({ error: "Berita acara tidak ditemukan" });
  if (!baBoleh(req, res, ba.modul, ba.unit, "input")) return;
  if (ba.status !== "DISETUJUI") return res.status(409).json({ error: ba.status === "MENUNGGU" ? "Tunggu persetujuan dulu; pelaksana dan saksi menandatangani saat pemusnahan" : "Berita acara ini sudah ditutup / dibatalkan" });
  const peran = String(req.body?.peran ?? "");
  if (!BA_TTD_MUSNAH.includes(peran)) return res.status(400).json({ error: "Kotak tanda tangan tidak valid" });
  const cara = req.body?.cara === "AKUN" ? "AKUN" : "LAYAR";
  const jabatan = String(req.body?.jabatan ?? ba.isian?.[peran]?.jabatan ?? "").trim().slice(0, 100);
  let isi: any;
  if (cara === "AKUN") {
    const lain = Object.entries(ba.ttd ?? {}).find(([k, v]: [string, any]) => k !== peran && v?.cara === "AKUN" && v?.user_id === u.id);
    if (lain && u.role !== "superuser") return res.status(403).json({ error: `Akun ini sudah menandatangani sebagai ${BA_PERAN_LABEL[lain[0]]}; satu orang satu tanda tangan` });
    isi = { cara, nama: u.nama, jabatan, user_id: u.id, at: new Date().toISOString() };
  } else {
    const gambar = String(req.body?.gambar ?? "");
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(gambar) || gambar.length > 400_000) return res.status(400).json({ error: "Tanda tangan di layar tidak terbaca; ulangi" });
    const nama = String(req.body?.nama ?? ba.isian?.[peran]?.nama ?? "").trim().slice(0, 100);
    if (!nama) return res.status(400).json({ error: "Isi nama yang menandatangani" });
    isi = { cara, nama, jabatan, gambar, input_oleh: u.id, input_nama: u.nama, at: new Date().toISOString() };
  }
  const ganti = !!ba.ttd?.[peran];
  await execute("UPDATE berita_acara SET ttd = jsonb_set(ttd, @path::text[], @isi::jsonb) WHERE id = @id", { path: [peran], isi: JSON.stringify(isi), id: ba.id });
  await baLog(
    req,
    ba,
    "Tanda Tangan Berita Acara",
    `${BA_PERAN_LABEL[peran]}: ${isi.nama}${jabatan ? ` (${jabatan})` : ""} · ${cara === "AKUN" ? "dengan akun" : `di layar, dicatat ${u.nama}`}${ganti ? " · mengganti tanda tangan sebelumnya" : ""}`
  );
  res.json({ success: true });
});

// Batal (before it is closed): its barang can go on another BA.
app.put("/api/berita-acara/:id/batal", async (req, res) => {
  const ba = await queryOne<any>("SELECT * FROM berita_acara WHERE id = @id", { id: req.params.id });
  if (!ba) return res.status(404).json({ error: "Berita acara tidak ditemukan" });
  if (!baBoleh(req, res, ba.modul, ba.unit, "edit")) return;
  if (!["MENUNGGU", "DISETUJUI"].includes(ba.status)) return res.status(409).json({ error: "Berita acara yang sudah ditutup tidak bisa dibatalkan" });
  const alasan = String(req.body?.alasan ?? "").trim();
  if (!alasan) return res.status(400).json({ error: "Tulis alasan pembatalannya" });
  await execute("UPDATE berita_acara SET status = 'BATAL', batal_oleh = @uid, batal_alasan = @alasan WHERE id = @id", { uid: req.user!.id, alasan, id: ba.id });
  await baLog(req, ba, "Batal Berita Acara", alasan);
  res.json({ success: true });
});

// ---- Kendaraan & Alat Berat (see schema.sql kendaraan_unit / kendaraan_harian): PT.AKSS for now ----
const KENDARAAN_PT = ["AKSS"];
const KENDARAAN_KONDISI = ["", "BAIK", "RUSAK", "STANDBY", "MANGKRAK"];
const kdPt = (v: unknown) => (KENDARAAN_PT.includes(String(v ?? "")) ? String(v) : KENDARAAN_PT[0]);
const kdDate = (v: unknown) => (v === null || v === undefined || v === "" ? null : isIsoDate(v) ? String(v) : undefined);
// Log rows are scoped by estate: the unit's estate, or Nilam for one serving all estates.
const kdLogEstate = (alokasi: unknown) => (["NILAM", "ZAMRUD", "FIRUS"].includes(String(alokasi)) ? String(alokasi) : "NILAM");
const KD_COLS = "id, pt, kode, id_unit, status, grup, jenis, nama, kepemilikan, tgl_perolehan, pemilik, alokasi, info, kondisi, tgl_rusak, tgl_selesai, keterangan, aktif, updated_at";

app.get("/api/kendaraan/unit", async (req, res) => {
  res.json(await queryMany(`SELECT ${KD_COLS} FROM kendaraan_unit WHERE pt = @pt ORDER BY status, jenis, kode`, { pt: kdPt(req.query.pt) }));
});

// The fields of a unit form (add / edit); undefined = refused (the error is sent).
function kdUnitBody(res: express.Response, b: any) {
  const t = (v: unknown) => String(v ?? "").trim();
  const u = {
    kode: t(b.kode).toUpperCase(),
    id_unit: t(b.id_unit),
    status: t(b.status) === "EKSTERNAL" ? "EKSTERNAL" : "INTERNAL",
    grup: t(b.grup).toUpperCase(),
    jenis: t(b.jenis).toUpperCase(),
    nama: t(b.nama),
    kepemilikan: t(b.kepemilikan).toUpperCase(),
    tgl_perolehan: kdDate(b.tgl_perolehan),
    pemilik: t(b.pemilik),
    alokasi: t(b.alokasi).toUpperCase(),
    info: t(b.info),
    kondisi: t(b.kondisi).toUpperCase(),
    tgl_rusak: kdDate(b.tgl_rusak),
    tgl_selesai: kdDate(b.tgl_selesai),
    keterangan: t(b.keterangan),
    operator: t(b.operator),
    aktif: b.aktif !== false,
  };
  if (!u.kode || !u.nama || !u.jenis) return void res.status(400).json({ error: "Kode unit, nama dan jenis wajib diisi" });
  if (!KENDARAAN_KONDISI.includes(u.kondisi)) return void res.status(400).json({ error: "Kondisi tidak valid" });
  if (u.tgl_perolehan === undefined || u.tgl_rusak === undefined || u.tgl_selesai === undefined) return void res.status(400).json({ error: "Tanggal tidak valid" });
  if (u.tgl_rusak && u.tgl_selesai && u.tgl_selesai < u.tgl_rusak) return void res.status(400).json({ error: "Tanggal selesai tidak boleh sebelum tanggal rusak" });
  return u;
}
const kdText = (u: any) => `${u.jenis} · ${u.status} · ${u.alokasi || "-"} · ${u.kondisi || "kondisi -"}`;

app.post("/api/kendaraan/unit", async (req, res) => {
  const u = kdUnitBody(res, req.body ?? {});
  if (!u) return;
  const pt = kdPt(req.body?.pt);
  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO kendaraan_unit (pt, kode, id_unit, status, grup, jenis, nama, kepemilikan, tgl_perolehan, pemilik, alokasi, info, kondisi, tgl_rusak, tgl_selesai, keterangan, operator, aktif)
       VALUES (@pt, @kode, @id_unit, @status, @grup, @jenis, @nama, @kepemilikan, @tgl_perolehan, @pemilik, @alokasi, @info, @kondisi, @tgl_rusak, @tgl_selesai, @keterangan, @operator, @aktif) RETURNING id`,
      { pt, ...u }
    );
    await logActivity(req, { module: "KENDARAAN", estate: kdLogEstate(u.alokasi), aksi: "Tambah Unit", objek: `${u.kode} - ${u.nama}`, detail: kdText(u) });
    res.json({ success: true, id: row!.id });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: `Kode unit ${u.kode} sudah dipakai` });
    throw e;
  }
});

app.put("/api/kendaraan/unit/:id", async (req, res) => {
  const before = await queryOne("SELECT * FROM kendaraan_unit WHERE id = @id", { id: req.params.id });
  if (!before) return res.status(404).json({ error: "Unit tidak ditemukan" });
  const u = kdUnitBody(res, req.body ?? {});
  if (!u) return;
  try {
    await execute(
      `UPDATE kendaraan_unit SET kode = @kode, id_unit = @id_unit, status = @status, grup = @grup, jenis = @jenis, nama = @nama, kepemilikan = @kepemilikan,
         tgl_perolehan = @tgl_perolehan, pemilik = @pemilik, alokasi = @alokasi, info = @info, kondisi = @kondisi, tgl_rusak = @tgl_rusak,
         tgl_selesai = @tgl_selesai, keterangan = @keterangan, operator = @operator, aktif = @aktif, updated_at = now() WHERE id = @id`,
      { ...u, id: before.id }
    );
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: `Kode unit ${u.kode} sudah dipakai` });
    throw e;
  }
  const changed = (Object.keys(u) as (keyof typeof u)[]).filter((k) => String(before[k] ?? "") !== String(u[k] ?? "")).map((k) => `${k}: ${before[k] ?? "-"} → ${u[k] ?? "-"}`);
  await logActivity(req, { module: "KENDARAAN", estate: kdLogEstate(u.alokasi), aksi: "Edit Unit", objek: `${u.kode} - ${u.nama}`, detail: changed.join("; ") || "Tidak ada perubahan" });
  res.json({ success: true });
});

// Kondisi of a unit now (rusak / selesai): Input.
app.put("/api/kendaraan/unit/:id/kondisi", async (req, res) => {
  const before = await queryOne("SELECT * FROM kendaraan_unit WHERE id = @id", { id: req.params.id });
  if (!before) return res.status(404).json({ error: "Unit tidak ditemukan" });
  const b = req.body ?? {};
  const kondisi = String(b.kondisi ?? "").toUpperCase();
  const tgl_rusak = kdDate(b.tgl_rusak);
  const tgl_selesai = kdDate(b.tgl_selesai);
  const keterangan = String(b.keterangan ?? "").trim();
  if (!KENDARAAN_KONDISI.includes(kondisi) || !kondisi) return res.status(400).json({ error: "Pilih kondisinya" });
  if (tgl_rusak === undefined || tgl_selesai === undefined) return res.status(400).json({ error: "Tanggal tidak valid" });
  if ((tgl_rusak && tgl_rusak > jakartaToday()) || (tgl_selesai && tgl_selesai > jakartaToday())) return res.status(400).json({ error: "Tanggal tidak boleh setelah hari ini" });
  if (kondisi !== "BAIK" && !tgl_rusak) return res.status(400).json({ error: "Isi tanggal rusaknya" });
  if (tgl_rusak && tgl_selesai && tgl_selesai < tgl_rusak) return res.status(400).json({ error: "Tanggal selesai tidak boleh sebelum tanggal rusak" });
  await execute("UPDATE kendaraan_unit SET kondisi = @kondisi, tgl_rusak = @tgl_rusak, tgl_selesai = @tgl_selesai, keterangan = @keterangan, updated_at = now() WHERE id = @id", {
    kondisi,
    tgl_rusak,
    tgl_selesai: kondisi === "BAIK" ? tgl_selesai : null,
    keterangan,
    id: before.id,
  });
  // Not baik: its kondisi harian from tgl_rusak up to today becomes B (S for standby) where still empty,
  // so the breakdown isn't typed twice. Cells already filled keep what was entered.
  let harianDiisi = 0;
  if (kondisi !== "BAIK" && tgl_rusak && before.status === "INTERNAL")
    harianDiisi = (
      await execute(
        `INSERT INTO kendaraan_harian (unit_id, tanggal, kondisi, user_id)
         SELECT @id, to_char(d, 'YYYY-MM-DD'), @k, @uid FROM generate_series(@dari::text::date, @sampai::text::date, interval '1 day') d
         ON CONFLICT (unit_id, tanggal) DO NOTHING`,
        { id: before.id, k: kondisi === "STANDBY" ? "S" : "B", uid: req.user!.id, dari: tgl_rusak, sampai: jakartaToday() }
      )
    ).rowCount ?? 0;
  await logActivity(req, {
    module: "KENDARAAN",
    estate: kdLogEstate(before.alokasi),
    aksi: "Update Kondisi Unit",
    objek: `${before.kode} - ${before.nama}`,
    detail: `${before.kondisi || "-"} → ${kondisi}${tgl_rusak ? ` · rusak ${tgl_rusak}` : ""}${kondisi === "BAIK" && tgl_selesai ? ` · selesai ${tgl_selesai}` : ""}${keterangan ? ` · ${keterangan}` : ""}${harianDiisi ? ` · ${harianDiisi} hari kondisi harian diisi ${kondisi === "STANDBY" ? "S" : "B"}` : ""}`,
  });
  res.json({ success: true, harian: harianDiisi });
});

// Kondisi harian of a month (bulan = 'YYYY-MM'): every cell R / S / B with its lokasi and pekerjaan.
app.get("/api/kendaraan/harian", async (req, res) => {
  const bulan = String(req.query.bulan ?? "");
  if (!/^\d{4}-\d{2}$/.test(bulan)) return res.status(400).json({ error: "Bulan tidak valid" });
  const cells = await queryMany(
    `SELECT h.unit_id, h.tanggal, h.kondisi, h.lokasi, h.pekerjaan FROM kendaraan_harian h JOIN kendaraan_unit u ON u.id = h.unit_id
      WHERE u.pt = @pt AND h.tanggal LIKE @like`,
    { pt: kdPt(req.query.pt), like: `${bulan}-%` }
  );
  res.json(cells);
});

// Fill one date for every active internal unit, only where the cell is still empty: "kemarin" copies the day
// before; "semua" puts R, or B / S for a unit recorded rusak / mangkrak / standby on that date.
app.post("/api/kendaraan/harian/isi", async (req, res) => {
  const b = req.body ?? {};
  const mode = b.mode === "kemarin" ? "kemarin" : b.mode === "semua" ? "semua" : b.mode === "kosongkan" ? "kosongkan" : "";
  if (!mode) return res.status(400).json({ error: "Pilih cara mengisi" });
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  const pt = kdPt(b.pt);
  // Kosongkan: every cell of that date (all internal units) is cleared, e.g. to undo an Isi semua.
  if (mode === "kosongkan") {
    const n = (await execute("DELETE FROM kendaraan_harian h USING kendaraan_unit u WHERE u.id = h.unit_id AND u.pt = @pt AND h.tanggal = @tgl", { pt, tgl: b.tanggal })).rowCount ?? 0;
    if (n) await logActivity(req, { module: "KENDARAAN", estate: "NILAM", aksi: "Kondisi Harian", objek: `Semua unit internal ${b.tanggal}`, detail: `dikosongkan · ${n} sel dihapus` });
    return res.json({ success: true, n });
  }
  const sql =
    mode === "kemarin"
      ? `INSERT INTO kendaraan_harian (unit_id, tanggal, kondisi, lokasi, pekerjaan, user_id)
         SELECT h.unit_id, @tgl::text, h.kondisi, h.lokasi, h.pekerjaan, @uid FROM kendaraan_harian h JOIN kendaraan_unit u ON u.id = h.unit_id
          WHERE u.pt = @pt AND u.aktif AND u.status = 'INTERNAL' AND h.tanggal = to_char(@tgl::text::date - 1, 'YYYY-MM-DD')
         ON CONFLICT (unit_id, tanggal) DO NOTHING`
      : `INSERT INTO kendaraan_harian (unit_id, tanggal, kondisi, user_id)
         SELECT u.id, @tgl,
                CASE WHEN u.kondisi IN ('RUSAK', 'MANGKRAK', 'STANDBY') AND (u.tgl_rusak IS NULL OR u.tgl_rusak <= @tgl)
                     THEN CASE WHEN u.kondisi = 'STANDBY' THEN 'S' ELSE 'B' END
                     WHEN u.kondisi = 'BAIK' AND u.tgl_rusak IS NOT NULL AND u.tgl_rusak <= @tgl AND (u.tgl_selesai IS NULL OR u.tgl_selesai > @tgl) THEN 'B'
                     ELSE 'R' END,
                @uid
           FROM kendaraan_unit u WHERE u.pt = @pt AND u.aktif AND u.status = 'INTERNAL'
         ON CONFLICT (unit_id, tanggal) DO NOTHING`;
  const n = (await execute(sql, { tgl: b.tanggal, uid: req.user!.id, pt })).rowCount ?? 0;
  if (n)
    await logActivity(req, {
      module: "KENDARAAN",
      estate: "NILAM",
      aksi: "Kondisi Harian",
      objek: `Semua unit internal ${b.tanggal}`,
      detail: `${mode === "kemarin" ? "salin dari kemarin (kondisi, lokasi, pekerjaan)" : "isi R (rusak = B, standby = S)"} · ${n} unit diisi (yang sudah terisi tidak diubah)`,
    });
  res.json({ success: true, n });
});

// One cell: kondisi R / S / B, or '' to clear it; lokasi / pekerjaan when sent (kept as they are otherwise).
app.put("/api/kendaraan/harian", async (req, res) => {
  const b = req.body ?? {};
  const kondisi = String(b.kondisi ?? "").toUpperCase();
  const detail = b.lokasi !== undefined || b.pekerjaan !== undefined;
  const lokasi = String(b.lokasi ?? "").trim().slice(0, 200);
  const pekerjaan = String(b.pekerjaan ?? "").trim().slice(0, 300);
  if (detail && !kondisi && (lokasi || pekerjaan)) return res.status(400).json({ error: "Pilih kondisinya (R / S / B) untuk mengisi lokasi dan pekerjaan" });
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  if (!["", "R", "S", "B"].includes(kondisi)) return res.status(400).json({ error: "Kondisi harus R, S atau B" });
  const u = await queryOne("SELECT id, kode, nama, alokasi, pt FROM kendaraan_unit WHERE id = @id", { id: Number(b.unit_id) || 0 });
  if (!u) return res.status(404).json({ error: "Unit tidak ditemukan" });
  const before = await queryOne<{ kondisi: string; lokasi: string; pekerjaan: string }>("SELECT kondisi, lokasi, pekerjaan FROM kendaraan_harian WHERE unit_id = @id AND tanggal = @tgl", {
    id: u.id,
    tgl: b.tanggal,
  });
  if ((before?.kondisi ?? "") === kondisi && (!detail || ((before?.lokasi ?? "") === lokasi && (before?.pekerjaan ?? "") === pekerjaan))) return res.json({ success: true });
  if (kondisi)
    await execute(
      `INSERT INTO kendaraan_harian (unit_id, tanggal, kondisi, lokasi, pekerjaan, user_id) VALUES (@id, @tgl, @k, @lokasi, @pekerjaan, @uid)
       ON CONFLICT (unit_id, tanggal) DO UPDATE SET kondisi = EXCLUDED.kondisi, user_id = EXCLUDED.user_id, updated_at = now()
         ${detail ? ", lokasi = EXCLUDED.lokasi, pekerjaan = EXCLUDED.pekerjaan" : ""}`,
      { id: u.id, tgl: b.tanggal, k: kondisi, lokasi, pekerjaan, uid: req.user!.id }
    );
  else await execute("DELETE FROM kendaraan_harian WHERE unit_id = @id AND tanggal = @tgl", { id: u.id, tgl: b.tanggal });
  await logActivity(req, {
    module: "KENDARAAN",
    estate: kdLogEstate(u.alokasi),
    aksi: "Kondisi Harian",
    objek: `${u.kode} - ${u.nama}`,
    detail: `${b.tanggal}: ${before?.kondisi || "-"} → ${kondisi || "-"}${
      detail && ((before?.lokasi ?? "") !== lokasi || (before?.pekerjaan ?? "") !== pekerjaan) ? ` · lokasi: ${lokasi || "-"} · pekerjaan: ${pekerjaan || "-"}` : ""
    }`,
  });
  res.json({ success: true });
});

// ---- Koperasi karyawan (see schema.sql koperasi_*): Nilam only for now ----
// An anggota takes goods (JUAL, deducted from the salary of that month = periode), the koperasi buys
// them in (BELI) and throws away what spoiled (RUSAK). Stock = BELI - JUAL - RUSAK.
const KOPERASI = "NILAM";
// A karyawan may take up to this much per payroll month; everything is deducted from that month's
// salary (no cicilan). Kantor / Mess Tamu (instansi) have no limit.
const KOP_LIMIT = 1_500_000;
const KOPERASI_LIST = [KOPERASI];
const kopMonth = (d: string) => d.slice(0, 7);
// Kunci periode: on the 1st the previous month's rekap goes to HRD and the salaries are cut from it, so
// from then on that month's Stock Out can't be added (back-dated), edited or deleted, except by HR
// (Pelunasan Koperasi) or a Super User. Stock In / Rusak / Koreksi aren't billed and stay open.
function kopKunci(req: express.Request, periode: string): string | null {
  const u = req.user!;
  if (u.role === "superuser" || u.perms.includes("koperasi.pelunasan") || periode >= kopMonth(jakartaToday())) return null;
  const [y, m] = periode.split("-");
  const bulan = INDO_MONTHS[Number(m) - 1];
  return `Periode ${bulan.charAt(0) + bulan.slice(1).toLowerCase()} ${y} sudah dikunci: rekapnya sudah disetor ke HRD tgl 1. Stock Out periode itu hanya bisa ditambah / diubah / dihapus oleh HR (Pelunasan Koperasi) atau Super User.`;
}
const isIsoDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const isPeriode = (p: unknown): p is string => typeof p === "string" && /^\d{4}-\d{2}$/.test(p);
// The anggota's shown name / jabatan / estate: master karyawan's while the employee is there, else what
// the koperasi kept (someone who left).
const KOP_ANGGOTA_COLS = `a.kode, a.jenis, COALESCE(NULLIF(k.nama, ''), a.nama) AS nama, a.jabatan, COALESCE(NULLIF(k.estate, ''), a.estate) AS estate,
  COALESCE(NULLIF(k.lokasi_kerja, ''), a.divisi) AS divisi, a.aktif, a.catatan, (k.nik IS NOT NULL) AS di_master`;
const KOP_ANGGOTA_JOIN = "LEFT JOIN karyawan k ON UPPER(REPLACE(k.nik, ' ', '')) = a.kode";
// The April 2023 rekap (sumber IMPORT-REKAP2023) is history from before the ledger: it doesn't move the stock.
// KOREKSI (stok opname / koreksi stok) carries a signed qty: + found, - missing.
const kopStokSql = `SUM(CASE WHEN t.sumber = 'IMPORT-REKAP2023' OR t.status = 'DITOLAK' OR (t.jenis = 'KOREKSI' AND t.status = 'MENUNGGU') THEN 0 WHEN t.jenis IN ('BELI', 'KOREKSI') THEN t.qty ELSE -t.qty END)`;

app.use("/api/koperasi", (req, res, next) => {
  if (!estateAllowed(req.user!, KOPERASI)) return res.status(403).json({ error: "Koperasi hanya untuk akun estate Nilam" });
  next();
});

app.get("/api/koperasi/periode", async (_req, res) => {
  const rows = await queryMany<{ periode: string }>("SELECT DISTINCT periode FROM koperasi_tx WHERE koperasi = @k ORDER BY periode DESC", { k: KOPERASI });
  const now = kopMonth(jakartaToday());
  const list = rows.map((r) => r.periode);
  if (!list.includes(now)) list.unshift(now);
  res.json(list);
});

// Cards on top of the page for one payroll month.
app.get("/api/koperasi/ringkasan", async (req, res) => {
  const periode = isPeriode(req.query.periode) ? req.query.periode : kopMonth(jakartaToday());
  const r = await queryOne(
    `SELECT COALESCE(SUM(total) FILTER (WHERE jenis = 'JUAL'), 0)::float8 AS jual,
            COALESCE(SUM(total) FILTER (WHERE jenis = 'JUAL' AND bayar = 'POTONG_GAJI'), 0)::float8 AS potong_gaji,
            COALESCE(SUM(total) FILTER (WHERE jenis = 'JUAL' AND bayar = 'TUNAI'), 0)::float8 AS tunai,
            COALESCE(SUM(total) FILTER (WHERE jenis = 'JUAL' AND bayar = 'INSTANSI'), 0)::float8 AS instansi,
            COUNT(DISTINCT anggota_kode) FILTER (WHERE jenis = 'JUAL')::int AS anggota,
            COALESCE(SUM(total) FILTER (WHERE jenis = 'BELI'), 0)::float8 AS beli
       FROM koperasi_tx WHERE koperasi = @k AND periode = @periode`,
    { k: KOPERASI, periode }
  );
  // Stock at the end of the periode (every movement up to that month), valued at the last harga beli
  // up to then (the barang's harga beli when it wasn't bought by then).
  const stok = await queryOne(
    `SELECT COALESCE(SUM(GREATEST(s.stok, 0) * COALESCE(h.harga, b.harga_beli)), 0)::float8 AS nilai_stok,
            COUNT(*) FILTER (WHERE b.aktif AND s.stok IS NOT NULL AND s.stok <= b.stok_min)::int AS menipis
       FROM koperasi_barang b
       LEFT JOIN (SELECT barang_kode, ${kopStokSql} AS stok FROM koperasi_tx t WHERE t.periode <= @periode GROUP BY barang_kode) s ON s.barang_kode = b.kode
       LEFT JOIN LATERAL (SELECT harga FROM koperasi_tx x WHERE x.barang_kode = b.kode AND x.jenis = 'BELI' AND x.harga > 0 AND x.periode <= @periode
                           ORDER BY x.tanggal_iso DESC, x.id DESC LIMIT 1) h ON true
      WHERE b.koperasi = @k AND b.lacak_stok`,
    { k: KOPERASI, periode }
  );
  res.json({ periode, ...r, ...stok });
});

// Dashboard koperasi over the payroll months dari..sampai: totals, sales per month (the 12 months up to
// sampai), per day (when the range is one month), top 15 barang and pengebon, per estate / divisi,
// barang that sell but are running out, and karyawan close to their limit in sampai.
app.get("/api/koperasi/dashboard", async (req, res) => {
  const sampai = isPeriode(req.query.sampai) ? req.query.sampai : kopMonth(jakartaToday());
  const dari = isPeriode(req.query.dari) && req.query.dari <= sampai ? req.query.dari : sampai;
  const p = { k: KOPERASI, dari, sampai };
  const jual = "t.koperasi = @k AND t.jenis = 'JUAL' AND t.periode BETWEEN @dari AND @sampai";
  const [y, m] = sampai.split("-").map(Number);
  const awal12 = `${m === 12 ? y : y - 1}-${String((m % 12) + 1).padStart(2, "0")}`;
  const anggotaNama = `COALESCE(NULLIF(k.nama, ''), NULLIF(a.nama, ''), a.kode)`;
  // One after another on one connection: nine at once can exceed the database pooler's connections.
  const steps: (() => Promise<any>)[] = [
    () => queryOne(
      `SELECT COALESCE(SUM(total), 0)::float8 AS jual, COUNT(DISTINCT COALESCE(bon, id::text))::int AS bon,
              COUNT(DISTINCT anggota_kode) FILTER (WHERE bayar = 'POTONG_GAJI')::int AS pengebon,
              COALESCE(SUM(total) FILTER (WHERE bayar = 'POTONG_GAJI'), 0)::float8 AS potong_gaji,
              COALESCE(SUM(total) FILTER (WHERE bayar = 'INSTANSI'), 0)::float8 AS instansi,
              COUNT(DISTINCT barang_kode)::int AS jenis_barang
         FROM koperasi_tx t WHERE ${jual}`,
      p
    ),
    () => queryOne(`SELECT COALESCE(SUM(total), 0)::float8 AS beli FROM koperasi_tx WHERE koperasi = @k AND jenis = 'BELI' AND periode BETWEEN @dari AND @sampai`, p),
    () => queryMany(
      `SELECT periode, COALESCE(SUM(total) FILTER (WHERE jenis = 'JUAL'), 0)::float8 AS jual, COALESCE(SUM(total) FILTER (WHERE jenis = 'BELI'), 0)::float8 AS beli,
              COUNT(DISTINCT anggota_kode) FILTER (WHERE jenis = 'JUAL' AND bayar = 'POTONG_GAJI')::int AS pengebon
         FROM koperasi_tx WHERE koperasi = @k AND periode BETWEEN @awal AND @sampai GROUP BY periode ORDER BY periode`,
      { ...p, awal: awal12 }
    ),
    () => dari === sampai
      ? queryMany(`SELECT tanggal_iso AS tanggal, SUM(total)::float8 AS jual, COUNT(DISTINCT anggota_kode)::int AS orang FROM koperasi_tx t WHERE ${jual} GROUP BY 1 ORDER BY 1`, p)
      : Promise.resolve([]),
    () => queryMany(
      `SELECT t.barang_kode AS kode, b.nama, b.satuan, SUM(t.qty)::float8 AS qty, SUM(t.total)::float8 AS nilai, COUNT(DISTINCT t.anggota_kode)::int AS orang
         FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode WHERE ${jual}
        GROUP BY 1, 2, 3 ORDER BY nilai DESC LIMIT 15`,
      p
    ),
    () => queryMany(
      `SELECT a.kode, ${anggotaNama} AS nama, a.jabatan, COALESCE(NULLIF(k.estate, ''), a.estate) AS estate, COALESCE(NULLIF(k.lokasi_kerja, ''), a.divisi) AS divisi,
              SUM(t.total)::float8 AS total, COUNT(DISTINCT t.bon)::int AS bon, COUNT(DISTINCT t.periode)::int AS bulan
         FROM koperasi_tx t JOIN koperasi_anggota a ON a.kode = t.anggota_kode ${KOP_ANGGOTA_JOIN}
        WHERE ${jual} AND t.bayar = 'POTONG_GAJI'
        GROUP BY a.kode, a.nama, a.jabatan, a.estate, a.divisi, k.nama, k.estate, k.lokasi_kerja ORDER BY total DESC LIMIT 15`,
      p
    ),
    () => queryMany(
      `SELECT CASE WHEN a.jenis = 'INSTANSI' THEN 'Instansi' WHEN COALESCE(NULLIF(k.estate, ''), NULLIF(a.estate, '')) IS NULL THEN 'Tidak tercatat'
                  ELSE INITCAP(COALESCE(NULLIF(k.estate, ''), a.estate)) || ' · ' || COALESCE(NULLIF(INITCAP(COALESCE(NULLIF(k.lokasi_kerja, ''), a.divisi)), ''), '-') END AS grup,
              SUM(t.total)::float8 AS total, COUNT(DISTINCT t.anggota_kode)::int AS orang
         FROM koperasi_tx t JOIN koperasi_anggota a ON a.kode = t.anggota_kode ${KOP_ANGGOTA_JOIN}
        WHERE ${jual} GROUP BY 1 ORDER BY total DESC LIMIT 12`,
      p
    ),
    // Sold in the last 3 months up to sampai, with stock left for less than a month of that pace.
    () => queryMany(
      `WITH laku AS (
         SELECT barang_kode, SUM(qty) / 3.0 AS rata FROM koperasi_tx
          WHERE koperasi = @k AND jenis = 'JUAL' AND periode BETWEEN @awal3 AND @sampai AND sumber IS DISTINCT FROM 'IMPORT-REKAP2023' GROUP BY 1
       ), stok AS (SELECT barang_kode, ${kopStokSql} AS stok FROM koperasi_tx t GROUP BY 1)
       SELECT b.kode, b.nama, b.satuan, b.harga_beli, COALESCE(s.stok, 0)::float8 AS stok, l.rata::float8 AS rata
         FROM laku l JOIN koperasi_barang b ON b.kode = l.barang_kode LEFT JOIN stok s ON s.barang_kode = b.kode
        WHERE b.lacak_stok AND b.aktif AND COALESCE(s.stok, 0) < l.rata
        ORDER BY COALESCE(s.stok, 0) / NULLIF(l.rata, 0), l.rata DESC LIMIT 15`,
      { ...p, awal3: (() => { const d = new Date(Date.UTC(y, m - 3, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; })() }
    ),
    () => queryMany(
      `SELECT a.kode, ${anggotaNama} AS nama, SUM(t.total)::float8 AS total
         FROM koperasi_tx t JOIN koperasi_anggota a ON a.kode = t.anggota_kode ${KOP_ANGGOTA_JOIN}
        WHERE t.koperasi = @k AND t.jenis = 'JUAL' AND t.bayar = 'POTONG_GAJI' AND t.periode = @sampai
        GROUP BY a.kode, a.nama, k.nama HAVING SUM(t.total) >= @batas ORDER BY total DESC LIMIT 20`,
      { ...p, batas: KOP_LIMIT * 0.8 }
    ),
  ];
  const out: any[] = [];
  for (const step of steps) out.push(await step());
  const [kpi, beli, perBulan, perHari, topBarang, topPengebon, perDivisi, perluBeli, dekatLimit] = out;
  res.json({ dari, sampai, limit: KOP_LIMIT, kpi: { ...kpi, ...beli }, perBulan, perHari, topBarang, topPengebon, perDivisi, perluBeli, dekatLimit });
});

// ---- Barang ----
app.get("/api/koperasi/barang", async (req, res) => {
  const { search = "", aktif = "1" } = req.query as Record<string, string>;
  const data = await queryMany(
    `SELECT b.*, COALESCE(s.stok, 0)::float8 AS stok, s.terakhir
       FROM koperasi_barang b
       LEFT JOIN (SELECT barang_kode, ${kopStokSql} AS stok, MAX(t.tanggal_iso) AS terakhir FROM koperasi_tx t GROUP BY barang_kode) s ON s.barang_kode = b.kode
      WHERE b.koperasi = @k AND (@aktif = '' OR b.aktif = (@aktif = '1'))
        AND (@search = '' OR b.nama ILIKE @like OR b.kode ILIKE @like)
      ORDER BY b.nama`,
    { k: KOPERASI, aktif, search, like: `%${search}%` }
  );
  // Expiry per arrival: the Stock In rows that carry a tanggal expired, the stock on hand spread over them
  // FEFO (what expires first was sold first, so the latest expiries are what is left). Stock beyond them
  // (older arrivals without a date) keeps the barang's own tanggal expired.
  const arrivals = await queryMany<{ kode: string; exp: string; qty: number }>(
    `SELECT barang_kode AS kode, exp_iso AS exp, SUM(qty)::float8 AS qty FROM koperasi_tx
      WHERE koperasi = @k AND jenis = 'BELI' AND exp_iso IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2 DESC`,
    { k: KOPERASI }
  );
  const byKode = new Map<string, { exp: string; qty: number }[]>();
  for (const a of arrivals) byKode.set(a.kode, [...(byKode.get(a.kode) ?? []), { exp: a.exp, qty: a.qty }]);
  for (const b of data as any[]) {
    let sisa = b.lacak_stok ? Math.max(Number(b.stok), 0) : 0;
    const batches: { exp: string; qty: number }[] = [];
    for (const a of byKode.get(b.kode) ?? []) {
      if (sisa <= 1e-9) break;
      const q = Math.min(a.qty, sisa);
      batches.push({ exp: a.exp, qty: Math.round(q * 1000) / 1000 });
      sisa -= q;
    }
    if (b.exp_iso && (sisa > 1e-9 || !b.lacak_stok)) batches.push({ exp: b.exp_iso, qty: b.lacak_stok ? Math.round(sisa * 1000) / 1000 : 0 });
    batches.sort((x, y) => x.exp.localeCompare(y.exp));
    b.exp_batches = batches;
    b.exp_terdekat = batches[0]?.exp ?? null;
  }
  res.json(data);
});

// The Stock In arrivals of a barang (newest first) with their tanggal expired, for the barang form.
app.get("/api/koperasi/barang/:kode/kedatangan", async (req, res) => {
  const data = await queryMany(
    `SELECT id, tanggal_iso, qty::float8 qty, exp_iso, no_po, keterangan FROM koperasi_tx
      WHERE koperasi = @k AND barang_kode = @kode AND jenis = 'BELI' ORDER BY tanggal_iso DESC, id DESC LIMIT 50`,
    { k: KOPERASI, kode: req.params.kode }
  );
  res.json(data);
});

// Set / change / clear the tanggal expired of one Stock In arrival (Edit Koperasi).
app.put("/api/koperasi/kedatangan/:id/exp", async (req, res) => {
  const exp = String(req.body?.exp_iso ?? "").trim();
  if (exp && !isIsoDate(exp)) return res.status(400).json({ error: "Tanggal expired tidak valid" });
  const t = await queryOne<any>(
    "SELECT t.id, t.tanggal_iso, t.exp_iso, t.qty, b.kode, b.nama FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode WHERE t.id = @id AND t.koperasi = @k AND t.jenis = 'BELI'",
    { id: req.params.id, k: KOPERASI }
  );
  if (!t) return res.status(404).json({ error: "Stock In tidak ditemukan" });
  await execute("UPDATE koperasi_tx SET exp_iso = @exp WHERE id = @id", { exp: exp || null, id: t.id });
  await logActivity(req, {
    module: "KOPERASI",
    estate: KOPERASI,
    aksi: "Ubah Tanggal Expired",
    objek: `${t.kode} ${t.nama}`,
    detail: `Stock In ${t.tanggal_iso} (${kopQty(Number(t.qty))}): ${t.exp_iso ?? "-"} → ${exp || "-"}`,
  });
  res.json({ success: true });
});

// A Stock In line's tanggal expired: a valid date or ''.
const kopExp = (v: unknown) => (isIsoDate(v) ? v : "");

const KOP_BARANG_LABELS = { exp_iso: "Tanggal Expired", catatan: "Catatan", nama: "Nama", satuan: "Satuan", harga_jual: "Harga Jual", harga_beli: "Harga Beli", stok_min: "Stok Minimum", aktif: "Aktif", lacak_stok: "Lacak Stok" };
function kopBarangBody(b: any): { error: string } | Record<string, unknown> {
  const nama = String(b.nama ?? "").trim().replace(/\s+/g, " ");
  const satuan = String(b.satuan ?? "").trim().toUpperCase();
  const harga_jual = Number(b.harga_jual ?? 0);
  const harga_beli = Number(b.harga_beli ?? 0);
  const stok_min = Number(b.stok_min ?? 0);
  if (!nama) return { error: "Nama barang wajib diisi" };
  if (!satuan) return { error: "Satuan wajib diisi" };
  if (![harga_jual, harga_beli, stok_min].every((n) => Number.isFinite(n) && n >= 0)) return { error: "Harga / stok minimum tidak valid" };
  // Tanggal expired of the stock on hand (the nearest one); empty = none / not tracked.
  const exp = String(b.exp_iso ?? "").trim();
  if (exp && !isIsoDate(exp)) return { error: "Tanggal expired tidak valid" };
  return { nama, satuan, harga_jual, harga_beli, stok_min, aktif: b.aktif !== false, lacak_stok: b.lacak_stok !== false, exp_iso: exp || null, catatan: String(b.catatan ?? "").trim() };
}

app.post("/api/koperasi/barang", async (req, res) => {
  const v = kopBarangBody(req.body ?? {});
  if ("error" in v) return res.status(400).json(v);
  // Next kode after the highest K0000.
  const last = await queryOne<{ n: number }>("SELECT COALESCE(MAX(SUBSTRING(kode FROM 2)::int), 0) AS n FROM koperasi_barang WHERE kode ~ '^K[0-9]+$'");
  const kode = `K${String(last!.n + 1).padStart(4, "0")}`;
  await execute(
    `INSERT INTO koperasi_barang (kode, koperasi, nama, satuan, harga_jual, harga_beli, stok_min, aktif, lacak_stok, exp_iso, catatan)
     VALUES (@kode, @k, @nama, @satuan, @harga_jual, @harga_beli, @stok_min, @aktif, @lacak_stok, @exp_iso, @catatan)`,
    { kode, k: KOPERASI, ...v }
  );
  await logActivity(req, { module: "KOPERASI", estate: KOPERASI, aksi: "Tambah Barang", objek: `${kode} ${v.nama}` });
  res.json({ kode });
});

app.put("/api/koperasi/barang/:kode", async (req, res) => {
  const before = await queryOne("SELECT * FROM koperasi_barang WHERE kode = @kode AND koperasi = @k", { kode: req.params.kode, k: KOPERASI });
  if (!before) return res.status(404).json({ error: "Barang tidak ditemukan" });
  const v = kopBarangBody(req.body ?? {});
  if ("error" in v) return res.status(400).json(v);
  await execute(
    `UPDATE koperasi_barang SET nama = @nama, satuan = @satuan, harga_jual = @harga_jual, harga_beli = @harga_beli, stok_min = @stok_min,
       aktif = @aktif, lacak_stok = @lacak_stok, exp_iso = @exp_iso, catatan = @catatan WHERE kode = @kode`,
    { kode: req.params.kode, ...v }
  );
  await logActivity(req, { module: "KOPERASI", estate: KOPERASI, aksi: "Edit Barang", objek: `${before.kode} ${before.nama}`, detail: describeChanges(before, v, KOP_BARANG_LABELS) });
  res.json({ success: true });
});

// ---- Anggota ----
app.get("/api/koperasi/anggota", async (req, res) => {
  const { search = "", status = "aktif", jenis = "" } = req.query as Record<string, string>;
  const periode = kopMonth(jakartaToday());
  const data = await queryMany(
    `SELECT ${KOP_ANGGOTA_COLS}, s.n_bon, s.terakhir, s.total_bulan_ini
       FROM koperasi_anggota a ${KOP_ANGGOTA_JOIN}
       LEFT JOIN (SELECT anggota_kode, COUNT(DISTINCT bon)::int AS n_bon, MAX(tanggal_iso) AS terakhir,
                         COALESCE(SUM(total) FILTER (WHERE periode = @periode), 0)::float8 AS total_bulan_ini
                    FROM koperasi_tx WHERE jenis = 'JUAL' GROUP BY anggota_kode) s ON s.anggota_kode = a.kode
      WHERE a.koperasi = @k AND (@status = '' OR a.aktif = (@status = 'aktif')) AND (@jenis = '' OR a.jenis = @jenis)
        AND (@search = '' OR a.kode ILIKE @like OR a.nama ILIKE @like OR k.nama ILIKE @like)
      ORDER BY a.jenis DESC, COALESCE(NULLIF(k.nama, ''), NULLIF(a.nama, ''), a.kode)`,
    { k: KOPERASI, status, jenis, search, like: `%${search}%`, periode }
  );
  res.json(data);
});

// The pengambilan form's picker: active anggota and any karyawan not yet anggota (added on the first
// pengambilan), matched by name or NIK.
app.get("/api/koperasi/anggota/pick", async (req, res) => {
  const search = String(req.query.search ?? "").trim();
  if (search.length < 2) return res.json([]);
  const like = `%${search}%`;
  const anggota = await queryMany(
    `SELECT ${KOP_ANGGOTA_COLS} FROM koperasi_anggota a ${KOP_ANGGOTA_JOIN}
      WHERE a.koperasi = @k AND a.aktif AND (a.kode ILIKE @like OR a.nama ILIKE @like OR k.nama ILIKE @like)
      ORDER BY COALESCE(NULLIF(k.nama, ''), a.nama) LIMIT 12`,
    { k: KOPERASI, like }
  );
  const karyawan = await queryMany(
    `SELECT UPPER(REPLACE(k.nik, ' ', '')) AS kode, 'KARYAWAN' AS jenis, k.nama, '' AS jabatan, k.estate, k.lokasi_kerja AS divisi, true AS aktif, '' AS catatan, true AS di_master, true AS baru
       FROM karyawan k
      WHERE (k.nama ILIKE @like OR k.nik ILIKE @like)
        AND NOT EXISTS (SELECT 1 FROM koperasi_anggota a WHERE a.kode = UPPER(REPLACE(k.nik, ' ', '')))
      ORDER BY k.nama LIMIT 8`,
    { like }
  );
  res.json([...anggota, ...karyawan]);
});

const KOP_ANGGOTA_LABELS = { nama: "Nama", jabatan: "Jabatan", estate: "Estate", divisi: "Divisi", aktif: "Aktif", catatan: "Catatan" };
app.post("/api/koperasi/anggota", async (req, res) => {
  const b = req.body ?? {};
  const jenis = b.jenis === "INSTANSI" ? "INSTANSI" : "KARYAWAN";
  const kode = String(b.kode ?? "").trim().toUpperCase().replace(/\s+/g, jenis === "KARYAWAN" ? "" : " ");
  const nama = String(b.nama ?? "").trim();
  if (!kode) return res.status(400).json({ error: jenis === "KARYAWAN" ? "NIK wajib diisi" : "Kode wajib diisi" });
  if (jenis === "INSTANSI" && !nama) return res.status(400).json({ error: "Nama wajib diisi" });
  // An instansi has no limit and isn't cut from a salary: a karyawan's NIK can't be one.
  if (jenis === "INSTANSI" && (await queryOne("SELECT 1 FROM karyawan WHERE UPPER(REPLACE(nik, ' ', '')) = @kode", { kode: kode.replace(/s+/g, "") })))
    return res.status(400).json({ error: "Kode ini NIK karyawan; daftarkan sebagai Karyawan, bukan Instansi" });
  const k = jenis === "KARYAWAN" ? await queryOne("SELECT nama, estate, lokasi_kerja FROM karyawan WHERE UPPER(REPLACE(nik, ' ', '')) = @kode", { kode }) : null;
  if (jenis === "KARYAWAN" && !k && !nama) return res.status(400).json({ error: "NIK ini tidak ada di master karyawan; isi namanya" });
  const r = await execute(
    `INSERT INTO koperasi_anggota (kode, koperasi, jenis, nama, jabatan, estate, divisi, catatan)
     VALUES (@kode, @k, @jenis, @nama, @jabatan, @estate, @divisi, @catatan) ON CONFLICT (kode) DO NOTHING`,
    {
      kode,
      k: KOPERASI,
      jenis,
      nama: k?.nama ?? nama,
      jabatan: String(b.jabatan ?? "").trim(),
      estate: k?.estate ?? String(b.estate ?? "").trim(),
      divisi: k?.lokasi_kerja ?? String(b.divisi ?? "").trim(),
      catatan: String(b.catatan ?? "").trim(),
    }
  );
  if (!r.rowCount) return res.status(409).json({ error: `${kode} sudah terdaftar sebagai anggota` });
  await logActivity(req, { module: "KOPERASI", estate: KOPERASI, aksi: "Tambah Anggota", objek: `${kode} ${k?.nama ?? nama}` });
  res.json({ kode });
});

app.put("/api/koperasi/anggota/:kode", async (req, res) => {
  const before = await queryOne("SELECT * FROM koperasi_anggota WHERE kode = @kode AND koperasi = @k", { kode: req.params.kode, k: KOPERASI });
  if (!before) return res.status(404).json({ error: "Anggota tidak ditemukan" });
  const b = req.body ?? {};
  const next = {
    nama: String(b.nama ?? before.nama).trim(),
    jabatan: String(b.jabatan ?? before.jabatan).trim(),
    estate: String(b.estate ?? before.estate).trim(),
    divisi: String(b.divisi ?? before.divisi).trim(),
    aktif: b.aktif === undefined ? before.aktif : b.aktif !== false,
    catatan: String(b.catatan ?? before.catatan).trim(),
  };
  await execute(
    "UPDATE koperasi_anggota SET nama = @nama, jabatan = @jabatan, estate = @estate, divisi = @divisi, aktif = @aktif, catatan = @catatan WHERE kode = @kode",
    { kode: before.kode, ...next }
  );
  await logActivity(req, { module: "KOPERASI", estate: KOPERASI, aksi: "Edit Anggota", objek: `${before.kode} ${next.nama}`, detail: describeChanges(before, next, KOP_ANGGOTA_LABELS) });
  res.json({ success: true });
});

// Limit of one anggota in a periode: what is already deducted (potong gaji) and what is left.
// A Stock Out change may not bring a periode's potong-gaji bill below what was already paid for it (the payment
// would be left over, hidden as sisa 0): delete the payment first. delta = change of the bill (negative = less).
async function kopLebihBayar(kode: string | null, periode: string, delta: number, client: PoolClient): Promise<string | null> {
  if (!kode || delta >= 0) return null;
  const dibayar = (await queryOne<{ v: number }>("SELECT COALESCE(SUM(jumlah), 0)::float8 v FROM koperasi_bayar WHERE anggota_kode = @kode AND periode = @periode AND koperasi = @k", { kode, periode, k: KOPERASI }, client))!.v;
  if (dibayar <= 0.5) return null;
  const tagihan = await kopTerpakai(kode, periode, client);
  if (tagihan + delta >= dibayar - 0.5) return null;
  const rpText = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  return `Tagihan ${kode} periode ${periode} sudah dibayar ${rpText(dibayar)}; perubahan ini membuat tagihannya ${rpText(tagihan + delta)}, lebih kecil dari yang dibayar. Hapus / ubah pembayarannya dulu (HR, tombol Pembayaran di Rekap).`;
}

async function kopTerpakai(kode: string, periode: string, client?: PoolClient) {
  const r = await queryOne<{ v: number }>(
    "SELECT COALESCE(SUM(total), 0)::float8 AS v FROM koperasi_tx WHERE anggota_kode = @kode AND periode = @periode AND jenis = 'JUAL' AND bayar = 'POTONG_GAJI'",
    { kode, periode },
    client
  );
  return r!.v;
}
app.get("/api/koperasi/limit/:kode", async (req, res) => {
  const periode = isPeriode(req.query.periode) ? req.query.periode : kopMonth(jakartaToday());
  const kode = String(req.params.kode).toUpperCase();
  const terpakai = await kopTerpakai(kode, periode);
  const [t] = await kopTunggakan([kode]);
  res.json({ periode, limit: KOP_LIMIT, terpakai, sisa: Math.max(KOP_LIMIT - terpakai, 0), tunggakan: t ? { sisa: t.sisa, periode: t.periode, pesan: kopTunggakanText(t) } : null });
});

// ---- Transaksi ----
app.get("/api/koperasi/tx", async (req, res) => {
  const { jenis = "JUAL", periode = "", anggota = "", barang = "", status = "", search = "", page = "1", pageSize = "100" } = req.query as Record<string, string>;
  const conditions = ["t.koperasi = @k"];
  if (["JUAL", "BELI", "RUSAK", "KOREKSI"].includes(jenis)) conditions.push("t.jenis = @jenis");
  if (isPeriode(periode)) conditions.push("t.periode = @periode");
  if (anggota) conditions.push("t.anggota_kode = @anggota");
  if (barang) conditions.push("t.barang_kode = @barang");
  if (["MENUNGGU", "DISETUJUI", "DITOLAK"].includes(status)) conditions.push(status === "DISETUJUI" ? "COALESCE(t.status, 'DISETUJUI') = @status" : "t.status = @status");
  if (search) conditions.push("(b.nama ILIKE @like OR t.barang_kode ILIKE @like OR t.anggota_kode ILIKE @like OR a.nama ILIKE @like OR k.nama ILIKE @like OR t.no_po ILIKE @like OR t.keterangan ILIKE @like)");
  const where = `WHERE ${conditions.join(" AND ")}`;
  const from = `FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode
    LEFT JOIN koperasi_anggota a ON a.kode = t.anggota_kode LEFT JOIN karyawan k ON UPPER(REPLACE(k.nik, ' ', '')) = a.kode`;
  const params = { k: KOPERASI, jenis, periode, anggota, barang, status, like: `%${search}%` };
  const sum = await queryOne<{ n: number; total: number; qty: number }>(`SELECT COUNT(*)::int n, COALESCE(SUM(t.total), 0)::float8 total, COALESCE(SUM(t.qty), 0)::float8 qty ${from} ${where}`, params);
  const limit = Math.min(parseInt(pageSize) || 100, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;
  const data = await queryMany(
    `SELECT t.id, t.jenis, t.tanggal_iso, t.periode, t.bon, t.barang_kode, b.nama AS barang_nama, b.satuan, t.qty, t.harga, t.total, t.anggota_kode,
            COALESCE(NULLIF(k.nama, ''), a.nama) AS anggota_nama, a.jenis AS anggota_jenis, t.bayar, t.no_po, t.keterangan, t.evidence_id, t.sumber, t.created_at,
            COALESCE(u.nama, u.username, '') AS oleh, t.user_id, t.opname_id, t.alasan, t.status, t.diperiksa_at, t.diperiksa_catatan,
            COALESCE(p.nama, p.username) AS diperiksa_nama
       ${from} LEFT JOIN users u ON u.id = t.user_id LEFT JOIN users p ON p.id = t.diperiksa_oleh ${where}
      ORDER BY t.tanggal_iso DESC, t.id DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  res.json({ data, total: sum!.n, sum_total: sum!.total, sum_qty: sum!.qty });
});

type KopLine = { barang_kode: string; qty: number; harga: number };
// The lines of a pengambilan / pembelian: known barang, qty > 0, harga >= 0 (one barang once).
async function kopLines(items: unknown, client: PoolClient): Promise<{ error: string } | { lines: (KopLine & { nama: string; lacak_stok: boolean; harga_jual: number })[] }> {
  if (!Array.isArray(items) || !items.length) return { error: "Isi minimal satu barang" };
  const lines = items.map((i: any) => ({ barang_kode: String(i?.barang_kode ?? ""), qty: Number(i?.qty), harga: Number(i?.harga ?? 0) }));
  if (lines.some((l) => !l.barang_kode || !(l.qty > 0) || !(l.harga >= 0))) return { error: "Jumlah harus lebih dari 0 dan harga tidak boleh minus" };
  if (new Set(lines.map((l) => l.barang_kode)).size !== lines.length) return { error: "Barang yang sama diisi dua kali; gabungkan jumlahnya" };
  const barang = await queryMany<{ kode: string; nama: string; lacak_stok: boolean; harga_jual: number }>(
    "SELECT kode, nama, lacak_stok, harga_jual::float8 harga_jual FROM koperasi_barang WHERE kode = ANY(@kode::text[]) AND koperasi = @k FOR UPDATE",
    { kode: lines.map((l) => l.barang_kode), k: KOPERASI },
    client
  );
  const by = new Map(barang.map((b) => [b.kode, b]));
  const missing = lines.find((l) => !by.has(l.barang_kode));
  if (missing) return { error: `Barang ${missing.barang_kode} tidak ada di master koperasi` };
  return { lines: lines.map((l) => ({ ...l, nama: by.get(l.barang_kode)!.nama, lacak_stok: by.get(l.barang_kode)!.lacak_stok, harga_jual: by.get(l.barang_kode)!.harga_jual })) };
}

// Stock now of these barang (rows locked by kopLines' FOR UPDATE, so two sales can't both take the last one).
async function kopStok(kode: string[], client: PoolClient) {
  const rows = await queryMany<{ kode: string; stok: number }>(
    `SELECT barang_kode AS kode, ${kopStokSql}::float8 AS stok FROM koperasi_tx t WHERE barang_kode = ANY(@kode::text[]) GROUP BY barang_kode`,
    { kode },
    client
  );
  return new Map(rows.map((r) => [r.kode, r.stok]));
}
const kopQty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

// Pengambilan: one bon of an anggota, several barang. A karyawan's is deducted from the salary of the
// tanggal's month (POTONG_GAJI, up to KOP_LIMIT a month); an INSTANSI (Kantor, Mess Tamu) is billed to the company.
app.post("/api/koperasi/jual", async (req, res) => {
  const b = req.body ?? {};
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  const kunci = kopKunci(req, kopMonth(b.tanggal));
  if (kunci) return res.status(403).json({ error: kunci });
  const kode = String(b.anggota_kode ?? "").trim().toUpperCase();
  if (!kode) return res.status(400).json({ error: "Pilih anggota / karyawan" });
  const evidence = b.evidence_id ? await claimEvidence(req, res) : null;
  if (evidence === undefined) return;
  try {
    const result = await withTransaction(async (client) => {
      let anggota = await queryOne<{ kode: string; jenis: string; nama: string; aktif: boolean }>(
        "SELECT kode, jenis, nama, aktif FROM koperasi_anggota WHERE kode = @kode AND koperasi = @k",
        { kode, k: KOPERASI },
        client
      );
      if (!anggota) {
        // A karyawan's first pengambilan makes them anggota.
        const k = await queryOne("SELECT nama, estate, lokasi_kerja FROM karyawan WHERE UPPER(REPLACE(nik, ' ', '')) = @kode", { kode }, client);
        if (!k) return { error: "NIK tidak ada di master karyawan maupun anggota koperasi" };
        await execute(
          "INSERT INTO koperasi_anggota (kode, koperasi, jenis, nama, estate, divisi) VALUES (@kode, @k, 'KARYAWAN', @nama, @estate, @divisi) ON CONFLICT (kode) DO NOTHING",
          { kode, k: KOPERASI, nama: k.nama, estate: k.estate ?? "", divisi: k.lokasi_kerja ?? "" },
          client
        );
        anggota = { kode, jenis: "KARYAWAN", nama: k.nama, aktif: true };
      }
      if (!anggota.aktif) return { error: `${anggota.nama || kode} sudah tidak aktif sebagai anggota koperasi` };
      const bayar = anggota.jenis === "INSTANSI" ? "INSTANSI" : "POTONG_GAJI";
      if (bayar === "POTONG_GAJI") {
        const [t] = await kopTunggakan([kode], client);
        if (t) return { error: kopTunggakanText(t) };
      }
      const v = await kopLines(b.items, client);
      if ("error" in v) return v;
      // Stock Out sells at the master harga jual (a price typed in could slip a bon under the limit / out of the bill).
      for (const l of v.lines) l.harga = l.harga_jual;
      const stok = await kopStok(v.lines.map((l) => l.barang_kode), client);
      const short = v.lines.find((l) => l.lacak_stok && (stok.get(l.barang_kode) ?? 0) + 1e-9 < l.qty);
      if (short) return { error: `Stok ${short.nama} tinggal ${kopQty(stok.get(short.barang_kode) ?? 0)}, tidak cukup untuk ${kopQty(short.qty)}` };
      if (bayar === "POTONG_GAJI") {
        // The anggota row is locked so two bon at once can't both fit under the limit.
        await queryOne("SELECT kode FROM koperasi_anggota WHERE kode = @kode FOR UPDATE", { kode }, client);
        const terpakai = await kopTerpakai(kode, kopMonth(b.tanggal), client);
        const baru = v.lines.reduce((s, l) => s + l.qty * l.harga, 0);
        if (terpakai + baru > KOP_LIMIT + 0.005) {
          const rpText = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
          return {
            error: `Melebihi limit ${rpText(KOP_LIMIT)} per bulan: ${anggota.nama || kode} sudah mengambil ${rpText(terpakai)} di periode ini, sisa ${rpText(Math.max(KOP_LIMIT - terpakai, 0))}, bon ini ${rpText(baru)}`,
          };
        }
      }
      const bon = `KOP-${b.tanggal.replace(/-/g, "")}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      await execute(
        `INSERT INTO koperasi_tx (koperasi, jenis, tanggal_iso, periode, bon, barang_kode, qty, harga, total, anggota_kode, bayar, keterangan, evidence_id, user_id)
         SELECT @k, 'JUAL', @tanggal, @periode, @bon, x.kode, x.qty, x.harga, ROUND((x.qty * x.harga)::numeric, 2), @anggota, @bayar, @ket, @evidence::uuid, @uid
           FROM json_to_recordset(@rows::json) AS x(kode text, qty float8, harga float8)`,
        {
          k: KOPERASI,
          tanggal: b.tanggal,
          periode: kopMonth(b.tanggal),
          bon,
          anggota: kode,
          bayar,
          ket: String(b.keterangan ?? "").trim(),
          evidence,
          uid: req.user!.id,
          // Tanggal expired of this arrival (optional), kept on the Stock In row.
          rows: JSON.stringify(v.lines.map((l, i) => ({ kode: l.barang_kode, qty: l.qty, harga: l.harga, exp: kopExp(b.items?.[i]?.exp_iso) }))),
        },
        client
      );
      const total = v.lines.reduce((s, l) => s + l.qty * l.harga, 0);
      return { bon, total, nama: anggota.nama, bayar, lines: v.lines };
    });
    if ("error" in result) return res.status(400).json(result);
    await logActivity(req, {
      module: "KOPERASI",
      estate: KOPERASI,
      aksi: "Stock Out",
      objek: `${result.bon} ${kode} ${result.nama}`,
      detail: `${result.lines.map((l) => `${l.nama} ${kopQty(l.qty)}`).join(", ")} · Rp ${Math.round(result.total).toLocaleString("id-ID")} (${result.bayar === "POTONG_GAJI" ? "potong gaji" : result.bayar.toLowerCase()})`,
    });
    res.json({ bon: result.bon, total: result.total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal menyimpan stock out" });
  }
});

// Pembelian: barang bought in. harga = harga beli; with update_harga the barang's harga beli and
// harga jual become this price (the koperasi sells at cost).
app.post("/api/koperasi/beli", async (req, res) => {
  const b = req.body ?? {};
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  const evidence = b.evidence_id ? await claimEvidence(req, res) : null;
  if (evidence === undefined) return;
  try {
    const result = await withTransaction(async (client) => {
      const v = await kopLines(b.items, client);
      if ("error" in v) return v;
      await execute(
        `INSERT INTO koperasi_tx (koperasi, jenis, tanggal_iso, periode, barang_kode, qty, harga, total, no_po, keterangan, evidence_id, user_id, exp_iso)
         SELECT @k, 'BELI', @tanggal, @periode, x.kode, x.qty, x.harga, ROUND((x.qty * x.harga)::numeric, 2), @po, @ket, @evidence::uuid, @uid, NULLIF(x.exp, '')
           FROM json_to_recordset(@rows::json) AS x(kode text, qty float8, harga float8, exp text)`,
        {
          k: KOPERASI,
          tanggal: b.tanggal,
          periode: kopMonth(b.tanggal),
          po: String(b.no_po ?? "").trim(),
          ket: String(b.keterangan ?? "").trim(),
          evidence,
          uid: req.user!.id,
          rows: JSON.stringify(v.lines.map((l) => ({ kode: l.barang_kode, qty: l.qty, harga: l.harga }))),
        },
        client
      );
      for (const l of v.lines.filter((l) => l.harga > 0))
        await execute(
          // A late-entered older nota doesn't override the price of a newer Stock In.
          `UPDATE koperasi_barang SET harga_beli = @harga${b.update_harga !== false ? ", harga_jual = @harga" : ""} WHERE kode = @kode AND NOT EXISTS (SELECT 1 FROM koperasi_tx x WHERE x.barang_kode = @kode AND x.jenis = 'BELI' AND x.tanggal_iso > @tanggal)`,
          { harga: l.harga, kode: l.barang_kode, tanggal: b.tanggal },
          client
        );
      return { lines: v.lines, total: v.lines.reduce((s, l) => s + l.qty * l.harga, 0) };
    });
    if ("error" in result) return res.status(400).json(result);
    await logActivity(req, {
      module: "KOPERASI",
      estate: KOPERASI,
      aksi: "Stock In",
      objek: String(b.no_po ?? "").trim() || `${result.lines.length} barang`,
      detail: `${result.lines.map((l) => `${l.nama} ${kopQty(l.qty)} @ ${l.harga.toLocaleString("id-ID")}`).join(", ")} · Rp ${Math.round(result.total).toLocaleString("id-ID")}`,
    });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal menyimpan stock in" });
  }
});

// Input Banyak Pengambilan: many anggota's pengambilan of one day typed as a table. Each row = one
// barang of one anggota; an anggota's rows become one bon. All rows are saved or none; a refused row
// comes back as { row } (its index) so the table marks it.
app.post("/api/koperasi/jual/batch", async (req, res) => {
  const b = req.body ?? {};
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  const kunci = kopKunci(req, kopMonth(b.tanggal));
  if (kunci) return res.status(403).json({ error: kunci });
  const rows: { anggota_kode: string; barang_kode: string; qty: number; harga: number }[] = (Array.isArray(b.rows) ? b.rows : []).map((r: any) => ({
    anggota_kode: String(r?.anggota_kode ?? "").trim().toUpperCase(),
    barang_kode: String(r?.barang_kode ?? "").trim().toUpperCase(),
    qty: Number(r?.qty),
    harga: Number(r?.harga ?? 0),
  }));
  if (!rows.length) return res.status(400).json({ error: "Belum ada baris" });
  if (rows.length > 500) return res.status(400).json({ error: "Maksimal 500 baris sekali simpan" });
  const evidence = b.evidence_id ? await claimEvidence(req, res) : null;
  if (evidence === undefined) return;
  const periode = kopMonth(b.tanggal);
  const rpText = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  type Refused = { error: string; row: number };
  try {
    const result = await withTransaction<Refused | { bons: number; total: number }>(async (client) => {
      const refuse = (i: number, error: string): Refused => ({ error: `Baris ${i + 1}: ${error}`, row: i });
      const bad = rows.findIndex((r) => !r.anggota_kode || !r.barang_kode || !(r.qty > 0) || !(r.harga >= 0));
      if (bad >= 0) return refuse(bad, "anggota, barang, jumlah (> 0) dan harga wajib diisi");
      // Anggota: existing and active, or a karyawan who becomes anggota now.
      const kodes = [...new Set(rows.map((r) => r.anggota_kode))];
      const anggota = new Map(
        (
          await queryMany<{ kode: string; jenis: string; nama: string; aktif: boolean }>(
            "SELECT kode, jenis, nama, aktif FROM koperasi_anggota WHERE kode = ANY(@k::text[]) AND koperasi = @kop FOR UPDATE",
            { k: kodes, kop: KOPERASI },
            client
          )
        ).map((a) => [a.kode, a])
      );
      const missing = kodes.filter((k) => !anggota.has(k));
      const karyawan = new Map(
        (
          await queryMany<{ kode: string; nama: string; estate: string; lokasi_kerja: string }>(
            "SELECT UPPER(REPLACE(nik, ' ', '')) AS kode, nama, estate, lokasi_kerja FROM karyawan WHERE UPPER(REPLACE(nik, ' ', '')) = ANY(@k::text[])",
            { k: missing },
            client
          )
        ).map((k) => [k.kode, k])
      );
      for (const [i, r] of rows.entries()) {
        const a = anggota.get(r.anggota_kode);
        if (a && !a.aktif) return refuse(i, `${a.nama || r.anggota_kode} sudah tidak aktif sebagai anggota`);
        if (!a && !karyawan.has(r.anggota_kode)) return refuse(i, `NIK ${r.anggota_kode} tidak ada di master karyawan maupun anggota koperasi`);
      }
      const barang = new Map(
        (
          await queryMany<{ kode: string; nama: string; lacak_stok: boolean; harga_jual: number }>(
            "SELECT kode, nama, lacak_stok, harga_jual::float8 harga_jual FROM koperasi_barang WHERE kode = ANY(@k::text[]) AND koperasi = @kop FOR UPDATE",
            { k: [...new Set(rows.map((r) => r.barang_kode))], kop: KOPERASI },
            client
          )
        ).map((x) => [x.kode, x])
      );
      const noBarang = rows.findIndex((r) => !barang.has(r.barang_kode));
      if (noBarang >= 0) return refuse(noBarang, `barang ${rows[noBarang].barang_kode} tidak ada di master koperasi`);
      // At the master harga jual, as a single Stock Out.
      for (const r of rows) r.harga = barang.get(r.barang_kode)!.harga_jual;
      // Karyawan with an unpaid bill past its due date can't take goods.
      const nunggak = new Map((await kopTunggakan(kodes, client)).map((t) => [t.kode, t]));
      const blocked = rows.findIndex((r) => anggota.get(r.anggota_kode)?.jenis !== "INSTANSI" && nunggak.has(r.anggota_kode));
      if (blocked >= 0) return refuse(blocked, kopTunggakanText(nunggak.get(rows[blocked].anggota_kode)!));
      // Stock and the monthly limit, row after row.
      const stok = await kopStok([...barang.keys()], client);
      const terpakai = new Map<string, number>();
      for (const [i, r] of rows.entries()) {
        const br = barang.get(r.barang_kode)!;
        if (br.lacak_stok) {
          const left = (stok.get(r.barang_kode) ?? 0) - r.qty;
          if (left < -1e-9) return refuse(i, `stok ${br.nama} tidak cukup (tinggal ${kopQty(stok.get(r.barang_kode) ?? 0)})`);
          stok.set(r.barang_kode, left);
        }
        const a = anggota.get(r.anggota_kode);
        if (a?.jenis === "INSTANSI") continue;
        if (!terpakai.has(r.anggota_kode)) terpakai.set(r.anggota_kode, await kopTerpakai(r.anggota_kode, periode, client));
        const before = terpakai.get(r.anggota_kode)!;
        const now = before + r.qty * r.harga;
        if (now > KOP_LIMIT + 0.005) {
          const nama = a?.nama || karyawan.get(r.anggota_kode)?.nama || r.anggota_kode;
          return refuse(i, `${nama} melebihi limit ${rpText(KOP_LIMIT)} per bulan (sudah ${rpText(before)}, sisa ${rpText(Math.max(KOP_LIMIT - before, 0))})`);
        }
        terpakai.set(r.anggota_kode, now);
      }
      for (const k of missing) {
        const kr = karyawan.get(k)!;
        await execute(
          "INSERT INTO koperasi_anggota (kode, koperasi, jenis, nama, estate, divisi) VALUES (@kode, @kop, 'KARYAWAN', @nama, @estate, @divisi) ON CONFLICT (kode) DO NOTHING",
          { kode: k, kop: KOPERASI, nama: kr.nama, estate: kr.estate ?? "", divisi: kr.lokasi_kerja ?? "" },
          client
        );
      }
      const stamp = Date.now().toString(36).toUpperCase();
      const bonOf = new Map(kodes.map((k, i) => [k, `KOP-${b.tanggal.replace(/-/g, "")}-${stamp}-${i + 1}`]));
      await execute(
        `INSERT INTO koperasi_tx (koperasi, jenis, tanggal_iso, periode, bon, barang_kode, qty, harga, total, anggota_kode, bayar, keterangan, evidence_id, user_id)
         SELECT @kop, 'JUAL', @tanggal, @periode, x.bon, x.kode, x.qty, x.harga, ROUND((x.qty * x.harga)::numeric, 2), x.anggota, x.bayar, 'Input banyak', @evidence::uuid, @uid
           FROM json_to_recordset(@rows::json) AS x(bon text, kode text, qty float8, harga float8, anggota text, bayar text)`,
        {
          kop: KOPERASI,
          tanggal: b.tanggal,
          periode,
          evidence,
          uid: req.user!.id,
          rows: JSON.stringify(
            rows.map((r) => ({
              bon: bonOf.get(r.anggota_kode),
              kode: r.barang_kode,
              qty: r.qty,
              harga: r.harga,
              anggota: r.anggota_kode,
              bayar: anggota.get(r.anggota_kode)?.jenis === "INSTANSI" ? "INSTANSI" : "POTONG_GAJI",
            }))
          ),
        },
        client
      );
      return { bons: kodes.length, total: rows.reduce((s, r) => s + r.qty * r.harga, 0) };
    });
    if ("error" in result) return res.status(400).json(result);
    await logActivity(req, {
      module: "KOPERASI",
      estate: KOPERASI,
      aksi: "Input Banyak Stock Out",
      objek: `${result.bons} anggota · ${b.tanggal}`,
      detail: `${rows.length} baris · ${rpText(result.total)}`,
    });
    res.json({ count: rows.length, bons: result.bons });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal menyimpan stock out" });
  }
});

// Input Banyak Pembelian: many barang bought on one day, each row with its own No PO / nota.
app.post("/api/koperasi/beli/batch", async (req, res) => {
  const b = req.body ?? {};
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  const rows: { barang_kode: string; qty: number; harga: number; no_po: string; exp: string }[] = (Array.isArray(b.rows) ? b.rows : []).map((r: any) => ({
    exp: kopExp(r?.exp_iso),
    barang_kode: String(r?.barang_kode ?? "").trim().toUpperCase(),
    qty: Number(r?.qty),
    harga: Number(r?.harga ?? 0),
    no_po: String(r?.no_po ?? "").trim(),
  }));
  if (!rows.length) return res.status(400).json({ error: "Belum ada baris" });
  if (rows.length > 500) return res.status(400).json({ error: "Maksimal 500 baris sekali simpan" });
  const bad = rows.findIndex((r) => !r.barang_kode || !(r.qty > 0) || !(r.harga >= 0));
  if (bad >= 0) return res.status(400).json({ error: `Baris ${bad + 1}: barang, jumlah (> 0) dan harga wajib diisi`, row: bad });
  const known = new Set(
    (await queryMany<{ kode: string }>("SELECT kode FROM koperasi_barang WHERE kode = ANY(@k::text[]) AND koperasi = @kop", { k: rows.map((r) => r.barang_kode), kop: KOPERASI })).map(
      (x) => x.kode
    )
  );
  const unknown = rows.findIndex((r) => !known.has(r.barang_kode));
  if (unknown >= 0) return res.status(400).json({ error: `Baris ${unknown + 1}: barang ${rows[unknown].barang_kode} tidak ada di master koperasi`, row: unknown });
  const evidence = b.evidence_id ? await claimEvidence(req, res) : null;
  if (evidence === undefined) return;
  try {
    await withTransaction(async (client) => {
      await execute(
        `INSERT INTO koperasi_tx (koperasi, jenis, tanggal_iso, periode, barang_kode, qty, harga, total, no_po, keterangan, evidence_id, user_id, exp_iso)
         SELECT @kop, 'BELI', @tanggal, @periode, x.kode, x.qty, x.harga, ROUND((x.qty * x.harga)::numeric, 2), x.po, 'Input banyak', @evidence::uuid, @uid, NULLIF(x.exp, '')
           FROM json_to_recordset(@rows::json) AS x(kode text, qty float8, harga float8, po text, exp text)`,
        {
          kop: KOPERASI,
          tanggal: b.tanggal,
          periode: kopMonth(b.tanggal),
          evidence,
          uid: req.user!.id,
          rows: JSON.stringify(rows.map((r) => ({ kode: r.barang_kode, qty: r.qty, harga: r.harga, po: r.no_po, exp: r.exp }))),
        },
        client
      );
      // The last row of a barang sets its harga beli (and harga jual, unless switched off).
      for (const r of rows.filter((r) => r.harga > 0))
        await execute(`UPDATE koperasi_barang SET harga_beli = @harga${b.update_harga !== false ? ", harga_jual = @harga" : ""} WHERE kode = @kode AND NOT EXISTS (SELECT 1 FROM koperasi_tx x WHERE x.barang_kode = @kode AND x.jenis = 'BELI' AND x.tanggal_iso > @tanggal)`, { harga: r.harga, kode: r.barang_kode, tanggal: b.tanggal }, client);
    });
    const total = rows.reduce((s, r) => s + r.qty * r.harga, 0);
    await logActivity(req, {
      module: "KOPERASI",
      estate: KOPERASI,
      aksi: "Input Banyak Stock In",
      objek: `${rows.length} baris · ${b.tanggal}`,
      detail: `Rp ${Math.round(total).toLocaleString("id-ID")}`,
    });
    res.json({ count: rows.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal menyimpan stock in" });
  }
});

app.post("/api/koperasi/rusak", async (req, res) => {
  const b = req.body ?? {};
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  const alasan = b.alasan === "EXPIRED" ? "EXPIRED" : b.alasan === "RUSAK" ? "RUSAK" : "";
  if (!alasan) return res.status(400).json({ error: "Pilih alasannya: Expired atau Rusak" });
  const ket = String(b.keterangan ?? "").trim();
  if (!ket) return res.status(400).json({ error: "Tulis keterangannya (mis. tanggal expired di kemasan, pecah, digigit tikus)" });
  // The photo of the barang (with its tanggal expired / damage) is what the pemeriksa checks it against.
  const evidence = await claimEvidence(req, res);
  if (evidence === undefined) return;
  const result = await withTransaction(async (client) => {
    const v = await kopLines([{ barang_kode: b.barang_kode, qty: b.qty, harga: 0 }], client);
    if ("error" in v) return v;
    const l = v.lines[0];
    const stok = (await kopStok([l.barang_kode], client)).get(l.barang_kode) ?? 0;
    if (l.lacak_stok && stok + 1e-9 < l.qty) return { error: `Stok ${l.nama} tinggal ${kopQty(stok)}` };
    await execute(
      `INSERT INTO koperasi_tx (koperasi, jenis, tanggal_iso, periode, barang_kode, qty, harga, total, keterangan, evidence_id, user_id, alasan, status)
       SELECT @k, 'RUSAK', @tanggal, @periode, @kode, @qty, harga_beli, harga_beli * @qty, @ket, @evidence::uuid, @uid, @alasan, 'MENUNGGU' FROM koperasi_barang WHERE kode = @kode`,
      { k: KOPERASI, tanggal: b.tanggal, periode: kopMonth(b.tanggal), kode: l.barang_kode, qty: l.qty, ket, evidence, uid: req.user!.id, alasan },
      client
    );
    return { l };
  });
  if ("error" in result) return res.status(400).json(result);
  await logActivity(req, { module: "KOPERASI", estate: KOPERASI, aksi: alasan === "EXPIRED" ? "Barang Expired" : "Barang Rusak", objek: `${result.l.barang_kode} ${result.l.nama}`, detail: `${kopQty(result.l.qty)} · ${ket} · menunggu pemeriksaan` });
  res.json({ success: true });
});

// Pemeriksaan of a Barang Rusak / Expired by a second account: Setujui (stays out of stock, goes on the
// Berita Acara) or Tolak (catatan required; the stock comes back). Never by the account that entered it.
app.put(["/api/koperasi/rusak/:id/periksa", "/api/koperasi/koreksi/:id/periksa"], async (req, res) => {
  const jenis = req.path.includes("/koreksi/") ? "KOREKSI" : "RUSAK";
  const setuju = req.body?.setuju === true;
  const catatan = String(req.body?.catatan ?? "").trim();
  if (!setuju && !catatan) return res.status(400).json({ error: "Tulis alasan penolakannya" });
  const result = await withTransaction(async (client) => {
    const t = await queryOne(
      "SELECT t.*, b.nama AS barang_nama, b.satuan FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode WHERE t.id = @id AND t.koperasi = @k AND t.jenis = @jenis FOR UPDATE OF t",
      { id: req.params.id, k: KOPERASI, jenis },
      client
    );
    if (!t) return { status: 404, error: jenis === "KOREKSI" ? "Koreksi tidak ditemukan" : "Barang rusak tidak ditemukan" };
    if (t.status !== "MENUNGGU") return { status: 400, error: "Sudah diperiksa" };
    if (t.user_id === req.user!.id) return { status: 403, error: "Yang memeriksa harus orang lain, bukan yang menginput" };
    // A koreksi minus taken now: the stock may have been sold on since it was counted.
    if (setuju && jenis === "KOREKSI" && Number(t.qty) < 0) {
      await queryOne("SELECT kode FROM koperasi_barang WHERE kode = @kode FOR UPDATE", { kode: t.barang_kode }, client);
      const stok = (await kopStok([t.barang_kode], client)).get(t.barang_kode) ?? 0;
      if (stok + Number(t.qty) < -1e-9) return { status: 400, error: `Stok ${t.barang_nama} sekarang tinggal ${kopQty(stok)}, kurang dari ${kopQty(-t.qty)} yang dikoreksi: tolak, lalu hitung dan koreksi ulang` };
    }
    await execute(
      "UPDATE koperasi_tx SET status = @status, diperiksa_oleh = @uid, diperiksa_at = now(), diperiksa_catatan = @catatan WHERE id = @id",
      { status: setuju ? "DISETUJUI" : "DITOLAK", uid: req.user!.id, catatan, id: t.id },
      client
    );
    return { t };
  });
  if ("error" in result) return res.status(result.status ?? 400).json({ error: result.error });
  const t = result.t;
  await logActivity(req, {
    module: "KOPERASI",
    estate: KOPERASI,
    aksi: `${setuju ? "Setujui" : "Tolak"} ${jenis === "KOREKSI" ? "Koreksi Stok" : `Barang ${t.alasan === "EXPIRED" ? "Expired" : "Rusak"}`}`,
    objek: `${t.barang_kode} ${t.barang_nama}`,
    detail: `${t.tanggal_iso} · ${jenis === "KOREKSI" && t.qty > 0 ? "+" : ""}${kopQty(t.qty)}${catatan ? ` · ${catatan}` : ""}`,
  });
  res.json({ success: true });
});

// Hapus one line (any jenis) or, with ?bon=1 on a JUAL line, its whole bon. Removing a pembelian that
// was already sold on (stock would go below 0) is refused.
app.delete("/api/koperasi/tx/:id", async (req, res) => {
  const t = await queryOne("SELECT t.*, b.nama AS barang_nama, b.lacak_stok FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode WHERE t.id = @id AND t.koperasi = @k", {
    id: req.params.id,
    k: KOPERASI,
  });
  if (!t) return res.status(404).json({ error: "Transaksi tidak ditemukan" });
  const kunci = t.jenis === "JUAL" ? kopKunci(req, t.periode) : null;
  if (kunci) return res.status(403).json({ error: kunci });
  const whole = req.query.bon === "1" && t.jenis === "JUAL" && t.bon;
  const result = await withTransaction(async (client) => {
    // A koreksi from a stok opname belongs to that opname: changing it here would leave the opname showing a selisih nobody booked.
    if (t.opname_id) return { error: `Koreksi ini dari Stok Opname #${t.opname_id}; ubah lewat opname itu` };
    const diBa = t.jenis === "RUSAK" ? await baAktifUntuk("KOPERASI", t.id, client) : null;
    if (diBa) return { error: `Barang rusak ini ada di Berita Acara ${diBa}; batalkan BA-nya dulu` };
    // An approved Barang Rusak / Expired is on a Berita Acara: only a Super User takes it back.
    if ((t.jenis === "RUSAK" || t.jenis === "KOREKSI") && t.status === "DISETUJUI" && req.user!.role !== "superuser")
      return { error: `${t.jenis === "RUSAK" ? "Barang rusak" : "Koreksi"} ini sudah disetujui pemeriksa; hanya Super User yang bisa menghapusnya` };
    // Stock that came in (Stock In, or a koreksi that added) can't be taken back once it was sold on.
    if ((t.jenis === "BELI" || (t.jenis === "KOREKSI" && Number(t.qty) > 0)) && t.lacak_stok) {
      await queryOne("SELECT kode FROM koperasi_barang WHERE kode = @kode FOR UPDATE", { kode: t.barang_kode }, client);
      const stok = (await kopStok([t.barang_kode], client)).get(t.barang_kode) ?? 0;
      if (stok + 1e-9 < t.qty) return { error: `${t.jenis === "BELI" ? "Stock In" : "Koreksi"} ini sudah terpakai: stok ${t.barang_nama} tinggal ${kopQty(stok)}, kurang dari ${kopQty(t.qty)}` };
    }
    if (t.jenis === "JUAL" && t.bayar === "POTONG_GAJI") {
      const removed = whole
        ? (await queryOne<{ v: number }>("SELECT COALESCE(SUM(total), 0)::float8 v FROM koperasi_tx WHERE bon = @bon AND jenis = 'JUAL' AND bayar = 'POTONG_GAJI'", { bon: t.bon }, client))!.v
        : Number(t.total);
      const lebih = await kopLebihBayar(t.anggota_kode, t.periode, -removed, client);
      if (lebih) return { error: lebih };
    }
    const r = await execute(whole ? "DELETE FROM koperasi_tx WHERE bon = @bon AND jenis = 'JUAL' RETURNING evidence_id" : "DELETE FROM koperasi_tx WHERE id = @id RETURNING evidence_id", { bon: t.bon, id: t.id }, client);
    return { n: r.rowCount };
  });
  if ("error" in result) return res.status(400).json(result);
  if (t.evidence_id) await releaseEvidence(t.evidence_id).catch(() => {});
  const jenis: Record<string, string> = { JUAL: "Stock Out", BELI: "Stock In", RUSAK: "Barang Rusak", KOREKSI: "Koreksi Stok" };
  await logActivity(req, {
    module: "KOPERASI",
    estate: KOPERASI,
    aksi: `Hapus ${jenis[t.jenis] ?? t.jenis}`,
    objek: whole ? `${t.bon} ${t.anggota_kode}` : `${t.barang_kode} ${t.barang_nama}`,
    detail: whole ? `${result.n} baris` : `${t.tanggal_iso} · ${kopQty(t.qty)} @ ${Number(t.harga).toLocaleString("id-ID")}${t.anggota_kode ? ` · ${t.anggota_kode}` : ""}`,
  });
  res.json({ success: true, n: result.n });
});

// Edit one Stock Out line (a barang typed wrong): barang, jumlah, harga. Checked like a new line: stock
// of the barang (the line's own qty counts back if it stays the same barang) and the anggota's monthly limit.
app.put("/api/koperasi/tx/:id", async (req, res) => {
  const b = req.body ?? {};
  try {
    const result = await withTransaction(async (client) => {
      const t = await queryOne<any>(
        "SELECT t.*, b.nama AS barang_nama, a.nama AS anggota_nama FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode LEFT JOIN koperasi_anggota a ON a.kode = t.anggota_kode WHERE t.id = @id AND t.koperasi = @k FOR UPDATE OF t",
        { id: req.params.id, k: KOPERASI },
        client
      );
      if (!t) return { error: "Transaksi tidak ditemukan", status: 404 };
      if (t.jenis !== "JUAL") return { error: "Hanya baris Stock Out yang bisa diedit" };
      const kunci = kopKunci(req, t.periode);
      if (kunci) return { error: kunci, status: 403 };
      const v = await kopLines([{ barang_kode: String(b.barang_kode ?? "").trim().toUpperCase(), qty: b.qty, harga: 0 }], client);
      if ("error" in v) return v;
      const l = v.lines[0];
      const sameBarang = l.barang_kode === t.barang_kode;
      // The same barang keeps the price it was sold at; another barang takes its master harga jual.
      l.harga = sameBarang ? Number(t.harga) : l.harga_jual;
      if (!sameBarang) {
        const dup = await queryOne("SELECT 1 FROM koperasi_tx WHERE bon = @bon AND jenis = 'JUAL' AND barang_kode = @kode AND id <> @id", { bon: t.bon, kode: l.barang_kode, id: t.id }, client);
        if (t.bon && dup) return { error: `${l.nama} sudah ada di bon ini; ubah jumlah baris itu saja` };
      }
      if (l.lacak_stok) {
        const stok = ((await kopStok([l.barang_kode], client)).get(l.barang_kode) ?? 0) + (sameBarang && t.sumber !== "IMPORT-REKAP2023" ? Number(t.qty) : 0);
        if (stok + 1e-9 < l.qty) return { error: `Stok ${l.nama} tinggal ${kopQty(stok)}, tidak cukup untuk ${kopQty(l.qty)}` };
      }
      const totalBaru = Math.round(l.qty * l.harga * 100) / 100;
      if (t.bayar === "POTONG_GAJI" && t.anggota_kode && totalBaru > Number(t.total)) {
        await queryOne("SELECT kode FROM koperasi_anggota WHERE kode = @kode FOR UPDATE", { kode: t.anggota_kode }, client);
        const terpakai = (await kopTerpakai(t.anggota_kode, t.periode, client)) - Number(t.total);
        if (terpakai + totalBaru > KOP_LIMIT + 0.005) {
          const rpText = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
          return { error: `Melebihi limit ${rpText(KOP_LIMIT)} per bulan: sisa ${rpText(Math.max(KOP_LIMIT - terpakai, 0))} untuk baris ini, perubahan ini ${rpText(totalBaru)}` };
        }
      }
      if (t.bayar === "POTONG_GAJI") {
        const lebih = await kopLebihBayar(t.anggota_kode, t.periode, totalBaru - Number(t.total), client);
        if (lebih) return { error: lebih };
      }
      await execute("UPDATE koperasi_tx SET barang_kode = @kode, qty = @qty, harga = @harga, total = @total WHERE id = @id", { kode: l.barang_kode, qty: l.qty, harga: l.harga, total: totalBaru, id: t.id }, client);
      return { t, l, totalBaru };
    });
    if ("error" in result) return res.status((result as any).status ?? 400).json({ error: result.error });
    const { t, l, totalBaru } = result;
    const rp = (n: number) => Number(n).toLocaleString("id-ID");
    await logActivity(req, {
      module: "KOPERASI",
      estate: KOPERASI,
      aksi: "Edit Stock Out",
      objek: `${t.bon ?? ""} ${t.anggota_kode ?? ""} ${t.anggota_nama ?? ""}`.trim(),
      detail: `${t.tanggal_iso}: ${t.barang_kode} ${t.barang_nama} ${kopQty(Number(t.qty))} @ ${rp(t.harga)} → ${l.barang_kode} ${l.nama} ${kopQty(l.qty)} @ ${rp(l.harga)} (total ${rp(t.total)} → ${rp(totalBaru)})`,
    });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal menyimpan perubahan" });
  }
});

// ---- Depo Air (see schema.sql depo_air_biaya): the koperasi's water depots at Nilam and Firus ----
const DEPO = ["NILAM", "FIRUS"];
const DEPO_BIAYA: Record<string, string> = {
  LISTRIK: "Listrik / BBM genset",
  FILTER: "Filter, media & lampu UV",
  GALON: "Galon, tutup & segel",
  OPERATOR: "Upah operator",
  PERAWATAN: "Perawatan & perbaikan mesin",
  UJI: "Uji kualitas air",
  LAINNYA: "Lain-lain",
};
// depo '' = both; the Stock Out of the depot barang in the periode.
const depoWhere = (depo: string) => `t.koperasi = @k AND t.jenis = 'JUAL' AND b.depo_air AND (@depo = '' OR t.depo = @depo)`;

// Months (YYYY-MM) arithmetic for the depot reports.
const blnGeser = (per: string, n: number) => {
  const [y, m] = per.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const blnAntara = (dari: string, sampai: string) => {
  const out: string[] = [];
  for (let p = dari; p <= sampai && out.length < 60; p = blnGeser(p, 1)) out.push(p);
  return out;
};
// dari..sampai (months) of a depot request; a lone `periode` is one month.
function depoRange(q: Record<string, unknown>) {
  const per = String(q.periode ?? "");
  const dari = String(q.dari ?? per);
  const sampai = String(q.sampai ?? per);
  if (!isPeriode(dari) || !isPeriode(sampai) || dari > sampai) return null;
  if (blnAntara(dari, sampai).length > 36) return null;
  return { dari, sampai };
}

// The report of a range of months (one month = a monthly report): galon, pendapatan per cara bayar,
// pelanggan, per divisi, per bulan (or per hari and per minggu for one month), top pelanggan, biaya,
// laba / rugi, the same figures of the range just before (to compare), and the 12 months up to the
// end for the on-screen trend.
app.get("/api/koperasi/depo", async (req, res) => {
  const r = depoRange(req.query as Record<string, unknown>);
  const depo = DEPO.includes(String(req.query.depo)) ? String(req.query.depo) : "";
  if (!r) return res.status(400).json({ error: "Periode tidak valid (paling panjang 36 bulan)" });
  const { dari, sampai } = r;
  const bulan = blnAntara(dari, sampai);
  const satuBulan = bulan.length === 1;
  const sebelumSampai = blnGeser(dari, -1);
  const sebelumDari = blnGeser(dari, -bulan.length);
  const awal12 = blnGeser(sampai, -11);
  const p = { k: KOPERASI, depo, dari, sampai };
  const from = `FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode LEFT JOIN koperasi_anggota a ON a.kode = t.anggota_kode ${KOP_ANGGOTA_JOIN}`;
  const dalam = `${depoWhere(depo)} AND t.periode BETWEEN @dari AND @sampai`;
  const [ringkas, perBayar, perDivisi, perHari, top, perBulanQ, biaya, biayaBulan, harga, sebelum, biayaSebelum] = await Promise.all([
    queryOne(
      `SELECT COALESCE(SUM(t.qty), 0)::float8 galon, COALESCE(SUM(t.total), 0)::float8 pendapatan, COUNT(DISTINCT t.anggota_kode)::int pelanggan, COUNT(*)::int transaksi
         ${from} WHERE ${dalam}`,
      p
    ),
    queryMany(`SELECT t.bayar, COALESCE(SUM(t.qty), 0)::float8 galon, COALESCE(SUM(t.total), 0)::float8 total ${from} WHERE ${dalam} GROUP BY 1`, p),
    queryMany(
      `SELECT COALESCE(NULLIF(COALESCE(NULLIF(k.lokasi_kerja, ''), a.divisi), ''), CASE WHEN a.jenis = 'INSTANSI' THEN 'Instansi' ELSE 'Tanpa divisi' END) AS divisi,
              COALESCE(SUM(t.qty), 0)::float8 galon, COALESCE(SUM(t.total), 0)::float8 total, COUNT(DISTINCT t.anggota_kode)::int orang
         ${from} WHERE ${dalam} GROUP BY 1 ORDER BY 2 DESC`,
      p
    ),
    satuBulan
      ? queryMany(`SELECT t.tanggal_iso AS tanggal, COALESCE(SUM(t.qty), 0)::float8 galon, COUNT(DISTINCT t.anggota_kode)::int orang ${from} WHERE ${dalam} GROUP BY 1 ORDER BY 1`, p)
      : Promise.resolve([]),
    queryMany(
      `SELECT t.anggota_kode AS kode, COALESCE(NULLIF(k.nama, ''), a.nama) AS nama, COALESCE(NULLIF(k.lokasi_kerja, ''), a.divisi) AS divisi, COALESCE(SUM(t.qty), 0)::float8 galon, COALESCE(SUM(t.total), 0)::float8 total
         ${from} WHERE ${dalam} GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 10`,
      p
    ),
    queryMany(
      `SELECT t.periode, COALESCE(SUM(t.qty), 0)::float8 galon, COALESCE(SUM(t.total), 0)::float8 pendapatan, COUNT(DISTINCT t.anggota_kode)::int pelanggan
         ${from} WHERE ${depoWhere(depo)} AND t.periode BETWEEN @awal AND @sampai GROUP BY 1 ORDER BY 1`,
      { ...p, awal: awal12 < dari ? awal12 : dari }
    ),
    queryMany(
      `SELECT b.id, b.depo, b.tanggal_iso, b.kategori, b.keterangan, b.jumlah, b.evidence_id, COALESCE(u.nama, u.username, '') AS oleh
         FROM depo_air_biaya b LEFT JOIN users u ON u.id = b.user_id WHERE (@depo = '' OR b.depo = @depo) AND b.periode BETWEEN @dari AND @sampai ORDER BY b.tanggal_iso, b.id`,
      p
    ),
    queryMany(`SELECT periode, SUM(jumlah)::float8 biaya FROM depo_air_biaya WHERE (@depo = '' OR depo = @depo) AND periode BETWEEN @awal AND @sampai GROUP BY 1`, {
      ...p,
      awal: awal12 < dari ? awal12 : dari,
    }),
    queryOne<{ h: number }>("SELECT MAX(harga_jual)::float8 h FROM koperasi_barang WHERE depo_air AND aktif"),
    queryOne<{ galon: number; pendapatan: number; pelanggan: number }>(
      `SELECT COALESCE(SUM(t.qty), 0)::float8 galon, COALESCE(SUM(t.total), 0)::float8 pendapatan, COUNT(DISTINCT t.anggota_kode)::int pelanggan
         ${from} WHERE ${depoWhere(depo)} AND t.periode BETWEEN @sdari AND @ssampai`,
      { ...p, sdari: sebelumDari, ssampai: sebelumSampai }
    ),
    queryOne<{ v: number }>("SELECT COALESCE(SUM(jumlah), 0)::float8 v FROM depo_air_biaya WHERE (@depo = '' OR depo = @depo) AND periode BETWEEN @sdari AND @ssampai", {
      depo,
      sdari: sebelumDari,
      ssampai: sebelumSampai,
    }),
  ]);
  const biayaPer = new Map(biayaBulan.map((x: any) => [x.periode, x.biaya]));
  const baris = (per: string) => {
    const x: any = perBulanQ.find((y: any) => y.periode === per);
    return { periode: per, galon: x?.galon ?? 0, pendapatan: x?.pendapatan ?? 0, pelanggan: x?.pelanggan ?? 0, biaya: biayaPer.get(per) ?? 0 };
  };
  // One month: per minggu (1-7, 8-14, 15-21, 22-28, 29-akhir) of the days.
  const perMinggu = satuBulan
    ? [1, 2, 3, 4, 5]
        .map((w) => {
          const hari = (perHari as any[]).filter((h) => Math.min(5, Math.ceil(Number(h.tanggal.slice(8)) / 7)) === w);
          const akhir = new Date(Number(dari.slice(0, 4)), Number(dari.slice(5, 7)), 0).getDate();
          return { minggu: w, dari: (w - 1) * 7 + 1, sampai: w === 5 ? akhir : w * 7, galon: hari.reduce((s, h) => s + h.galon, 0), hari: hari.length };
        })
        .filter((w) => w.dari <= new Date(Number(dari.slice(0, 4)), Number(dari.slice(5, 7)), 0).getDate())
    : [];
  res.json({
    dari,
    sampai,
    periode: sampai,
    depo,
    harga: harga?.h ?? 0,
    ringkas,
    perBayar,
    perDivisi,
    perHari,
    perMinggu,
    top,
    perBulan: bulan.map(baris),
    tren12: blnAntara(awal12, sampai).map(baris),
    biaya,
    sebelum: { dari: sebelumDari, sampai: sebelumSampai, ...sebelum!, biaya: biayaSebelum!.v },
    kategori: DEPO_BIAYA,
  });
});

// The depot's Stock Out rows of the range (for the list / Excel and to move a row to the other depot).
app.get("/api/koperasi/depo/tx", async (req, res) => {
  const r = depoRange(req.query as Record<string, unknown>);
  const depo = DEPO.includes(String(req.query.depo)) ? String(req.query.depo) : "";
  if (!r) return res.status(400).json({ error: "Periode tidak valid" });
  res.json(
    await queryMany(
      `SELECT t.id, t.tanggal_iso, t.depo, t.anggota_kode, COALESCE(NULLIF(k.nama, ''), a.nama) AS nama, COALESCE(NULLIF(k.lokasi_kerja, ''), a.divisi) AS divisi, a.estate,
              t.qty::float8, t.total::float8, t.bayar
         FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode LEFT JOIN koperasi_anggota a ON a.kode = t.anggota_kode ${KOP_ANGGOTA_JOIN}
        WHERE ${depoWhere(depo)} AND t.periode BETWEEN @dari AND @sampai ORDER BY t.tanggal_iso DESC, t.id DESC LIMIT 3000`,
      { k: KOPERASI, depo, ...r }
    )
  );
});

app.put("/api/koperasi/depo/tx/:id", async (req, res) => {
  const depo = String(req.body?.depo ?? "");
  if (!DEPO.includes(depo)) return res.status(400).json({ error: "Depo tidak valid" });
  const t = await queryOne<any>(
    "SELECT t.id, t.depo, t.tanggal_iso, t.qty, t.anggota_kode FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode WHERE t.id = @id AND t.koperasi = @k AND t.jenis = 'JUAL' AND b.depo_air",
    { id: req.params.id, k: KOPERASI }
  );
  if (!t) return res.status(404).json({ error: "Transaksi depo tidak ditemukan" });
  if (t.depo === depo) return res.json({ success: true });
  await execute("UPDATE koperasi_tx SET depo = @depo WHERE id = @id", { depo, id: t.id });
  await logActivity(req, { module: "KOPERASI", estate: KOPERASI, aksi: "Pindah Depo Air", objek: `${t.anggota_kode} ${t.tanggal_iso}`, detail: `${kopQty(t.qty)} galon: Depo ${t.depo ?? "-"} → Depo ${depo}` });
  res.json({ success: true });
});

app.post("/api/koperasi/depo/biaya", async (req, res) => {
  const b = req.body ?? {};
  const depo = String(b.depo ?? "");
  const jumlah = Number(b.jumlah);
  if (!DEPO.includes(depo)) return res.status(400).json({ error: "Pilih depo" });
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  if (!DEPO_BIAYA[b.kategori]) return res.status(400).json({ error: "Pilih jenis biaya" });
  if (!(jumlah > 0)) return res.status(400).json({ error: "Jumlah harus lebih dari 0" });
  const evidence = b.evidence_id ? await claimEvidence(req, res) : null;
  if (evidence === undefined) return;
  const ket = String(b.keterangan ?? "").trim();
  await execute(
    `INSERT INTO depo_air_biaya (depo, periode, tanggal_iso, kategori, keterangan, jumlah, evidence_id, user_id) VALUES (@depo, @periode, @tgl, @kat, @ket, @jumlah, @ev::uuid, @uid)`,
    { depo, periode: b.tanggal.slice(0, 7), tgl: b.tanggal, kat: b.kategori, ket, jumlah, ev: evidence, uid: req.user!.id }
  );
  await logActivity(req, { module: "KOPERASI", estate: KOPERASI, aksi: "Biaya Depo Air", objek: `Depo ${depo}`, detail: `${b.tanggal} · ${DEPO_BIAYA[b.kategori]} · Rp ${Math.round(jumlah).toLocaleString("id-ID")}${ket ? ` · ${ket}` : ""}` });
  res.json({ success: true });
});

app.delete("/api/koperasi/depo/biaya/:id", async (req, res) => {
  const r = await queryOne<any>("DELETE FROM depo_air_biaya WHERE id = @id RETURNING *", { id: req.params.id });
  if (!r) return res.status(404).json({ error: "Biaya tidak ditemukan" });
  await logActivity(req, { module: "KOPERASI", estate: KOPERASI, aksi: "Hapus Biaya Depo Air", objek: `Depo ${r.depo}`, detail: `${r.tanggal_iso} · ${DEPO_BIAYA[r.kategori] ?? r.kategori} · Rp ${Math.round(r.jumlah).toLocaleString("id-ID")}` });
  res.json({ success: true });
});

// ---- Stok opname koperasi (its own, separate from the inventory Stok Opname; see schema.sql koperasi_opname) ----
// Start = every active stocked barang with its stock now; the counts are typed in (saved as a draft);
// Selesai books fisik - stok_sistem of each counted line as a KOREKSI movement. One draft at a time.
const KOP_OPNAME_SUM = `
  COUNT(l.*)::int AS n_barang, COUNT(l.fisik)::int AS dihitung,
  COUNT(*) FILTER (WHERE l.fisik IS NOT NULL AND ABS(l.fisik - l.stok_sistem) > 1e-9)::int AS n_selisih,
  COALESCE(SUM((l.fisik - l.stok_sistem) * b.harga_beli) FILTER (WHERE l.fisik IS NOT NULL), 0)::float8 AS nilai_selisih`;

// Counted blind: while an opname is open, stok sistem and selisih are only for who may finish it (Approve Koperasi).
const kopLihatSistem = (req: express.Request) => req.user!.role === "superuser" || req.user!.perms.includes("koperasi.approve");
app.get("/api/koperasi/opname", async (req, res) => {
  const data = await queryMany(
    `SELECT o.id, o.tanggal_iso, o.status, o.catatan, o.created_at, o.selesai_at, COALESCE(u.nama, u.username, '') AS oleh,
            COALESCE(us.nama, us.username, '') AS selesai_oleh_nama, ${KOP_OPNAME_SUM}
       FROM koperasi_opname o
       LEFT JOIN koperasi_opname_line l ON l.opname_id = o.id LEFT JOIN koperasi_barang b ON b.kode = l.barang_kode
       LEFT JOIN users u ON u.id = o.user_id LEFT JOIN users us ON us.id = o.selesai_oleh
      WHERE o.koperasi = @k GROUP BY o.id, u.nama, u.username, us.nama, us.username ORDER BY o.id DESC LIMIT 100`,
    { k: KOPERASI }
  );
  const lihat = kopLihatSistem(req);
  res.json(data.map((o) => (o.status === "DRAFT" && !lihat ? { ...o, n_selisih: null, nilai_selisih: null } : o)));
});

app.post("/api/koperasi/opname", async (req, res) => {
  const b = req.body ?? {};
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  const result = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('koperasi_opname'))");
    const open = await queryOne<{ id: number }>("SELECT id FROM koperasi_opname WHERE koperasi = @k AND status = 'DRAFT'", { k: KOPERASI }, client);
    if (open) return { error: `Masih ada stok opname #${open.id} yang belum selesai`, id: open.id };
    const o = await queryOne<{ id: number }>(
      "INSERT INTO koperasi_opname (koperasi, tanggal_iso, catatan, user_id) VALUES (@k, @tanggal, @catatan, @uid) RETURNING id",
      { k: KOPERASI, tanggal: b.tanggal, catatan: String(b.catatan ?? "").trim(), uid: req.user!.id },
      client
    );
    const n = await execute(
      `INSERT INTO koperasi_opname_line (opname_id, barang_kode, stok_sistem)
       SELECT @id, b.kode, COALESCE((SELECT ${kopStokSql} FROM koperasi_tx t WHERE t.barang_kode = b.kode), 0)
         FROM koperasi_barang b WHERE b.koperasi = @k AND b.aktif AND b.lacak_stok`,
      { id: o!.id, k: KOPERASI },
      client
    );
    return { id: o!.id, n: n.rowCount };
  });
  if ("error" in result) return res.status(409).json(result);
  await logActivity(req, { module: "KOPERASI", estate: KOPERASI, aksi: "Mulai Stok Opname", objek: `Opname #${result.id}`, detail: `${b.tanggal} · ${result.n} barang` });
  res.json(result);
});

app.get("/api/koperasi/opname/:id", async (req, res) => {
  const o = await queryOne(
    `SELECT o.*, COALESCE(u.nama, u.username, '') AS oleh, COALESCE(us.nama, us.username, '') AS selesai_oleh_nama
       FROM koperasi_opname o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN users us ON us.id = o.selesai_oleh
      WHERE o.id = @id AND o.koperasi = @k`,
    { id: req.params.id, k: KOPERASI }
  );
  if (!o) return res.status(404).json({ error: "Stok opname tidak ditemukan" });
  const lines = await queryMany(
    `SELECT l.barang_kode AS kode, b.nama, b.satuan, b.harga_beli, l.stok_sistem, l.fisik, l.keterangan
       FROM koperasi_opname_line l JOIN koperasi_barang b ON b.kode = l.barang_kode WHERE l.opname_id = @id ORDER BY b.nama`,
    { id: o.id }
  );
  const buta = o.status === "DRAFT" && !kopLihatSistem(req);
  res.json({ ...o, buta, lines: buta ? lines.map((l) => ({ ...l, stok_sistem: null })) : lines });
});

// Counts typed so far (a draft): fisik null = not counted yet.
app.put("/api/koperasi/opname/:id/lines", async (req, res) => {
  const o = await queryOne<{ status: string }>("SELECT status FROM koperasi_opname WHERE id = @id AND koperasi = @k", { id: req.params.id, k: KOPERASI });
  if (!o) return res.status(404).json({ error: "Stok opname tidak ditemukan" });
  if (o.status !== "DRAFT") return res.status(409).json({ error: "Stok opname ini sudah selesai / dibatalkan" });
  const lines = (Array.isArray(req.body?.lines) ? req.body.lines : []).map((l: any) => ({
    kode: String(l?.barang_kode ?? ""),
    fisik: l?.fisik === null || l?.fisik === "" || l?.fisik === undefined ? null : Number(l.fisik),
    ket: String(l?.keterangan ?? "").trim(),
  }));
  if (lines.some((l: { fisik: number | null }) => l.fisik !== null && !(Number.isFinite(l.fisik) && l.fisik >= 0)))
    return res.status(400).json({ error: "Stok fisik harus angka 0 atau lebih" });
  await execute(
    `UPDATE koperasi_opname_line l SET fisik = x.fisik, keterangan = x.ket
       FROM json_to_recordset(@rows::json) AS x(kode text, fisik float8, ket text)
      WHERE l.opname_id = @id AND l.barang_kode = x.kode`,
    { id: req.params.id, rows: JSON.stringify(lines) }
  );
  res.json({ success: true });
});

app.post("/api/koperasi/opname/:id/selesai", async (req, res) => {
  const result = await withTransaction(async (client) => {
    const o = await queryOne<{ id: number; status: string; tanggal_iso: string; user_id: number | null }>(
      "SELECT id, status, tanggal_iso, user_id FROM koperasi_opname WHERE id = @id AND koperasi = @k FOR UPDATE",
      { id: req.params.id, k: KOPERASI },
      client
    );
    if (!o) return { error: "Stok opname tidak ditemukan", status: 404 };
    if (o.status !== "DRAFT") return { error: "Stok opname ini sudah selesai / dibatalkan", status: 409 };
    if (o.user_id === req.user!.id) return { error: "Yang menyelesaikan stok opname harus orang lain, bukan yang memulainya", status: 403 };
    // A koreksi still waiting would be booked a second time on top of this opname's.
    const tunggu = await queryOne<{ nama: string }>(
      "SELECT b.nama FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode WHERE t.koperasi = @k AND t.jenis = 'KOREKSI' AND t.status = 'MENUNGGU' LIMIT 1",
      { k: KOPERASI },
      client
    );
    if (tunggu) return { error: `Masih ada koreksi stok yang menunggu pemeriksaan (${tunggu.nama}); periksa dulu, baru selesaikan opname`, status: 409 };
    const counted = await queryOne<{ n: number }>("SELECT COUNT(fisik)::int AS n FROM koperasi_opname_line WHERE opname_id = @id", { id: o.id }, client);
    if (!counted!.n) return { error: "Belum ada stok fisik yang diisi", status: 400 };
    // Sales / Stock In while the count was open moved the stock: the koreksi is fisik against the stock now
    // (as the inventory Stok Opname refreshes stok_sistem at approval), not against the snapshot at the start.
    await execute(
      `UPDATE koperasi_opname_line l SET stok_sistem = COALESCE((SELECT ${kopStokSql} FROM koperasi_tx t WHERE t.barang_kode = l.barang_kode), 0)::float8
        WHERE l.opname_id = @id`,
      { id: o.id },
      client
    );
    const koreksi = await kopOpnameBook(o.id, o.tanggal_iso, req.user!.id, client);
    await execute("UPDATE koperasi_opname SET status = 'SELESAI', selesai_at = now(), selesai_oleh = @uid WHERE id = @id", { id: o.id, uid: req.user!.id }, client);
    return { id: o.id, koreksi, dihitung: counted!.n };
  });
  if ("error" in result) return res.status(result.status ?? 400).json({ error: result.error });
  await logActivity(req, {
    module: "KOPERASI",
    estate: KOPERASI,
    aksi: "Selesai Stok Opname",
    objek: `Opname #${result.id}`,
    detail: `${result.dihitung} barang dihitung · ${result.koreksi} dikoreksi`,
  });
  res.json(result);
});

app.post("/api/koperasi/opname/:id/batal", async (req, res) => {
  const r = await execute("UPDATE koperasi_opname SET status = 'BATAL' WHERE id = @id AND koperasi = @k AND status = 'DRAFT'", { id: req.params.id, k: KOPERASI });
  if (!r.rowCount) return res.status(409).json({ error: "Hanya stok opname yang belum selesai yang bisa dibatalkan" });
  await logActivity(req, { module: "KOPERASI", estate: KOPERASI, aksi: "Batal Stok Opname", objek: `Opname #${req.params.id}` });
  res.json({ success: true });
});

// Superuser: change an opname after the fact (tanggal, catatan, counts) - a finished one gets its
// KOREKSI movements booked again from the new counts - or delete it with its koreksi (the stock goes
// back to before the opname).
async function kopOpnameBook(id: number, tanggal: string, uid: number, client: PoolClient) {
  await execute("DELETE FROM koperasi_tx WHERE opname_id = @id AND jenis = 'KOREKSI'", { id }, client);
  const r = await execute(
    `INSERT INTO koperasi_tx (koperasi, jenis, tanggal_iso, periode, barang_kode, qty, harga, total, keterangan, opname_id, user_id)
     SELECT @k, 'KOREKSI', @tanggal, @periode, l.barang_kode, l.fisik - l.stok_sistem, b.harga_beli, ROUND(((l.fisik - l.stok_sistem) * b.harga_beli)::numeric, 2),
            TRIM('Stok opname #' || @id::text || CASE WHEN l.keterangan <> '' THEN ': ' || l.keterangan ELSE '' END), @id::int, @uid
       FROM koperasi_opname_line l JOIN koperasi_barang b ON b.kode = l.barang_kode
      WHERE l.opname_id = @id::int AND l.fisik IS NOT NULL AND ABS(l.fisik - l.stok_sistem) > 1e-9`,
    { k: KOPERASI, tanggal, periode: kopMonth(tanggal), id, uid },
    client
  );
  return r.rowCount;
}

app.put("/api/koperasi/opname/:id", (req, res, next) => (req.user!.role === "superuser" ? next() : res.status(403).json({ error: "Hanya Super User yang bisa mengubah / menghapus stok opname yang sudah selesai" })), async (req, res) => {
  const b = req.body ?? {};
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((l: any) => ({
    kode: String(l?.barang_kode ?? ""),
    fisik: l?.fisik === null || l?.fisik === "" || l?.fisik === undefined ? null : Number(l.fisik),
    ket: String(l?.keterangan ?? "").trim(),
  }));
  if (lines.some((l: { fisik: number | null }) => l.fisik !== null && !(Number.isFinite(l.fisik) && l.fisik >= 0)))
    return res.status(400).json({ error: "Stok fisik harus angka 0 atau lebih" });
  const result = await withTransaction(async (client) => {
    const o = await queryOne<{ id: number; status: string; tanggal_iso: string; catatan: string }>(
      "SELECT id, status, tanggal_iso, catatan FROM koperasi_opname WHERE id = @id AND koperasi = @k FOR UPDATE",
      { id: req.params.id, k: KOPERASI },
      client
    );
    if (!o) return { error: "Stok opname tidak ditemukan" };
    const before = await queryOne<{ n: number; nilai: number }>(
      `SELECT COUNT(*) FILTER (WHERE l.fisik IS NOT NULL AND ABS(l.fisik - l.stok_sistem) > 1e-9)::int AS n,
              COALESCE(SUM((l.fisik - l.stok_sistem) * b.harga_beli) FILTER (WHERE l.fisik IS NOT NULL), 0)::float8 AS nilai
         FROM koperasi_opname_line l JOIN koperasi_barang b ON b.kode = l.barang_kode WHERE l.opname_id = @id`,
      { id: o.id },
      client
    );
    await execute("UPDATE koperasi_opname SET tanggal_iso = @tanggal, catatan = @catatan WHERE id = @id", { id: o.id, tanggal: b.tanggal, catatan: String(b.catatan ?? "").trim() }, client);
    if (lines.length)
      await execute(
        `UPDATE koperasi_opname_line l SET fisik = x.fisik, keterangan = x.ket
           FROM json_to_recordset(@rows::json) AS x(kode text, fisik float8, ket text)
          WHERE l.opname_id = @id AND l.barang_kode = x.kode`,
        { id: o.id, rows: JSON.stringify(lines) },
        client
      );
    const koreksi = o.status === "SELESAI" ? await kopOpnameBook(o.id, b.tanggal, req.user!.id, client) : null;
    const after = await queryOne<{ n: number; nilai: number }>(
      `SELECT COUNT(*) FILTER (WHERE l.fisik IS NOT NULL AND ABS(l.fisik - l.stok_sistem) > 1e-9)::int AS n,
              COALESCE(SUM((l.fisik - l.stok_sistem) * b.harga_beli) FILTER (WHERE l.fisik IS NOT NULL), 0)::float8 AS nilai
         FROM koperasi_opname_line l JOIN koperasi_barang b ON b.kode = l.barang_kode WHERE l.opname_id = @id`,
      { id: o.id },
      client
    );
    return { o, before: before!, after: after!, koreksi };
  });
  if ("error" in result) return res.status(404).json(result);
  const { o, before, after } = result;
  const rpText = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const changes = [
    o.tanggal_iso !== b.tanggal && `Tanggal: ${o.tanggal_iso} → ${b.tanggal}`,
    o.catatan !== String(b.catatan ?? "").trim() && `Catatan: ${o.catatan || "-"} → ${String(b.catatan ?? "").trim() || "-"}`,
    (before.n !== after.n || Math.round(before.nilai) !== Math.round(after.nilai)) &&
      `Selisih: ${before.n} barang ${rpText(before.nilai)} → ${after.n} barang ${rpText(after.nilai)}`,
  ].filter(Boolean);
  await logActivity(req, {
    module: "KOPERASI",
    estate: KOPERASI,
    aksi: "Edit Stok Opname",
    objek: `Opname #${o.id}`,
    detail: `${changes.join("; ") || "Tidak ada perubahan"}${result.koreksi !== null ? ` · koreksi stok dibukukan ulang (${result.koreksi} barang)` : ""}`,
  });
  res.json({ success: true, koreksi: result.koreksi });
});

app.delete("/api/koperasi/opname/:id", (req, res, next) => (req.user!.role === "superuser" ? next() : res.status(403).json({ error: "Hanya Super User yang bisa mengubah / menghapus stok opname yang sudah selesai" })), async (req, res) => {
  const result = await withTransaction(async (client) => {
    const o = await queryOne<{ id: number; status: string; tanggal_iso: string }>(
      "SELECT id, status, tanggal_iso FROM koperasi_opname WHERE id = @id AND koperasi = @k FOR UPDATE",
      { id: req.params.id, k: KOPERASI },
      client
    );
    if (!o) return { error: "Stok opname tidak ditemukan" };
    const tx = await execute("DELETE FROM koperasi_tx WHERE opname_id = @id AND jenis = 'KOREKSI'", { id: o.id }, client);
    await execute("DELETE FROM koperasi_opname_line WHERE opname_id = @id", { id: o.id }, client);
    await execute("DELETE FROM koperasi_opname WHERE id = @id", { id: o.id }, client);
    return { o, koreksi: tx.rowCount };
  });
  if ("error" in result) return res.status(404).json(result);
  await logActivity(req, {
    module: "KOPERASI",
    estate: KOPERASI,
    aksi: "Hapus Stok Opname",
    objek: `Opname #${result.o.id}`,
    detail: `${result.o.tanggal_iso} · status ${result.o.status}${result.koreksi ? ` · ${result.koreksi} koreksi stok dibatalkan` : ""}`,
  });
  res.json({ success: true, koreksi: result.koreksi });
});

// Koreksi Stok of one barang, counted blind (the form doesn't show the stock): the difference between the
// counted stok_fisik and the stock now is a KOREKSI that waits (stock unchanged) until a second account with
// Approve Koperasi checks it. alasan = a category, a photo of what was counted is required.
const KOP_KOREKSI_ALASAN: Record<string, string> = {
  SALAH_HITUNG: "Salah hitung sebelumnya",
  HILANG: "Hilang",
  SELISIH_BON: "Selisih bon / salah serah",
  SALAH_INPUT: "Salah input transaksi",
  LAINNYA: "Lainnya",
};
app.post("/api/koperasi/koreksi", async (req, res) => {
  const b = req.body ?? {};
  const fisik = Number(b.stok_fisik);
  const ket = String(b.keterangan ?? "").trim();
  const alasan = String(b.alasan ?? "");
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  if (!(Number.isFinite(fisik) && fisik >= 0)) return res.status(400).json({ error: "Stok fisik harus angka 0 atau lebih" });
  if (!KOP_KOREKSI_ALASAN[alasan]) return res.status(400).json({ error: "Pilih alasan koreksinya" });
  if (!ket) return res.status(400).json({ error: "Tulis keterangan koreksinya" });
  const evidence = await claimEvidence(req, res);
  if (evidence === undefined) return;
  const result = await withTransaction(async (client) => {
    const br = await queryOne<{ kode: string; nama: string; harga_beli: number; lacak_stok: boolean }>(
      "SELECT kode, nama, harga_beli, lacak_stok FROM koperasi_barang WHERE kode = @kode AND koperasi = @k FOR UPDATE",
      { kode: String(b.barang_kode ?? ""), k: KOPERASI },
      client
    );
    if (!br) return { error: "Barang tidak ditemukan" };
    if (!br.lacak_stok) return { error: `${br.nama} tidak dilacak stoknya` };
    const tunggu = await queryOne("SELECT id FROM koperasi_tx WHERE barang_kode = @kode AND jenis = 'KOREKSI' AND status = 'MENUNGGU'", { kode: br.kode }, client);
    if (tunggu) return { error: `Masih ada koreksi ${br.nama} yang menunggu pemeriksaan; tunggu itu diperiksa dulu` };
    const stok = (await kopStok([br.kode], client)).get(br.kode) ?? 0;
    const selisih = Math.round((fisik - stok) * 1000) / 1000;
    if (!selisih) return { br, stok, selisih };
    await execute(
      `INSERT INTO koperasi_tx (koperasi, jenis, tanggal_iso, periode, barang_kode, qty, harga, total, keterangan, evidence_id, user_id, alasan, status)
       VALUES (@k, 'KOREKSI', @tanggal, @periode, @kode, @qty, @harga, ROUND((@qty::float8 * @harga::float8)::numeric, 2), @ket, @evidence::uuid, @uid, @alasan, 'MENUNGGU')`,
      { k: KOPERASI, tanggal: b.tanggal, periode: kopMonth(b.tanggal), kode: br.kode, qty: selisih, harga: br.harga_beli, ket: `Koreksi stok: fisik ${kopQty(fisik)}, sistem ${kopQty(stok)} · ${ket}`, evidence, uid: req.user!.id, alasan },
      client
    );
    return { br, stok, selisih };
  });
  if ("error" in result) return res.status(400).json(result);
  // Counted equal to the stock: nothing booked, the photo goes back.
  if (!result.selisih && evidence) await releaseEvidence(evidence).catch(() => {});
  await logActivity(req, {
    module: "KOPERASI",
    estate: KOPERASI,
    aksi: result.selisih ? "Koreksi Stok (menunggu pemeriksaan)" : "Hitung Stok (cocok)",
    objek: `${result.br.kode} ${result.br.nama}`,
    detail: `sistem ${kopQty(result.stok)} · fisik ${kopQty(fisik)}${result.selisih ? ` (${result.selisih > 0 ? "+" : ""}${kopQty(result.selisih)})` : ""} · ${KOP_KOREKSI_ALASAN[alasan]} · ${ket}`,
  });
  res.json({ success: true, selisih: result.selisih, nilai: Math.round(result.selisih * result.br.harga_beli) });
});

// ---- Pelunasan (see schema.sql koperasi_bayar) ----
// Bill of an anggota in a periode = its potong gaji there; dibayar = its payments; due on the 15th of
// the next month (KOP_JATUH_TEMPO). Open after that = tunggakan, which blocks new Stock Out.
const KOP_JATUH_TEMPO = 15;
const kopJatuhTempo = (periode: string) => {
  const [y, m] = periode.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, KOP_JATUH_TEMPO));
  return d.toISOString().slice(0, 10);
};
const KOP_TAGIHAN_SQL = `
  WITH t AS (SELECT anggota_kode AS kode, periode, SUM(total) AS tagihan FROM koperasi_tx
              WHERE koperasi = @k AND jenis = 'JUAL' AND bayar = 'POTONG_GAJI' GROUP BY 1, 2),
       b AS (SELECT anggota_kode AS kode, periode, SUM(jumlah) AS dibayar FROM koperasi_bayar WHERE koperasi = @k GROUP BY 1, 2)
  SELECT t.kode, t.periode, t.tagihan::float8 AS tagihan, COALESCE(b.dibayar, 0)::float8 AS dibayar,
         (t.tagihan - COALESCE(b.dibayar, 0))::float8 AS sisa,
         (to_date(t.periode || '-01', 'YYYY-MM-DD') + interval '1 month' + interval '${KOP_JATUH_TEMPO - 1} days')::date::text AS jatuh_tempo
    FROM t LEFT JOIN b ON b.kode = t.kode AND b.periode = t.periode`;

// Open bills past their due date, per anggota (optionally only these kode).
async function kopTunggakan(kodes: string[] | null, client?: PoolClient) {
  return queryMany<{ kode: string; nama: string; jabatan: string; divisi: string; sisa: number; periode: string[] }>(
    `SELECT x.kode, COALESCE(NULLIF(k.nama, ''), NULLIF(a.nama, ''), x.kode) AS nama, a.jabatan, COALESCE(NULLIF(k.lokasi_kerja, ''), a.divisi) AS divisi,
            SUM(x.sisa)::float8 AS sisa, array_agg(x.periode ORDER BY x.periode) AS periode
       FROM (${KOP_TAGIHAN_SQL}) x JOIN koperasi_anggota a ON a.kode = x.kode ${KOP_ANGGOTA_JOIN}
      WHERE x.sisa > 0.5 AND x.jatuh_tempo < @today AND (@all OR x.kode = ANY(@kodes::text[]))
      GROUP BY x.kode, a.nama, a.jabatan, a.divisi, k.nama, k.lokasi_kerja ORDER BY sisa DESC`,
    { k: KOPERASI, today: jakartaToday(), all: kodes === null, kodes: kodes ?? [] },
    client
  );
}
const kopTunggakanText = (t: { nama: string; sisa: number; periode: string[] }) => {
  const bln = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const p = t.periode.map((x) => `${bln[Number(x.slice(5, 7)) - 1]} ${x.slice(0, 4)}`).join(", ");
  return `${t.nama} masih punya tagihan koperasi belum lunas Rp ${Math.round(t.sisa).toLocaleString("id-ID")} (${p}). Lunasi dulu sebelum ngebon lagi.`;
};

app.get("/api/koperasi/tunggakan", async (_req, res) => {
  res.json(await kopTunggakan(null));
});

// Payments of one anggota in one periode, with the bill.
app.get("/api/koperasi/bayar", async (req, res) => {
  const kode = String(req.query.anggota ?? "").toUpperCase();
  const periode = String(req.query.periode ?? "");
  if (!kode || !isPeriode(periode)) return res.status(400).json({ error: "Anggota / periode tidak valid" });
  const tagihan = await queryOne(`SELECT * FROM (${KOP_TAGIHAN_SQL}) x WHERE x.kode = @kode AND x.periode = @periode`, { k: KOPERASI, kode, periode });
  const data = await queryMany(
    `SELECT p.id, p.jumlah, p.tanggal_iso, p.cara, p.keterangan, p.sumber, p.created_at, COALESCE(u.nama, u.username, '') AS oleh
       FROM koperasi_bayar p LEFT JOIN users u ON u.id = p.user_id WHERE p.anggota_kode = @kode AND p.periode = @periode ORDER BY p.id`,
    { kode, periode }
  );
  res.json({ tagihan: tagihan ?? { kode, periode, tagihan: 0, dibayar: 0, sisa: 0, jatuh_tempo: kopJatuhTempo(periode) }, data });
});

const KOP_CARA = ["POTONG_GAJI", "TUNAI", "LAINNYA"];
const KOP_CARA_LABEL: Record<string, string> = { POTONG_GAJI: "potong gaji", TUNAI: "tunai", LAINNYA: "lainnya" };
app.post("/api/koperasi/bayar", async (req, res) => {
  const b = req.body ?? {};
  const kode = String(b.anggota_kode ?? "").toUpperCase();
  const jumlah = Number(b.jumlah);
  const cara = KOP_CARA.includes(b.cara) ? b.cara : "POTONG_GAJI";
  if (!kode || !isPeriode(b.periode)) return res.status(400).json({ error: "Anggota / periode tidak valid" });
  if (!isIsoDate(b.tanggal) || b.tanggal > jakartaToday()) return res.status(400).json({ error: "Tanggal tidak valid (tidak boleh setelah hari ini)" });
  if (!(jumlah > 0)) return res.status(400).json({ error: "Jumlah bayar harus lebih dari 0" });
  const result = await withTransaction(async (client) => {
    await queryOne("SELECT kode FROM koperasi_anggota WHERE kode = @kode FOR UPDATE", { kode }, client);
    const t = await queryOne<{ tagihan: number; sisa: number }>(`SELECT * FROM (${KOP_TAGIHAN_SQL}) x WHERE x.kode = @kode AND x.periode = @periode`, { k: KOPERASI, kode, periode: b.periode }, client);
    if (!t || t.sisa <= 0.5) return { error: "Tidak ada tagihan yang belum lunas di periode ini" };
    if (jumlah > t.sisa + 0.5) return { error: `Jumlah lebih besar dari sisa tagihan (Rp ${Math.round(t.sisa).toLocaleString("id-ID")})` };
    await execute(
      `INSERT INTO koperasi_bayar (koperasi, anggota_kode, periode, jumlah, tanggal_iso, cara, keterangan, user_id)
       VALUES (@k, @kode, @periode, @jumlah, @tanggal, @cara, @ket, @uid)`,
      { k: KOPERASI, kode, periode: b.periode, jumlah, tanggal: b.tanggal, cara, ket: String(b.keterangan ?? "").trim(), uid: req.user!.id },
      client
    );
    return { sisa: Math.max(t.sisa - jumlah, 0) };
  });
  if ("error" in result) return res.status(400).json(result);
  const nama = (await queryOne<{ nama: string }>(`SELECT COALESCE(NULLIF(k.nama, ''), a.nama) AS nama FROM koperasi_anggota a ${KOP_ANGGOTA_JOIN} WHERE a.kode = @kode`, { kode }))?.nama ?? kode;
  await logActivity(req, {
    module: "KOPERASI",
    estate: KOPERASI,
    aksi: "Pelunasan",
    objek: `${kode} ${nama}`,
    detail: `Periode ${b.periode} · Rp ${Math.round(jumlah).toLocaleString("id-ID")} (${KOP_CARA_LABEL[cara]})${result.sisa > 0.5 ? ` · sisa Rp ${Math.round(result.sisa).toLocaleString("id-ID")}` : " · lunas"}`,
  });
  res.json({ success: true, sisa: result.sisa });
});

// Tandai lunas: the whole rest of these anggota's bill of the periode, deducted from the salary.
app.post("/api/koperasi/bayar/lunas", async (req, res) => {
  const b = req.body ?? {};
  const kodes: string[] = (Array.isArray(b.kode) ? b.kode : []).map((x: unknown) => String(x).toUpperCase());
  if (!isPeriode(b.periode) || !kodes.length) return res.status(400).json({ error: "Pilih anggota dan periode" });
  const tanggal = isIsoDate(b.tanggal) && b.tanggal <= jakartaToday() ? b.tanggal : jakartaToday();
  // The sisa HR saw per kode (optional): if a bon or payment changed it since, refuse rather than book another amount.
  const seen: Record<string, number> = b.sisa && typeof b.sisa === "object" ? b.sisa : {};
  const result = await withTransaction(async (client) => {
    // Locked like POST /bayar, so a double click or two HR users can't both book the same sisa.
    await execute("SELECT kode FROM koperasi_anggota WHERE kode = ANY(@kodes::text[]) ORDER BY kode FOR UPDATE", { kodes }, client);
    const now = await queryMany<{ kode: string; sisa: number }>(
      `SELECT x.kode, x.sisa::float8 sisa FROM (${KOP_TAGIHAN_SQL}) x WHERE x.periode = @periode AND x.kode = ANY(@kodes::text[])`,
      { k: KOPERASI, periode: b.periode, kodes },
      client
    );
    const changed = now.find((x) => x.kode in seen && Math.abs(Number(seen[x.kode]) - x.sisa) > 0.5);
    if (changed) return { error: `Tagihan ${changed.kode} berubah sejak halaman dibuka (sekarang Rp ${Math.round(changed.sisa).toLocaleString("id-ID")}). Muat ulang Rekap lalu ulangi.` };
    return {
      r: await execute(
        `INSERT INTO koperasi_bayar (koperasi, anggota_kode, periode, jumlah, tanggal_iso, cara, keterangan, user_id)
         SELECT @k, x.kode, x.periode, x.sisa, @tanggal, 'POTONG_GAJI', 'Lunas potong gaji', @uid
           FROM (${KOP_TAGIHAN_SQL}) x WHERE x.periode = @periode AND x.kode = ANY(@kodes::text[]) AND x.sisa > 0.5
         RETURNING jumlah`,
        { k: KOPERASI, periode: b.periode, kodes, tanggal, uid: req.user!.id },
        client
      ),
    };
  });
  if ("error" in result) return res.status(409).json({ error: result.error });
  const r = result.r;
  const total = r.rows.reduce((s: number, x: { jumlah: number }) => s + Number(x.jumlah), 0);
  if (r.rowCount)
    await logActivity(req, {
      module: "KOPERASI",
      estate: KOPERASI,
      aksi: "Tandai Lunas",
      objek: `Periode ${b.periode}`,
      detail: `${r.rowCount} orang · Rp ${Math.round(total).toLocaleString("id-ID")} (potong gaji)`,
    });
  res.json({ count: r.rowCount, total });
});

app.delete("/api/koperasi/bayar/:id", async (req, res) => {
  const p = await queryOne<{ anggota_kode: string; periode: string; jumlah: number; cara: string }>(
    "DELETE FROM koperasi_bayar WHERE id = @id AND koperasi = @k RETURNING anggota_kode, periode, jumlah, cara",
    { id: req.params.id, k: KOPERASI }
  );
  if (!p) return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
  await logActivity(req, {
    module: "KOPERASI",
    estate: KOPERASI,
    aksi: "Hapus Pelunasan",
    objek: p.anggota_kode,
    detail: `Periode ${p.periode} · Rp ${Math.round(p.jumlah).toLocaleString("id-ID")} (${KOP_CARA_LABEL[p.cara] ?? p.cara})`,
  });
  res.json({ success: true });
});

// Rekap Potong Gaji: per anggota, what they took in the periode, split by how it is paid.
app.get("/api/koperasi/rekap", async (req, res) => {
  const periode = isPeriode(req.query.periode) ? req.query.periode : kopMonth(jakartaToday());
  const data = await queryMany(
    `SELECT ${KOP_ANGGOTA_COLS}, COUNT(DISTINCT t.bon)::int AS n_bon, MIN(t.tanggal_iso) AS dari, MAX(t.tanggal_iso) AS sampai,
            COALESCE(SUM(t.total) FILTER (WHERE t.bayar = 'POTONG_GAJI'), 0)::float8 AS potong_gaji,
            COALESCE(SUM(t.total) FILTER (WHERE t.bayar = 'TUNAI'), 0)::float8 AS tunai,
            COALESCE(SUM(t.total) FILTER (WHERE t.bayar = 'INSTANSI'), 0)::float8 AS instansi,
            COALESCE(SUM(t.total), 0)::float8 AS total,
            COALESCE((SELECT SUM(p.jumlah) FROM koperasi_bayar p WHERE p.anggota_kode = a.kode AND p.periode = @periode), 0)::float8 AS dibayar
       FROM koperasi_tx t JOIN koperasi_anggota a ON a.kode = t.anggota_kode ${KOP_ANGGOTA_JOIN}
      WHERE t.koperasi = @k AND t.jenis = 'JUAL' AND t.periode = @periode
      GROUP BY a.kode, a.jenis, a.nama, a.jabatan, a.estate, a.divisi, a.aktif, a.catatan, k.nik, k.nama, k.estate, k.lokasi_kerja
      ORDER BY a.jenis DESC, COALESCE(NULLIF(k.nama, ''), NULLIF(a.nama, ''), a.kode)`,
    { k: KOPERASI, periode }
  );
  res.json({ periode, limit: KOP_LIMIT, jatuh_tempo: kopJatuhTempo(periode), today: jakartaToday(), data });
});

// Slip potong gaji: every Stock Out line of these anggota in the periode, for one printed slip each.
app.get("/api/koperasi/slip", async (req, res) => {
  const periode = isPeriode(req.query.periode) ? req.query.periode : kopMonth(jakartaToday());
  const kodes = String(req.query.kode ?? "").split(",").map((k) => k.trim().toUpperCase()).filter(Boolean).slice(0, 1000);
  if (!kodes.length) return res.json({ periode, limit: KOP_LIMIT, jatuh_tempo: kopJatuhTempo(periode), data: [] });
  const data = await queryMany(
    `SELECT t.anggota_kode, t.tanggal_iso, t.bon, t.barang_kode, b.nama AS barang_nama, b.satuan, t.qty::float8 qty, t.harga::float8 harga, t.total::float8 total, t.bayar
       FROM koperasi_tx t JOIN koperasi_barang b ON b.kode = t.barang_kode
      WHERE t.koperasi = @k AND t.jenis = 'JUAL' AND t.bayar = 'POTONG_GAJI' AND t.periode = @periode AND t.anggota_kode = ANY(@kodes::text[])
      ORDER BY t.anggota_kode, t.tanggal_iso, t.id`,
    { k: KOPERASI, periode, kodes }
  );
  res.json({ periode, limit: KOP_LIMIT, jatuh_tempo: kopJatuhTempo(periode), data });
});

// ---- Dokumen & Link (see schema.sql dokumen_link) ----
const DOK_KATEGORI = ["LAPORAN", "SOP", "FORM", "REKAP", "KONTRAK", "LAINNYA"];
const DOK_MODUL = ["", "GUDANG", "BBM", "PUPUK", "OLI", "KLINIK", "KOPERASI"];
const DOK_LOG: Record<string, LogModule> = { GUDANG: "BARANG", BBM: "BBM", PUPUK: "PUPUK", OLI: "OLI", KLINIK: "KLINIK", KOPERASI: "KOPERASI" };
const dokPayload = (b: any) => ({
  judul: String(b?.judul ?? "").trim(),
  url: String(b?.url ?? "").trim(),
  kategori: DOK_KATEGORI.includes(String(b?.kategori ?? "").toUpperCase()) ? String(b.kategori).toUpperCase() : "LAINNYA",
  modul: DOK_MODUL.includes(String(b?.modul ?? "").toUpperCase()) ? String(b?.modul ?? "").toUpperCase() : "",
  estate: (ESTATES as readonly string[]).includes(String(b?.estate ?? "").toUpperCase()) ? String(b.estate).toUpperCase() : "",
  keterangan: String(b?.keterangan ?? "").trim(),
  pic: String(b?.pic ?? "").trim(),
  pinned: b?.pinned === true,
});
// Only web links: a javascript: / data: url would run in the page when clicked.
const dokUrlOk = (u: string) => /^https?:\/\/\S+$/i.test(u);
// Who may change / delete a link: Kelola semua (and Super User) any; Dokumen & Link only the ones it added
// itself, while they are not locked.
const dokKelola = (u: SessionUser) => u.role === "superuser" || u.perms.includes("dokumen.kelola");
const dokBolehUbah = (u: SessionUser, d: { user_id: number | null; dikunci: boolean }) =>
  dokKelola(u) || (u.perms.includes("dokumen.edit") && d.user_id === u.id && !d.dikunci);
const dokTolak = (u: SessionUser, d: { user_id: number | null; dikunci: boolean }) =>
  d.dikunci
    ? "Dokumen ini dikunci; hanya pengelola dokumen yang bisa mengubah / menghapusnya"
    : d.user_id !== u.id
      ? "Hanya pembuat dokumen ini atau pengelola dokumen yang bisa mengubah / menghapusnya"
      : "Akses ditolak";
async function dokLog(req: express.Request, d: { modul: string; estate: string; judul: string }, aksi: string, detail?: string) {
  const module = DOK_LOG[d.modul];
  if (module) await logActivity(req, { module, estate: d.estate || null, aksi, objek: d.judul, detail });
}

app.get("/api/dokumen", async (req, res) => {
  const q = req.query as Record<string, string>;
  const u = req.user!;
  const conditions: string[] = [];
  const params: any = { estates: u.role === "superuser" ? [...ESTATES] : u.estates };
  // Links of every estate ("") and of the account's own estates.
  conditions.push("(d.estate = '' OR d.estate = ANY(@estates::text[]))");
  if (q.modul) {
    conditions.push("d.modul = @modul");
    params.modul = String(q.modul).toUpperCase();
  }
  if (q.estate) {
    // A page of one estate: that estate's links plus the ones for every estate.
    conditions.push("(d.estate = '' OR d.estate = @estate)");
    params.estate = String(q.estate).toUpperCase();
  }
  if (q.kategori) {
    conditions.push("d.kategori = @kategori");
    params.kategori = String(q.kategori).toUpperCase();
  }
  wordSearch(q.search ?? "", ["d.judul", "d.keterangan", "d.url", "d.pic"], conditions, params);
  const data = await queryMany(
    `SELECT d.*, u.nama AS oleh FROM dokumen_link d LEFT JOIN users u ON u.id = d.user_id
      WHERE ${conditions.join(" AND ")} ORDER BY d.pinned DESC, d.id`,
    params
  );
  res.json({ data: data.map((d: any) => ({ ...d, boleh_ubah: dokBolehUbah(u, d) })), kelola: dokKelola(u) });
});

app.post("/api/dokumen", async (req, res) => {
  if (!dokKelola(req.user!) && !req.user!.perms.includes("dokumen.edit")) return res.status(403).json({ error: "Akses ditolak" });
  const d = dokPayload(req.body);
  if (!d.judul) return res.status(400).json({ error: "Judul wajib diisi" });
  if (!dokUrlOk(d.url)) return res.status(400).json({ error: "Link harus diawali https:// (salin dari address bar / tombol Share)" });
  if (d.estate && !estateAllowed(req.user!, d.estate)) return res.status(403).json({ error: "Estate ini tidak termasuk akses akun Anda" });
  const row = await queryOne<{ id: number }>(
    `INSERT INTO dokumen_link (judul, url, kategori, modul, estate, keterangan, pic, pinned, user_id)
     VALUES (@judul, @url, @kategori, @modul, @estate, @keterangan, @pic, @pinned, @uid) RETURNING id`,
    { ...d, uid: req.user!.id }
  );
  await dokLog(req, d, "Tambah Dokumen", d.url);
  res.json({ success: true, id: row!.id });
});

app.put("/api/dokumen/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM dokumen_link WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Dokumen tidak ditemukan" });
  if (existing.estate && !estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  // Kunci / buka kunci: Kelola semua only.
  if (req.body?.kunciOnly !== undefined) {
    if (!dokKelola(req.user!)) return res.status(403).json({ error: "Hanya pengelola dokumen yang bisa mengunci dokumen" });
    const kunci = req.body.kunciOnly === true;
    await execute("UPDATE dokumen_link SET dikunci = @kunci, updated_at = now() WHERE id = @id", { kunci, id: existing.id });
    await dokLog(req, existing, kunci ? "Kunci Dokumen" : "Buka Kunci Dokumen", existing.url);
    return res.json({ success: true });
  }
  if (!dokBolehUbah(req.user!, existing)) return res.status(403).json({ error: dokTolak(req.user!, existing) });
  // Pin only (the star on a card) keeps the rest as it is.
  const d = req.body?.pinOnly ? { ...existing, pinned: req.body.pinned === true } : dokPayload(req.body);
  if (!d.judul) return res.status(400).json({ error: "Judul wajib diisi" });
  if (!dokUrlOk(d.url)) return res.status(400).json({ error: "Link harus diawali https://" });
  if (d.estate && !estateAllowed(req.user!, d.estate)) return res.status(403).json({ error: "Estate ini tidak termasuk akses akun Anda" });
  await execute(
    `UPDATE dokumen_link SET judul = @judul, url = @url, kategori = @kategori, modul = @modul, estate = @estate, keterangan = @keterangan,
       pic = @pic, pinned = @pinned, updated_at = now() WHERE id = @id`,
    { judul: d.judul, url: d.url, kategori: d.kategori, modul: d.modul, estate: d.estate, keterangan: d.keterangan, pic: d.pic ?? "", pinned: d.pinned, id: existing.id }
  );
  if (!req.body?.pinOnly)
    await dokLog(req, d, "Edit Dokumen", describeChanges(existing, d, { judul: "Nama dokumen", url: "Link", pic: "PIC", kategori: "Kategori", modul: "Modul", estate: "Estate", keterangan: "Keterangan" }));
  res.json({ success: true });
});

app.delete("/api/dokumen/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM dokumen_link WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Dokumen tidak ditemukan" });
  if (existing.estate && !estateAllowed(req.user!, existing.estate)) return res.status(403).json({ error: "Akses ditolak" });
  if (!dokBolehUbah(req.user!, existing)) return res.status(403).json({ error: dokTolak(req.user!, existing) });
  await execute("DELETE FROM dokumen_link WHERE id = @id", { id: existing.id });
  await dokLog(req, existing, "Hapus Dokumen", existing.url);
  res.json({ success: true });
});

// ---- Daftar SOP (see schema.sql sop) ----
const SOP_BAGIAN: Record<string, string> = {
  "01": "1. Persiapan Lahan & Pembukaan", "02": "2. Pembibitan", "03": "3. Penanaman & TBM", "04": "4. Pemeliharaan TM", "05": "5. Proteksi Tanaman",
  "06": "6. Panen & Transport", "07": "7. Agronomi & Riset", "08": "8. Pabrik Kelapa Sawit", "09": "9. Teknik, Gudang & Logistik", "10": "10. K3",
  "11": "11. Lingkungan & Keberlanjutan", "12": "12. SDM & Hubungan Industrial", "13": "13. Sosial & Kemitraan", "14": "14. Administrasi, Keuangan & Keamanan", UMUM: "15. Umum",
};
const SOP_STATUS: Record<string, string> = { BELUM: "Belum ada", DRAFT: "Draft", BERLAKU: "Berlaku", REVISI: "Perlu revisi" };
const sopPayload = (b: any) => ({
  bagian: SOP_BAGIAN[String(b?.bagian ?? "").toUpperCase()] ? String(b.bagian).toUpperCase() : "UMUM",
  judul: String(b?.judul ?? "").trim(),
  audit: b?.audit === true,
  no_dokumen: String(b?.no_dokumen ?? "").trim(),
  revisi: String(b?.revisi ?? "").trim(),
  tgl_berlaku: /^\d{4}-\d{2}-\d{2}$/.test(String(b?.tgl_berlaku ?? "")) ? String(b.tgl_berlaku) : "",
  pic: String(b?.pic ?? "").trim(),
  status: SOP_STATUS[String(b?.status ?? "").toUpperCase()] ? String(b.status).toUpperCase() : "BELUM",
  url: String(b?.url ?? "").trim(),
  keterangan: String(b?.keterangan ?? "").trim(),
});
const sopCek = (d: ReturnType<typeof sopPayload>) =>
  !d.judul ? "Nama SOP wajib diisi" : d.url && !dokUrlOk(d.url) ? "Link harus diawali https:// (salin dari address bar / tombol Share)" : "";
// Kunci: locks / unlocks and changes the locked SOPs; Ubah: adds and changes / deletes the unlocked ones.
const sopKunci = (u: SessionUser) => u.role === "superuser" || u.perms.includes("sop.kunci");
const sopUbah = (u: SessionUser, s?: { dikunci: boolean }) => sopKunci(u) || (u.perms.includes("sop.edit") && !s?.dikunci);
const SOP_TERKUNCI = "SOP ini dikunci; hanya akun dengan hak Kunci Daftar SOP yang bisa mengubah / menghapus atau membuka kuncinya";
// The log shows the values as on screen: Ya / Tidak, the status and bagian names.
const sopLogView = (s: any) => ({ ...s, bagian: SOP_BAGIAN[s.bagian] ?? s.bagian, status: SOP_STATUS[s.status] ?? s.status, audit: s.audit ? "Ya" : "Tidak" });
const SOP_LABELS = {
  bagian: "Bagian", judul: "Nama SOP", audit: "Audit ISPO/RSPO", no_dokumen: "No. Dokumen", revisi: "Revisi", tgl_berlaku: "Tgl Berlaku",
  pic: "PIC", status: "Status", url: "Link", keterangan: "Keterangan",
};
const sopLog = (req: express.Request, aksi: string, objek: string, detail?: string) => logActivity(req, { module: "SOP", estate: null, aksi, objek, detail });
const sopObjek = (s: { bagian: string; judul: string }) => `${s.judul} (${SOP_BAGIAN[s.bagian] ?? s.bagian})`;
const sopRingkas = (s: any) =>
  [`Status: ${SOP_STATUS[s.status] ?? s.status}`, s.no_dokumen && `No. Dokumen: ${s.no_dokumen}`, s.pic && `PIC: ${s.pic}`, s.audit && "Audit ISPO/RSPO", s.url && `Link: ${s.url}`]
    .filter(Boolean)
    .join("; ");

app.get("/api/sop", async (req, res) => {
  const u = req.user!;
  const data = await queryMany(
    `SELECT s.*, (s.isi <> '{}'::jsonb) AS ada_isi, u.nama AS oleh FROM sop s LEFT JOIN users u ON u.id = s.user_id
      ORDER BY s.bagian = 'UMUM', s.bagian, s.urut, s.id`
  );
  // The list leaves the written SOP out (it is read on the SOP's own page).
  res.json({ data: data.map(({ isi, ...s }: any) => ({ ...s, boleh_ubah: sopUbah(u, s) })), edit: sopUbah(u), kunci: sopKunci(u) });
});

// One SOP with what is written in it, and its place (1.2) in the list.
app.get("/api/sop/:id", async (req, res) => {
  const u = req.user!;
  const s = await queryOne<any>(
    `SELECT s.*, u.nama AS oleh,
       (SELECT COUNT(*) FROM sop x WHERE x.bagian = s.bagian AND (x.urut < s.urut OR (x.urut = s.urut AND x.id <= s.id)))::int AS nomor
     FROM sop s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = @id`,
    { id: Number(req.params.id) || 0 }
  );
  if (!s) return res.status(404).json({ error: "SOP tidak ditemukan" });
  res.json({ data: { ...s, boleh_ubah: sopUbah(u, s) }, edit: sopUbah(u), kunci: sopKunci(u) });
});

// The SOP written in the app: only the known sections, as plain text.
const SOP_ISI: Record<string, string> = {
  tujuan: "Tujuan", ruang_lingkup: "Ruang Lingkup", referensi: "Referensi", definisi: "Definisi", tanggung_jawab: "Tanggung Jawab",
  prosedur: "Prosedur", rekaman: "Rekaman / Dokumen Terkait", lampiran: "Lampiran",
  disusun_nama: "Disusun oleh", disusun_jabatan: "Jabatan penyusun", diperiksa_nama: "Diperiksa oleh", diperiksa_jabatan: "Jabatan pemeriksa",
  disetujui_nama: "Disetujui oleh", disetujui_jabatan: "Jabatan penyetuju",
};
app.put("/api/sop/:id/isi", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM sop WHERE id = @id", { id: Number(req.params.id) || 0 });
  if (!existing) return res.status(404).json({ error: "SOP tidak ditemukan" });
  if (!sopUbah(req.user!, existing)) return res.status(403).json({ error: existing.dikunci ? SOP_TERKUNCI : "Akses ditolak" });
  const b = req.body?.isi ?? {};
  const isi: Record<string, string> = {};
  for (const k of Object.keys(SOP_ISI)) {
    const v = String(b[k] ?? "").replace(/\r\n/g, "\n").trim();
    if (v) isi[k] = v.slice(0, 50000);
  }
  await execute("UPDATE sop SET isi = @isi::jsonb, updated_at = now() WHERE id = @id", { isi: JSON.stringify(isi), id: existing.id });
  const lama = existing.isi ?? {};
  const berubah = Object.entries(SOP_ISI)
    .filter(([k]) => (lama[k] ?? "") !== (isi[k] ?? ""))
    .map(([k, label]) => (k.endsWith("_nama") || k.endsWith("_jabatan") ? `${label}: ${lama[k] || "-"} → ${isi[k] || "-"}` : `${label} ${lama[k] ? (isi[k] ? "diubah" : "dihapus") : "diisi"}`));
  if (berubah.length) await sopLog(req, "Edit Isi SOP", sopObjek(existing), berubah.join("; "));
  res.json({ success: true });
});

app.post("/api/sop", async (req, res) => {
  if (!sopUbah(req.user!)) return res.status(403).json({ error: "Akses ditolak" });
  const d = sopPayload(req.body);
  const err = sopCek(d);
  if (err) return res.status(400).json({ error: err });
  // A new SOP goes to the bottom of its bagian.
  const row = await queryOne<{ id: number; urut: number }>(
    `INSERT INTO sop (bagian, urut, judul, audit, no_dokumen, revisi, tgl_berlaku, pic, status, url, keterangan, user_id)
     VALUES (@bagian, (SELECT COALESCE(MAX(urut), 0) + 1 FROM sop WHERE bagian = @bagian), @judul, @audit, @no_dokumen, @revisi,
             @tgl_berlaku, @pic, @status, @url, @keterangan, @uid) RETURNING id, urut`,
    { ...d, uid: req.user!.id }
  );
  await sopLog(req, "Tambah SOP", sopObjek(d), sopRingkas(d));
  res.json({ success: true, id: row!.id, urut: row!.urut });
});

// Kunci / buka kunci one SOP ({ id }) or every SOP of a bagian ({ bagian }).
app.put("/api/sop/kunci", async (req, res) => {
  const kunci = req.body?.kunci === true;
  const id = Number(req.body?.id);
  const bagian = String(req.body?.bagian ?? "").toUpperCase();
  if (id) {
    const s = await queryOne<any>("SELECT * FROM sop WHERE id = @id", { id });
    if (!s) return res.status(404).json({ error: "SOP tidak ditemukan" });
    if (s.dikunci === kunci) return res.json({ success: true, n: 0 });
    await execute("UPDATE sop SET dikunci = @kunci, updated_at = now() WHERE id = @id", { kunci, id });
    await sopLog(req, kunci ? "Kunci SOP" : "Buka Kunci SOP", sopObjek(s));
    return res.json({ success: true, n: 1 });
  }
  if (!SOP_BAGIAN[bagian]) return res.status(400).json({ error: "Bagian tidak valid" });
  const rows = await queryMany<{ judul: string }>(
    "UPDATE sop SET dikunci = @kunci, updated_at = now() WHERE bagian = @bagian AND dikunci <> @kunci RETURNING judul",
    { kunci, bagian }
  );
  if (rows.length)
    await sopLog(req, kunci ? "Kunci SOP" : "Buka Kunci SOP", `Bagian ${SOP_BAGIAN[bagian]}`, `${rows.length} SOP: ${rows.map((r) => r.judul).join("; ")}`);
  res.json({ success: true, n: rows.length });
});

app.put("/api/sop/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM sop WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "SOP tidak ditemukan" });
  if (!sopUbah(req.user!, existing)) return res.status(403).json({ error: existing.dikunci ? SOP_TERKUNCI : "Akses ditolak" });
  const d = sopPayload(req.body);
  const err = sopCek(d);
  if (err) return res.status(400).json({ error: err });
  // Moved to another bagian: to the bottom of that one.
  const urut =
    d.bagian === existing.bagian
      ? existing.urut
      : (await queryOne<{ n: number }>("SELECT COALESCE(MAX(urut), 0) + 1 AS n FROM sop WHERE bagian = @bagian", { bagian: d.bagian }))!.n;
  await execute(
    `UPDATE sop SET bagian = @bagian, urut = @urut, judul = @judul, audit = @audit, no_dokumen = @no_dokumen, revisi = @revisi,
       tgl_berlaku = @tgl_berlaku, pic = @pic, status = @status, url = @url, keterangan = @keterangan, updated_at = now() WHERE id = @id`,
    { ...d, urut, id: existing.id }
  );
  const detail = describeChanges(sopLogView(existing), sopLogView(d), SOP_LABELS);
  if (detail !== "Tidak ada perubahan") await sopLog(req, "Edit SOP", sopObjek(d), detail);
  res.json({ success: true, urut });
});

app.delete("/api/sop/:id", async (req, res) => {
  const existing = await queryOne<any>("SELECT * FROM sop WHERE id = @id", { id: req.params.id });
  if (!existing) return res.status(404).json({ error: "SOP tidak ditemukan" });
  if (!sopUbah(req.user!, existing)) return res.status(403).json({ error: existing.dikunci ? SOP_TERKUNCI : "Akses ditolak" });
  await execute("DELETE FROM sop WHERE id = @id", { id: existing.id });
  await sopLog(req, "Hapus SOP", sopObjek(existing), sopRingkas(existing));
  res.json({ success: true });
});

// ---- Status Update: how current each estate's data is, per module ----
// The latest date with data (transaction date, so a back-entered day counts) and how many days ago
// that is, against a limit per module. The Dashboard panel and the admins' reminder banner read it.
// A module / estate that has never had data isn't late, it just isn't used there (yet).
// Pupuk is seasonal (pemupukan rounds) and oli goes out at service intervals, so both get a month;
// pupuk also stays out of the reminder banner.
const UPDATE_LIMIT: Record<string, number> = { BBM: 3, LAPORAN: 3, KLINIK: 3, OLI: 30, PUPUK: 30, GUDANG: 7 };
const UPDATE_MODULE: Record<string, LoanModule> = { GUDANG: "GUDANG", BBM: "BBM", OLI: "OLI", PUPUK: "PUPUK", KLINIK: "KLINIK", LAPORAN: "KLINIK" };
app.get("/api/status-update", async (req, res) => {
  const jak = (col: string) => `to_char((${col} AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD')`;
  const iso = (col: string) => `CASE WHEN ${col} LIKE '____-__-__' THEN ${col} END`;
  const rows = await queryMany<{ modul: string; estate: string; terakhir: string | null }>(
    `SELECT 'GUDANG' modul, 'NILAM' estate, GREATEST(
        (SELECT MAX(${iso("tanggal_keluar_iso")}) FROM stock_out_log), (SELECT MAX(${iso("tanggal_terima_iso")}) FROM stock_in_log),
        (SELECT MAX(${jak("created_at")}) FROM transactions)) terakhir
     UNION ALL SELECT 'GUDANG', gudang, MAX(${jak("created_at")}) FROM gudang_stock_tx GROUP BY 2
     UNION ALL SELECT 'BBM', lokasi, MAX(${iso("tanggal_iso")}) FROM bbm_log GROUP BY 2
     UNION ALL SELECT 'OLI', estate, MAX(${iso("tanggal_iso")}) FROM oli_log GROUP BY 2
     UNION ALL SELECT 'PUPUK', estate, MAX(${iso("tanggal_iso")}) FROM pupuk_log GROUP BY 2
     UNION ALL SELECT 'KLINIK', klinik, MAX(${jak("created_at")}) FROM klinik_stock_tx GROUP BY 2
     UNION ALL SELECT 'LAPORAN', klinik, MAX(${iso("tanggal_iso")}) FROM klinik_kunjungan GROUP BY 2`
  );
  const today = jakartaToday();
  const days = (d: string) => Math.max(Math.round((Date.parse(today) - Date.parse(d)) / 86400000), 0);
  const data = rows
    .filter((r) => (ESTATES as readonly string[]).includes(r.estate) && estateAllowed(req.user!, r.estate) && canLoan(req.user!, UPDATE_MODULE[r.modul], "view"))
    .map((r) => ({ ...r, hari: r.terakhir ? days(r.terakhir) : null, batas: UPDATE_LIMIT[r.modul] }));
  res.json({ today, limits: UPDATE_LIMIT, data });
});

// ---- Foto bukti transaksi (see schema.sql evidence) ----
// Every Stok Masuk / Keluar (Gudang, Klinik, BBM, Pupuk, Oli) and every Pinjaman / pengembalian needs
// a photo. The form uploads it first (POST /api/evidence, already shrunk in the browser); the photo
// lives in the private Supabase Storage bucket `evidence` and the transaction keeps its id. It is
// shown through GET /api/evidence/:id, which redirects to a short-lived signed URL.
// On a server of our own (VPS, see deploy/PINDAH-VPS.md) EVIDENCE_DIR keeps the photos on its disk
// instead, at the same `path` (YYYY-MM/<id>.<ext>), and GET /api/evidence/:id sends the file.
const EVIDENCE_DIR = (process.env.EVIDENCE_DIR ?? "").replace(/[\/]$/, "");
const STORAGE_URL = EVIDENCE_DIR ? "" : (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const STORAGE_KEY = EVIDENCE_DIR ? "" : process.env.SUPABASE_SERVICE_KEY ?? "";
const EVIDENCE_BUCKET = "evidence";
const EVIDENCE_MAX_BYTES = 3 * 1024 * 1024;
const EVIDENCE_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
function evidenceEnabled() {
  return !!EVIDENCE_DIR || !!(STORAGE_URL && STORAGE_KEY);
}
// A legacy service_role key (a JWT, "eyJ...") goes in both headers; a new secret key ("sb_secret_...")
// only in apikey - Supabase turns it into the service role itself.
const storageHeaders = (): Record<string, string> =>
  STORAGE_KEY.startsWith("sb_") ? { apikey: STORAGE_KEY } : { Authorization: `Bearer ${STORAGE_KEY}`, apikey: STORAGE_KEY };

async function storageUpload(path: string, body: Buffer, mime: string) {
  if (EVIDENCE_DIR) {
    const file = nodePath.join(EVIDENCE_DIR, path);
    await fs.mkdir(nodePath.dirname(file), { recursive: true });
    await fs.writeFile(file, body, { flag: "wx" });
    return;
  }
  const put = () =>
    fetch(`${STORAGE_URL}/storage/v1/object/${EVIDENCE_BUCKET}/${path}`, {
      method: "POST",
      headers: { ...storageHeaders(), "Content-Type": mime, "x-upsert": "false" },
      body: new Uint8Array(body),
    });
  let r = await put();
  // First upload ever: the bucket doesn't exist yet, create it (private) and try again.
  if (r.status === 400 || r.status === 404) {
    const text = await r.text();
    if (!/bucket not found/i.test(text)) throw new Error(`Upload gagal: ${text}`);
    await fetch(`${STORAGE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...storageHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: EVIDENCE_BUCKET, name: EVIDENCE_BUCKET, public: false }),
    });
    r = await put();
  }
  if (!r.ok) throw new Error(`Upload gagal: ${r.status} ${await r.text()}`);
}

app.post("/api/evidence", async (req, res) => {
  if (!evidenceEnabled()) return res.status(503).json({ error: "Penyimpanan foto belum disiapkan" });
  const m = String(req.body?.data ?? "").match(/^data:(image\/[a-z]+);base64,(.+)$/);
  const ext = m && EVIDENCE_MIME[m[1]];
  if (!m || !ext) return res.status(400).json({ error: "File harus berupa gambar (JPG / PNG / WEBP)" });
  const body = Buffer.from(m[2], "base64");
  if (!body.length || body.length > EVIDENCE_MAX_BYTES) return res.status(400).json({ error: "Ukuran foto maksimal 3 MB" });
  const row = (await queryOne<{ id: string }>("SELECT gen_random_uuid()::text id"))!;
  const path = `${jakartaToday().slice(0, 7)}/${row.id}.${ext}`;
  try {
    await storageUpload(path, body, m[1]);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "Foto gagal diupload, coba lagi" });
  }
  await execute("INSERT INTO evidence (id, path, mime, size, user_id) VALUES (@id::uuid, @path, @mime, @size, @uid)", {
    id: row.id,
    path,
    mime: m[1],
    size: body.length,
    uid: req.user!.id,
  });
  res.json({ id: row.id });
});

// Opens the photo (any logged-in account; the id is a random uuid only shown next to the transaction).
// How a photo is shown (its saved rotation), and saving a new one from the viewer: any logged-in
// account that can open the photo may turn one taken sideways / upside down so it reads right.
app.get("/api/evidence/:id/meta", async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).json({ error: "Foto tidak ditemukan" });
  const ev = await queryOne<{ rotation: number }>("SELECT rotation FROM evidence WHERE id = @id::uuid", { id: req.params.id });
  if (!ev) return res.status(404).json({ error: "Foto tidak ditemukan" });
  res.json({ rotation: ev.rotation });
});
app.post("/api/evidence/:id/rotation", async (req, res) => {
  const rotation = Number(req.body?.rotation);
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).json({ error: "Foto tidak ditemukan" });
  if (![0, 90, 180, 270].includes(rotation)) return res.status(400).json({ error: "Putaran tidak valid" });
  const r = await execute("UPDATE evidence SET rotation = @rotation WHERE id = @id::uuid", { id: req.params.id, rotation });
  if (!r.rowCount) return res.status(404).json({ error: "Foto tidak ditemukan" });
  res.json({ success: true });
});

// Tambah Bukti: puts a foto bukti on an older transaction that has none, without changing it - for the
// estates in EVIDENCE_ANYTIME (KNS, filling in its earlier months), past the 3-day edit window. The
// account needs Input or Edit of the module in that estate; a photo already there is not replaced
// (that stays an edit). Loan / transfer rows keep the Pinjaman's photo.
const EVIDENCE_ANYTIME = ["KNS"];
const ATTACH: Record<string, { table: string; estate: string; module: string }> = {
  bbm: { table: "bbm_log", estate: "lokasi", module: "bbm" },
  oli: { table: "oli_log", estate: "estate", module: "oli" },
  pupuk: { table: "pupuk_log", estate: "estate", module: "pupuk" },
  gudang: { table: "gudang_stock_tx", estate: "gudang", module: "gudang" },
  klinik: { table: "klinik_stock_tx", estate: "klinik", module: "klinik" },
};
app.put("/api/evidence/attach", async (req, res) => {
  const t = ATTACH[String(req.body?.kind ?? "")];
  const id = Number(req.body?.id);
  if (!t || !Number.isInteger(id)) return res.status(400).json({ error: "Transaksi tidak valid" });
  const row = await queryOne<any>(`SELECT *, ${t.estate} AS lokasi_ FROM ${t.table} WHERE id = @id`, { id });
  if (!row) return res.status(404).json({ error: "Transaksi tidak ditemukan" });
  const u = req.user!;
  if (!estateAllowed(u, row.lokasi_)) return res.status(403).json({ error: "Akses ditolak" });
  if (u.role !== "superuser" && !EVIDENCE_ANYTIME.includes(row.lokasi_)) return res.status(403).json({ error: "Tambah bukti transaksi lama hanya dibuka untuk estate KNS" });
  if (u.role !== "superuser" && ![`${t.module}.input`, `${t.module}.edit`].some((p) => u.perms.includes(p)))
    return res.status(403).json({ error: `Akun ini tidak punya hak Input ${t.module.toUpperCase()}` });
  if (row.evidence_id) return res.status(409).json({ error: "Transaksi ini sudah punya foto bukti" });
  if (row.pinjaman_id || row.transfer_from_id) return res.status(400).json({ error: "Foto bukti pinjaman / transfer diatur di menu Pinjaman" });
  if (!req.body?.evidence_id) return res.status(400).json({ error: "Pilih foto bukti dulu" });
  const ev = await checkEditEvidence(req, res, null);
  if (ev === undefined) return;
  if (!ev) return res.status(400).json({ error: "Foto bukti tidak valid, upload ulang fotonya" });
  await useEditEvidence(ev, [{ table: t.table, where: "id = @id", params: { id } }]);
  await logActivity(req, {
    module: t.module === "gudang" ? "BARANG" : (t.module.toUpperCase() as LogModule),
    estate: row.lokasi_,
    aksi: "Tambah Foto Bukti",
    objek: `${t.module.toUpperCase()} · ${row.tanggal ?? row.tanggal_iso ?? String(row.created_at ?? "").slice(0, 10)}${row.no_spb ? ` · SPB ${row.no_spb}` : ""}`,
    detail: [row.keterangan, row.note, row.jenis_bbm, row.jenis_oli, row.jenis_pupuk, row.item_kode, row.obat_kode].filter(Boolean).join(" · "),
  });
  res.json({ success: true });
});

// ---- Lengkapi Data: complete a month's transactions in one go ----
// Lists ALL the month's transactions of one estate with the fields the input form asks for (No. SPB / BPB,
// kendaraan & HM, blok, keterangan / catatan, foto bukti), marking what is still empty - a placeholder
// such as "-" or "0" counts as empty - and saves what the admin fills in or corrects, all rows at once,
// each change logged with its old value. Amounts, dates and saldo are never touched, so it is open (any
// month) to an account with Input or Edit of the module in that estate. Loan / transfer / koreksi rows are
// left out (their data lives in Pinjaman / Stok Opname).
type LengkapiField = { key: string; label: string; type: "text" | "number"; applies: string };
type LengkapiKind = {
  table: string;
  estate: string;
  module: "bbm" | "pupuk" | "oli" | "gudang" | "klinik";
  log: LogModule;
  date: string;
  base: string;
  info: string;
  fields: LengkapiField[];
  // Gudang Nilam: its Stock In / Out rows mirror a manual transaction (transactions.mirror_*) that
  // keeps the same text fields (field -> transactions column) and shares the photo (nilamEvidenceRows).
  mirror?: Record<string, string>;
};
const JKT_DATE = "to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')";
const LENGKAPI: Record<string, LengkapiKind> = {
  bbm: {
    table: "bbm_log",
    estate: "lokasi",
    module: "bbm",
    log: "BBM",
    date: "tanggal_iso",
    base: "pinjaman_id IS NULL AND koreksi IS NULL",
    info: "jenis_bbm AS jenis, estate AS sub, diterima AS masuk, pemakaian AS keluar",
    fields: [
      { key: "no_spb", label: "No. SPB", type: "text", applies: "true" },
      { key: "kode_kendaraan", label: "Kode Kendaraan", type: "text", applies: "COALESCE(pemakaian, 0) > 0" },
      // As the form: no HM/KM for a genset (by its code or its Master Alat Berat jenis).
      {
        key: "hm_terakhir",
        label: "HM/KM",
        type: "text",
        applies:
          "COALESCE(pemakaian, 0) > 0 AND COALESCE(kode_kendaraan, '') NOT ILIKE '%GENSET%' AND NOT EXISTS (SELECT 1 FROM alat_berat a WHERE upper(a.kode) = upper(kode_kendaraan) AND a.jenis_unit = 'GENSET')",
      },
      { key: "keterangan", label: "Keterangan", type: "text", applies: "true" },
    ],
  },
  pupuk: {
    table: "pupuk_log",
    estate: "estate",
    module: "pupuk",
    log: "PUPUK",
    date: "tanggal_iso",
    base: "pinjaman_id IS NULL AND koreksi IS NULL",
    info: "jenis_pupuk AS jenis, '' AS sub, diterima AS masuk, keluar AS keluar",
    fields: [
      { key: "divisi", label: "Divisi", type: "text", applies: "COALESCE(keluar, 0) > 0" },
      { key: "blok", label: "Blok", type: "text", applies: "COALESCE(keluar, 0) > 0" },
      { key: "ha", label: "HA", type: "number", applies: "COALESCE(keluar, 0) > 0" },
      { key: "pokok", label: "Pokok", type: "number", applies: "COALESCE(keluar, 0) > 0" },
      { key: "keterangan", label: "Keterangan", type: "text", applies: "true" },
    ],
  },
  oli: {
    table: "oli_log",
    estate: "estate",
    module: "oli",
    log: "OLI",
    date: "tanggal_iso",
    base: "pinjaman_id IS NULL AND koreksi IS NULL",
    info: "jenis_oli AS jenis, '' AS sub, diterima AS masuk, pemakaian AS keluar",
    fields: [
      { key: "no_embrace", label: "No. BPB", type: "text", applies: "true" },
      { key: "keterangan", label: "Keterangan", type: "text", applies: "true" },
    ],
  },
  gudang: {
    table: "gudang_stock_tx",
    estate: "gudang",
    module: "gudang",
    log: "BARANG",
    date: JKT_DATE,
    base: "COALESCE(is_correction, 0) = 0 AND pinjaman_id IS NULL AND transfer_from_id IS NULL",
    info: "(SELECT i.nama FROM items i WHERE i.kode = item_kode) AS jenis, item_kode AS sub, CASE WHEN type = 'IN' THEN qty END AS masuk, CASE WHEN type = 'OUT' THEN qty END AS keluar",
    fields: [
      { key: "tujuan", label: "Tujuan / Konsumen", type: "text", applies: "type = 'OUT'" },
      { key: "penerima", label: "Penerima / Diterima Oleh", type: "text", applies: "true" },
      { key: "note", label: "Catatan", type: "text", applies: "true" },
    ],
  },
  nilam_masuk: {
    table: "stock_in_log",
    estate: "'NILAM'",
    module: "gudang",
    log: "BARANG",
    date: "tanggal_terima_iso",
    base: "pinjaman_id IS NULL",
    info: "nama AS jenis, kode AS sub, qty AS masuk, NULL::int AS keluar",
    fields: [{ key: "keterangan", label: "Catatan", type: "text", applies: "true" }],
    mirror: { keterangan: "note" },
  },
  nilam_keluar: {
    table: "stock_out_log",
    estate: "'NILAM'",
    module: "gudang",
    log: "BARANG",
    date: "tanggal_keluar_iso",
    base: "pinjaman_id IS NULL",
    info: "nama AS jenis, kode AS sub, NULL::int AS masuk, qty AS keluar",
    fields: [
      { key: "tujuan", label: "Tujuan / Konsumen", type: "text", applies: "true" },
      { key: "penerima", label: "Penerima / Pengambil", type: "text", applies: "true" },
      { key: "keterangan", label: "Catatan", type: "text", applies: "true" },
    ],
    mirror: { tujuan: "tujuan", penerima: "penerima", keterangan: "note" },
  },
  klinik: {
    table: "klinik_stock_tx",
    estate: "klinik",
    module: "klinik",
    log: "KLINIK",
    date: JKT_DATE,
    base: "COALESCE(is_correction, 0) = 0 AND pinjaman_id IS NULL AND kunjungan_id IS NULL",
    info: "(SELECT o.nama FROM obat o WHERE o.kode = obat_kode) AS jenis, obat_kode AS sub, CASE WHEN type = 'IN' THEN qty END AS masuk, CASE WHEN type = 'OUT' THEN qty END AS keluar",
    fields: [
      // Obat taken out for a patient: who got it (not for one thrown away / sent back, which has an alasan).
      { key: "penerima", label: "Pasien / Penerima", type: "text", applies: "type = 'OUT' AND alasan IS NULL" },
      { key: "note", label: "Catatan", type: "text", applies: "true" },
    ],
  },
};
// A field counts as empty when NULL, blank or only a placeholder ("-", "0", "--", "."); a number column: NULL.
const lengkapiEmpty = (f: LengkapiField) => (f.type === "number" ? `${f.key} IS NULL` : `trim(COALESCE(${f.key}::text, '')) ~ '^[-0. ]*$'`);
const lengkapiKind = (req: express.Request, res: express.Response) => {
  const k = LENGKAPI[String(req.params.kind)];
  if (!k) res.status(404).json({ error: "Modul tidak dikenal" });
  return k;
};

app.get("/api/lengkapi/:kind", async (req, res) => {
  const k = lengkapiKind(req, res);
  if (!k) return;
  const estate = String(req.query.estate ?? "");
  const bulan = String(req.query.bulan ?? "");
  if (!estateAllowed(req.user!, estate)) return res.status(403).json({ error: "Akses ditolak" });
  if (!/^\d{4}-\d{2}$/.test(bulan)) return res.status(400).json({ error: "Pilih bulan" });
  const foto = evidenceEnabled();
  const need = k.fields.map((f) => `(${f.applies}) AND ${lengkapiEmpty(f)}`);
  const rows = await queryMany(
    `SELECT id, ${k.date} AS tanggal_iso, ${k.info}, ${k.fields.map((f) => f.key).join(", ")}, evidence_id,
       ARRAY_REMOVE(ARRAY[${k.fields.map((f, i) => `CASE WHEN ${need[i]} THEN '${f.key}' END`).join(", ")}${foto ? ", CASE WHEN evidence_id IS NULL THEN 'foto' END" : ""}], NULL) AS kurang,
       ARRAY_REMOVE(ARRAY[${k.fields.map((f) => `CASE WHEN ${f.applies} THEN '${f.key}' END`).join(", ")}], NULL) AS berlaku
     FROM ${k.table}
     WHERE ${k.estate} = @estate AND left(${k.date}, 7) = @bulan AND ${k.base}
     ORDER BY ${k.date}, id`,
    { estate, bulan }
  );
  // The choices the input form offers for a field (picked from a list, or still typed): kode kendaraan
  // (Master Alat Berat + the codes used at the lokasi), divisi / blok (Master Blok), penerima (the
  // estate's karyawan), tujuan (the fixed list of the gudang - `pilihan` = only these).
  const want = new Set(k.fields.map((f) => f.key));
  const options: Record<string, string[]> = {};
  const pilihan: string[] = [];
  if (k.module === "bbm" && want.has("kode_kendaraan"))
    options.kode_kendaraan = (
      await queryMany<{ v: string }>(
        `SELECT kode v FROM alat_berat UNION SELECT DISTINCT trim(kode_kendaraan) FROM bbm_log WHERE lokasi = @estate AND trim(COALESCE(kode_kendaraan, '')) <> '' ORDER BY 1`,
        { estate }
      )
    ).map((r) => r.v);
  if (k.module === "pupuk") {
    options.divisi = (
      await queryMany<{ v: string }>(
        `SELECT DISTINCT divisi v FROM master_blok WHERE estate = @estate AND divisi <> ''
         UNION SELECT DISTINCT divisi FROM pupuk_log WHERE estate = @estate AND trim(COALESCE(divisi, '')) <> '' ORDER BY 1`,
        { estate }
      )
    ).map((r) => r.v);
    options.blok = (await queryMany<{ v: string }>("SELECT DISTINCT upper(blok) v FROM master_blok WHERE estate = @estate ORDER BY 1", { estate })).map((r) => r.v);
  }
  if (want.has("tujuan")) {
    options.tujuan = k.table === "stock_out_log" ? NILAM_TUJUAN : GUDANG_TUJUAN[estate] ?? [];
    // The other gudang only supply their own estates; Gudang Nilam's history also has free-typed tujuan.
    if (k.table === "gudang_stock_tx") pilihan.push("tujuan");
  }
  // Penerima: the estate's karyawan, plus the names already received by at this gudang / klinik (KNS and WJA
  // have no Master Karyawan yet).
  if (want.has("penerima"))
    options.penerima = (
      await queryMany<{ v: string }>(
        `SELECT DISTINCT nama v FROM karyawan WHERE UPPER(estate) = @estate AND trim(nama) <> ''
         UNION SELECT DISTINCT trim(penerima) FROM ${k.table} WHERE ${k.estate} = @estate AND trim(COALESCE(penerima, '')) <> '' AND trim(penerima) !~ '^[-0. ]*$'
         ORDER BY 1`,
        { estate: k.estate === "'NILAM'" ? "NILAM" : estate }
      )
    ).map((r) => r.v);
  res.json({ fields: k.fields.map(({ key, label, type }) => ({ key, label, type })), foto, rows, totalBulan: rows.length, options, pilihan });
});

app.put("/api/lengkapi/:kind", async (req, res) => {
  const k = lengkapiKind(req, res);
  if (!k) return;
  const estate = String(req.body?.estate ?? "");
  if (!estateAllowed(req.user!, estate)) return res.status(403).json({ error: "Akses ditolak" });
  const input = (Array.isArray(req.body?.rows) ? req.body.rows : []).slice(0, 1000);
  if (!input.length) return res.status(400).json({ error: "Belum ada yang diisi" });
  const u = req.user!;
  const done: string[] = [];
  let fotoCount = 0;
  try {
    await withTransaction(async (c) => {
      for (const r of input) {
        const id = Number(r?.id);
        if (!Number.isInteger(id)) continue;
        const row = await queryOne<any>(
          `SELECT *, ${k.date} AS tgl_, ${k.fields.map((f) => `(${f.applies}) AS "ok_${f.key}"`).join(", ")}
           FROM ${k.table} WHERE id = @id AND ${k.estate} = @estate AND ${k.base} FOR UPDATE`,
          { id, estate },
          c
        );
        if (!row) throw new Error(`Transaksi #${id} tidak ditemukan di ${estate}`);
        const set: Record<string, unknown> = {};
        const old: Record<string, unknown> = {};
        for (const f of k.fields) {
          const v = r?.values?.[f.key];
          if (v === undefined || v === null || !row[`ok_${f.key}`]) continue;
          const cur = row[f.key];
          let nv: string | number | null;
          if (f.type === "number") {
            if (String(v).trim() === "") nv = null;
            else {
              nv = Number(String(v).replace(",", "."));
              if (!Number.isFinite(nv) || nv < 0) throw new Error(`Tanggal ${row.tgl_}: ${f.label} harus angka`);
            }
            if (nv === (cur === null ? null : Number(cur))) continue;
          } else {
            nv = String(v).trim().slice(0, 200);
            if (nv === String(cur ?? "").trim()) continue;
          }
          set[f.key] = nv;
          old[f.key] = cur;
        }
        const keys = Object.keys(set);
        if (keys.length) await execute(`UPDATE ${k.table} SET ${keys.map((x) => `${x} = @${x}`).join(", ")} WHERE id = @id`, { ...set, id }, c);
        // The mirrored manual transaction gets the same text.
        for (const x of keys.filter((x) => k.mirror?.[x])) {
          const col = k.mirror![x];
          await execute(`UPDATE transactions SET ${col} = @v WHERE mirror_source = @t AND mirror_id = @id`, { v: set[x] ?? "", t: k.table, id }, c);
        }
        let foto = false;
        const ev = r?.evidence_id;
        if (ev && ev !== row.evidence_id) {
          const ok =
            /^[0-9a-f-]{36}$/.test(String(ev)) &&
            (await queryOne("UPDATE evidence SET used = true WHERE id = @ev::uuid AND used = false AND (user_id = @uid OR @su) RETURNING id", { ev, uid: u.id, su: u.role === "superuser" }, c));
          if (!ok) throw new Error(`Tanggal ${row.tgl_}: foto bukti tidak valid, upload ulang fotonya`);
          const targets = k.mirror ? nilamEvidenceRows(k.table as "stock_in_log" | "stock_out_log", id) : [{ table: k.table, where: "id = @id", params: { id } }];
          // A photo already there is replaced (the old one stays in the log line).
          for (const t of targets) await execute(`UPDATE ${t.table} SET evidence_id = @ev::uuid WHERE (${t.where}) AND evidence_id IS NOT DISTINCT FROM @old::uuid`, { ...t.params, ev, old: row.evidence_id }, c);
          foto = true;
          fotoCount++;
        }
        if (keys.length || foto)
          done.push(
            `${String(row.tgl_).split("-").reverse().join("/")} #${id}: ${[...keys.map((x) => `${k.fields.find((f) => f.key === x)!.label} ${old[x] === null || old[x] === "" ? "(kosong)" : old[x]} → ${set[x] ?? "(kosong)"}`), foto && (row.evidence_id ? "ganti foto bukti" : "foto bukti")].filter(Boolean).join(", ")}`
          );
      }
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Gagal menyimpan" });
  }
  if (done.length) {
    const bulan = String(req.body?.bulan ?? "");
    await logActivity(req, {
      module: k.log,
      estate,
      aksi: "Lengkapi Data",
      objek: `${done.length} transaksi${/^\d{4}-\d{2}$/.test(bulan) ? ` · ${bulan.split("-").reverse().join("/")}` : ""}${fotoCount ? ` · ${fotoCount} foto bukti` : ""}`,
      detail: done.slice(0, 80).join("; ") + (done.length > 80 ? ` +${done.length - 80} lainnya` : ""),
    });
  }
  res.json({ success: true, saved: done.length, foto: fotoCount });
});

app.get("/api/evidence/:id", async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).send("Foto tidak ditemukan");
  const ev = await queryOne<{ path: string; created_at: Date }>("SELECT path, created_at FROM evidence WHERE id = @id::uuid", { id: req.params.id });
  if (!ev || !evidenceEnabled()) return res.status(404).send("Foto tidak ditemukan");
  const name = `bukti-${new Date(ev.created_at.getTime() + 7 * 3600_000).toISOString().slice(0, 10)}-${req.params.id.slice(0, 8)}.${ev.path.split(".").pop()}`;
  if (EVIDENCE_DIR) {
    const file = nodePath.join(EVIDENCE_DIR, ev.path);
    if (req.query.download) return res.download(file, name, (e) => e && !res.headersSent && res.status(404).send("Foto tidak ditemukan"));
    return res.sendFile(file, { headers: { "Cache-Control": "private, max-age=600" } }, (e) => e && !res.headersSent && res.status(404).send("Foto tidak ditemukan"));
  }
  const r = await fetch(`${STORAGE_URL}/storage/v1/object/sign/${EVIDENCE_BUCKET}/${ev.path}`, {
    method: "POST",
    headers: { ...storageHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.signedURL) return res.status(502).send("Foto tidak bisa dibuka");
  // ?download=1 makes the storage answer an attachment, so the browser saves it instead of showing it.
  const download = req.query.download ? `&download=${encodeURIComponent(name)}` : "";
  res.redirect(`${STORAGE_URL}/storage/v1${j.signedURL}${download}`);
});

// Takes the uploaded photo of a new transaction: it must exist, be uploaded by this account and not
// belong to another transaction yet. Returns its id; undefined = refused (the error is sent); null =
// photo storage isn't set up on this server (SUPABASE_URL / SUPABASE_SERVICE_KEY), so no photo is
// asked and transactions keep working until it is.
// Every table whose rows keep a foto bukti (schema.sql evidence_id columns).
const EVIDENCE_HOLDERS = ["transactions", "stock_in_log", "stock_out_log", "gudang_stock_tx", "klinik_stock_tx", "bbm_log", "pupuk_log", "oli_log", "pinjaman", "pinjaman_kembali", "klinik_kunjungan", "koperasi_tx", "berita_acara", "chat_message", "depo_air_biaya"];

async function claimEvidence(req: express.Request, res: express.Response): Promise<string | null | undefined> {
  if (!evidenceEnabled()) return null;
  const id = String(req.body?.evidence_id ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    res.status(400).json({ error: "Foto bukti wajib diupload" });
    return undefined;
  }
  // used = false is what stops the same form being booked twice (a resend while the first request
  // is still saving can't take the photo again).
  const ok = await queryOne(
    "UPDATE evidence SET used = true WHERE id = @id::uuid AND used = false AND (user_id = @uid OR @su) RETURNING id",
    { id, uid: req.user!.id, su: req.user!.role === "superuser" }
  );
  if (!ok) {
    res.status(400).json({ error: "Foto bukti tidak valid, upload ulang fotonya" });
    return undefined;
  }
  // The request is refused or fails after this (stok kurang, a server error...): the photo goes back,
  // if no saved row holds it, just before that answer goes out - so sending the same form again
  // works instead of answering "foto tidak valid". Done before the answer, not after: on Vercel the
  // function may stop as soon as it has answered.
  const end = res.end.bind(res) as (...a: unknown[]) => express.Response;
  res.end = ((...args: unknown[]) => {
    if (res.statusCode < 400) return end(...args);
    execute(
      `UPDATE evidence SET used = false WHERE id = @id::uuid
         AND NOT (${EVIDENCE_HOLDERS.map((t) => `EXISTS (SELECT 1 FROM ${t} WHERE evidence_id = @id::uuid)`).join(" OR ")})`,
      { id }
    )
      .catch((e) => console.error("Foto bukti tidak bisa dilepas:", e))
      .finally(() => end(...args));
    return res;
  }) as typeof res.end;
  return id;
}

// Gives a claimed photo back when the transaction it was for is refused (e.g. not enough stock), so
// the same upload can be used when the form is sent again.
// Input Banyak: a foto bukti per row (rows[i].evidence_id) and / or one for the whole batch (evidence_id).
// Every photo is optional - a row without one is completed later (Lengkapi Data). Each is taken (used) once;
// a refused booking gives them back (ev.release / bookBatch). undefined = refused (the error is sent).
type BatchEvidence = { of: (i: number) => string | null; ids: string[]; release: () => Promise<void> };
async function claimBatchEvidence(req: express.Request, res: express.Response, n: number): Promise<BatchEvidence | undefined> {
  if (!evidenceEnabled()) return { of: () => null, ids: [], release: async () => {} };
  const list: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const want = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const shared = want(req.body?.evidence_id);
  const per = Array.from({ length: n }, (_, i) => want(list[i]?.evidence_id));
  const taken: string[] = [];
  for (const id of [...new Set([shared, ...per].filter((x): x is string => !!x))]) {
    const ok = await queryOne("UPDATE evidence SET used = true WHERE id = @id::uuid AND used = false AND (user_id = @uid OR @su) RETURNING id", {
      id,
      uid: req.user!.id,
      su: req.user!.role === "superuser",
    });
    if (!ok) {
      for (const t of taken) await releaseEvidence(t);
      const row = per.indexOf(id);
      res.status(400).json(row >= 0 ? { error: `Baris ${row + 1}: foto bukti tidak valid, upload ulang fotonya`, row } : { error: "Foto bukti tidak valid, upload ulang fotonya" });
      return undefined;
    }
    taken.push(id);
  }
  return { of: (i) => per[i] ?? shared, ids: taken, release: async () => { for (const t of taken) await releaseEvidence(t); } };
}

async function releaseEvidence(id: string | null | undefined) {
  if (id) await execute("UPDATE evidence SET used = false WHERE id = @id::uuid", { id });
}

// Edit forms: a new foto bukti (body.evidence_id other than the row's) replaces the row's. Checked
// before the edit (it must exist, be this account's upload and unused) and taken only once the edit
// is saved (useEditEvidence), so a refused edit doesn't use it up. Returns the new id, null = the
// photo stays as it is, undefined = refused (the error is sent).
async function checkEditEvidence(req: express.Request, res: express.Response, current: string | null | undefined): Promise<string | null | undefined> {
  const next = req.body?.evidence_id;
  if (typeof next !== "string" || !next || next === current || !evidenceEnabled()) return null;
  const ok =
    /^[0-9a-f-]{36}$/.test(next) &&
    (await queryOne("SELECT 1 FROM evidence WHERE id = @id::uuid AND used = false AND (user_id = @uid OR @su)", {
      id: next,
      uid: req.user!.id,
      su: req.user!.role === "superuser",
    }));
  if (!ok) {
    res.status(400).json({ error: "Foto bukti tidak valid, upload ulang fotonya" });
    return undefined;
  }
  return next;
}
// Puts the checked photo on the edited row (and the rows that share it, e.g. a Nilam transaction's mirror).
async function useEditEvidence(id: string | null | undefined, rows: { table: string; where: string; params: Record<string, unknown> }[]) {
  if (!id) return;
  await execute("UPDATE evidence SET used = true WHERE id = @id::uuid", { id });
  for (const r of rows) await execute(`UPDATE ${r.table} SET evidence_id = @evidenceId::uuid WHERE ${r.where}`, { ...r.params, evidenceId: id });
}
// A Nilam Stock In / Out row, the manual transaction it mirrors and the Stok Masuk that transaction
// booked in another gudang all show the same photo.
const nilamEvidenceRows = (table: "stock_in_log" | "stock_out_log", id: unknown) => [
  { table, where: "id = @id", params: { id } },
  { table: "transactions", where: "mirror_source = @t AND mirror_id = @id", params: { t: table, id } },
  {
    table: "gudang_stock_tx",
    where: "transfer_from_id IN (SELECT t.id FROM transactions t WHERE t.mirror_source = @t AND t.mirror_id = @id)",
    params: { t: table, id },
  },
];
