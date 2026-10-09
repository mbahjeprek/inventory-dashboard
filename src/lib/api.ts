export type Role = "superuser" | "estate";
export const ESTATES = ["NILAM", "KNS", "WJA", "ZAMRUD", "FIRUS"] as const;
export type Estate = (typeof ESTATES)[number];

// The estates each non-Nilam site supplies (KNS and WJA each supply two): Stok Keluar tujuan of
// their gudang and the BBM Estate choices. Keep in sync with GUDANG_TUJUAN in server/src/app.ts.
export const GUDANG_TUJUAN: Record<string, string[]> = {
  KNS: ["MALAPIAK", "TAGANG"],
  WJA: ["LUBAKAN", "TAGUL"],
  ZAMRUD: ["ZAMRUD"],
  FIRUS: ["FIRUS"],
};

export type AuthUser = {
  id: number;
  username: string;
  nama: string;
  role: Role;
  estate: Estate | null;
  // Estates it can open and the permissions ticked for it (see src/lib/access.ts); a superuser
  // gets every estate and permission.
  estates: string[];
  perms: string[];
};

export type UserAccount = {
  id: number;
  username: string;
  nama: string;
  role: Role;
  // Comma separated, e.g. "ZAMRUD,FIRUS" and "gudang.view,gudang.input"; null for a superuser.
  estates: string | null;
  perms: string | null;
  // Temporary full inventory access in its own estates until this moment (null = none).
  temp_full_until?: string | null;
  created_at: string;
};

// Log Aktivitas User: every account plus its actions / logins in the period.
export type UserActivity = {
  users: (Omit<UserAccount, "created_at"> & { last_login: string | null; last_action: string | null })[];
  perUser: {
    user_id: number;
    aksi: number;
    hari_aktif: number;
    stok_masuk: number;
    stok_keluar: number;
    koreksi: number;
    m_gudang: number;
    m_bbm: number;
    m_pupuk: number;
    m_klinik: number;
    m_oli?: number;
  }[];
  logins: { user_id: number; login: number }[];
  daily: { user_id: number; tanggal: string; aksi: number }[];
};

export type Item = {
  id: number;
  kode: string;
  nama: string;
  satuan: string;
  buffer_stock: number;
  keterangan: string;
  stock_tersedia: number;
  stock_in: number;
  stock_out: number;
  stock_fisik: number;
  selisih_stock: number;
};

// What the Pilih Barang list and the transaction form need; filled from items (Nilam) or from a
// gudang's own stock (KNS/WJA/Zamrud/Firus, via /api/gudang-stock/pick).
// Klinik rows also carry the obat's kemasan.
export type PickerItem = Pick<Item, "id" | "kode" | "nama" | "satuan" | "buffer_stock" | "stock_tersedia" | "keterangan"> & Partial<Pick<Obat, "kemasan" | "isi_kemasan">>;

// Where a Stock In/Out/Koreksi goes when it isn't Nilam's gudang (which uses items directly).
export type StockScope = { kind: "gudang" | "klinik"; name: string };

// One Stock In / Stock Out row of a gudang (KNS/WJA/Zamrud/Firus) or klinik ledger.
export type LedgerTx = {
  id: number;
  created_at: string;
  type: "IN" | "OUT";
  qty: number;
  tujuan: string;
  penerima: string;
  note: string | null;
  is_correction: number;
  // Klinik: which batches the movement touched ([{exp, qty}], exp '' = no expiry).
  alloc?: { exp: string; qty: number }[] | null;
  // Stok Masuk booked automatically by a Stok Keluar from another gudang; changed only from there.
  is_transfer: boolean;
  pinjaman_id?: number | null;
  evidence_id?: string | null;
  kode: string;
  nama: string;
  satuan: string;
  input_oleh: string;
};

export type Obat = {
  id: number;
  kode: string;
  nama: string;
  kategori: string;
  jenis: string;
  deskripsi: string;
  satuan: string;
  // Pack it comes in (STRIP) and how many `satuan` one holds (0 = none), see src/lib/kemasan.ts.
  kemasan: string;
  isi_kemasan: number;
};

export type KlinikStockItem = {
  id: number;
  obat_id: number;
  kode: string;
  nama: string;
  kategori: string;
  jenis: string;
  deskripsi: string;
  satuan: string;
  kemasan: string;
  isi_kemasan: number;
  buffer_stock: number;
  stock_tersedia: number;
  expired_date: string | null;
  catatan: string;
  keterangan: string;
  // Batches still in stock, nearest expiry first ('' = no expiry date).
  batches: KlinikBatch[];
};

export type KlinikBatch = { id: number; expired_date: string; qty: number };

export type KlinikSummary = {
  totalItems: number;
  totalStock: number;
  lowStock: number;
  outOfStock: number;
  expiring: number;
};

export type Summary = {
  totalItems: number;
  lowStock: number;
  outOfStock: number;
  totalStock: number;
  totalStockIn: number;
  totalStockOut: number;
  statusBreakdown: { keterangan: string; c: number }[];
  perTujuan: { tujuan: string; qty: number }[];
};

export type GudangStockItem = {
  id: number;
  kode: string;
  nama: string;
  satuan: string;
  buffer_stock: number;
  stock_tersedia: number;
  keterangan: string;
};

export type GudangStockSummary = {
  totalItems: number;
  lowStock: number;
  outOfStock: number;
  totalStock: number;
};

export type Transaction = {
  id: number;
  item_id: number;
  tujuan: string;
  type: "IN" | "OUT";
  qty: number;
  note: string | null;
  penerima: string | null;
  created_at: string;
  kode?: string;
  nama?: string;
};

