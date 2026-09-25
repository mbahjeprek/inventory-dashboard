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
-- Which inventory modules an estate account may open, comma separated from GUDANG, BBM, PUPUK,
-- KLINIK (e.g. an admin entry data "GUDANG,BBM,PUPUK" or "KLINIK"). NULL = every module.
ALTER TABLE users ADD COLUMN IF NOT EXISTS modules TEXT;
-- Checkbox access of an estate account (superusers have everything): `estates` = the estates it may
-- open, `perms` = permission keys like "gudang.view,gudang.input,master.obat" (see ALL_PERMS in
-- auth.ts). Accounts from before this carry over what they could do: their estate, and view +
-- input on their modules (edit/delete/koreksi were superuser-only). `estate`/`modules` are legacy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS estates TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS perms TEXT;
UPDATE users SET estates = estate WHERE estates IS NULL AND estate IS NOT NULL;
UPDATE users SET perms = (
  SELECT string_agg(lower(trim(m)) || '.view,' || lower(trim(m)) || '.input', ',')
  FROM unnest(string_to_array(COALESCE(NULLIF(modules, ''), 'GUDANG,BBM,PUPUK,KLINIK'), ',')) m
) WHERE role = 'estate' AND perms IS NULL;

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

-- Stock In / Stock Out / Koreksi history for those gudang, entered through the same transaction
-- form as Nilam. Each row has already been applied to gudang_stock.stock_tersedia.
CREATE TABLE IF NOT EXISTS gudang_stock_tx (
  id SERIAL PRIMARY KEY,
  gudang TEXT NOT NULL,
  item_kode TEXT NOT NULL REFERENCES items(kode),
  type TEXT NOT NULL CHECK(type IN ('IN','OUT')),
  qty INTEGER NOT NULL,
  tujuan TEXT DEFAULT '',
  penerima TEXT DEFAULT '',
  note TEXT,
  is_correction INTEGER DEFAULT 0,
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gudang_tx_item ON gudang_stock_tx(gudang, item_kode);

-- Transfer Gudang Nilam -> gudang estate lain: a Nilam Stok Keluar (transactions) whose tujuan is
-- KNS/WJA/Zamrud/Firus automatically books a Stok Masuk in that gudang. The receiving row points
-- back at it via transfer_from_id (transactions.id), so it follows that Stok Keluar on edit/delete
-- and cannot be changed on its own. The other gudang only supply their own estate.
ALTER TABLE gudang_stock_tx ADD COLUMN IF NOT EXISTS transfer_from_id INTEGER;

-- These gudang also hold goods counted in fractions (e.g. 2.5 KG of pestisida), so their stock and
-- movement qty are decimal, like pupuk_log. The app rounds stock to 3 decimals after every change.
-- Nilam (items/transactions) and Klinik stay whole numbers.
ALTER TABLE gudang_stock ALTER COLUMN stock_tersedia TYPE DOUBLE PRECISION;
ALTER TABLE gudang_stock ALTER COLUMN buffer_stock TYPE DOUBLE PRECISION;
ALTER TABLE gudang_stock_tx ALTER COLUMN qty TYPE DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS idx_gudang_tx_transfer ON gudang_stock_tx(transfer_from_id);

-- Medicines and medical supplies for the estate clinics, kept apart from the Gudang master barang.
CREATE TABLE IF NOT EXISTS obat (
  id SERIAL PRIMARY KEY,
  kode TEXT UNIQUE NOT NULL,
  nama TEXT NOT NULL,
  kategori TEXT DEFAULT '',
  jenis TEXT DEFAULT '',
  deskripsi TEXT DEFAULT '',
  satuan TEXT DEFAULT ''
);

-- Per-clinic stock (Klinik NILAM/KNS/WJA/ZAMRUD/FIRUS), same shape as gudang_stock plus an expiry
-- date. ON UPDATE CASCADE lets a kode be corrected in master obat without breaking the stock rows.
CREATE TABLE IF NOT EXISTS klinik_stock (
  id SERIAL PRIMARY KEY,
  klinik TEXT NOT NULL,
  obat_kode TEXT NOT NULL REFERENCES obat(kode) ON UPDATE CASCADE,
  buffer_stock INTEGER DEFAULT 0,
  stock_tersedia INTEGER DEFAULT 0,
  expired_date TEXT,
  catatan TEXT DEFAULT '',
  UNIQUE(klinik, obat_kode)
);

-- Stock In / Stock Out / Koreksi history per clinic, entered through the shared transaction form.
CREATE TABLE IF NOT EXISTS klinik_stock_tx (
  id SERIAL PRIMARY KEY,
  klinik TEXT NOT NULL,
  obat_kode TEXT NOT NULL REFERENCES obat(kode) ON UPDATE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('IN','OUT')),
  qty INTEGER NOT NULL,
  tujuan TEXT DEFAULT '',
  penerima TEXT DEFAULT '',
  note TEXT,
  is_correction INTEGER DEFAULT 0,
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_klinik_tx_item ON klinik_stock_tx(klinik, obat_kode);

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

-- One row per successful login, for the Log Aktivitas User page (who logs in, who doesn't).
CREATE TABLE IF NOT EXISTS login_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_log_user_date ON login_log(user_id, created_at);

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
