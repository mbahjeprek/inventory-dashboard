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
-- Narrows temp_full_until to these modules (comma list, e.g. "bbm"); NULL / empty = all it holds.
ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_full_modules TEXT;
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
CREATE INDEX IF NOT EXISTS idx_tx_mirror ON transactions(mirror_source, mirror_id);
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
-- Klinik: the expiry found on the counted batch when it differs from `exp` (NULL = as in the system).
-- Approval empties batch `exp` and puts the count in batch `exp_fisik`.
ALTER TABLE opname_line ADD COLUMN IF NOT EXISTS exp_fisik TEXT;

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
-- estates: the estates a jenis is used in, comma separated ('' = every estate), e.g. SAE 40 only at KNS.
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
-- PINJAM = a loan, returned later (status DIPINJAM -> LUNAS / BATAL); TRANSFER = stock sent to another
-- estate for good (status TRANSFER, nothing comes back): the same pair of movement rows, no return.
ALTER TABLE pinjaman ADD COLUMN IF NOT EXISTS jenis TEXT NOT NULL DEFAULT 'PINJAM';
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
-- How the photo is shown, in degrees clockwise (0 / 90 / 180 / 270): a photo taken sideways or upside
-- down is turned in the viewer and saved here; the file itself stays as uploaded.
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS rotation INTEGER NOT NULL DEFAULT 0;
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

-- Time of entry for the rows that had only a date (BBM, Nilam stock in / out). Added without a default
-- first so older rows stay NULL (their time is unknown) instead of all getting the migration time; new
-- rows get now(). Nilam rows mirrored from a manual transaction take that transaction's time.
ALTER TABLE bbm_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE bbm_log ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE stock_in_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE stock_in_log ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE stock_out_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE stock_out_log ALTER COLUMN created_at SET DEFAULT now();
UPDATE stock_in_log s SET created_at = t.created_at FROM transactions t
  WHERE s.created_at IS NULL AND t.mirror_source = 'stock_in_log' AND t.mirror_id = s.id;
UPDATE stock_out_log s SET created_at = t.created_at FROM transactions t
  WHERE s.created_at IS NULL AND t.mirror_source = 'stock_out_log' AND t.mirror_id = s.id;

-- Pupuk / oli rows bulk-imported from the sheets carry the import time, not when they happened: those
-- (20+ rows in the same minute) get no time, like the other imported history.
ALTER TABLE pupuk_log ALTER COLUMN created_at DROP NOT NULL;
ALTER TABLE oli_log ALTER COLUMN created_at DROP NOT NULL;
UPDATE pupuk_log SET created_at = NULL WHERE date_trunc('minute', created_at) IN
  (SELECT date_trunc('minute', created_at) FROM pupuk_log WHERE created_at IS NOT NULL GROUP BY 1 HAVING COUNT(*) >= 20);
UPDATE oli_log SET created_at = NULL WHERE date_trunc('minute', created_at) IN
  (SELECT date_trunc('minute', created_at) FROM oli_log WHERE created_at IS NOT NULL GROUP BY 1 HAVING COUNT(*) >= 20);

-- BBM / pupuk / oli: a row whose saldo_stock is fixed (the Google Sheet's own saldo from the import,
-- or a saldo typed by hand in Edit) rather than worked out from the row before it (rechainSaldo in
-- app.ts). Added once, marking the imported rows (created_at NULL); an edit of an imported row's
-- jumlah / tanggal clears it so the row runs on with the others.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bbm_log', 'pupuk_log', 'oli_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'dari_sheet') THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN dari_sheet BOOLEAN NOT NULL DEFAULT false', t);
      EXECUTE format('UPDATE %I SET dari_sheet = true WHERE created_at IS NULL', t);
    END IF;
  END LOOP;
END $$;

-- BBM liters can be fractional (the sheets have 76,5 / 142,5 L): the amounts were INTEGER, so a
-- comma value was imported as 765 / 1425 and couldn't be typed in. Same type as pupuk / oli.
ALTER TABLE bbm_log
  ALTER COLUMN stock_awal TYPE DOUBLE PRECISION,
  ALTER COLUMN diterima TYPE DOUBLE PRECISION,
  ALTER COLUMN pinjam TYPE DOUBLE PRECISION,
  ALTER COLUMN pemakaian TYPE DOUBLE PRECISION,
  ALTER COLUMN saldo_stock TYPE DOUBLE PRECISION;