export type StockInRecord = {
  id: number;
  evidence_id?: string | null;
  item_id: number | null;
  kode: string;
  nama: string;
  tanggal_po: string;
  no_pr: string;
  po_in_akss: string;
  nama_vendor: string;
  qty: number;
  satuan: string;
  tujuan: string | null;
  estate_raw: string;
  divisi: string;
  tanggal_terima: string;
  tanggal_terima_iso: string | null;
  keterangan: string;
};

export type StockOutRecord = {
  id: number;
  evidence_id?: string | null;
  item_id: number | null;
  kode: string;
  nama: string;
  no_request: string;
  no_po: string;
  req_by: string;
  qty: number;
  satuan: string;
  tanggal_keluar: string;
  tanggal_keluar_iso: string | null;
  nik_ktp: string;
  penerima: string;
  tujuan: string | null;
  estate_raw: string;
  divisi: string;
  no_embrace_gudang: string;
  keterangan: string;
  nik_karyawan: string;
};

export type Karyawan = {
  id: number;
  nik: string;
  nama: string;
  status: string;
  estate: string;
  lokasi_kerja: string;
  nik_ktp: string;
};

export type AlatBerat = {
  id: number;
  kode: string;
  jenis_unit: string;
  nama: string;
};

export type BbmBatchRow = {
  tipe: "DITERIMA" | "PEMAKAIAN";
  jumlah: number;
  estate: string;
  no_spb: string;
  keterangan: string;
  kode_kendaraan: string;
  hm_terakhir: string;
};

export type BbmRecord = {
  id: number;
  jenis_bbm: "SOLAR" | "BENSIN";
  lokasi: string;
  estate: string | null;
  periode: string;
  tanggal: string;
  tanggal_iso: string | null;
  created_at?: string | null;
  no_spb: string;
  stock_awal: number | null;
  diterima: number | null;
  pinjam: number | null;
  // Row booked by a Pinjaman / Transfer: its jenis ("PINJAM" | "TRANSFER"), null otherwise.
  pinjaman_jenis?: string | null;
  pinjaman_id?: number | null;
  pemakaian: number | null;
  evidence_id?: string | null;
  saldo_stock: number | null;
  keterangan: string;
  status_kepemilikan: string | null;
  kode_kendaraan: string | null;
  hm_terakhir: string | null;
  total_hm?: number | null;
};

export type PupukRecord = {
  id: number;
  estate: string;
  jenis_pupuk: string;
  periode: string;
  tanggal: string;
  tanggal_iso: string | null;
  created_at?: string | null;
  divisi: string;
  no_embrace: string;
  kode_barang: string;
  keluar: number | null;
  diterima: number | null;
  // Pinjaman antar estate: + borrowed in / return received, - lent out / returned.
  pinjam: number | null;
  // Row booked by a Pinjaman / Transfer: its jenis ("PINJAM" | "TRANSFER"), null otherwise.
  pinjaman_jenis?: string | null;
  pinjaman_id: number | null;
  evidence_id: string | null;
  saldo_stock: number | null;
  keterangan: string;
  blok: string;
  ha: number | null;
  pokok: number | null;
};

export type OliRecord = {
  id: number;
  estate: string;
  jenis_oli: string;
  periode: string;
  tanggal: string;
  tanggal_iso: string | null;
  created_at?: string | null;
  no_embrace: string;
  diterima: number | null;
  pemakaian: number | null;
  pinjam: number | null;
  // Row booked by a Pinjaman / Transfer: its jenis ("PINJAM" | "TRANSFER"), null otherwise.
  pinjaman_jenis?: string | null;
  pinjaman_id: number | null;
  evidence_id: string | null;
  saldo_stock: number | null;
  keterangan: string;
};
export type MasterOli = { id: number; kode: string; nama: string; satuan: string; keterangan: string; transaksi: number };
export type OliSaldo = { jenis_oli: string; saldo_stock: number; tanggal: string };
export type OliSummary = {
  perJenis: { jenis_oli: string; diterima: number; pemakaian: number }[];
  saldoTerakhir: OliSaldo[];
  saldoPerTanggal: OliSaldo[];
};

export type PupukSaldo = { jenis_pupuk: string; saldo_stock: number; tanggal: string };
export type PupukSummary = {
  perJenis: { jenis_pupuk: string; diterima: number; keluar: number }[];
  saldoTerakhir: PupukSaldo[];
  saldoPerTanggal: PupukSaldo[];
};

export type ActivityLog = {
  id: number;
  created_at: string;
  module: "BARANG" | "BBM" | "PUPUK" | "KLINIK" | "OLI";
  estate: string | null;
  aksi: string;
  objek: string | null;
  detail: string | null;
  username: string | null;
  nama: string | null;
};

export type BbmSummary = {
  perLokasi: { jenis_bbm: string; lokasi: string; diterima: number; pemakaian: number }[];
  saldoTerakhir: { jenis_bbm: string; lokasi: string; saldo_stock: number; tanggal: string; tanggal_iso: string }[];
  saldoPerTanggal: { jenis_bbm: string; lokasi: string; saldo_stock: number; tanggal: string; tanggal_iso: string }[];
};

export type Movement = {
  id: number;
  date: string | null;
  dateDisplay: string;
  created_at?: string | null;
  pinjaman_id?: number | null;
  type: "IN" | "OUT";
  source: "STOCK_IN" | "STOCK_OUT" | "MANUAL";
  tujuan: string | null;
  qty: number;
  satuan: string | null;
  note: string | null;
  ref: string | null;
  refCode: string | null;
  evidence_id?: string | null;
};

export type TopKeluarRow = { kode: string; id: number | null; nama: string; satuan: string | null; qty: number; trx: number };
// ---- Stok Opname (server/src/app.ts "Stok Opname") ----
export type OpnameModule = "GUDANG" | "KLINIK" | "BBM" | "PUPUK" | "OLI";

