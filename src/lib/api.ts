export type AuthUser = {
  id: number;
  username: string;
  nama: string;
};

export type UserAccount = {
  id: number;
  username: string;
  nama: string;
  created_at: string;
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

export type BbmRecord = {
  id: number;
  jenis_bbm: "SOLAR" | "BENSIN";
  lokasi: string;
  estate: string | null;
  periode: string;
  tanggal: string;
  tanggal_iso: string | null;
  no_spb: string;
  stock_awal: number | null;
  diterima: number | null;
  pinjam: number | null;
  pemakaian: number | null;
  saldo_stock: number | null;
  keterangan: string;
  status_kepemilikan: string | null;
  kode_kendaraan: string | null;
  hm_terakhir: string | null;
};

export type BbmSummary = {
  perLokasi: { jenis_bbm: string; lokasi: string; diterima: number; pemakaian: number }[];
  saldoTerakhir: { jenis_bbm: string; lokasi: string; saldo_stock: number; tanggal: string; tanggal_iso: string }[];
};

export type Movement = {
  id: number;
  date: string | null;
  dateDisplay: string;
  type: "IN" | "OUT";
  source: "STOCK_IN" | "STOCK_OUT" | "MANUAL";
  tujuan: string | null;
  qty: number;
  satuan: string | null;
  note: string | null;
  ref: string | null;
  refCode: string | null;
};

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export const api = {
  login: (username: string, password: string) =>
    req<{ user: AuthUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  logout: () => req<{ success: boolean }>("/api/auth/logout", { method: "POST" }),

  me: () => req<{ user: AuthUser }>("/api/auth/me"),

  summary: () => req<Summary>("/api/summary"),

  satuanOptions: () => req<string[]>("/api/satuan-options"),

  items: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: Item[]; total: number; page: number; pageSize: number }>(`/api/items?${qs}`);
  },

  item: (id: number) => req<Item & { transactions: Transaction[] }>(`/api/items/${id}`),

  itemMovements: (id: number) => req<{ data: Movement[] }>(`/api/items/${id}/movements`),

  createTransaction: (payload: {
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

  updateItem: (id: number, payload: { nama: string; satuan: string; buffer_stock: number }) =>
    req<{ success: boolean }>(`/api/items/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  updateTransaction: (
    id: number,
    payload: { tujuan?: string; type: "IN" | "OUT"; qty: number; note?: string; penerima?: string }
  ) => req<{ success: boolean }>(`/api/transactions/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteTransaction: (id: number) => req<{ success: boolean }>(`/api/transactions/${id}`, { method: "DELETE" }),

  updateStockIn: (
    id: number,
    payload: { nama_vendor: string; qty: number; satuan: string; tujuan: string | null; tanggal_terima_iso: string | null; keterangan: string }
  ) => req<{ success: boolean }>(`/api/stock-in/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteStockIn: (id: number) => req<{ success: boolean }>(`/api/stock-in/${id}`, { method: "DELETE" }),

  updateStockOut: (
    id: number,
    payload: { penerima: string; qty: number; satuan: string; tujuan: string | null; tanggal_keluar_iso: string | null; keterangan: string }
  ) => req<{ success: boolean }>(`/api/stock-out/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteStockOut: (id: number) => req<{ success: boolean }>(`/api/stock-out/${id}`, { method: "DELETE" }),

  karyawan: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: Karyawan[]; total: number; page: number; pageSize: number }>(`/api/karyawan?${qs}`);
  },

  karyawanStatusOptions: () => req<string[]>("/api/karyawan/status-options"),

  karyawanEstateOptions: () => req<string[]>("/api/karyawan/estate-options"),

  updateKaryawan: (
    id: number,
    payload: { nik: string; nama: string; status: string; estate: string; lokasi_kerja: string; nik_ktp: string }
  ) => req<{ success: boolean }>(`/api/karyawan/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  alatBerat: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: AlatBerat[]; total: number; page: number; pageSize: number }>(`/api/alat-berat?${qs}`);
  },

  alatBeratJenisOptions: () => req<string[]>("/api/alat-berat/jenis-options"),

  updateAlatBerat: (id: number, payload: { kode: string; jenis_unit: string; nama: string }) =>
    req<{ success: boolean }>(`/api/alat-berat/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  bbmSummary: () => req<BbmSummary>("/api/bbm/summary"),

  bbmLokasiOptions: () => req<string[]>("/api/bbm/lokasi-options"),

  bbmEstateOptions: (jenis_bbm: string, lokasi: string) =>
    req<string[]>(`/api/bbm/estate-options?${new URLSearchParams({ jenis_bbm, lokasi }).toString()}`),

  bbm: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: BbmRecord[]; total: number; pemakaianSum: number; diterimaSum: number; page: number; pageSize: number }>(
      `/api/bbm?${qs}`
    );
  },

  createBbmTransaction: (payload: {
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
    }
  ) => req<{ success: boolean }>(`/api/bbm/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteBbm: (id: number) => req<{ success: boolean }>(`/api/bbm/${id}`, { method: "DELETE" }),

  users: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: UserAccount[]; total: number; page: number; pageSize: number }>(`/api/users?${qs}`);
  },

  createUser: (payload: { username: string; password: string; nama: string }) =>
    req<{ success: boolean; id: number }>("/api/users", { method: "POST", body: JSON.stringify(payload) }),

  updateUser: (id: number, payload: { username: string; nama: string; password?: string }) =>
    req<{ success: boolean }>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteUser: (id: number) => req<{ success: boolean }>(`/api/users/${id}`, { method: "DELETE" }),
};