-- Kemasan obat: the pack it comes in (STRIP / BOX) and how many `satuan` (tablet/biji) one holds.
-- Stock is still kept in `satuan`; the forms convert (Stock In per strip, opname strip + biji lepas).
ALTER TABLE obat ADD COLUMN IF NOT EXISTS kemasan TEXT NOT NULL DEFAULT '';
ALTER TABLE obat ADD COLUMN IF NOT EXISTS isi_kemasan INTEGER NOT NULL DEFAULT 0;
-- Bahan habis pakai dipakai sebagian per pasien (Hypafix, kasa gulung, perban): stock is cut one
-- roll / pack when it is opened (a manual Stock Out), so a terapi of it never moves stock and needs no qty.
ALTER TABLE obat ADD COLUMN IF NOT EXISTS bhp BOOLEAN NOT NULL DEFAULT false;

-- Laporan Harian Klinik (KPI): one row per patient visit, read from each clinic's Daily Report
-- Google Sheet (server/src/klinikLaporan.ts). Report only - the obat given here do not move stock
-- (Stock Out stays on the Inventory Klinik page). A sync replaces that clinic's rows.
CREATE TABLE IF NOT EXISTS klinik_kunjungan (
  id SERIAL PRIMARY KEY,
  klinik TEXT NOT NULL,
  no INTEGER,
  tanggal_iso TEXT NOT NULL,
  jenis_kunjungan TEXT NOT NULL DEFAULT '',
  nik TEXT NOT NULL DEFAULT '',
  nama_pasien TEXT NOT NULL,
  jenis_kelamin TEXT NOT NULL DEFAULT '',
  tanggal_lahir_iso TEXT,
  usia INTEGER,
  status_pasien TEXT NOT NULL DEFAULT '',
  penanggung TEXT NOT NULL DEFAULT '',
  jabatan TEXT NOT NULL DEFAULT '',
  divisi TEXT NOT NULL DEFAULT '',
  tempat_tinggal TEXT NOT NULL DEFAULT '',
  asal_pasien TEXT NOT NULL DEFAULT '',
  diagnosis TEXT NOT NULL DEFAULT '',
  kecelakaan_kerja BOOLEAN NOT NULL DEFAULT false,
  istirahat BOOLEAN NOT NULL DEFAULT false,
  hari_istirahat INTEGER NOT NULL DEFAULT 0,
  rujukan BOOLEAN NOT NULL DEFAULT false,
  provider TEXT NOT NULL DEFAULT '',
  detail_kejadian TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_kunjungan_klinik_tgl ON klinik_kunjungan(klinik, tanggal_iso);
CREATE TABLE IF NOT EXISTS klinik_kunjungan_obat (
  id SERIAL PRIMARY KEY,
  kunjungan_id INTEGER NOT NULL REFERENCES klinik_kunjungan(id) ON DELETE CASCADE,
  obat_kode TEXT NOT NULL DEFAULT '',
  nama_obat TEXT NOT NULL DEFAULT '',
  qty DOUBLE PRECISION,
  satuan TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_kunjungan_obat ON klinik_kunjungan_obat(kunjungan_id);
-- Where each clinic's Daily Report lives, and the last sync.
CREATE TABLE IF NOT EXISTS klinik_laporan_sumber (
  klinik TEXT PRIMARY KEY,
  sheet_url TEXT NOT NULL,
  synced_at TIMESTAMPTZ,
  synced_rows INTEGER,
  synced_by TEXT
);
-- Kunjungan are now entered in the app (Klinik > Laporan Harian); the rows read from the Daily Report
-- sheets once at go-live keep sumber = 'SHEET'. Foto = the visit's evidence photo (optional).
ALTER TABLE klinik_kunjungan ADD COLUMN IF NOT EXISTS sumber TEXT NOT NULL DEFAULT 'APP';
ALTER TABLE klinik_kunjungan ADD COLUMN IF NOT EXISTS evidence_id UUID;
ALTER TABLE klinik_kunjungan ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE klinik_kunjungan ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE klinik_kunjungan ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE klinik_kunjungan_obat ADD COLUMN IF NOT EXISTS urut INTEGER NOT NULL DEFAULT 0;

-- Master Pasien: the patients of each estate's clinic (not the karyawan list - family members and
-- outsiders are patients too). Built once from the Daily Report visits (buildPasien.ts); a visit
-- entered for a new name adds its patient. klinik_kunjungan.pasien_id = whose visit it was.
CREATE TABLE IF NOT EXISTS klinik_pasien (
  id SERIAL PRIMARY KEY,
  estate TEXT NOT NULL,
  nama TEXT NOT NULL,
  jenis_kelamin TEXT NOT NULL DEFAULT '',
  tanggal_lahir_iso TEXT,
  status_pasien TEXT NOT NULL DEFAULT '',
  penanggung TEXT NOT NULL DEFAULT '',
  jabatan TEXT NOT NULL DEFAULT '',
  divisi TEXT NOT NULL DEFAULT '',
  tempat_tinggal TEXT NOT NULL DEFAULT '',
  asal_pasien TEXT NOT NULL DEFAULT '',
  catatan TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pasien_estate_nama ON klinik_pasien(estate, lower(nama));
ALTER TABLE klinik_kunjungan ADD COLUMN IF NOT EXISTS pasien_id INTEGER REFERENCES klinik_pasien(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_kunjungan_pasien ON klinik_kunjungan(pasien_id);

-- Tanggal on Stock In / Out / Koreksi of barang & obat: a movement entered later than it happened
-- keeps its own date. The app sets app.tx_time for the transaction (db.ts txTime) and created_at
-- takes it; input_at = when it was typed (NULL on older rows = created_at).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transactions', 'gudang_stock_tx', 'klinik_stock_tx', 'stock_in_log', 'stock_out_log'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN created_at SET DEFAULT COALESCE(NULLIF(current_setting(''app.tx_time'', true), '''')::timestamptz, now())', t);
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'input_at') THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN input_at TIMESTAMPTZ', t);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN input_at SET DEFAULT now()', t);
    END IF;
  END LOOP;
END $$;

-- Terapi of a Laporan Harian kunjungan that names a master obat is that clinic's Stock Out (app.ts
-- syncKunjunganStok): klinik_stock_tx.kunjungan_id = the visit it was given at. A manual Stock Out
-- entered for the same patient / obat is linked to the visit instead of being booked twice.
ALTER TABLE klinik_stock_tx ADD COLUMN IF NOT EXISTS kunjungan_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_klinik_tx_kunjungan ON klinik_stock_tx(kunjungan_id);

-- Nama obat typed in a kunjungan's terapi (key: lower-case letters and digits only) -> the master obat
-- it means ("PCT" -> Paracetamol 500 mg). A visit saved with such a name gets that obat_kode, so its
-- terapi is cut from stock (app.ts resolveTerapiKode); Super User adds names via Cocokkan Nama Obat.
CREATE TABLE IF NOT EXISTS klinik_obat_alias (
  nama_key TEXT PRIMARY KEY,
  obat_kode TEXT NOT NULL REFERENCES obat(kode) ON UPDATE CASCADE ON DELETE CASCADE,
  nama_contoh TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Master Blok: the estate's blocks as in the "AKSS - BLOCK DETAIL" sheet, row for row. A blok name is
-- kept exactly as written ("I-5" is block minus 5, a different block from "I5"), and one blok can
-- have several rows (planted in two years, or split between divisi). urut = the sheet's order.
CREATE TABLE IF NOT EXISTS master_blok (
  id SERIAL PRIMARY KEY,
  estate TEXT NOT NULL,
  divisi TEXT NOT NULL DEFAULT '',
  blok TEXT NOT NULL,
  planting_material TEXT NOT NULL DEFAULT '',
  tahun_tanam INTEGER,
  ha DOUBLE PRECISION,
  sph INTEGER,
  pkk INTEGER,
  urut INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_master_blok_estate ON master_blok(estate, blok);

-- Peta Blok: the AKSS block map as drawn in the "mapping pemupukan npk akss" sheet. One box per
-- blok at grid column gx / row gy (h rows tall), the estate whose master_blok it is (NULL = not in
-- Master Blok), and the colour someone painted on it (Warna Bebas, '#rrggbb', NULL = none).
-- kind 'label' = a text label on the map (estate names).
CREATE TABLE IF NOT EXISTS peta_blok (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'blok',
  label TEXT NOT NULL,
  gx INTEGER NOT NULL,
  gy INTEGER NOT NULL,
  h INTEGER NOT NULL DEFAULT 1,
  estate TEXT,
  warna TEXT
);
-- The colours of the progress pemupukan map: a blok gets the item with the highest `dari` (%) it reaches.
CREATE TABLE IF NOT EXISTS peta_legend (
  id SERIAL PRIMARY KEY,
  dari DOUBLE PRECISION NOT NULL,
  label TEXT NOT NULL,
  warna TEXT NOT NULL
);
-- Each map has its own legend: 'pupuk' (progress pemupukan) or 'pruning'.
ALTER TABLE peta_legend ADD COLUMN IF NOT EXISTS jenis TEXT NOT NULL DEFAULT 'pupuk';
INSERT INTO peta_legend (dari, label, warna, jenis)
SELECT * FROM (VALUES (0::float8, 'Belum pruning', '#ff0000', 'pruning'), (1, 'Sebagian (< 50%)', '#ff9900', 'pruning'),
  (50, '50 - 99%', '#ffff00', 'pruning'), (100, 'Selesai (≥ 100%)', '#6aa84f', 'pruning')) v
WHERE NOT EXISTS (SELECT 1 FROM peta_legend WHERE jenis = 'pruning');

-- Rekap Pruning PT.AKSS, copied from its Google Sheet (server/src/pruning.ts) and refreshed from it
-- automatically: one pruning_blok per sheet row (a blok can have two rows), the pokok (PKK) and Ha
-- pruned per month in pruning_bulan. pruning_sync = when the sheet was last read and how it went.
CREATE TABLE IF NOT EXISTS pruning_blok (
  id SERIAL PRIMARY KEY,
  estate TEXT NOT NULL,
  divisi TEXT NOT NULL DEFAULT '',
  blok TEXT NOT NULL,
  planting_material TEXT NOT NULL DEFAULT '',
  tahun_tanam INTEGER,
  ha DOUBLE PRECISION,
  sph DOUBLE PRECISION,
  kondisi TEXT NOT NULL DEFAULT '',
  urut INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pruning_blok_estate ON pruning_blok(estate, blok);
CREATE TABLE IF NOT EXISTS pruning_bulan (
  blok_id INTEGER NOT NULL REFERENCES pruning_blok(id) ON DELETE CASCADE,
  tahun INTEGER NOT NULL,
  bulan INTEGER NOT NULL,
  pkk DOUBLE PRECISION NOT NULL DEFAULT 0,
  ha DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pruning_bulan_blok ON pruning_bulan(blok_id, tahun);
CREATE TABLE IF NOT EXISTS pruning_sync (
  id INTEGER PRIMARY KEY DEFAULT 1,
  checked_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  baris INTEGER,
  error TEXT
);
ALTER TABLE master_oli ADD COLUMN IF NOT EXISTS estates TEXT NOT NULL DEFAULT '';

-- ---- Koperasi karyawan (for now Nilam only; `koperasi` = the estate running it) ----
-- Barang the koperasi sells, kode K0001... from the koperasi sheet. harga_jual = price to members,
-- harga_beli = last purchase price. lacak_stok = false for what isn't bought in (AIR GALON from the
-- depo air): it is sold, but has no stock.
CREATE TABLE IF NOT EXISTS koperasi_barang (
  kode TEXT PRIMARY KEY,
  koperasi TEXT NOT NULL DEFAULT 'NILAM',
  nama TEXT NOT NULL,
  satuan TEXT NOT NULL DEFAULT '',
  harga_jual DOUBLE PRECISION NOT NULL DEFAULT 0,
  harga_beli DOUBLE PRECISION NOT NULL DEFAULT 0,
  stok_min DOUBLE PRECISION NOT NULL DEFAULT 0,
  lacak_stok BOOLEAN NOT NULL DEFAULT true,
  aktif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Anggota: who takes goods. kode = the karyawan's NIK (TBL1234...), so name / jabatan / estate come
-- from master karyawan while the employee is there; nama / jabatan / estate / divisi here are the
-- last known values, kept for one who has left (the history and what is still owed stay readable).
-- jenis INSTANSI = not a person (KANTOR, MESS TAMU, ...): paid by the company, not potong gaji.
CREATE TABLE IF NOT EXISTS koperasi_anggota (
  kode TEXT PRIMARY KEY,
  koperasi TEXT NOT NULL DEFAULT 'NILAM',
  jenis TEXT NOT NULL DEFAULT 'KARYAWAN',
  nama TEXT NOT NULL DEFAULT '',
  jabatan TEXT NOT NULL DEFAULT '',
  estate TEXT NOT NULL DEFAULT '',
  divisi TEXT NOT NULL DEFAULT '',
  aktif BOOLEAN NOT NULL DEFAULT true,
  catatan TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Every movement: JUAL (an anggota takes goods; bon groups the lines of one pengambilan), BELI
-- (bought in), RUSAK (thrown away). periode = the payroll month ('YYYY-MM') a JUAL is deducted in.
-- Stock of a barang = BELI - JUAL - RUSAK. sumber 'IMPORT' = from the koperasi Google Sheet.
CREATE TABLE IF NOT EXISTS koperasi_tx (
  id SERIAL PRIMARY KEY,
  koperasi TEXT NOT NULL DEFAULT 'NILAM',
  jenis TEXT NOT NULL,
  tanggal_iso TEXT NOT NULL,
  periode TEXT NOT NULL,
  bon TEXT,
  barang_kode TEXT NOT NULL REFERENCES koperasi_barang(kode),
  qty DOUBLE PRECISION NOT NULL,
  harga DOUBLE PRECISION NOT NULL DEFAULT 0,
  total DOUBLE PRECISION NOT NULL DEFAULT 0,
  anggota_kode TEXT REFERENCES koperasi_anggota(kode),
  bayar TEXT NOT NULL DEFAULT 'POTONG_GAJI',
  no_po TEXT NOT NULL DEFAULT '',
  keterangan TEXT NOT NULL DEFAULT '',
  evidence_id UUID,
  sumber TEXT,
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_koperasi_tx_periode ON koperasi_tx(koperasi, jenis, periode);
CREATE INDEX IF NOT EXISTS idx_koperasi_tx_anggota ON koperasi_tx(anggota_kode, tanggal_iso);
CREATE INDEX IF NOT EXISTS idx_koperasi_tx_barang ON koperasi_tx(barang_kode);

-- Stok opname koperasi: stok_sistem = the stock when the opname was started; fisik = what was counted.
-- Finishing it books each difference as a KOREKSI movement (qty signed: + found, - missing) of
-- fisik - stok_sistem, so sales during the count don't skew it. KOREKSI also comes from a single
-- Koreksi Stok (opname_id NULL).
CREATE TABLE IF NOT EXISTS koperasi_opname (
  id SERIAL PRIMARY KEY,
  koperasi TEXT NOT NULL DEFAULT 'NILAM',
  tanggal_iso TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  catatan TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  selesai_at TIMESTAMPTZ,
  selesai_oleh INTEGER
);
CREATE TABLE IF NOT EXISTS koperasi_opname_line (
  opname_id INTEGER NOT NULL REFERENCES koperasi_opname(id),
  barang_kode TEXT NOT NULL REFERENCES koperasi_barang(kode),
  stok_sistem DOUBLE PRECISION NOT NULL,
  fisik DOUBLE PRECISION,
  keterangan TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (opname_id, barang_kode)
);
ALTER TABLE koperasi_tx ADD COLUMN IF NOT EXISTS opname_id INTEGER;

-- Pelunasan bon koperasi: a karyawan's potong gaji of a periode (sum of its JUAL rows) is sent to HRD
-- on the 1st of the next month and deducted on the 10th-15th. Each payment of that bill is a row here
-- (cara POTONG_GAJI / TUNAI / LAINNYA; part payments allowed). A bill still open after the 15th of the
-- next month is a tunggakan: that karyawan can't take goods until it is paid.
CREATE TABLE IF NOT EXISTS koperasi_bayar (
  id SERIAL PRIMARY KEY,
  koperasi TEXT NOT NULL DEFAULT 'NILAM',
  anggota_kode TEXT NOT NULL REFERENCES koperasi_anggota(kode),
  periode TEXT NOT NULL,
  jumlah DOUBLE PRECISION NOT NULL,
  tanggal_iso TEXT NOT NULL,
  cara TEXT NOT NULL DEFAULT 'POTONG_GAJI',
  keterangan TEXT NOT NULL DEFAULT '',
  sumber TEXT,
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_koperasi_bayar ON koperasi_bayar(anggota_kode, periode);

-- Master data pupuk: the jenis pupuk Inventory Pupuk and Stok Opname offer (pupuk_log.jenis_pupuk holds
-- the nama). estates '' = every estate, like master_oli. Satuan is always KG.
CREATE TABLE IF NOT EXISTS master_pupuk (
  id SERIAL PRIMARY KEY,
  kode TEXT UNIQUE NOT NULL,
  nama TEXT UNIQUE NOT NULL,
  keterangan TEXT NOT NULL DEFAULT '',
  estates TEXT NOT NULL DEFAULT ''
);
INSERT INTO master_pupuk (kode, nama) VALUES
  ('PPK-01', 'PUPUK NPK 12.12.17.2'),
  ('PPK-02', 'PUPUK ROCK PHOSPAT'),
  ('PPK-03', 'PUPUK DOLOMITE'),
  ('PPK-04', 'PUPUK NPK 12.12.17.2+TE'),
  ('PPK-05', 'PUPUK UREA'),
  ('PPK-06', 'PUPUK MOP'),
  ('PPK-07', 'PUPUK NPK 13.6.27.4+B (HI KAY)'),
  ('PPK-08', 'PUPUK NPK 7.6.34 ZNCUB (PEAT KAY)')
ON CONFLICT DO NOTHING;

-- Dokumen & Link: links to the files kept elsewhere (Google Sheets / Docs / Drive, PDF...), opened in a new
-- tab. modul '' = umum, estate '' = every estate (else only accounts with that estate see it).
CREATE TABLE IF NOT EXISTS dokumen_link (
  id SERIAL PRIMARY KEY,
  judul TEXT NOT NULL,
  url TEXT NOT NULL,
  kategori TEXT NOT NULL DEFAULT 'LAINNYA',
  modul TEXT NOT NULL DEFAULT '',
  estate TEXT NOT NULL DEFAULT '',
  keterangan TEXT NOT NULL DEFAULT '',
  pinned BOOLEAN NOT NULL DEFAULT false,
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dokumen_link_modul ON dokumen_link(modul, estate);
-- PIC: who looks after the document (the Excel-like list in Master Data).
ALTER TABLE dokumen_link ADD COLUMN IF NOT EXISTS pic TEXT NOT NULL DEFAULT '';

-- Stok opname done properly: a team counts (tim, at least two people), with a witness (saksi) and the
-- person who holds the stock (pemegang) named on the Berita Acara. hitung_buta: the counters don't see
-- stok sistem until the count is finished (dibuka_at), then they explain every selisih. Each line keeps
-- who counted it, and someone who counted can't approve.
ALTER TABLE opname ADD COLUMN IF NOT EXISTS tim TEXT NOT NULL DEFAULT '';
ALTER TABLE opname ADD COLUMN IF NOT EXISTS saksi TEXT NOT NULL DEFAULT '';
ALTER TABLE opname ADD COLUMN IF NOT EXISTS pemegang TEXT NOT NULL DEFAULT '';
ALTER TABLE opname ADD COLUMN IF NOT EXISTS hitung_buta BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE opname ADD COLUMN IF NOT EXISTS dibuka_at TIMESTAMPTZ;
ALTER TABLE opname ADD COLUMN IF NOT EXISTS dibuka_oleh_nama TEXT;
ALTER TABLE opname_line ADD COLUMN IF NOT EXISTS dihitung_oleh INTEGER;
ALTER TABLE opname_line ADD COLUMN IF NOT EXISTS dihitung_oleh_nama TEXT;
ALTER TABLE opname_line ADD COLUMN IF NOT EXISTS dihitung_at TIMESTAMPTZ;

-- Koperasi barang: the expiry date of the stock on hand (the nearest one; NULL = none / not tracked) and a
-- free note. Stok Barang colours it and the Koperasi page reminds of barang expired / expiring in 30 days.
ALTER TABLE koperasi_barang ADD COLUMN IF NOT EXISTS exp_iso TEXT;
ALTER TABLE koperasi_barang ADD COLUMN IF NOT EXISTS catatan TEXT NOT NULL DEFAULT '';
-- Tanggal expired of each arrival (Stock In row); the stock on hand is spread over them FEFO.
ALTER TABLE koperasi_tx ADD COLUMN IF NOT EXISTS exp_iso TEXT;

-- Barang Rusak / Expired (jenis RUSAK): alasan EXPIRED | RUSAK, and a check by a second account with
-- Approve Koperasi (never the one who entered it): status MENUNGGU -> DISETUJUI / DITOLAK. MENUNGGU is
-- already out of stock (the barang is pulled off the shelf, nobody can sell it); DITOLAK puts it back
-- (kopStokSql). NULL = entered before this check, counted as approved. harga = harga beli then (the loss).
ALTER TABLE koperasi_tx ADD COLUMN IF NOT EXISTS alasan TEXT;
ALTER TABLE koperasi_tx ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE koperasi_tx ADD COLUMN IF NOT EXISTS diperiksa_oleh INTEGER;
ALTER TABLE koperasi_tx ADD COLUMN IF NOT EXISTS diperiksa_at TIMESTAMPTZ;
ALTER TABLE koperasi_tx ADD COLUMN IF NOT EXISTS diperiksa_catatan TEXT NOT NULL DEFAULT '';

-- Klinik obat / BHP pulled out (tujuan DIBUANG): alasan EXPIRED | RUSAK | RETUR and a check by a second
-- account with Approve Klinik (never the one who entered it): status MENUNGGU -> DISETUJUI / DITOLAK.
-- MENUNGGU already took the stock out of its batch (quarantined, can't go to a patient); DITOLAK puts it
-- back where it came from (alloc). NULL = thrown away before this check, counted as approved.
ALTER TABLE klinik_stock_tx ADD COLUMN IF NOT EXISTS alasan TEXT;
ALTER TABLE klinik_stock_tx ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE klinik_stock_tx ADD COLUMN IF NOT EXISTS diperiksa_oleh INTEGER;
ALTER TABLE klinik_stock_tx ADD COLUMN IF NOT EXISTS diperiksa_at TIMESTAMPTZ;
ALTER TABLE klinik_stock_tx ADD COLUMN IF NOT EXISTS diperiksa_catatan TEXT NOT NULL DEFAULT '';

-- Edit bulan lalu, sementara: until this moment the account may edit (not delete, not approve) the
-- transactions of earlier months in the modules and estates it already has. NULL = only the current month.
ALTER TABLE users ADD COLUMN IF NOT EXISTS edit_lampau_until TIMESTAMPTZ;

-- Kendaraan & Alat Berat (PT.AKSS for now; pt keeps room for UKM). kode = the unit code also used by BBM
-- (BAP01, DT01, MT15 ...); eksternal (sewa) units without one get EXT-<jenis>-<n>. id_unit = the ID from the
-- old sheet (AK-DMTR-1 ...). kondisi BAIK / RUSAK / STANDBY / MANGKRAK ('' = belum diisi) with the dates of
-- the current breakdown; downtime = days since tgl_rusak while not BAIK.
CREATE TABLE IF NOT EXISTS kendaraan_unit (
  id SERIAL PRIMARY KEY,
  pt TEXT NOT NULL DEFAULT 'AKSS',
  kode TEXT NOT NULL,
  id_unit TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'INTERNAL',
  grup TEXT NOT NULL DEFAULT '',
  jenis TEXT NOT NULL DEFAULT '',
  nama TEXT NOT NULL DEFAULT '',
  kepemilikan TEXT NOT NULL DEFAULT '',
  tgl_perolehan TEXT,
  pemilik TEXT NOT NULL DEFAULT '',
  alokasi TEXT NOT NULL DEFAULT '',
  info TEXT NOT NULL DEFAULT '',
  kondisi TEXT NOT NULL DEFAULT '',
  tgl_rusak TEXT,
  tgl_selesai TEXT,
  keterangan TEXT NOT NULL DEFAULT '',
  aktif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pt, kode)
);
-- Kondisi harian of a unit: R = running, S = standby / breakdown sebagian, B = breakdown.
CREATE TABLE IF NOT EXISTS kendaraan_harian (
  unit_id INTEGER NOT NULL REFERENCES kendaraan_unit(id) ON DELETE CASCADE,
  tanggal TEXT NOT NULL,
  kondisi TEXT NOT NULL CHECK (kondisi IN ('R', 'S', 'B')),
  user_id INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (unit_id, tanggal)
);
CREATE INDEX IF NOT EXISTS idx_kendaraan_harian_tanggal ON kendaraan_harian(tanggal);

-- Berita Acara Pemusnahan (Klinik obat / BHP, Koperasi barang rusak): nomor = urut per modul + unit + tahun
-- (001/BA-PMS/KLINIK-NILAM/10/2026), isian = the form (company, place, cara, signatories), items = a
-- snapshot of the approved rows it covers (berita_acara_item keeps each row in one active BA only).
-- status MENUNGGU (made, printed, sent to the manager) -> DISETUJUI (evidence_id = capture of the
-- manager's WhatsApp reply) -> SELESAI (destroyed; foto_musnah optional), or BATAL (items free again).
CREATE TABLE IF NOT EXISTS berita_acara (
  id SERIAL PRIMARY KEY,
  modul TEXT NOT NULL,
  unit TEXT NOT NULL,
  tahun INTEGER NOT NULL,
  urut INTEGER NOT NULL,
  nomor TEXT NOT NULL UNIQUE,
  tanggal TEXT NOT NULL,
  isian JSONB NOT NULL,
  items JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'MENUNGGU',
  dibuat_oleh INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disetujui_nama TEXT NOT NULL DEFAULT '',
  disetujui_jabatan TEXT NOT NULL DEFAULT '',
  disetujui_tgl TEXT,
  evidence_id UUID,
  disetujui_input_oleh INTEGER,
  selesai_tgl TEXT,
  selesai_catatan TEXT NOT NULL DEFAULT '',
  foto_musnah UUID,
  selesai_oleh INTEGER,
  batal_oleh INTEGER,
  batal_alasan TEXT NOT NULL DEFAULT '',
  UNIQUE (modul, unit, tahun, urut)
);
CREATE TABLE IF NOT EXISTS berita_acara_item (
  ba_id INTEGER NOT NULL REFERENCES berita_acara(id) ON DELETE CASCADE,
  modul TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  PRIMARY KEY (ba_id, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_ba_item_ref ON berita_acara_item(modul, ref_id);

-- Who is online: the last request of an account (at most once a minute, or when its page changes) and
-- the app page it was on (sent by the browser). Online = seen in the last 5 minutes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_page TEXT;

-- Chat between accounts: DM (two people, dm_key "<smaller id>-<larger id>"), ESTATE (one room per estate,
-- everyone who has that estate) and GRUP (made by a Super User, its chat_member rows). chat_read keeps
-- how far each account has read a room (receipts and unread counts). A message may carry a photo
-- (evidence_id) and a link to a page of the app (link_url / link_label).
CREATE TABLE IF NOT EXISTS chat_room (
  id SERIAL PRIMARY KEY,
  jenis TEXT NOT NULL,
  nama TEXT NOT NULL DEFAULT '',
  estate TEXT UNIQUE,
  dm_key TEXT UNIQUE,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_member (
  room_id INTEGER NOT NULL REFERENCES chat_room(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_member_user ON chat_member(user_id);
CREATE TABLE IF NOT EXISTS chat_message (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES chat_room(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  isi TEXT NOT NULL DEFAULT '',
  evidence_id UUID,
  link_url TEXT,
  link_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_message_room ON chat_message(room_id, id);
CREATE TABLE IF NOT EXISTS chat_read (
  room_id INTEGER NOT NULL REFERENCES chat_room(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);

-- Depo Air (Koperasi): a barang marked depo_air is the water of the koperasi's depots (K0188 AIR GALON
-- isi ulang). Each of its Stock Out rows says which depot served it (depo NILAM / FIRUS): set by the
-- trigger from the buyer's estate when not given (Firus -> FIRUS, anything else -> NILAM), changeable in
-- the Depo Air tab. depo_air_biaya = the depot's running costs per month, for its laba / rugi.
ALTER TABLE koperasi_barang ADD COLUMN IF NOT EXISTS depo_air BOOLEAN NOT NULL DEFAULT false;
UPDATE koperasi_barang SET depo_air = true WHERE kode = 'K0188' AND NOT depo_air;
ALTER TABLE koperasi_tx ADD COLUMN IF NOT EXISTS depo TEXT;
CREATE OR REPLACE FUNCTION koperasi_tx_depo() RETURNS trigger AS $$
BEGIN
  IF NEW.depo IS NULL AND NEW.jenis = 'JUAL' AND EXISTS (SELECT 1 FROM koperasi_barang b WHERE b.kode = NEW.barang_kode AND b.depo_air) THEN
    -- The buyer's estate; one without an estate (an instansi) by its kode / name (FRS..., "Kantor Firus").
    NEW.depo := COALESCE((SELECT CASE WHEN upper(COALESCE(NULLIF(k.estate, ''), a.estate, '')) = 'FIRUS'
                                        OR (COALESCE(NULLIF(k.estate, ''), a.estate, '') = '' AND (a.kode LIKE 'FRS%' OR upper(a.nama) LIKE '%FIRUS%'))
                                      THEN 'FIRUS' ELSE 'NILAM' END
                            FROM koperasi_anggota a LEFT JOIN karyawan k ON UPPER(REPLACE(k.nik, ' ', '')) = a.kode WHERE a.kode = NEW.anggota_kode LIMIT 1), 'NILAM');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_koperasi_tx_depo ON koperasi_tx;
CREATE TRIGGER trg_koperasi_tx_depo BEFORE INSERT OR UPDATE OF barang_kode ON koperasi_tx FOR EACH ROW EXECUTE FUNCTION koperasi_tx_depo();
UPDATE koperasi_tx t SET depo = CASE WHEN upper(COALESCE(NULLIF(k.estate, ''), a.estate, '')) = 'FIRUS'
                                         OR (COALESCE(NULLIF(k.estate, ''), a.estate, '') = '' AND (a.kode LIKE 'FRS%' OR upper(a.nama) LIKE '%FIRUS%'))
                                       THEN 'FIRUS' ELSE 'NILAM' END
  FROM koperasi_barang b, koperasi_anggota a LEFT JOIN karyawan k ON UPPER(REPLACE(k.nik, ' ', '')) = a.kode
 WHERE b.kode = t.barang_kode AND b.depo_air AND a.kode = t.anggota_kode AND t.jenis = 'JUAL' AND t.depo IS NULL;
UPDATE koperasi_tx t SET depo = 'NILAM' FROM koperasi_barang b WHERE b.kode = t.barang_kode AND b.depo_air AND t.jenis = 'JUAL' AND t.depo IS NULL;
CREATE TABLE IF NOT EXISTS depo_air_biaya (
  id SERIAL PRIMARY KEY,
  depo TEXT NOT NULL,
  periode TEXT NOT NULL,
  tanggal_iso TEXT NOT NULL,
  kategori TEXT NOT NULL,
  keterangan TEXT NOT NULL DEFAULT '',
  jumlah DOUBLE PRECISION NOT NULL,
  evidence_id UUID,
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_depo_biaya ON depo_air_biaya(depo, periode);
