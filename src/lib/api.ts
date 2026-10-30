export type Role = "superuser" | "estate";
export const ESTATES = ["NILAM", "FIRUS", "ZAMRUD", "KNS", "WJA"] as const;
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
  // Until when it may edit (not delete) earlier months' transactions; null = only the current month.
  editLampauUntil?: string | null;
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
  // Edit bulan lalu (edit only) until this moment; null = none.
  edit_lampau_until?: string | null;
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
  // When it was typed, if later than created_at (the day it happened); null on older rows.
  input_at?: string | null;
  evidence_id?: string | null;
  kode: string;
  nama: string;
  satuan: string;
  input_oleh: string;
  // One item's Riwayat only: its stock after this movement.
  saldo?: number | null;
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
  // Bahan habis pakai (Hypafix, kasa gulung): stock is cut per roll / pack when opened, a terapi of it never cuts stock.
  bhp: boolean;
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
// A batch past its expiry date that still holds stock (Klinik > Expired & Rusak).
export type KlinikExpiredBatch = { kode: string; nama: string; satuan: string; expired_date: string; qty: number };
// Obat / BHP pulled out (expired / rusak / retur) and its check by a second account; status null = thrown away before the check.
export type KlinikTarik = {
  id: number;
  created_at: string;
  kode: string;
  nama: string;
  satuan: string;
  qty: number;
  alloc: { exp: string; qty: number }[] | null;
  note: string | null;
  alasan: string | null;
  status: "MENUNGGU" | "DISETUJUI" | "DITOLAK" | null;
  evidence_id: string | null;
  user_id: number | null;
  oleh: string;
  diperiksa_nama: string | null;
  diperiksa_at: string | null;
  diperiksa_catatan: string;
};

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
  // Stock of the item right after this row (null = imported history, no movement of its own).
  saldo?: number | null;
  created_at?: string | null;
  // When the row was typed (a back-dated entry's created_at holds its chosen date).
  input_at?: string | null;
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
  saldo?: number | null;
  created_at?: string | null;
  // When the row was typed (a back-dated entry's created_at holds its chosen date).
  input_at?: string | null;
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

// Master Blok: one row of the estate block sheet (a blok may have several rows, see schema.sql).
export type Blok = {
  id: number;
  estate: string;
  divisi: string;
  blok: string;
  planting_material: string;
  tahun_tanam: number | null;
  ha: number | null;
  sph: number | null;
  pkk: number | null;
  urut: number;
};
export type BlokInput = Omit<Blok, "id" | "urut">;
// Peta Blok: one box of the block map (kind 'label' = an estate name on the map) with its Master
// Blok figures and the pupuk out to it in the period; null figures = another estate / not in Master Blok.
export type PetaCell = {
  id: number;
  kind: "blok" | "label";
  label: string;
  gx: number;
  gy: number;
  h: number;
  estate: string | null;
  warna: string | null;
  divisi: string | null;
  tahun_tanam: string | null;
  planting_material: string | null;
  ha: number | null;
  pkk: number | null;
  kg: number | null;
  terakhir: string | null;
};
export type PetaLegend = { id: number; dari: number; label: string; warna: string };
export type PetaBlok = { estates: string[]; cells: PetaCell[]; legend: PetaLegend[]; pruningLegend: PetaLegend[] };
// Pruning per blok for one year (Kebun > Pruning). target = Ha x SPH (target_sumber: the blok's own
// pruning target or its Master Blok), pkk / ha_pruning = pruned that year, bulan / ha_bulan = per
// month, terakhir = date of the last pruning in any year (the old sheet's months are on the 1st).
export type PruningBlok = {
  estate: string;
  blok: string;
  divisi: string | null;
  ha: number | null;
  sph: number | null;
  target: number | null;
  target_sumber: "pruning" | "master";
  pkk: number;
  ha_pruning: number;
  bulan: number[];
  ha_bulan: number[];
  terakhir: string | null;
  entri: number;
};
export type PetaPruning = { tahun: number; tahunList: number[]; blok: PruningBlok[] };
export type PruningLog = {
  id: number;
  estate: string;
  blok: string;
  tanggal_iso: string;
  pkk: number;
  ha: number;
  keterangan: string;
  sumber: "app" | "sheet";
  user_id: number | null;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  baris_id: number | null;
  tahun_tanam: number | null;
  divisi: string | null;
  dua_baris: boolean;
};
// The Rekap Pruning rows, the sheet's BLOCK DETAIL row for row; bulan = "yyyy-mm" -> [pokok, Ha] pruned.
export type PruningRekapBaris = {
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
  bulan: Record<string, [number, number]>;
  terakhir: string | null;
};
export type PruningRekapData = { tahunAwal: number; tahunAkhir: number; sekarang: number; baris: PruningRekapBaris[] };
// Permintaan Obat (Klinik): saran from the stock, the requests and their items.
export type PermintaanSaran = {
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
  rata_bulan: number;
  cukup_bulan: number | null;
  satuan_minta: string;
  saran: number;
  urgensi: PermintaanUrgensi;
  stok_text: string;
};
export type PermintaanUrgensi = "HIGH" | "MEDIUM" | "LOW";
export type PermintaanLineStatus = "MENUNGGU" | "APPROVED" | "SEBAGIAN" | "DITOLAK";
export type PermintaanOrang = { nama: string; jabatan: string };
export type PermintaanTtdOleh = { nama: string; jabatan: string; user_id?: number; at: string };
export type PermintaanMenunggu = Pick<Permintaan, "id" | "klinik" | "nomor" | "tanggal" | "periode" | "departemen" | "created_by" | "diajukan_at" | "approval" | "ttd"> & {
  items: number;
  high: number;
  // The unsigned boxes this account may sign (any order).
  bisa: (keyof PermintaanTtd)[];
};
export type PermintaanTtd = { dibuat: PermintaanOrang; diketahui: PermintaanOrang; disetujui1: PermintaanOrang; disetujui2: PermintaanOrang };
export type PermintaanLine = {
  id?: number;
  obat_kode: string | null;
  nama: string;
  satuan: string;
  jumlah: number;
  urgensi: PermintaanUrgensi;
  stok: number | null;
  stok_text: string;
  keterangan: string;
  status?: PermintaanLineStatus;
  // Why Sebagian / Ditolak; how much was approved (all, 0, or the Sebagian amount); who set it last and when.
  alasan?: string;
  disetujui?: number | null;
  approval_oleh?: string | null;
  approval_at?: string | null;
  // The rank of who decided it (0 Approve, 1 Finance, 2 GM, 3 Head, 4 Super User); only that rank or higher changes it.
  approval_level?: number;
  dipenuhi?: number | null;
  tanggal_pemenuhan?: string | null;
};
export type Permintaan = {
  id: number;
  klinik: string;
  nomor: string;
  tanggal: string;
  periode: string;
  departemen: string;
  // DIAJUKAN = sent, being signed box by box; DISETUJUI = all four signed, its items can be approved / fulfilled.
  status: "DRAFT" | "DIAJUKAN" | "DISETUJUI";
  catatan: string;
  ttd: PermintaanTtd;
  approval: Partial<Record<keyof PermintaanTtd, PermintaanTtdOleh>>;
  // The last refusal (sent back to the klinik as a draft).
  tolak: (PermintaanTtdOleh & { level: keyof PermintaanTtd; alasan: string }) | null;
  created_by: string;
  created_at: string;
  diajukan_at: string | null;
  lines: PermintaanLine[];
};
export type PermintaanRingkas = Omit<Permintaan, "ttd" | "lines"> & { items: number; approved: number; sebagian: number; ditolak: number; terpenuhi: number; high: number };
export type PermintaanRekapRow = {
  id: number;
  permintaan_id: number;
  nomor: string;
  tanggal: string;
  klinik: string;
  nama: string;
  satuan: string;
  jumlah: number;
  urgensi: PermintaanUrgensi;
  status: PermintaanLineStatus;
  alasan: string;
  disetujui: number | null;
  dipenuhi: number | null;
  tanggal_pemenuhan: string | null;
  keterangan: string;
  stok_text: string;
};
export type PermintaanInput = { klinik?: string; tanggal: string; periode: string; departemen: string; catatan: string; ttd: PermintaanTtd; lines: PermintaanLine[]; ajukan: boolean };
// Lengkapi Data: a month's transactions still missing a field the form asks for / a foto bukti.
export type LengkapiKind = "bbm" | "pupuk" | "oli" | "gudang" | "klinik" | "nilam_masuk" | "nilam_keluar";
export type LengkapiRow = {
  id: number;
  tanggal_iso: string;
  jenis: string | null;
  sub: string | null;
  masuk: number | null;
  keluar: number | null;
  evidence_id: string | null;
  kurang: string[];
  berlaku: string[];
  [field: string]: unknown;
};
// options: the choices of a field (as the input form offers them); pilihan: the fields that take only those.
export type LengkapiList = {
  fields: { key: string; label: string; type: "text" | "number" }[];
  foto: boolean;
  rows: LengkapiRow[];
  totalBulan: number;
  options?: Record<string, string[]>;
  pilihan?: string[];
};
export type PruningImportRow = {
  row: number;
  estate: string;
  blok: string;
  tanggal_iso: string;
  pkk: number;
  ha: number;
  keterangan: string;
  status: "ok" | "duplikat" | "error";
  error?: string;
};
// baris = the blok's Rekap rows (two when planted in two years / divisi); empty for a Master Blok one not in the Rekap yet.
export type PruningBlokOption = {
  estate: string;
  blok: string;
  divisi: string | null;
  ha: number | null;
  sph: number | null;
  sumber: "pruning" | "master";
  baris: { id: number; divisi: string; tahun_tanam: number | null; ha: number | null; sph: number | null }[];
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
  beban?: string;
  // Nilam: another estate = sent into its stock, booked as a Transfer.
  ke?: string;
  // The row's own foto bukti (Input Banyak: one per row, optional).
  evidence_id?: string;
};

