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
-- Temporary full access: until this moment an estate account has every inventory permission
-- (MODULE_ACTIONS) in its own estates, on top of its ticked perms; afterwards it falls back to them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_full_until TIMESTAMPTZ;
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

-- One obat in one clinic can sit in several batches with their own expiry date. Stock In adds to
-- the batch of its expiry date ('' = no expiry, e.g. kasa/plester), Stock Out takes the batch that
-- expires first (FEFO) unless a batch is picked, Koreksi counts one batch. klinik_stock keeps the
-- totals: stock_tersedia = sum of the batches, expired_date = the nearest expiry still in stock.
-- klinik_stock_tx.alloc records which batches a movement touched ([{exp, qty}]) so an edit or
-- delete can put the stock back where it came from.
CREATE TABLE IF NOT EXISTS klinik_batch (
  id SERIAL PRIMARY KEY,
  klinik TEXT NOT NULL,
  obat_kode TEXT NOT NULL REFERENCES obat(kode) ON UPDATE CASCADE,
  expired_date TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(klinik, obat_kode, expired_date)
);
ALTER TABLE klinik_stock_tx ADD COLUMN IF NOT EXISTS alloc JSONB;
-- Stock from before batches existed becomes one batch per obat with the expiry it had.
INSERT INTO klinik_batch (klinik, obat_kode, expired_date, qty)
SELECT ks.klinik, ks.obat_kode, COALESCE(ks.expired_date, ''), ks.stock_tersedia
FROM klinik_stock ks
WHERE ks.stock_tersedia > 0
  AND NOT EXISTS (SELECT 1 FROM klinik_batch b WHERE b.klinik = ks.klinik AND b.obat_kode = ks.obat_kode);

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

-- Stok Opname: a physical count of one location (module + estate) as one document. Creating it
-- snapshots the system stock into opname_line; the counter fills stok_fisik (NULL = not counted,
-- left unchanged), submits, and someone with the approve permission approves it, which books one
-- Koreksi per line whose count differs. While a session is DRAFT/SUBMITTED every stock movement of
-- that location is refused (see opnameLocks in app.ts), so the snapshot stays the real stock.
-- module: GUDANG | KLINIK | BBM | PUPUK; status: DRAFT | SUBMITTED | APPROVED | BATAL.
CREATE TABLE IF NOT EXISTS opname (
  id SERIAL PRIMARY KEY,
  module TEXT NOT NULL,
  estate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  tanggal TEXT NOT NULL,
  catatan TEXT NOT NULL DEFAULT '',
  -- Why it was sent back to the counter or cancelled.
  catatan_review TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_by_nama TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by INTEGER,
  submitted_by_nama TEXT,
  submitted_at TIMESTAMPTZ,
  approved_by INTEGER,
  approved_by_nama TEXT,
  approved_at TIMESTAMPTZ
);
-- At most one open opname per location.
CREATE UNIQUE INDEX IF NOT EXISTS uq_opname_open ON opname(module, estate) WHERE status IN ('DRAFT', 'SUBMITTED');
CREATE INDEX IF NOT EXISTS idx_opname_created ON opname(created_at DESC);

-- One counted thing: a barang (items/gudang_stock), an obat batch (exp = expiry, '' = none), a jenis
-- BBM or a jenis pupuk. stok_sistem is the snapshot, refreshed to the stock at approval.
CREATE TABLE IF NOT EXISTS opname_line (
  id SERIAL PRIMARY KEY,
  opname_id INTEGER NOT NULL REFERENCES opname(id) ON DELETE CASCADE,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL DEFAULT '',
  satuan TEXT NOT NULL DEFAULT '',
  exp TEXT NOT NULL DEFAULT '',
  stok_sistem DOUBLE PRECISION NOT NULL DEFAULT 0,
  stok_fisik DOUBLE PRECISION,
  keterangan TEXT NOT NULL DEFAULT '',
  -- Found during the count but not in the snapshot (can be removed again while DRAFT).
  ditambahkan BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(opname_id, kode, exp)
);

-- BBM / pupuk have no movement table, only a running saldo: an approved opname adds a row whose
-- saldo_stock is the counted amount and `koreksi` the difference, with diterima/pemakaian/keluar left
-- empty so stok masuk/keluar totals don't count it.
ALTER TABLE bbm_log ADD COLUMN IF NOT EXISTS koreksi DOUBLE PRECISION;