// Usage per estate for the Dashboard "Perbandingan" tab (metric trx = number of Stok Keluar).
export type Perbandingan = {
  unit: string;
  metric: "qty" | "trx";
  bucket: "week" | "month";
  prevFrom: string;
  prevTo: string;
  perEstate: { estate: string; value: number }[];
  prev: { estate: string; value: number }[];
  series: { bucket: string; estate: string; value: number }[];
};

// TRANSFER = stock sent to another estate for good (jenis TRANSFER), nothing comes back.
export type PinjamanStatus = "DIPINJAM" | "LUNAS" | "BATAL" | "TRANSFER";
export type Pinjaman = {
  id: number;
  module: OpnameModule;
  kode: string;
  nama: string;
  satuan: string;
  dari_estate: string;
  ke_estate: string;
  qty: number;
  qty_kembali: number;
  status: PinjamanStatus;
  jenis: "PINJAM" | "TRANSFER";
  alasan: string;
  tanggal_iso: string;
  created_at: string;
  dibuat_oleh: string;
  evidence_id: string | null;
  kembali: { qty: number; tanggal_iso: string; created_at?: string | null; note: string; batal: boolean; oleh: string; evidence_id: string | null }[];
};
export type PinjamanBarang = { kode: string; nama: string; satuan: string; stok: number };
export type OpnameStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "BATAL";
export type Opname = {
  id: number;
  module: OpnameModule;
  estate: string;
  status: OpnameStatus;
  tanggal: string;
  catatan: string;
  catatan_review: string;
  created_by: number | null;
  created_by_nama: string | null;
  created_at: string;
  submitted_by: number | null;
  submitted_by_nama: string | null;
  submitted_at: string | null;
  approved_by: number | null;
  approved_by_nama: string | null;
  approved_at: string | null;
};
export type OpnameListRow = Opname & { total: number; dihitung: number; selisih: number };
export type OpnameLine = {
  id: number;
  kode: string;
  nama: string;
  satuan: string;
  // Klinik batch expiry ('' = none); '' for the other modules.
  exp: string;
  // Klinik: expiry found on the batch when it differs from `exp` (null = as in the system).
  exp_fisik: string | null;
  stok_sistem: number;
  stok_fisik: number | null;
  keterangan: string;
  ditambahkan: boolean;
  // Klinik: the obat's pack (isi 0 = none), so the count can be typed as strip utuh + biji lepas.
  kemasan: string;
  isi_kemasan: number;
};

// Laporan Harian Klinik (KPI) - visits read from each clinic's Daily Report sheet.
export type LaporanCount = { label: string; n: number };
export type LaporanKlinikSummary = {
  totals: { total: number; hari: number; kecelakaan: number; istirahat: number; hari_istirahat: number; rujukan: number; mcu: number; pasien: number };
  jenis: LaporanCount[];
  status: LaporanCount[];
  divisi: LaporanCount[];
  kelamin: LaporanCount[];
  diagnosis: LaporanCount[];
  provider: LaporanCount[];
  obat: (LaporanCount & { kode: string; satuan: string; qty: number })[];
  perHari: { tanggal: string; n: number; kecelakaan: number }[];
  kecelakaanList: {
    tanggal_iso: string;
    klinik: string;
    nama_pasien: string;
    jabatan: string;
    divisi: string;
    diagnosis: string;
    istirahat: boolean;
    hari_istirahat: number;
    rujukan: boolean;
    provider: string;
    detail_kejadian: string;
  }[];
};
// One patient visit (Klinik > Laporan Harian), the columns of the Daily Report sheet. nomor = No.
export type KunjunganObat = { obat_kode: string; nama_obat: string; qty: number | null; satuan: string };
export type KunjunganInput = {
  // The Master Pasien entry picked for Nama Pasien (null = matched / added by name on save).
  pasien_id?: number | null;
  tanggal_iso: string;
  jenis_kunjungan: string;
  nama_pasien: string;
  jenis_kelamin: string;
  tanggal_lahir_iso: string | null;
  usia: number | null;
  status_pasien: string;
  penanggung: string;
  jabatan: string;
  divisi: string;
  tempat_tinggal: string;
  asal_pasien: string;
  diagnosis: string;
  kecelakaan_kerja: boolean;
  istirahat: boolean;
  hari_istirahat: number;
  rujukan: boolean;
  provider: string;
  detail_kejadian: string;
  obat: KunjunganObat[];
};
export type Kunjungan = KunjunganInput & {
  id: number;
  klinik: string;
  nomor: number;
  sumber: "APP" | "SHEET";
  evidence_id: string | null;
  created_at: string | null;
  created_by: string;
};
// Master Pasien: one patient of an estate's clinic, with their visit count.
export type Pasien = {
  id: number;
  estate: string;
  nama: string;
  jenis_kelamin: string;
  tanggal_lahir_iso: string | null;
  status_pasien: string;
  penanggung: string;
  jabatan: string;
  divisi: string;
  tempat_tinggal: string;
  asal_pasien: string;
  catatan: string;
  kunjungan: number;
  kunjungan_pertama: string | null;
  kunjungan_terakhir: string | null;
};
export type PasienInput = Omit<Pasien, "id" | "estate" | "kunjungan" | "kunjungan_pertama" | "kunjungan_terakhir">;

export type KunjunganOptions = {
  jabatan: string[];
  divisi: string[];
  tempat_tinggal: string[];
  asal_pasien: string[];
  diagnosis: string[];
  provider: string[];
  satuan: string[];
  obat: { kode: string; nama: string; satuan: string; stok: number | null }[];
};

export type TopKeluar = { rows: TopKeluarRow[]; totalQty: number; totalTrx: number };