export type BbmRecord = {
  id: number;
  jenis_bbm: "SOLAR" | "BENSIN" | "BENSIN_CAMPUR" | "EMERGENCY" | "JATAH_GM";
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
  // OPEX / CAPEX of a Stock Out ('' = not marked).
  beban?: string;
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
// estates: where the jenis is used, comma separated ('' = every estate).
export type MasterOli = { id: number; kode: string; nama: string; satuan: string; keterangan: string; estates: string; transaksi: number };
export type MasterPupuk = { id: number; kode: string; nama: string; keterangan: string; estates: string; transaksi: number };
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
  module: "BARANG" | "BBM" | "PUPUK" | "KLINIK" | "OLI" | "KOPERASI" | "KENDARAAN" | "PRUNING" | "SOP";
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
export type PakaiModule = "GUDANG" | "BBM" | "PUPUK" | "OLI";
export type PakaiPer = "hari" | "minggu" | "bulan";
// Status Update: the latest date with data per module + estate, days since then and the module's limit.
export type StatusUpdate = {
  today: string;
  limits: Record<string, number>;
  data: { modul: string; estate: string; terakhir: string | null; hari: number | null; batas: number }[];
};

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
  // PRIBADI = borrowed from a karyawan (their own BBM): dari_estate is "PRIBADI", pemberi says who
  jenis: "PINJAM" | "TRANSFER" | "PRIBADI";
  pemberi?: string;
  alasan: string;
  tanggal_iso: string;
  created_at: string;
  dibuat_oleh: string;
  evidence_id: string | null;
  kembali: { qty: number; tanggal_iso: string; created_at?: string | null; note: string; batal: boolean; oleh: string; evidence_id: string | null }[];
};
// ---- Koperasi karyawan (Nilam) ----
export type KopBarang = {
  kode: string;
  nama: string;
  // Expiry of the stock on hand (nearest; null = none) and a free note.
  exp_iso: string | null;
  catatan: string;
  // The stock on hand per tanggal expired (Stock In arrivals, FEFO; then the barang's own date), nearest first.
  exp_batches: { exp: string; qty: number }[];
  exp_terdekat: string | null;
  satuan: string;
  harga_jual: number;
  harga_beli: number;
  // Air galon of the depots (Depo Air): sold, no stock.
  depo_air?: boolean;
  stok_min: number;
  lacak_stok: boolean;
  aktif: boolean;
  stok: number;
  terakhir: string | null;
};
// Permintaan Barang Koperasi: one request (the order list sent to purchasing) and its lines. masuk = Tgl Masuk: typed,
// else the first Stock In of the kode on / after the request's tanggal (null = not in yet).
export type KopPermintaanOrang = { nama: string; jabatan: string };
export type KopPermintaanTtd = { dibuat: KopPermintaanOrang; diketahui: KopPermintaanOrang };
export type KopPermintaanLine = { barang_kode: string | null; nama: string; jenis: string; jumlah: number; satuan: string; isi: number | null; tgl_masuk: string | null; masuk?: string | null };
// Signed in the app: DRAFT -> DIAJUKAN (Dibuat oleh signed) -> DISETUJUI (HR signed Diketahui oleh) / DITOLAK (with the alasan).
export type KopPermintaanStatus = "DRAFT" | "DIAJUKAN" | "DISETUJUI" | "DITOLAK";
export type KopPermintaanCap = { user_id: number; nama: string; at: string };
export type KopPermintaanSign = {
  status: KopPermintaanStatus;
  approval: { dibuat?: KopPermintaanCap; diketahui?: KopPermintaanCap };
  tolak: (KopPermintaanCap & { alasan: string }) | null;
};
export type KopPermintaan = KopPermintaanSign & { id: number; nomor: string; tanggal: string; catatan: string; ttd: Partial<KopPermintaanTtd>; created_by: string; lines: (KopPermintaanLine & { id?: number })[] };
export type KopPermintaanRow = KopPermintaanSign & { id: number; nomor: string; tanggal: string; catatan: string; created_by: string; item: number; masuk: number };
export type KopAnggota = {
  kode: string;
  jenis: "KARYAWAN" | "INSTANSI";
  nama: string;
  jabatan: string;
  estate: string;
  divisi: string;
  aktif: boolean;
  catatan: string;
  di_master: boolean;
  baru?: boolean;
  n_bon?: number;
  terakhir?: string | null;
  total_bulan_ini?: number;
};
export type KopBayar = "POTONG_GAJI" | "TUNAI" | "INSTANSI";
export type KopTx = {
  id: number;
  jenis: "JUAL" | "BELI" | "RUSAK" | "KOREKSI";
  tanggal_iso: string;
  periode: string;
  bon: string | null;
  barang_kode: string;
  barang_nama: string;
  satuan: string;
  qty: number;
  harga: number;
  total: number;
  anggota_kode: string | null;
  anggota_nama: string | null;
  anggota_jenis: string | null;
  bayar: KopBayar;
  no_po: string;
  keterangan: string;
  evidence_id: string | null;
  sumber: string | null;
  created_at: string;
  oleh: string;
  user_id: number | null;
  opname_id: number | null;
  // Barang Rusak / Expired and Koreksi Stok: alasan and the check by a second account (status null = before the check existed).
  alasan: string | null;
  status: "MENUNGGU" | "DISETUJUI" | "DITOLAK" | null;
  diperiksa_nama: string | null;
  diperiksa_at: string | null;
  diperiksa_catatan: string;
};
// Depo Air (Koperasi): the monthly report of one depot (or both).
export type DepoLaporan = {
  dari: string;
  sampai: string;
  periode: string;
  depo: string;
  harga: number;
  ringkas: { galon: number; pendapatan: number; pelanggan: number; transaksi: number };
  perBayar: { bayar: string; galon: number; total: number }[];
  perDivisi: { divisi: string; galon: number; total: number; orang: number }[];
  perHari: { tanggal: string; galon: number; orang: number }[];
  perMinggu: { minggu: number; dari: number; sampai: number; galon: number; hari: number }[];
  top: { kode: string; nama: string | null; divisi: string | null; galon: number; total: number }[];
  // The months of the range; tren12 = the 12 months up to its end (on-screen trend only).
  perBulan: { periode: string; galon: number; pendapatan: number; pelanggan: number; biaya: number }[];
  tren12: { periode: string; galon: number; pendapatan: number; pelanggan: number; biaya: number }[];
  // The range of the same length just before, to compare.
  sebelum: { dari: string; sampai: string; galon: number; pendapatan: number; pelanggan: number; biaya: number };
  biaya: { id: number; depo: string; tanggal_iso: string; kategori: string; keterangan: string; jumlah: number; evidence_id: string | null; oleh: string }[];
  kategori: Record<string, string>;
};

// Chat: a room of the account (DM, estate room, group) and a message.
export type ChatRoom = {
  id: number;
  jenis: "DM" | "ESTATE" | "GRUP";
  estate: string | null;
  nama: string;
  lawan_id: number | null;
  lawan_online: boolean | null;
  last_id: number | null;
  last_isi: string | null;
  last_foto: boolean | null;
  last_at: string | null;
  last_nama: string | null;
  last_saya: boolean | null;
  unread: number;
  n_member: number;
};
export type ChatMessage = { id: number; user_id: number; nama: string; isi: string; evidence_id: string | null; link_url: string | null; link_label: string | null; created_at: string };

