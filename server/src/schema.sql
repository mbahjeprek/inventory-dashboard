CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nama TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 'superuser' sees/manages everything; 'estate' is locked to just their one estate's Gudang/BBM
-- pages (Nilam/KNS/WJA/Zamrud/Firus) so different estates' data never mix in one login.
-- Existing rows default to 'superuser' so accounts that predate this column keep full access.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'superuser';
ALTER TABLE users ADD COLUMN IF NOT EXISTS estate TEXT;

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  kode TEXT UNIQUE NOT NULL,
  nama TEXT NOT NULL,
  satuan TEXT,
  buffer_stock INTEGER DEFAULT 0,
  keterangan TEXT,
  stock_tersedia INTEGER DEFAULT 0,
  stock_in INTEGER DEFAULT 0,
  stock_out INTEGER DEFAULT 0,
  stock_fisik INTEGER DEFAULT 0,
  selisih_stock INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tujuan TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('IN','OUT')),
  qty INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  penerima TEXT DEFAULT '',
  is_correction INTEGER DEFAULT 0,
  mirror_source TEXT,
  mirror_id INTEGER
);

CREATE TABLE IF NOT EXISTS stock_in_log (
  id SERIAL PRIMARY KEY,
  item_id INTEGER REFERENCES items(id),
  kode TEXT,
  nama TEXT,
  tanggal_po TEXT,
  no_pr TEXT,
  po_in_akss TEXT,
  nama_vendor TEXT,
  qty INTEGER DEFAULT 0,
  satuan TEXT,
  tujuan TEXT,
  estate_raw TEXT,
  divisi TEXT,
  tanggal_terima TEXT,
  tanggal_terima_iso TEXT,
  keterangan TEXT
);

CREATE TABLE IF NOT EXISTS karyawan (
  id SERIAL PRIMARY KEY,
  nik TEXT UNIQUE NOT NULL,
  nama TEXT NOT NULL,
  status TEXT,
  estate TEXT,
  lokasi_kerja TEXT,
  nik_ktp TEXT
);

CREATE TABLE IF NOT EXISTS alat_berat (
  id SERIAL PRIMARY KEY,
  kode TEXT UNIQUE NOT NULL,
  jenis_unit TEXT,
  nama TEXT
);

-- Per-warehouse stock for the non-Nilam gudang (KNS/WJA/ZAMRUD/FIRUS). Nilam's own stock lives
-- directly on `items` (it's the original/master warehouse); these gudang pick their item names
-- from that same master list via item_kode, but track their own buffer/stock quantities.
CREATE TABLE IF NOT EXISTS gudang_stock (
  id SERIAL PRIMARY KEY,
  gudang TEXT NOT NULL,
  item_kode TEXT NOT NULL REFERENCES items(kode),
  buffer_stock INTEGER DEFAULT 0,
  stock_tersedia INTEGER DEFAULT 0,
  UNIQUE(gudang, item_kode)
);

CREATE TABLE IF NOT EXISTS bbm_log (
  id SERIAL PRIMARY KEY,
  jenis_bbm TEXT NOT NULL,
  lokasi TEXT NOT NULL,
  estate TEXT,
  periode TEXT,
  tanggal TEXT,
  tanggal_iso TEXT,
  no_spb TEXT,
  stock_awal INTEGER,
  diterima INTEGER,
  pinjam INTEGER,
  pemakaian INTEGER,
  saldo_stock INTEGER,
  keterangan TEXT,
  status_kepemilikan TEXT,
  kode_kendaraan TEXT,
  hm_terakhir TEXT
);

CREATE TABLE IF NOT EXISTS stock_out_log (
  id SERIAL PRIMARY KEY,
  item_id INTEGER REFERENCES items(id),
  kode TEXT,
  nama TEXT,
  no_request TEXT,
  no_po TEXT,
  req_by TEXT,
  qty INTEGER DEFAULT 0,
  satuan TEXT,
  tanggal_keluar TEXT,
  tanggal_keluar_iso TEXT,
  nik_ktp TEXT,
  penerima TEXT,
  tujuan TEXT,
  estate_raw TEXT,
  divisi TEXT,
  no_embrace_gudang TEXT,
  keterangan TEXT,
  nik_karyawan TEXT
);

CREATE INDEX IF NOT EXISTS idx_karyawan_estate ON karyawan(estate);
CREATE INDEX IF NOT EXISTS idx_karyawan_status ON karyawan(status);
CREATE INDEX IF NOT EXISTS idx_alat_berat_jenis ON alat_berat(jenis_unit);
CREATE INDEX IF NOT EXISTS idx_tx_item ON transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_in_item ON stock_in_log(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_in_date ON stock_in_log(tanggal_terima_iso);
CREATE INDEX IF NOT EXISTS idx_stock_in_tujuan ON stock_in_log(tujuan);
CREATE INDEX IF NOT EXISTS idx_stock_out_item ON stock_out_log(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_out_date ON stock_out_log(tanggal_keluar_iso);
CREATE INDEX IF NOT EXISTS idx_stock_out_tujuan ON stock_out_log(tujuan);
CREATE INDEX IF NOT EXISTS idx_bbm_lokasi ON bbm_log(lokasi);
CREATE INDEX IF NOT EXISTS idx_bbm_estate ON bbm_log(estate);
CREATE INDEX IF NOT EXISTS idx_bbm_jenis ON bbm_log(jenis_bbm);
CREATE INDEX IF NOT EXISTS idx_bbm_date ON bbm_log(tanggal_iso);

-- Audit trail of every change made through the dashboard, kept as two separate logs: module
-- 'BARANG' (Inventory Gudang of every estate, incl. Nilam's items/transactions/stock in-out) and
-- 'BBM'. `estate` is the gudang/lokasi the change belongs to, so estate users see only their own.
-- The acting user is copied in (not just referenced) so the log still reads correctly after an
-- account is renamed or deleted.
CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  module TEXT NOT NULL,
  estate TEXT,
  aksi TEXT NOT NULL,
  objek TEXT,
  detail TEXT,
  user_id INTEGER,
  username TEXT,
  nama TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_module_time ON activity_log(module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_estate ON activity_log(estate);

-- Fertiliser (pupuk) ledger, one running balance per estate + jenis pupuk. Imported from the
-- "STOCK PUPUK" Google Sheet tab (see importPupuk.ts) and extended by manual transactions. The
-- sheet's own STOK column is one balance across all estates; saldo_stock here is per estate.
CREATE TABLE IF NOT EXISTS pupuk_log (
  id SERIAL PRIMARY KEY,
  estate TEXT NOT NULL,
  jenis_pupuk TEXT NOT NULL,
  periode TEXT,
  tanggal TEXT,
  tanggal_iso TEXT,
  divisi TEXT,
  no_embrace TEXT,
  kode_barang TEXT,
  keluar DOUBLE PRECISION,
  diterima DOUBLE PRECISION,
  saldo_stock DOUBLE PRECISION,
  keterangan TEXT,
  blok TEXT,
  ha DOUBLE PRECISION,
  pokok DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pupuk_estate_date ON pupuk_log(estate, tanggal_iso);