// Keeps the status in the message ("API error 409") for the callers that check it, plus the
// server's own explanation (its { error }) for showing to the user.
export class ApiError extends Error {
  status: number;
  serverMessage: string;
  // The whole error body, for routes that say more than { error } (e.g. the failing row of a batch).
  data: any;
  constructor(status: number, serverMessage: string, data: any = null) {
    super(`API error ${status}`);
    this.status = status;
    this.serverMessage = serverMessage;
    this.data = data;
  }
}

// 423 = the location is locked by an open Stok Opname (see server/src/app.ts).
export const isOpnameLock = (e: unknown) => e instanceof ApiError && e.status === 423;

// Text for a failed request: the lock explanation when a Stok Opname blocks it, otherwise
// `fallback` (or the server's message when `useServer` is set, for screens whose server messages
// are written for users).
// The reason the server gave (a refused entry says why: foto bukti, stok, tanggal...), else the
// fallback with the status code (e.g. a server error or a timeout), so the cause can be traced.
// `useServer` is kept for the call sites that already passed it; every refusal is shown now.
export function errorText(e: unknown, fallback: string, _useServer = false): string {
  if (e instanceof ApiError) return e.serverMessage || `${fallback} (kode ${e.status})`;
  if (e instanceof TypeError) return `${fallback}: koneksi ke server terputus, coba lagi`;
  return fallback;
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, typeof body?.error === "string" ? body.error : "", body);
  }
  return res.json();
}