// Berita Acara Pemusnahan (Klinik / Koperasi): the stored document and its approval (capture WA) and closing.
export type BeritaAcara = {
  id: number;
  modul: "KLINIK" | "KOPERASI";
  unit: string;
  nomor: string;
  tanggal: string;
  isian: Record<string, any>;
  items: { id: number; nama: string; kode: string; tgl: string; qty: number; satuan: string; alasan: string; keterangan: string; info: string; nilai?: number }[];
  status: "MENUNGGU" | "DISETUJUI" | "SELESAI" | "BATAL";
  created_at: string;
  dibuat_nama: string;
  disetujui_nama: string;
  disetujui_jabatan: string;
  disetujui_tgl: string | null;
  evidence_id: string | null;
  selesai_tgl: string | null;
  selesai_catatan: string;
  foto_musnah: string | null;
  batal_alasan: string;
  // Signed in the app (a BA made before it has {}): pj when made, mengetahui on approval, the rest at the destruction.
  ttd: Partial<Record<BaPeran, BaTtd>>;
};
export type BaPeran = "pj" | "pelaksana" | "saksi1" | "saksi2" | "mengetahui";
// AKUN = signed by the account (user_id); LAYAR = drawn on the screen (gambar, PNG data URL), entered by input_nama;
// WA = the manager answered YA on WhatsApp (tanggal), recorded by input_nama with the capture.
export type BaTtd = { cara: "AKUN" | "LAYAR" | "WA"; nama: string; jabatan: string; at: string; user_id?: number; gambar?: string; input_nama?: string; tanggal?: string };

// Kendaraan & Alat Berat: one unit (see schema.sql kendaraan_unit) and a cell of the kondisi harian.
export type KdUnit = {
  id: number;
  pt: string;
  kode: string;
  id_unit: string;
  status: "INTERNAL" | "EKSTERNAL";
  grup: string;
  jenis: string;
  nama: string;
  kepemilikan: string;
  tgl_perolehan: string | null;
  pemilik: string;
  alokasi: string;
  info: string;
  kondisi: "" | "BAIK" | "RUSAK" | "STANDBY" | "MANGKRAK";
  tgl_rusak: string | null;
  tgl_selesai: string | null;
  keterangan: string;
  operator: string;
  aktif: boolean;
  updated_at: string;
};
// A day of a unit: kondisi, and where / on what it works (the Rencana Kerja Harian).
export type KdHarian = { unit_id: number; tanggal: string; kondisi: "R" | "S" | "B"; lokasi: string; pekerjaan: string };
export type KdUnitInput = Omit<KdUnit, "id" | "pt" | "updated_at">;

export type KopRingkasan = {
  periode: string;
  jual: number;
  potong_gaji: number;
  tunai: number;
  instansi: number;
  anggota: number;
  beli: number;
  nilai_stok: number;
  menipis: number;
};
export type KopRekap = KopAnggota & { n_bon: number; dari: string; sampai: string; potong_gaji: number; tunai: number; instansi: number; total: number; dibayar: number };
export type KopTunggakan = { kode: string; nama: string; jabatan: string; divisi: string; sisa: number; periode: string[] };
export type DokKategori = "LAPORAN" | "SOP" | "FORM" | "REKAP" | "KONTRAK" | "LAINNYA";
export type Dokumen = {
  id: number;
  judul: string;
  url: string;
  kategori: DokKategori;
  modul: string;
  estate: string;
  keterangan: string;
  pic: string;
  pinned: boolean;
  oleh: string | null;
  user_id: number | null;
  // dikunci: only a Kelola semua account changes it; boleh_ubah: whether this account may change / delete it.
  dikunci: boolean;
  boleh_ubah: boolean;
  created_at: string;
  updated_at: string;
};
export type SopStatus = "BELUM" | "DRAFT" | "BERLAKU" | "REVISI";
export type Sop = {
  id: number;
  bagian: string;
  urut: number;
  judul: string;
  audit: boolean;
  no_dokumen: string;
  revisi: string;
  tgl_berlaku: string;
  pic: string;
  status: SopStatus;
  url: string;
  keterangan: string;
  oleh: string | null;
  // dikunci: only an account with Kunci Daftar SOP changes it; boleh_ubah: whether this account may change / delete it.
  dikunci: boolean;
  boleh_ubah: boolean;
  // ada_isi: written in the app (the list); isi and nomor (its place in the bagian) come with one SOP.
  ada_isi?: boolean;
  isi?: SopIsi;
  nomor?: number;
  updated_at: string;
};
export type SopIsi = Partial<
  Record<
    | "tujuan"
    | "ruang_lingkup"
    | "referensi"
    | "definisi"
    | "tanggung_jawab"
    | "prosedur"
    | "rekaman"
    | "lampiran"
    | "disusun_nama"
    | "disusun_jabatan"
    | "diperiksa_nama"
    | "diperiksa_jabatan"
    | "disetujui_nama"
    | "disetujui_jabatan",
    string
  >
>;
export type SopInput = Pick<Sop, "bagian" | "judul" | "audit" | "no_dokumen" | "revisi" | "tgl_berlaku" | "pic" | "status" | "url" | "keterangan">;
export type DokumenInput = Pick<Dokumen, "judul" | "url" | "kategori" | "modul" | "estate" | "keterangan" | "pic" | "pinned">;
export type KopSlipLine = { anggota_kode: string; tanggal_iso: string; bon: string | null; barang_kode: string; barang_nama: string; satuan: string; qty: number; harga: number; total: number; bayar: string };
export type KopCara = "POTONG_GAJI" | "TUNAI" | "LAINNYA";
export type KopTagihan = { kode: string; periode: string; tagihan: number; dibayar: number; sisa: number; jatuh_tempo: string };
export type KopBayarRow = { id: number; jumlah: number; tanggal_iso: string; cara: KopCara; keterangan: string; sumber: string | null; created_at: string; oleh: string };
export type KopDashboard = {
  dari: string;
  sampai: string;
  limit: number;
  kpi: { jual: number; bon: number; pengebon: number; potong_gaji: number; instansi: number; jenis_barang: number; beli: number };
  perBulan: { periode: string; jual: number; beli: number; pengebon: number }[];
  perHari: { tanggal: string; jual: number; orang: number }[];
  topBarang: { kode: string; nama: string; satuan: string; qty: number; nilai: number; orang: number }[];
  topPengebon: { kode: string; nama: string; jabatan: string; estate: string; divisi: string; total: number; bon: number; bulan: number }[];
  perDivisi: { grup: string; total: number; orang: number }[];
  perluBeli: { kode: string; nama: string; satuan: string; harga_beli: number; stok: number; rata: number }[];
  dekatLimit: { kode: string; nama: string; total: number }[];
};
export type KopOpname = {
  id: number;
  tanggal_iso: string;
  status: "DRAFT" | "SELESAI" | "BATAL";
  catatan: string;
  created_at: string;
  selesai_at: string | null;
  oleh: string;
  selesai_oleh_nama: string;
  n_barang?: number;
  dihitung?: number;
  n_selisih?: number | null;
  nilai_selisih?: number | null;
  // Counted blind: stok sistem hidden from this account while the opname is open.
  buta?: boolean;
  user_id?: number | null;
};
export type KopOpnameLine = { kode: string; nama: string; satuan: string; harga_beli: number; stok_sistem: number | null; fisik: number | null; keterangan: string };
export type KopLineInput = { barang_kode: string; qty: number; harga: number; exp_iso?: string };