-- Oli (lubricant) ledger, one running balance per estate + jenis oli (SAE 15W 40, SAE 90, SAE 10...),
-- laid out like the "STOK OLI" Google Sheet: diterima / pemakaian in liters, saldo_stock after the row.
-- Same shape as pupuk_log; `koreksi` = the difference booked by an approved Stok Opname.
CREATE TABLE IF NOT EXISTS oli_log (
  id SERIAL PRIMARY KEY,
  estate TEXT NOT NULL,
  jenis_oli TEXT NOT NULL,
  periode TEXT,
  tanggal TEXT,
  tanggal_iso TEXT,
  no_embrace TEXT DEFAULT '',
  diterima DOUBLE PRECISION,
  pemakaian DOUBLE PRECISION,
  saldo_stock DOUBLE PRECISION,
  keterangan TEXT DEFAULT '',
  koreksi DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oli_estate_date ON oli_log(estate, tanggal_iso);

-- Master data oli: the jenis oli that transactions and opname may use. oli_log.jenis_oli holds the
-- `nama`; renaming a jenis here renames it in oli_log too (see PUT /api/master-oli/:id).
CREATE TABLE IF NOT EXISTS master_oli (
  id SERIAL PRIMARY KEY,
  kode TEXT UNIQUE NOT NULL,
  nama TEXT UNIQUE NOT NULL,
  satuan TEXT NOT NULL DEFAULT 'LTR',
  keterangan TEXT NOT NULL DEFAULT ''
);
INSERT INTO master_oli (kode, nama, satuan, keterangan) VALUES
  ('OL-001', 'SAE 15W 40', 'LTR', ''),
  ('OL-002', 'SAE 90', 'LTR', ''),
  ('OL-003', 'SAE 10', 'LTR', '')
ON CONFLICT DO NOTHING;
ALTER TABLE pupuk_log ADD COLUMN IF NOT EXISTS koreksi DOUBLE PRECISION;

-- Pinjaman antar estate: stock one estate lends another (dari_estate -> ke_estate), in any module.
-- Lending books a Stok Keluar at the lender and a Stok Masuk at the borrower right away; each
-- return (pinjaman_kembali, may be partial) books the reverse until qty_kembali = qty (LUNAS).
-- Batal = the whole loan returned at once while nothing had come back yet. The movement rows carry
-- pinjaman_id and can only change through the Pinjaman page; BBM / pupuk / oli keep the qty in
-- `pinjam` (+ in, - out) so stok masuk / pemakaian totals don't count it.
CREATE TABLE IF NOT EXISTS pinjaman (
  id SERIAL PRIMARY KEY,
  module TEXT NOT NULL,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL DEFAULT '',
  satuan TEXT NOT NULL DEFAULT '',
  dari_estate TEXT NOT NULL,
  ke_estate TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL,
  qty_kembali DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DIPINJAM',
  alasan TEXT NOT NULL DEFAULT '',
  tanggal_iso TEXT NOT NULL,
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pinjaman_estates ON pinjaman(dari_estate, ke_estate, status);
CREATE TABLE IF NOT EXISTS pinjaman_kembali (
  id SERIAL PRIMARY KEY,
  pinjaman_id INTEGER NOT NULL REFERENCES pinjaman(id),
  qty DOUBLE PRECISION NOT NULL,
  tanggal_iso TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  batal BOOLEAN NOT NULL DEFAULT false,
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pinjaman_id INTEGER;
ALTER TABLE stock_in_log ADD COLUMN IF NOT EXISTS pinjaman_id INTEGER;
ALTER TABLE stock_out_log ADD COLUMN IF NOT EXISTS pinjaman_id INTEGER;
ALTER TABLE gudang_stock_tx ADD COLUMN IF NOT EXISTS pinjaman_id INTEGER;
ALTER TABLE klinik_stock_tx ADD COLUMN IF NOT EXISTS pinjaman_id INTEGER;
ALTER TABLE bbm_log ADD COLUMN IF NOT EXISTS pinjaman_id INTEGER;
ALTER TABLE pupuk_log ADD COLUMN IF NOT EXISTS pinjaman_id INTEGER;
ALTER TABLE oli_log ADD COLUMN IF NOT EXISTS pinjaman_id INTEGER;
ALTER TABLE pupuk_log ADD COLUMN IF NOT EXISTS pinjam DOUBLE PRECISION;
ALTER TABLE oli_log ADD COLUMN IF NOT EXISTS pinjam DOUBLE PRECISION;

-- Foto bukti transaksi: the image sits in the private Supabase Storage bucket `evidence` at `path`;
-- every Stok Masuk / Keluar and Pinjaman row keeps its evidence_id (used = linked to a transaction).
CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/jpeg',
  size INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE stock_in_log ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE stock_out_log ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE gudang_stock_tx ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE klinik_stock_tx ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE bbm_log ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE pupuk_log ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE oli_log ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE pinjaman ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE pinjaman_kembali ADD COLUMN IF NOT EXISTS evidence_id UUID;