export const api = {
  login: (username: string, password: string) =>
    req<{ user: AuthUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  logout: () => req<{ success: boolean }>("/api/auth/logout", { method: "POST" }),

  me: () => req<{ user: AuthUser }>("/api/auth/me"),

  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ success: boolean }>("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),

  summary: () => req<Summary>("/api/summary"),

  topKeluar: (p: { source: "gudang" | "klinik"; estates: string[]; sortBy: "qty" | "trx"; dateFrom?: string; dateTo?: string }) => {
    const qs = new URLSearchParams({
      source: p.source,
      estates: p.estates.join(","),
      sortBy: p.sortBy,
      dateFrom: p.dateFrom ?? "",
      dateTo: p.dateTo ?? "",
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return req<TopKeluar>(`/api/top-keluar?${qs}`);
  },

  satuanOptions: () => req<string[]>("/api/satuan-options"),

  items: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: Item[]; total: number; page: number; pageSize: number }>(`/api/items?${qs}`);
  },

  item: (id: number) => req<Item & { transactions: Transaction[] }>(`/api/items/${id}`),

  itemMovements: (id: number) => req<{ data: Movement[] }>(`/api/items/${id}/movements`),

  createTransaction: (payload: {
    // Foto bukti (uploadEvidence) - required by the server.
    evidence_id: string;
    item_id: number;
    tujuan?: string;
    type: "IN" | "OUT";
    qty: number;
    note?: string;
    penerima?: string;
  }) =>
    req<{ success: boolean }>("/api/transactions", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  stockCorrection: (payload: { item_id: number; actual_qty: number; note?: string }) =>
    req<{ success: boolean; delta: number }>("/api/stock-correction", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  gudangPickItems: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: PickerItem[]; total: number; page: number; pageSize: number }>(`/api/gudang-stock/pick?${qs}`);
  },

  createGudangTransaction: (payload: {
    // Foto bukti (uploadEvidence) - required by the server.
    evidence_id: string;
    gudang: string;
    item_kode: string;
    type: "IN" | "OUT";
    qty: number;
    tujuan?: string;
    penerima?: string;
    note?: string;
  }) => req<{ success: boolean }>("/api/gudang-stock/transactions", { method: "POST", body: JSON.stringify(payload) }),

  gudangStockCorrection: (payload: { gudang: string; item_kode: string; actual_qty: number; note?: string }) =>
    req<{ success: boolean; delta: number }>("/api/gudang-stock/correction", { method: "POST", body: JSON.stringify(payload) }),

  obatOptions: () => req<{ kategori: string[]; satuan: string[]; jenis: { kategori: string; jenis: string }[] }>("/api/obat/options"),

  obat: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: Obat[]; total: number; page: number; pageSize: number }>(`/api/obat?${qs}`);
  },

  createObat: (payload: Omit<Obat, "id">) =>
    req<{ success: boolean; id: number }>("/api/obat", { method: "POST", body: JSON.stringify(payload) }),

  updateObat: (id: number, payload: Omit<Obat, "id">) =>
    req<{ success: boolean }>(`/api/obat/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteObat: (id: number) => req<{ success: boolean }>(`/api/obat/${id}`, { method: "DELETE" }),

  klinikSummary: (klinik: string) => req<KlinikSummary>(`/api/klinik-stock/summary?klinik=${klinik}`),

  klinikStock: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: KlinikStockItem[]; total: number; page: number; pageSize: number; kategoriOptions: string[] }>(
      `/api/klinik-stock?${qs}`
    );
  },

  laporanKlinikSummary: (params: { klinik: string; dateFrom: string; dateTo: string }) =>
    req<LaporanKlinikSummary>(`/api/klinik-laporan/summary?${new URLSearchParams(params)}`),
  laporanKlinikKunjungan: (params: Record<string, string | number>) =>
    req<{ data: Kunjungan[]; total: number; page: number; pageSize: number }>(`/api/klinik-laporan/kunjungan?${new URLSearchParams(params as any)}`),
  laporanKlinikTotals: (params: { klinik: string; dateFrom: string; dateTo: string }) =>
    req<Pick<LaporanKlinikSummary, "totals">>(`/api/klinik-laporan/summary?${new URLSearchParams({ ...params, lite: "1" })}`),
  pasien: (params: Record<string, string | number>) =>
    req<{ data: Pasien[]; total: number; page: number; pageSize: number }>(`/api/pasien?${new URLSearchParams(params as any)}`),
  pasienPick: (estate: string, search: string) => req<Pasien[]>(`/api/pasien/pick?${new URLSearchParams({ estate, search })}`),
  createPasien: (payload: PasienInput & { estate: string }) => req<{ success: boolean; id: number }>("/api/pasien", { method: "POST", body: JSON.stringify(payload) }),
  updatePasien: (id: number, payload: PasienInput) => req<{ success: boolean }>(`/api/pasien/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deletePasien: (id: number) => req<{ success: boolean }>(`/api/pasien/${id}`, { method: "DELETE" }),
  kunjunganOptions: (klinik: string) => req<KunjunganOptions>(`/api/klinik-laporan/options?${new URLSearchParams({ klinik })}`),
  createKunjungan: (payload: KunjunganInput & { klinik: string; evidence_id?: string | null }) =>
    req<{ success: boolean; id: number }>("/api/klinik-laporan/kunjungan", { method: "POST", body: JSON.stringify(payload) }),
  updateKunjungan: (id: number, payload: KunjunganInput & { evidence_id?: string | null }) =>
    req<{ success: boolean }>(`/api/klinik-laporan/kunjungan/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteKunjungan: (id: number) => req<{ success: boolean }>(`/api/klinik-laporan/kunjungan/${id}`, { method: "DELETE" }),

  klinikPickItems: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: PickerItem[]; total: number; page: number; pageSize: number }>(`/api/klinik-stock/pick?${qs}`);
  },

  createKlinikTransaction: (payload: {
    // Foto bukti (uploadEvidence) - required by the server.
    evidence_id: string;
    klinik: string;
    obat_kode: string;
    type: "IN" | "OUT";
    qty: number;
    tujuan?: string;
    penerima?: string;
    note?: string;
    // IN: the batch's expiry date; OUT: take from this batch (absent = expiring first).
    expired_date?: string;
  }) => req<{ success: boolean }>("/api/klinik-stock/transactions", { method: "POST", body: JSON.stringify(payload) }),

  klinikBatches: (klinik: string, obat_kode: string) =>
    req<KlinikBatch[]>(`/api/klinik-stock/batches?${new URLSearchParams({ klinik, obat_kode })}`),

  // Without qty the whole batch moves to the date; with qty only that many (split off).
  updateKlinikBatch: (id: number, expired_date: string, qty?: number) =>
    req<{ success: boolean }>(`/api/klinik-stock/batch/${id}`, { method: "PUT", body: JSON.stringify({ expired_date, qty }) }),

  klinikStockCorrection: (payload: { klinik: string; obat_kode: string; actual_qty: number; note?: string; expired_date?: string }) =>
    req<{ success: boolean; delta: number }>("/api/klinik-stock/correction", { method: "POST", body: JSON.stringify(payload) }),

  // The full expiry breakdown of a clinic stock row; a changed total is booked as Koreksi (needs note).
  setKlinikBatches: (id: number, batches: { expired_date: string; qty: number }[], note: string) =>
    req<{ success: boolean }>(`/api/klinik-stock/${id}/batches`, { method: "PUT", body: JSON.stringify({ batches, note }) }),

  updateKlinikStock: (id: number, payload: { buffer_stock: number; catatan: string }) =>
    req<{ success: boolean }>(`/api/klinik-stock/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteKlinikStock: (id: number) => req<{ success: boolean }>(`/api/klinik-stock/${id}`, { method: "DELETE" }),

  // Stock In / Stock Out history of a gudang or klinik ledger.
  ledgerHistory: (scope: StockScope, params: Record<string, string | number>) => {
    const qs = new URLSearchParams({
      ...(params as any),
      scope: scope.name,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).toString();
    return req<{ data: LedgerTx[]; total: number; qtySum: number; page: number; pageSize: number }>(
      `/api/${scope.kind === "klinik" ? "klinik-stock" : "gudang-stock"}/history?${qs}`
    );
  },

  updateLedgerTx: (scope: StockScope, id: number, payload: { qty: number; tujuan: string; penerima: string; note: string; expired_date?: string; evidence_id?: string }) =>
    req<{ success: boolean }>(`/api/${scope.kind === "klinik" ? "klinik-stock" : "gudang-stock"}/history/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteLedgerTx: (scope: StockScope, id: number) =>
    req<{ success: boolean }>(`/api/${scope.kind === "klinik" ? "klinik-stock" : "gudang-stock"}/history/${id}`, { method: "DELETE" }),

  transactions: (limit = 100) => req<Transaction[]>(`/api/transactions?limit=${limit}`),

  stockIn: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: StockInRecord[]; total: number; qtySum: number; page: number; pageSize: number }>(
      `/api/stock-in?${qs}`
    );
  },

  stockInVendors: () => req<string[]>("/api/stock-in/vendors"),

  stockOut: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: StockOutRecord[]; total: number; qtySum: number; page: number; pageSize: number }>(
      `/api/stock-out?${qs}`
    );
  },

  createItem: (payload: { kode: string; nama: string; satuan: string; buffer_stock: number }) =>
    req<{ success: boolean; id: number }>("/api/items", { method: "POST", body: JSON.stringify(payload) }),

  updateItem: (id: number, payload: { kode: string; nama: string; satuan: string; buffer_stock: number }) =>
    req<{ success: boolean }>(`/api/items/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteItem: (id: number) => req<{ success: boolean }>(`/api/items/${id}`, { method: "DELETE" }),

  activityLog: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams({
      ...(params as any),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).toString();
    return req<{ data: ActivityLog[]; total: number; page: number; pageSize: number; aksiOptions: string[] }>(
      `/api/activity-log?${qs}`
    );
  },

  updateActivityLog: (id: number, payload: { aksi: string; objek: string; detail: string }) =>
    req<{ success: boolean }>(`/api/activity-log/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteActivityLog: (id: number) => req<{ success: boolean }>(`/api/activity-log/${id}`, { method: "DELETE" }),

  pupuk: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: PupukRecord[]; total: number; keluarSum: number; diterimaSum: number; page: number; pageSize: number }>(
      `/api/pupuk?${qs}`
    );
  },

  pupukSummary: (estate: string, range: { dateFrom?: string; dateTo?: string; asOf?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries({ estate, ...range }).filter((e): e is [string, string] => !!e[1])).toString();
    return req<PupukSummary>(`/api/pupuk/summary?${qs}`);
  },

  pupukOptions: (estate: string) => req<{ jenis: string[]; divisi: string[] }>(`/api/pupuk/options?estate=${estate}`),

  createPupuk: (payload: {
    // Foto bukti (uploadEvidence) - required by the server.
    evidence_id: string;
    estate: string;
    jenis_pupuk: string;
    tanggal_iso: string;
    tipe: "MASUK" | "KELUAR";
    jumlah: number;
    divisi?: string;
    no_embrace?: string;
    kode_barang?: string;
    keterangan?: string;
    blok?: string;
    ha?: number | "";
    pokok?: number | "";
  }) => req<{ success: boolean; id: number; saldo_stock: number }>("/api/pupuk", { method: "POST", body: JSON.stringify(payload) }),

  updatePupuk: (id: number, payload: Record<string, unknown>) =>
    req<{ success: boolean }>(`/api/pupuk/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deletePupuk: (id: number) => req<{ success: boolean }>(`/api/pupuk/${id}`, { method: "DELETE" }),

  oli: (params: Record<string, string | number>) =>
    req<{ data: OliRecord[]; total: number; pemakaianSum: number; diterimaSum: number; page: number; pageSize: number }>(
      `/api/oli?${new URLSearchParams(params as any)}`
    ),
  oliSummary: (estate: string, range: { dateFrom?: string; dateTo?: string; asOf?: string } = {}) =>
    req<OliSummary>(`/api/oli/summary?${new URLSearchParams({ estate, ...range } as any)}`),
  oliOptions: (estate: string) => req<{ jenis: string[] }>(`/api/oli/options?estate=${estate}`),
  createOli: (payload: { evidence_id: string; estate: string; jenis_oli: string; tanggal_iso: string; tipe: "MASUK" | "PEMAKAIAN"; jumlah: number; no_embrace?: string; keterangan?: string }) =>
    req<{ success: boolean; id: number; saldo_stock: number }>("/api/oli", { method: "POST", body: JSON.stringify(payload) }),
  updateOli: (id: number, payload: Record<string, unknown>) => req<{ success: boolean }>(`/api/oli/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteOli: (id: number) => req<{ success: boolean }>(`/api/oli/${id}`, { method: "DELETE" }),

  masterOli: (search = "") => req<{ data: MasterOli[]; total: number }>(`/api/master-oli?${new URLSearchParams({ search })}`),
  createMasterOli: (payload: { kode: string; nama: string; satuan: string; keterangan: string }) =>
    req<{ success: boolean; id: number }>("/api/master-oli", { method: "POST", body: JSON.stringify(payload) }),
  updateMasterOli: (id: number, payload: { kode: string; nama: string; satuan: string; keterangan: string }) =>
    req<{ success: boolean }>(`/api/master-oli/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteMasterOli: (id: number) => req<{ success: boolean }>(`/api/master-oli/${id}`, { method: "DELETE" }),

  gudangStockSummary: (gudang: string) => req<GudangStockSummary>(`/api/gudang-stock/summary?gudang=${gudang}`),

  gudangStock: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: GudangStockItem[]; total: number; page: number; pageSize: number }>(`/api/gudang-stock?${qs}`);
  },

  addGudangStockItem: (payload: { gudang: string; item_kode: string; buffer_stock: number; stock_tersedia: number }) =>
    req<{ success: boolean; id: number }>("/api/gudang-stock", { method: "POST", body: JSON.stringify(payload) }),

  updateGudangStockItem: (id: number, payload: { buffer_stock: number; stock_tersedia: number }) =>
    req<{ success: boolean }>(`/api/gudang-stock/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteGudangStockItem: (id: number) => req<{ success: boolean }>(`/api/gudang-stock/${id}`, { method: "DELETE" }),

  updateTransaction: (
    id: number,
    payload: { tujuan?: string; type: "IN" | "OUT"; qty: number; note?: string; penerima?: string }
  ) => req<{ success: boolean }>(`/api/transactions/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteTransaction: (id: number) => req<{ success: boolean }>(`/api/transactions/${id}`, { method: "DELETE" }),

  updateStockIn: (
    id: number,
    payload: { nama_vendor: string; qty: number; satuan: string; tujuan: string | null; tanggal_terima_iso: string | null; keterangan: string; evidence_id?: string }
  ) => req<{ success: boolean }>(`/api/stock-in/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteStockIn: (id: number) => req<{ success: boolean }>(`/api/stock-in/${id}`, { method: "DELETE" }),

  updateStockOut: (
    id: number,
    payload: { penerima: string; qty: number; satuan: string; tujuan: string | null; tanggal_keluar_iso: string | null; keterangan: string; evidence_id?: string }
  ) => req<{ success: boolean }>(`/api/stock-out/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteStockOut: (id: number) => req<{ success: boolean }>(`/api/stock-out/${id}`, { method: "DELETE" }),

  karyawan: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: Karyawan[]; total: number; page: number; pageSize: number }>(`/api/karyawan?${qs}`);
  },

  alatPick: (search: string) => req<{ kode: string; jenis_unit: string; nama: string }[]>(`/api/alat-berat/pick?${new URLSearchParams({ search })}`),

  karyawanPick: (estate: string, search: string) =>
    req<{ nik: string; nama: string }[]>(`/api/karyawan/pick?${new URLSearchParams({ estate, search })}`),

  karyawanStatusOptions: () => req<string[]>("/api/karyawan/status-options"),

  karyawanEstateOptions: () => req<string[]>("/api/karyawan/estate-options"),

  createKaryawan: (payload: { nik: string; nama: string; status: string; estate: string; lokasi_kerja: string; nik_ktp: string }) =>
    req<{ success: boolean; id: number }>("/api/karyawan", { method: "POST", body: JSON.stringify(payload) }),

  updateKaryawan: (
    id: number,
    payload: { nik: string; nama: string; status: string; estate: string; lokasi_kerja: string; nik_ktp: string }
  ) => req<{ success: boolean }>(`/api/karyawan/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteKaryawan: (id: number) => req<{ success: boolean }>(`/api/karyawan/${id}`, { method: "DELETE" }),

  alatBerat: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: AlatBerat[]; total: number; page: number; pageSize: number }>(`/api/alat-berat?${qs}`);
  },

  alatBeratJenisOptions: () => req<string[]>("/api/alat-berat/jenis-options"),

  createAlatBerat: (payload: { kode: string; jenis_unit: string; nama: string }) =>
    req<{ success: boolean; id: number }>("/api/alat-berat", { method: "POST", body: JSON.stringify(payload) }),

  updateAlatBerat: (id: number, payload: { kode: string; jenis_unit: string; nama: string }) =>
    req<{ success: boolean }>(`/api/alat-berat/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteAlatBerat: (id: number) => req<{ success: boolean }>(`/api/alat-berat/${id}`, { method: "DELETE" }),

  bbmSummary: (lokasi?: string, range?: { dateFrom?: string; dateTo?: string; asOf?: string }) => {
    const qs = new URLSearchParams(
      Object.entries({ lokasi, ...range }).filter((e): e is [string, string] => !!e[1])
    ).toString();
    return req<BbmSummary>(`/api/bbm/summary${qs ? `?${qs}` : ""}`);
  },

  bbmLokasiOptions: () => req<string[]>("/api/bbm/lokasi-options"),

  bbmEstateOptions: (jenis_bbm: string, lokasi: string) =>
    req<string[]>(`/api/bbm/estate-options?${new URLSearchParams({ jenis_bbm, lokasi }).toString()}`),

  bbmAlatOptions: (lokasi: string) => req<string[]>(`/api/bbm/alat-options?${new URLSearchParams({ lokasi }).toString()}`),

  bbm: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: BbmRecord[]; total: number; pemakaianSum: number; diterimaSum: number; page: number; pageSize: number }>(
      `/api/bbm?${qs}`
    );
  },

  createBbmTransaction: (payload: {
    // Foto bukti (uploadEvidence) - required by the server.
    evidence_id: string;
    jenis_bbm: "SOLAR" | "BENSIN";
    lokasi: string;
    tanggal_iso: string;
    tipe: "DITERIMA" | "PEMAKAIAN";
    jumlah: number;
    keterangan?: string;
    no_spb?: string;
    estate?: string;
    kode_kendaraan?: string;
    hm_terakhir?: string;
  }) => req<{ success: boolean; id: number; saldo_stock: number }>("/api/bbm", { method: "POST", body: JSON.stringify(payload) }),

  // Input Banyak (all rows or none; a refused row comes back as ApiError.data.row, 0-based).
  createNilamBatch: (payload: { evidence_id: string; rows: { item_kode: string; type: "IN" | "OUT"; qty: number; tujuan: string; penerima: string; note: string }[] }) =>
    req<{ success: boolean; count: number }>("/api/transactions/batch", { method: "POST", body: JSON.stringify(payload) }),
  createGudangBatch: (payload: {
    evidence_id: string;
    gudang: string;
    rows: { item_kode: string; type: "IN" | "OUT"; qty: number; tujuan: string; penerima: string; note: string }[];
  }) => req<{ success: boolean; count: number }>("/api/gudang-stock/transactions/batch", { method: "POST", body: JSON.stringify(payload) }),
  createKlinikBatch: (payload: {
    evidence_id: string;
    klinik: string;
    rows: { obat_kode: string; type: "IN" | "OUT"; qty: number; expired_date: string; buang: boolean; penerima: string; note: string }[];
  }) => req<{ success: boolean; count: number }>("/api/klinik-stock/transactions/batch", { method: "POST", body: JSON.stringify(payload) }),
  createPupukBatch: (payload: {
    evidence_id: string;
    estate: string;
    tanggal_iso: string;
    rows: { jenis_pupuk: string; tipe: "MASUK" | "KELUAR"; jumlah: number; divisi: string; blok: string; ha: number | ""; pokok: number | ""; keterangan: string }[];
  }) => req<{ success: boolean; count: number }>("/api/pupuk/batch", { method: "POST", body: JSON.stringify(payload) }),
  createOliBatch: (payload: {
    evidence_id: string;
    estate: string;
    tanggal_iso: string;
    rows: { jenis_oli: string; tipe: "MASUK" | "PEMAKAIAN"; jumlah: number; no_embrace: string; keterangan: string }[];
  }) => req<{ success: boolean; count: number }>("/api/oli/batch", { method: "POST", body: JSON.stringify(payload) }),
  createBbmBatch: (payload: { evidence_id: string; jenis_bbm: "SOLAR" | "BENSIN"; lokasi: string; tanggal_iso: string; rows: BbmBatchRow[] }) =>
    req<{ success: boolean; count: number; saldo_stock: number }>("/api/bbm/batch", { method: "POST", body: JSON.stringify(payload) }),

  updateBbm: (
    id: number,
    payload: {
      tanggal_iso?: string;
      no_spb?: string;
      diterima?: number | null;
      pemakaian?: number | null;
      saldo_stock?: number | null;
      keterangan?: string;
      estate?: string;
      kode_kendaraan?: string;
      hm_terakhir?: string;
      // A new foto bukti (replaces the current one).
      evidence_id?: string;
    }
  ) => req<{ success: boolean }>(`/api/bbm/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteBbm: (id: number) => req<{ success: boolean }>(`/api/bbm/${id}`, { method: "DELETE" }),

  userActivity: (dateFrom: string, dateTo: string) =>
    req<UserActivity>(
      `/api/user-activity?${new URLSearchParams({ dateFrom, dateTo, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}`
    ),

  users: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: UserAccount[]; total: number; page: number; pageSize: number }>(`/api/users?${qs}`);
  },

  createUser: (payload: { username: string; password: string; nama: string; role: Role; estates?: string[]; perms?: string[] }) =>
    req<{ success: boolean; id: number }>("/api/users", { method: "POST", body: JSON.stringify(payload) }),

  updateUser: (
    id: number,
    payload: { username: string; nama: string; password?: string; role: Role; estates?: string[]; perms?: string[] }
  ) => req<{ success: boolean }>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteUser: (id: number) => req<{ success: boolean }>(`/api/users/${id}`, { method: "DELETE" }),

  perbandingan: (params: { module: OpnameModule; estates: string[]; dateFrom: string; dateTo: string; kode: string }) =>
    req<Perbandingan>(`/api/perbandingan?${new URLSearchParams({ ...params, estates: params.estates.join(",") })}`),
  perbandinganBarang: (module: OpnameModule, search: string) =>
    req<{ kode: string; nama: string; satuan: string }[]>(`/api/perbandingan/barang?${new URLSearchParams({ module, search })}`),

  pinjamanList: (params: Record<string, string | number>) =>
    req<{ data: Pinjaman[]; total: number }>(`/api/pinjaman?${new URLSearchParams(params as any)}`),
  pinjamanBarang: (module: OpnameModule, estate: string, search: string) =>
    req<PinjamanBarang[]>(`/api/pinjaman/barang?${new URLSearchParams({ module, estate, search })}`),
  // jenis TRANSFER: sent for good, may be dated back (tanggal_iso); a loan is booked today.
  evidenceMeta: (id: string) => req<{ rotation: number }>(`/api/evidence/${id}/meta`),
  saveEvidenceRotation: (id: string, rotation: number) =>
    req<{ success: boolean }>(`/api/evidence/${id}/rotation`, { method: "POST", body: JSON.stringify({ rotation }) }),
  createPinjaman: (payload: {
    evidence_id: string;
    module: OpnameModule;
    dari: string;
    ke: string;
    kode: string;
    qty: number;
    alasan: string;
    jenis?: "PINJAM" | "TRANSFER";
    tanggal_iso?: string;
  }) =>
    req<{ success: boolean; id: number }>("/api/pinjaman", { method: "POST", body: JSON.stringify(payload) }),
  kembalikanPinjaman: (id: number, qty: number, note: string, evidence_id: string) =>
    req<{ success: boolean }>(`/api/pinjaman/${id}/kembali`, { method: "POST", body: JSON.stringify({ qty, note, evidence_id }) }),

  // Foto bukti: a data URL (already shrunk, see lib/evidence.ts) -> the id a transaction refers to.
  uploadEvidence: (data: string) => req<{ id: string }>("/api/evidence", { method: "POST", body: JSON.stringify({ data }) }),
  batalPinjaman: (id: number, note: string) =>
    req<{ success: boolean }>(`/api/pinjaman/${id}/batal`, { method: "POST", body: JSON.stringify({ note }) }),
  // Superuser only, a Dibatalkan / Lunas loan: removed with its movement rows in both estates.
  deletePinjaman: (id: number, catatan: string) =>
    req<{ success: boolean }>(`/api/pinjaman/${id}/delete`, { method: "POST", body: JSON.stringify({ catatan }) }),

  opnameList: (params: Record<string, string | number>) =>
    req<{ data: OpnameListRow[]; total: number; page: number; pageSize: number }>(
      `/api/stock-opname?${new URLSearchParams(params as any)}`
    ),
  createOpname: (payload: { module: OpnameModule; estate: string; tanggal: string; catatan?: string }) =>
    req<{ success: boolean; id: number }>("/api/stock-opname", { method: "POST", body: JSON.stringify(payload) }),
  opname: (id: number) => req<{ opname: Opname; lines: OpnameLine[] }>(`/api/stock-opname/${id}`),
  saveOpname: (id: number, payload: { catatan?: string; lines: { id: number; stok_fisik: number | null; keterangan: string; exp_fisik?: string | null }[] }) =>
    req<{ success: boolean; adjusted?: number }>(`/api/stock-opname/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  addOpnameLine: (id: number, kode: string, exp = "") =>
    req<OpnameLine>(`/api/stock-opname/${id}/lines`, { method: "POST", body: JSON.stringify({ kode, exp }) }),
  deleteOpnameLine: (id: number, lineId: number) => req<{ success: boolean }>(`/api/stock-opname/${id}/lines/${lineId}`, { method: "DELETE" }),
  // Superuser only; an approved opname's corrections are booked back first.
  deleteOpname: (id: number, catatan: string, keep_stock = false) =>
    req<{ success: boolean; undone: number }>(`/api/stock-opname/${id}/delete`, { method: "POST", body: JSON.stringify({ catatan, keep_stock }) }),
  opnameAction: (id: number, action: "submit" | "return" | "approve" | "cancel", catatan = "") =>
    req<{ success: boolean; corrected?: number }>(`/api/stock-opname/${id}/${action}`, { method: "POST", body: JSON.stringify({ catatan }) }),
};