export type PinjamanLogAksi = "PINJAM" | "TRANSFER" | "KEMBALI" | "LUNAS" | "BATAL";
export type PinjamanLog = {
  pinjaman_id: number;
  jenis?: "PINJAM" | "TRANSFER" | "PRIBADI";
  pemberi?: string;
  aksi: PinjamanLogAksi;
  qty: number;
  tanggal_iso: string;
  created_at: string;
  note: string;
  evidence_id: string | null;
  oleh: string;
  module: OpnameModule;
  kode: string;
  nama: string;
  satuan: string;
  dari_estate: string;
  ke_estate: string;
  qty_pinjam: number;
  tanggal_pinjam: string;
};
export type PinjamanRingkasan = { open: number; telat: number; lunas30: number; transfer30: number; rata_hari: number | null };
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
  // The count team, witness and stock holder (see schema.sql); hitung_buta hides stok sistem from the
  // counters until dibuka_at; disembunyikan = it is hidden from this account right now.
  tim: string;
  saksi: string;
  pemegang: string;
  // The same people one by one with their jabatan, and the account that approves ({} on older opnames).
  pihak: OpnamePihak | Record<string, never>;
  hitung_buta: boolean;
  dibuka_at: string | null;
  dibuka_oleh_nama: string | null;
  disembunyikan?: boolean;
};
export type OpnameOrang = { nama: string; jabatan: string };
export type OpnamePihak = { tim: OpnameOrang[]; saksi: OpnameOrang[]; pemegang: OpnameOrang; penyetuju: OpnameOrang & { user_id: number } };
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
  dihitung_oleh_nama: string | null;
  dihitung_at: string | null;
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
export type KunjunganObat = {
  obat_kode: string;
  nama_obat: string;
  qty: number | null;
  satuan: string;
  // List only: obat_kode is a master obat, and how much of it this visit took from the clinic's stock.
  master?: boolean;
  bhp?: boolean;
  terpotong?: number | null;
};
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
  // Before the clinic's last approved stok opname: its terapi don't move stock (the count has them).
  sebelum_opname?: boolean;
  evidence_id: string | null;
  created_at: string | null;
  created_by: string;
  // NIK (from the old Daily Report sheet; often empty for visits entered in the app).
  nik?: string;
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
  obat: { kode: string; nama: string; satuan: string; bhp: boolean; stok: number | null }[];
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
  if (e instanceof ApiError && e.status === 401 && e.serverMessage === "Not authenticated") return "Sesi login habis. Login ulang di jendela yang muncul, lalu tekan Simpan lagi - isian form tidak hilang.";
  if (e instanceof ApiError) return e.serverMessage || `${fallback} (kode ${e.status})`;
  if (e instanceof TypeError) return `${fallback}: koneksi ke server terputus, coba lagi`;
  return fallback;
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    // X-Page: the app page this request came from (Log Aktivitas User > Sedang online).
    headers: { "Content-Type": "application/json", "X-Page": window.location.pathname + window.location.search },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // The session ran out while the page was open: SessionExpiredModal asks to log in again on the spot.
    if (res.status === 401 && !url.startsWith("/api/auth/")) window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(res.status, typeof body?.error === "string" ? body.error : "", body);
  }
  return res.json();
}

export const api = {
  login: (username: string, password: string) =>
    req<{ user: AuthUser }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  logout: () => req<{ success: boolean }>("/api/auth/logout", { method: "POST" }),

  me: () => req<{ user: AuthUser }>("/api/auth/me"),
  chatRooms: () => req<ChatRoom[]>("/api/chat/rooms"),
  chatUnread: (after: number) => req<{ total: number; max: number; baru: { id: number; room_id: number; isi: string; foto: boolean; dari: string; room_nama: string | null }[] }>(`/api/chat/unread?after=${after}`),
  chatUsers: () => req<{ id: number; username: string; nama: string; role: string; estates: string | null; online: boolean }[]>("/api/chat/users"),
  chatDm: (user_id: number) => req<{ id: number }>("/api/chat/dm", { method: "POST", body: JSON.stringify({ user_id }) }),
  chatGrup: (nama: string, user_ids: number[]) => req<{ id: number }>("/api/chat/grup", { method: "POST", body: JSON.stringify({ nama, user_ids }) }),
  chatMessages: (room: number, after = 0, before = 0) =>
    req<{ messages: ChatMessage[]; reads: { user_id: number; last_read_id: number; nama: string }[] }>(`/api/chat/rooms/${room}/messages?after=${after}&before=${before}`),
  chatSend: (room: number, body: { isi: string; evidence_id?: string | null; link_url?: string | null; link_label?: string | null }) =>
    req<{ id: number }>(`/api/chat/rooms/${room}/messages`, { method: "POST", body: JSON.stringify(body) }),
  chatRead: (room: number, last_id: number) => req<{ success: boolean }>(`/api/chat/rooms/${room}/read`, { method: "POST", body: JSON.stringify({ last_id }) }),
  userOnline: () =>
    req<{ id: number; username: string; nama: string; role: string; estates: string | null; last_seen_at: string; last_page: string | null; online: boolean }[]>("/api/user-online"),

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
    // The day it happened when entered later (default today), see BACKDATE in app.ts.
    tanggal_iso?: string;
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

  stockCorrection: (payload: { tanggal_iso?: string; item_id: number; actual_qty: number; note?: string }) =>
    req<{ success: boolean; delta: number }>("/api/stock-correction", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  gudangPickItems: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: PickerItem[]; total: number; page: number; pageSize: number }>(`/api/gudang-stock/pick?${qs}`);
  },

  createGudangTransaction: (payload: {
    // The day it happened when entered later (default today), see BACKDATE in app.ts.
    tanggal_iso?: string;
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

  gudangStockCorrection: (payload: { tanggal_iso?: string; gudang: string; item_kode: string; actual_qty: number; note?: string }) =>
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
  // Konsumsi Obat: qty / patients per master obat per month from the Laporan Harian terapi, and stock now.
  konsumsiObat: (params: { klinik: string; dateFrom: string; dateTo: string; obat?: string }) =>
    req<{
      rows: { kode: string; nama: string; satuan: string; bhp: boolean; bulan: string; qty: number; pasien: number }[];
      totals: { pasien: number; tanpa_master: number; tanpa_qty: number };
      stok: { kode: string; stok: number }[];
      bulanData: string[];
    }>(`/api/klinik-laporan/konsumsi-obat?${new URLSearchParams({ ...params, obat: params.obat ?? "" })}`),
  // Konsumsi Obat detail: the visits that got one obat (in one month, or the whole period).
  konsumsiObatDetail: (params: { klinik: string; dateFrom: string; dateTo: string; obat: string; bulan?: string }) =>
    req<{
      data: {
        id: number;
        klinik: string;
        tanggal_iso: string;
        nama_pasien: string;
        jenis_kelamin: string;
        usia: number | null;
        status_pasien: string;
        jabatan: string;
        divisi: string;
        diagnosis: string;
        jenis_kunjungan: string;
        nama_obat: string;
        qty: number | null;
        satuan: string;
        bhp: boolean;
        sebelum_opname: boolean;
        terpotong: number | null;
      }[];
    }>(`/api/klinik-laporan/konsumsi-obat/detail?${new URLSearchParams({ ...params, bulan: params.bulan ?? "" })}`),
  // Superuser: typed terapi names of a clinic no master obat covers, and saving one as an alias of a master obat.
  obatBelumCocok: (klinik: string) =>
    req<{ opname: string; rows: { key: string; nama: string; satuan: string | null; baris: number; sejak_opname: number; terakhir: string }[] }>(
      `/api/klinik-laporan/obat-belum-cocok?${new URLSearchParams({ klinik })}`
    ),
  saveObatAlias: (nama: string, obat_kode: string) =>
    req<{ success: boolean; updated: number }>("/api/klinik-laporan/obat-alias", { method: "POST", body: JSON.stringify({ nama, obat_kode }) }),
  // Superuser: every visit since the last opname brought in line with its terapi (dryRun = only show).
  sinkronStokKunjungan: (klinik: string, dryRun: boolean) =>
    req<{
      dryRun: boolean;
      opname: string;
      checked: number;
      results: { id: number; tanggal_iso: string; nama_pasien: string; stok?: { kode: string; nama: string; qty: number; how: string }[]; error?: string }[];
    }>("/api/klinik-laporan/sinkron-stok", { method: "POST", body: JSON.stringify({ klinik, dryRun }) }),

  klinikPickItems: (params: Record<string, string | number>) => {
    const qs = new URLSearchParams(params as any).toString();
    return req<{ data: PickerItem[]; total: number; page: number; pageSize: number }>(`/api/klinik-stock/pick?${qs}`);
  },

  createKlinikTransaction: (payload: {
    // The day it happened when entered later (default today), see BACKDATE in app.ts.
    tanggal_iso?: string;
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

  klinikExpired: (klinik: string) => req<KlinikExpiredBatch[]>(`/api/klinik-stock/expired?${new URLSearchParams({ klinik })}`),
  klinikTarikList: (params: { klinik: string; status?: string; periode?: string }) =>
    req<KlinikTarik[]>(`/api/klinik-stock/tarik?${new URLSearchParams(params as Record<string, string>)}`),
  klinikTarik: (body: { klinik: string; obat_kode: string; qty: number; expired_date: string; alasan: string; note: string; evidence_id: string | null }) =>
    req<{ success: boolean }>("/api/klinik-stock/tarik", { method: "POST", body: JSON.stringify(body) }),
  klinikPeriksaTarik: (id: number, body: { setuju: boolean; catatan: string }) =>
    req<{ success: boolean }>(`/api/klinik-stock/tarik/${id}/periksa`, { method: "PUT", body: JSON.stringify(body) }),
  klinikBatches: (klinik: string, obat_kode: string) =>
    req<KlinikBatch[]>(`/api/klinik-stock/batches?${new URLSearchParams({ klinik, obat_kode })}`),

  // Without qty the whole batch moves to the date; with qty only that many (split off).
  updateKlinikBatch: (id: number, expired_date: string, qty?: number) =>
    req<{ success: boolean }>(`/api/klinik-stock/batch/${id}`, { method: "PUT", body: JSON.stringify({ expired_date, qty }) }),

  klinikStockCorrection: (payload: { tanggal_iso?: string; klinik: string; obat_kode: string; actual_qty: number; note?: string; expired_date?: string }) =>
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
    return req<{ data: LedgerTx[]; total: number; qtySum: number; inSum: number; outSum: number; page: number; pageSize: number }>(
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
  createMasterOli: (payload: { kode: string; nama: string; satuan: string; keterangan: string; estates: string[] }) =>
    req<{ success: boolean; id: number }>("/api/master-oli", { method: "POST", body: JSON.stringify(payload) }),
  updateMasterOli: (id: number, payload: { kode: string; nama: string; satuan: string; keterangan: string; estates: string[] }) =>
    req<{ success: boolean }>(`/api/master-oli/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteMasterOli: (id: number) => req<{ success: boolean }>(`/api/master-oli/${id}`, { method: "DELETE" }),
  masterPupuk: (search = "") => req<{ data: MasterPupuk[]; total: number }>(`/api/master-pupuk?${new URLSearchParams({ search })}`),
  createMasterPupuk: (payload: { kode: string; nama: string; keterangan: string; estates: string[] }) =>
    req<{ success: boolean; id: number }>("/api/master-pupuk", { method: "POST", body: JSON.stringify(payload) }),
  updateMasterPupuk: (id: number, payload: { kode: string; nama: string; keterangan: string; estates: string[] }) =>
    req<{ success: boolean }>(`/api/master-pupuk/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteMasterPupuk: (id: number) => req<{ success: boolean }>(`/api/master-pupuk/${id}`, { method: "DELETE" }),

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

  masterBlok: (params: Record<string, string | number>) =>
    req<{ data: Blok[]; total: number; totalHa: number; totalPkk: number; page: number; pageSize: number }>(
      `/api/master-blok?${new URLSearchParams(params as any)}`
    ),
  masterBlokOptions: () => req<{ estates: string[]; divisi: string[]; planting_material: string[]; tahun_tanam: number[] }>("/api/master-blok/options"),
  createBlok: (payload: BlokInput) => req<{ success: boolean; id: number }>("/api/master-blok", { method: "POST", body: JSON.stringify(payload) }),
  updateBlok: (id: number, payload: BlokInput) => req<{ success: boolean }>(`/api/master-blok/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteBlok: (id: number) => req<{ success: boolean }>(`/api/master-blok/${id}`, { method: "DELETE" }),
  petaBlok: (range: { dateFrom: string; dateTo: string }) => req<PetaBlok>(`/api/peta-blok?${new URLSearchParams(range)}`),
  petaBlokWarna: (ids: number[], warna: string | null) =>
    req<{ success: boolean }>("/api/peta-blok/warna", { method: "PUT", body: JSON.stringify({ ids, warna }) }),
  petaBlokLegend: (items: { dari: number; label: string; warna: string }[], jenis: "pupuk" | "pruning" = "pupuk") =>
    req<{ success: boolean }>("/api/peta-blok/legend", { method: "PUT", body: JSON.stringify({ items, jenis }) }),
  petaPruning: (tahun: number | null) => req<PetaPruning>(`/api/peta-blok/pruning?${new URLSearchParams(tahun ? { tahun: String(tahun) } : {})}`),
  pruningRekap: (estate: string) => req<PruningRekapData>(`/api/pruning/rekap?${new URLSearchParams({ estate })}`),
  pruningPerBlok: (tahun: number | null, estate: string) =>
    req<PetaPruning>(`/api/pruning/per-blok?${new URLSearchParams({ ...(tahun ? { tahun: String(tahun) } : {}), estate })}`),
  pruningBlokOptions: () => req<PruningBlokOption[]>("/api/pruning/blok-options"),
  pruningList: (params: Record<string, string | number>) =>
    req<{ rows: PruningLog[]; total: number; pkk: number; ha: number }>(
      `/api/pruning?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`
    ),
  pruningCreate: (payload: { estate: string; tanggal_iso: string; rows: { blok: string; baris_id?: number; pkk: number; ha: number; keterangan: string }[] }) =>
    req<{ success: boolean }>("/api/pruning", { method: "POST", body: JSON.stringify(payload) }),
  permintaanSaran: (klinik: string, bulan: number) => req<{ bulan: number; rows: PermintaanSaran[] }>(`/api/klinik-permintaan/saran?${new URLSearchParams({ klinik, bulan: String(bulan) })}`),
  permintaanList: (klinik: string) => req<{ rows: PermintaanRingkas[]; ttd: PermintaanTtd | null }>(`/api/klinik-permintaan?${new URLSearchParams({ klinik })}`),
  permintaanGet: (id: number) => req<Permintaan>(`/api/klinik-permintaan/${id}`),
  permintaanCreate: (payload: PermintaanInput) => req<{ success: boolean; id: number; nomor: string }>("/api/klinik-permintaan", { method: "POST", body: JSON.stringify(payload) }),
  permintaanUpdate: (id: number, payload: PermintaanInput) => req<{ success: boolean }>(`/api/klinik-permintaan/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  permintaanPemenuhan: (
    id: number,
    lines: { id: number; status: PermintaanLineStatus; alasan: string; disetujui: number | null }[]
  ) =>
    req<{ success: boolean; saved: number }>(`/api/klinik-permintaan/${id}/pemenuhan`, { method: "PUT", body: JSON.stringify({ lines }) }),
  permintaanMenunggu: () => req<{ rows: PermintaanMenunggu[] }>("/api/klinik-permintaan/menunggu"),
  permintaanTtd: (id: number, body: { level: string; aksi: "SETUJU" | "TOLAK"; alasan?: string }) =>
    req<{ success: boolean; status: Permintaan["status"] }>(`/api/klinik-permintaan/${id}/ttd`, { method: "POST", body: JSON.stringify(body) }),
  permintaanDelete: (id: number) => req<{ success: boolean }>(`/api/klinik-permintaan/${id}`, { method: "DELETE" }),
  permintaanRekap: (params: Record<string, string>) => req<{ rows: PermintaanRekapRow[] }>(`/api/klinik-permintaan-rekap?${new URLSearchParams(params)}`),
  lengkapiList: (kind: LengkapiKind, estate: string, bulan: string) => req<LengkapiList>(`/api/lengkapi/${kind}?${new URLSearchParams({ estate, bulan })}`),
  lengkapiSave: (kind: LengkapiKind, estate: string, bulan: string, rows: { id: number; values: Record<string, string>; evidence_id?: string }[]) =>
    req<{ success: boolean; saved: number; foto: number }>(`/api/lengkapi/${kind}`, { method: "PUT", body: JSON.stringify({ estate, bulan, rows }) }),
  pruningImport: (rows: { row: number; tanggal_iso: string; estate: string; blok: string; tahun_tanam?: number | null; pkk: number | null; ha: number | null; keterangan: string }[], dryRun: boolean) =>
    req<{ rows: PruningImportRow[]; ok: number; duplikat: number; error: number; saved: number }>("/api/pruning/import", {
      method: "POST",
      body: JSON.stringify({ rows, dryRun }),
    }),
  pruningUpdate: (id: number, payload: { blok: string; baris_id?: number | null; tanggal_iso: string; pkk: number; ha: number; keterangan: string }) =>
    req<{ success: boolean }>(`/api/pruning/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  pruningDelete: (id: number) => req<{ success: boolean }>(`/api/pruning/${id}`, { method: "DELETE" }),
  pruningBarisUpdate: (
    id: number,
    payload: { divisi: string; planting_material: string; tahun_tanam: number | null; ha: number | null; sph: number | null; kondisi: string; field_number: string }
  ) => req<{ success: boolean }>(`/api/pruning/baris/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

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
    return req<{ data: BbmRecord[]; total: number; pemakaianSum: number; diterimaSum: number; opexSum: number; capexSum: number; page: number; pageSize: number }>(
      `/api/bbm?${qs}`
    );
  },

  createBbmTransaction: (payload: {
    // Foto bukti (uploadEvidence) - required by the server.
    evidence_id: string;
    jenis_bbm: "SOLAR" | "BENSIN" | "BENSIN_CAMPUR" | "EMERGENCY" | "JATAH_GM";
    lokasi: string;
    tanggal_iso: string;
    tipe: "DITERIMA" | "PEMAKAIAN";
    jumlah: number;
    keterangan?: string;
    no_spb?: string;
    estate?: string;
    kode_kendaraan?: string;
    hm_terakhir?: string;
    beban?: string;
  }) => req<{ success: boolean; id: number; saldo_stock: number }>("/api/bbm", { method: "POST", body: JSON.stringify(payload) }),
  setBbmBeban: (id: number, beban: string) => req<{ success: boolean }>(`/api/bbm/${id}/beban`, { method: "PUT", body: JSON.stringify({ beban }) }),

  // Input Banyak (all rows or none; a refused row comes back as ApiError.data.row, 0-based).
  createNilamBatch: (payload: { tanggal_iso?: string; evidence_id: string; rows: { item_kode: string; type: "IN" | "OUT"; qty: number; tujuan: string; penerima: string; note: string; evidence_id?: string }[] }) =>
    req<{ success: boolean; count: number }>("/api/transactions/batch", { method: "POST", body: JSON.stringify(payload) }),
  createGudangBatch: (payload: {
    // The day it happened when entered later (default today), see BACKDATE in app.ts.
    tanggal_iso?: string;
    evidence_id: string;
    gudang: string;
    rows: { item_kode: string; type: "IN" | "OUT"; qty: number; tujuan: string; penerima: string; note: string; evidence_id?: string }[];
  }) => req<{ success: boolean; count: number }>("/api/gudang-stock/transactions/batch", { method: "POST", body: JSON.stringify(payload) }),
  createKlinikBatch: (payload: {
    // The day it happened when entered later (default today), see BACKDATE in app.ts.
    tanggal_iso?: string;
    evidence_id: string;
    klinik: string;
    rows: { obat_kode: string; type: "IN" | "OUT"; qty: number; expired_date: string; buang: boolean; penerima: string; ke?: string; note: string; evidence_id?: string }[];
  }) => req<{ success: boolean; count: number }>("/api/klinik-stock/transactions/batch", { method: "POST", body: JSON.stringify(payload) }),
  createPupukBatch: (payload: {
    evidence_id: string;
    estate: string;
    tanggal_iso: string;
    // ke: Nilam's keluar sent into another estate's stock (a Transfer).
    rows: { jenis_pupuk: string; tipe: "MASUK" | "KELUAR"; jumlah: number; divisi: string; blok: string; ha: number | ""; pokok: number | ""; keterangan: string; ke?: string; evidence_id?: string }[];
  }) => req<{ success: boolean; count: number }>("/api/pupuk/batch", { method: "POST", body: JSON.stringify(payload) }),
  createOliBatch: (payload: {
    evidence_id: string;
    estate: string;
    tanggal_iso: string;
    rows: { jenis_oli: string; tipe: "MASUK" | "PEMAKAIAN"; jumlah: number; no_embrace: string; keterangan: string; ke?: string; evidence_id?: string }[];
  }) => req<{ success: boolean; count: number }>("/api/oli/batch", { method: "POST", body: JSON.stringify(payload) }),
  createBbmBatch: (payload: { evidence_id: string; jenis_bbm: "SOLAR" | "BENSIN" | "BENSIN_CAMPUR" | "EMERGENCY" | "JATAH_GM"; lokasi: string; tanggal_iso: string; rows: BbmBatchRow[] }) =>
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
      beban?: string;
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
    payload: { username: string; nama: string; password?: string; role: Role; estates?: string[]; perms?: string[]; edit_lampau_until?: string | null }
  ) => req<{ success: boolean }>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  deleteUser: (id: number) => req<{ success: boolean }>(`/api/users/${id}`, { method: "DELETE" }),

  perbandingan: (params: { module: OpnameModule; estates: string[]; dateFrom: string; dateTo: string; kode: string }) =>
    req<Perbandingan>(`/api/perbandingan?${new URLSearchParams({ ...params, estates: params.estates.join(",") })}`),
  statusUpdate: () => req<StatusUpdate>("/api/status-update"),
  // Tambah Bukti: a foto bukti on an older transaction that has none (estates opened for it, see access.ts).
  attachEvidence: (kind: string, id: number, evidence_id: string) =>
    req<{ success: boolean }>("/api/evidence/attach", { method: "PUT", body: JSON.stringify({ kind, id, evidence_id }) }),
  // Pemakaian per bulan of one estate: Stok Keluar per barang / jenis (BBM: or per alat) per month, and stock now.
  // per: bulan (default) / minggu / hari - a row's bulan is then the period's key (YYYY-MM, a week's Monday or the day).
  pemakaian: (params: { module: PakaiModule; estate: string; dateFrom: string; dateTo: string; group?: string; per?: PakaiPer }) =>
    req<{
      rows: { kode: string; nama: string; satuan: string; info: string; bulan: string; qty: number; trx: number }[];
      stok: { kode: string; stok: number }[];
      mulai: string | null;
      awal?: string | null;
    }>(`/api/pemakaian?${new URLSearchParams({ ...params, group: params.group ?? "", per: params.per ?? "bulan" })}`),
  pemakaianDetail: (params: { module: PakaiModule; estate: string; dateFrom: string; dateTo: string; group?: string; per?: PakaiPer; kode: string; bulan?: string }) =>
    req<{ data: { id: number; tanggal_iso: string; ref: string; tujuan: string; penerima: string; ket: string; qty: number }[] }>(
      `/api/pemakaian/detail?${new URLSearchParams({ ...params, group: params.group ?? "", per: params.per ?? "bulan", bulan: params.bulan ?? "" })}`
    ),
  perbandinganBarang: (module: OpnameModule, search: string) =>
    req<{ kode: string; nama: string; satuan: string }[]>(`/api/perbandingan/barang?${new URLSearchParams({ module, search })}`),

  pinjamanList: (params: Record<string, string | number>) =>
    req<{ data: Pinjaman[]; total: number }>(`/api/pinjaman?${new URLSearchParams(params as any)}`),
  kopPeriode: () => req<string[]>("/api/koperasi/periode"),
  kopRingkasan: (periode: string) => req<KopRingkasan>(`/api/koperasi/ringkasan?periode=${periode}`),
  kopPermintaanList: () =>
    req<{ rows: KopPermintaanRow[]; ttd: Partial<KopPermintaanTtd> | null; terakhir: { kode: string; jenis: string; satuan: string; isi: number | null }[] }>("/api/koperasi/permintaan"),
  kopPermintaanGet: (id: number) => req<KopPermintaan>(`/api/koperasi/permintaan/${id}`),
  kopPermintaanSave: (id: number | null, body: { tanggal: string; catatan: string; ttd: KopPermintaanTtd; lines: KopPermintaanLine[]; ajukan?: boolean }) =>
    req<{ success: boolean; id: number; nomor: string }>(id ? `/api/koperasi/permintaan/${id}` : "/api/koperasi/permintaan", { method: id ? "PUT" : "POST", body: JSON.stringify(body) }),
  kopPermintaanMasuk: (id: number, lines: { id: number; tgl_masuk: string | null }[]) =>
    req<{ success: boolean }>(`/api/koperasi/permintaan/${id}/masuk`, { method: "PUT", body: JSON.stringify({ lines }) }),
  kopPermintaanSetujui: (id: number) => req<{ success: boolean }>(`/api/koperasi/permintaan/${id}/setujui`, { method: "POST", body: "{}" }),
  kopPermintaanTolak: (id: number, alasan: string) => req<{ success: boolean }>(`/api/koperasi/permintaan/${id}/tolak`, { method: "POST", body: JSON.stringify({ alasan }) }),
  kopPermintaanDelete: (id: number) => req<{ success: boolean }>(`/api/koperasi/permintaan/${id}`, { method: "DELETE" }),
  kopBarang: (params: { search?: string; aktif?: string } = {}) => req<KopBarang[]>(`/api/koperasi/barang?${new URLSearchParams(params as any)}`),
  kopKedatangan: (kode: string) =>
    req<{ id: number; tanggal_iso: string; qty: number; exp_iso: string | null; no_po: string; keterangan: string }[]>(`/api/koperasi/barang/${encodeURIComponent(kode)}/kedatangan`),
  kopKedatanganExp: (id: number, exp_iso: string) =>
    req<{ success: boolean }>(`/api/koperasi/kedatangan/${id}/exp`, { method: "PUT", body: JSON.stringify({ exp_iso }) }),
  kopSaveBarang: (kode: string | null, body: Partial<KopBarang>) =>
    req<{ kode?: string }>(kode ? `/api/koperasi/barang/${encodeURIComponent(kode)}` : "/api/koperasi/barang", { method: kode ? "PUT" : "POST", body: JSON.stringify(body) }),
  kopAnggota: (params: { search?: string; status?: string; jenis?: string } = {}) => req<KopAnggota[]>(`/api/koperasi/anggota?${new URLSearchParams(params as any)}`),
  kopPickAnggota: (search: string) => req<KopAnggota[]>(`/api/koperasi/anggota/pick?${new URLSearchParams({ search })}`),
  kopAddAnggota: (body: Partial<KopAnggota>) => req<{ kode: string }>("/api/koperasi/anggota", { method: "POST", body: JSON.stringify(body) }),
  kopSaveAnggota: (kode: string, body: Partial<KopAnggota>) => req<{ success: boolean }>(`/api/koperasi/anggota/${encodeURIComponent(kode)}`, { method: "PUT", body: JSON.stringify(body) }),
  baList: (modul: string, unit: string) => req<{ data: BeritaAcara[]; terpakai: number[] }>(`/api/berita-acara?${new URLSearchParams({ modul, unit })}`),
  baBuat: (body: { modul: string; unit: string; tanggal: string; isian: Record<string, any>; ref_ids: number[] }) =>
    req<{ id: number; nomor: string }>("/api/berita-acara", { method: "POST", body: JSON.stringify(body) }),
  // Who does each step of a Barang Rusak / Expired flow of a unit (from the accounts' ticks), see PetugasAlur.
  petugas: (modul: "KOPERASI" | "KLINIK", unit: string) =>
    req<{ input: string[]; approve: string[]; ba: string[]; pengganti: string[] }>(`/api/petugas?${new URLSearchParams({ modul, unit })}`),
  persetujuanJumlah: () => req<{ permintaan: number; ba: number; kop?: number; total: number }>("/api/persetujuan/jumlah"),
  // The manager's WhatsApp answer: YA (setuju) or TIDAK (tolak: true, with the alasan), its capture the proof.
  baSetuju: (id: number, body: { nama: string; jabatan: string; tanggal: string; evidence_id: string | null; tolak?: boolean; alasan?: string }) =>
    req<{ success: boolean }>(`/api/berita-acara/${id}/setuju`, { method: "PUT", body: JSON.stringify(body) }),
  baSelesai: (id: number, body: { tanggal: string; catatan: string; evidence_id: string | null }) =>
    req<{ success: boolean }>(`/api/berita-acara/${id}/selesai`, { method: "PUT", body: JSON.stringify(body) }),
  baMenunggu: () => req<{ data: BeritaAcara[] }>("/api/berita-acara/menunggu"),
  baPersetujuan: (id: number, body: { aksi: "SETUJU" | "TOLAK"; alasan?: string }) =>
    req<{ success: boolean }>(`/api/berita-acara/${id}/persetujuan`, { method: "PUT", body: JSON.stringify(body) }),
  baTtd: (id: number, body: { peran: BaPeran; cara: "AKUN" | "LAYAR"; nama?: string; jabatan?: string; gambar?: string }) =>
    req<{ success: boolean }>(`/api/berita-acara/${id}/ttd`, { method: "PUT", body: JSON.stringify(body) }),
  baBatal: (id: number, alasan: string) => req<{ success: boolean }>(`/api/berita-acara/${id}/batal`, { method: "PUT", body: JSON.stringify({ alasan }) }),
  depoLaporan: (depo: string, dari: string, sampai: string) => req<DepoLaporan>(`/api/koperasi/depo?${new URLSearchParams({ depo, dari, sampai })}`),
  depoTx: (depo: string, dari: string, sampai: string) =>
    req<{ id: number; tanggal_iso: string; depo: string; anggota_kode: string; nama: string | null; divisi: string | null; estate: string | null; qty: number; total: number; bayar: string }[]>(
      `/api/koperasi/depo/tx?${new URLSearchParams({ depo, dari, sampai })}`
    ),
  depoPindah: (id: number, depo: string) => req<{ success: boolean }>(`/api/koperasi/depo/tx/${id}`, { method: "PUT", body: JSON.stringify({ depo }) }),
  depoBiaya: (body: { depo: string; tanggal: string; kategori: string; jumlah: number; keterangan: string; evidence_id: string | null }) =>
    req<{ success: boolean }>("/api/koperasi/depo/biaya", { method: "POST", body: JSON.stringify(body) }),
  depoHapusBiaya: (id: number) => req<{ success: boolean }>(`/api/koperasi/depo/biaya/${id}`, { method: "DELETE" }),
  kdUnits: () => req<KdUnit[]>("/api/kendaraan/unit"),
  kdTambahUnit: (body: KdUnitInput) => req<{ success: boolean; id: number }>("/api/kendaraan/unit", { method: "POST", body: JSON.stringify(body) }),
  kdEditUnit: (id: number, body: KdUnitInput) => req<{ success: boolean }>(`/api/kendaraan/unit/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  kdKondisi: (id: number, body: { kondisi: string; tgl_rusak: string | null; tgl_selesai: string | null; keterangan: string }) =>
    req<{ success: boolean; harian: number }>(`/api/kendaraan/unit/${id}/kondisi`, { method: "PUT", body: JSON.stringify(body) }),
  kdIsiHarian: (body: { tanggal: string; mode: "kemarin" | "semua" | "kosongkan" }) => req<{ success: boolean; n: number }>("/api/kendaraan/harian/isi", { method: "POST", body: JSON.stringify(body) }),
  kdHarian: (bulan: string) => req<KdHarian[]>(`/api/kendaraan/harian?bulan=${bulan}`),
  kdSetHarian: (body: { unit_id: number; tanggal: string; kondisi: string; lokasi?: string; pekerjaan?: string }) => req<{ success: boolean }>("/api/kendaraan/harian", { method: "PUT", body: JSON.stringify(body) }),
  kopTx: (params: Record<string, string | number>) =>
    req<{ data: KopTx[]; total: number; sum_total: number; sum_qty: number }>(`/api/koperasi/tx?${new URLSearchParams(params as any)}`),
  kopJual: (body: { tanggal: string; anggota_kode: string; bayar: KopBayar; keterangan: string; evidence_id: string | null; items: KopLineInput[] }) =>
    req<{ bon: string; total: number }>("/api/koperasi/jual", { method: "POST", body: JSON.stringify(body) }),
  kopBeli: (body: { tanggal: string; no_po: string; keterangan: string; evidence_id: string | null; update_harga: boolean; items: KopLineInput[] }) =>
    req<{ success: boolean }>("/api/koperasi/beli", { method: "POST", body: JSON.stringify(body) }),
  kopJualBatch: (body: { tanggal: string; evidence_id: string | null; depo?: string; rows: { anggota_kode: string; barang_kode: string; qty: number; harga: number }[] }) =>
    req<{ count: number; bons: number }>("/api/koperasi/jual/batch", { method: "POST", body: JSON.stringify(body) }),
  kopBeliBatch: (body: { tanggal: string; evidence_id: string | null; update_harga: boolean; rows: { barang_kode: string; qty: number; harga: number; no_po: string; exp_iso?: string }[] }) =>
    req<{ count: number }>("/api/koperasi/beli/batch", { method: "POST", body: JSON.stringify(body) }),
  kopRusak: (body: { tanggal: string; barang_kode: string; qty: number; alasan: "EXPIRED" | "RUSAK"; keterangan: string; evidence_id: string | null }) =>
    req<{ success: boolean }>("/api/koperasi/rusak", { method: "POST", body: JSON.stringify(body) }),
  kopPeriksa: (jenis: "RUSAK" | "KOREKSI", id: number, body: { setuju: boolean; catatan: string }) =>
    req<{ success: boolean }>(`/api/koperasi/${jenis === "KOREKSI" ? "koreksi" : "rusak"}/${id}/periksa`, { method: "PUT", body: JSON.stringify(body) }),
  kopHapus: (id: number, bon = false) => req<{ success: boolean; n: number }>(`/api/koperasi/tx/${id}${bon ? "?bon=1" : ""}`, { method: "DELETE" }),
  kopSlip: (periode: string, kodes: string[]) =>
    req<{ periode: string; limit: number; jatuh_tempo: string; data: KopSlipLine[] }>(`/api/koperasi/slip?${new URLSearchParams({ periode, kode: kodes.join(",") })}`),
  dokumen: (p: { modul?: string; estate?: string; kategori?: string; search?: string } = {}) =>
    req<{ data: Dokumen[]; kelola: boolean }>(`/api/dokumen?${new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][])}`),
  dokumenTambah: (body: DokumenInput) => req<{ success: boolean; id: number }>("/api/dokumen", { method: "POST", body: JSON.stringify(body) }),
  dokumenEdit: (id: number, body: DokumenInput) => req<{ success: boolean }>(`/api/dokumen/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  dokumenPin: (id: number, pinned: boolean) => req<{ success: boolean }>(`/api/dokumen/${id}`, { method: "PUT", body: JSON.stringify({ pinOnly: true, pinned }) }),
  dokumenKunci: (id: number, kunci: boolean) => req<{ success: boolean }>(`/api/dokumen/${id}`, { method: "PUT", body: JSON.stringify({ kunciOnly: kunci }) }),
  sop: () => req<{ data: Sop[]; edit: boolean; kunci: boolean }>("/api/sop"),
  sopKunci: (body: { id: number } | { bagian: string }, kunci: boolean) =>
    req<{ success: boolean; n: number }>("/api/sop/kunci", { method: "PUT", body: JSON.stringify({ ...body, kunci }) }),
  sopTambah: (body: SopInput) => req<{ success: boolean; id: number; urut: number }>("/api/sop", { method: "POST", body: JSON.stringify(body) }),
  sopEdit: (id: number, body: SopInput) => req<{ success: boolean; urut: number }>(`/api/sop/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  sopDetail: (id: number) => req<{ data: Sop; edit: boolean; kunci: boolean }>(`/api/sop/${id}`),
  sopIsi: (id: number, isi: SopIsi) => req<{ success: boolean }>(`/api/sop/${id}/isi`, { method: "PUT", body: JSON.stringify({ isi }) }),
  sopHapus: (id: number) => req<{ success: boolean }>(`/api/sop/${id}`, { method: "DELETE" }),
  dokumenHapus: (id: number) => req<{ success: boolean }>(`/api/dokumen/${id}`, { method: "DELETE" }),
  kopEditTx: (id: number, body: { barang_kode: string; qty: number; harga: number }) =>
    req<{ success: boolean }>(`/api/koperasi/tx/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  kopDashboard: (dari: string, sampai: string) => req<KopDashboard>(`/api/koperasi/dashboard?dari=${dari}&sampai=${sampai}`),
  kopOpnameList: () => req<KopOpname[]>("/api/koperasi/opname"),
  kopOpname: (id: number) => req<KopOpname & { lines: KopOpnameLine[] }>(`/api/koperasi/opname/${id}`),
  kopOpnameMulai: (tanggal: string, catatan: string) => req<{ id: number; n: number }>("/api/koperasi/opname", { method: "POST", body: JSON.stringify({ tanggal, catatan }) }),
  kopOpnameSimpan: (id: number, lines: { barang_kode: string; fisik: number | null; keterangan: string }[]) =>
    req<{ success: boolean }>(`/api/koperasi/opname/${id}/lines`, { method: "PUT", body: JSON.stringify({ lines }) }),
  kopOpnameSelesai: (id: number) => req<{ id: number; koreksi: number; dihitung: number }>(`/api/koperasi/opname/${id}/selesai`, { method: "POST" }),
  kopOpnameEdit: (id: number, body: { tanggal: string; catatan: string; lines: { barang_kode: string; fisik: number | null; keterangan: string }[] }) =>
    req<{ success: boolean; koreksi: number | null }>(`/api/koperasi/opname/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  kopOpnameHapus: (id: number) => req<{ success: boolean; koreksi: number }>(`/api/koperasi/opname/${id}`, { method: "DELETE" }),
  kopOpnameBatal: (id: number) => req<{ success: boolean }>(`/api/koperasi/opname/${id}/batal`, { method: "POST" }),
  kopKoreksi: (body: { tanggal: string; barang_kode: string; stok_fisik: number; alasan: string; keterangan: string; evidence_id: string | null }) =>
    req<{ success: boolean; selisih: number; nilai: number }>("/api/koperasi/koreksi", { method: "POST", body: JSON.stringify(body) }),
  kopRekap: (periode: string) => req<{ periode: string; limit: number; jatuh_tempo: string; today: string; data: KopRekap[] }>(`/api/koperasi/rekap?periode=${periode}`),
  kopTunggakan: () => req<KopTunggakan[]>("/api/koperasi/tunggakan"),
  kopBayarList: (anggota: string, periode: string) =>
    req<{ tagihan: KopTagihan; data: KopBayarRow[] }>(`/api/koperasi/bayar?${new URLSearchParams({ anggota, periode })}`),
  kopBayar: (body: { anggota_kode: string; periode: string; jumlah: number; tanggal: string; cara: KopCara; keterangan: string }) =>
    req<{ success: boolean; sisa: number }>("/api/koperasi/bayar", { method: "POST", body: JSON.stringify(body) }),
  kopBayarLunas: (periode: string, kode: string[], sisa?: Record<string, number>) =>
    req<{ count: number; total: number }>("/api/koperasi/bayar/lunas", { method: "POST", body: JSON.stringify({ periode, kode, sisa }) }),
  kopBayarHapus: (id: number) => req<{ success: boolean }>(`/api/koperasi/bayar/${id}`, { method: "DELETE" }),
  kopLimit: (kode: string, periode: string) =>
    req<{ periode: string; limit: number; terpakai: number; sisa: number; tunggakan: { sisa: number; periode: string[]; pesan: string } | null }>(`/api/koperasi/limit/${encodeURIComponent(kode)}?periode=${periode}`),
  pinjamanLog: (params: Record<string, string | number>) =>
    req<{ data: PinjamanLog[]; total: number; ringkasan: PinjamanRingkasan }>(`/api/pinjaman/log?${new URLSearchParams(params as any)}`),
  pinjamanBarang: (module: OpnameModule, estate: string, search: string, all = false) =>
    req<PinjamanBarang[]>(`/api/pinjaman/barang?${new URLSearchParams({ module, estate, search, ...(all ? { all: "1" } : {}) })}`),
  // Input Banyak: one Pinjaman per row, all saved or none (a refused row comes back as data.row).
  createPinjamanBatch: (payload: { tanggal_iso: string; evidence_id: string; module: OpnameModule; dari: string; ke: string; rows: { kode: string; qty: number; alasan: string }[] }) =>
    req<{ success: boolean; count: number }>("/api/pinjaman/batch", { method: "POST", body: JSON.stringify(payload) }),
  // jenis TRANSFER: sent for good. tanggal_iso: the day it happened when entered later (default today).
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
  // Pinjaman Pribadi: the estate (ke) borrows BBM from a karyawan, given back in liters later.
  createPinjamanPribadi: (payload: { module: "BBM"; ke: string; kode: string; qty: number; nama: string; nik: string; alasan: string; tanggal_iso: string; evidence_id: string }) =>
    req<{ success: boolean; id: number }>("/api/pinjaman/pribadi", { method: "POST", body: JSON.stringify(payload) }),
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
  opnameLog: (p: { module?: string; estate?: string; opname?: number; search?: string; page?: number }) =>
    req<{ data: { id: number; created_at: string; module: string; estate: string; aksi: string; objek: string; detail: string; nama: string; username: string }[]; total: number }>(
      `/api/stock-opname-log?${new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`
    ),
  opnamePenyetuju: (module: OpnameModule, estate: string) =>
    req<{ id: number; nama: string; superuser: boolean }[]>(`/api/stock-opname/penyetuju?${new URLSearchParams({ module, estate })}`),
  opnameInfo: (id: number, payload: { pihak: OpnamePihak }) =>
    req<{ success: boolean }>(`/api/stock-opname/${id}/info`, { method: "PUT", body: JSON.stringify(payload) }),
  opnameBuka: (id: number) => req<{ success: boolean }>(`/api/stock-opname/${id}/buka`, { method: "POST", body: "{}" }),
  createOpname: (payload: { module: OpnameModule; estate: string; tanggal: string; catatan?: string; pihak: OpnamePihak; hitung_buta: boolean }) =>
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
