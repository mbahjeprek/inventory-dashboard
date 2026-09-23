# Inventory Dashboard

Dashboard monitoring & inventory barang. Ada **satu gudang fisik** (lokasi utama di Nilam) yang melayani
tiga tujuan/konsumen: Nilam, Zamrud, dan Firus. Stock adalah satu pool bersama — Nilam/Zamrud/Firus hanya
label tujuan barang keluar untuk keperluan laporan, bukan stok terpisah.

## Stack
- Frontend: Vite + React + TypeScript + Tailwind v4, recharts, xlsx, lucide-react
- Backend: Express + better-sqlite3 (SQLite lokal)

## Menjalankan

Backend (port 4000):
```
cd server
npm install
npm run import        # import master barang dari data_raw.csv (sekali saja)
npm run import:logs   # import histori stock in/out dari data_stock_in.csv & data_stock_out.csv
npm run import:karyawan  # import master karyawan dari data_karyawan.csv
npm run import:alat-berat # import master alat berat/kendaraan dari data_alat_berat.csv
npm run import:bbm       # import histori Solar & Bensin dari data_bbm_*.csv
npm run dev
```

Frontend (port 5173/5174):
```
npm install
npm run dev
```

Frontend akan proxy request `/api/*` ke backend di `http://localhost:4000`.

## Struktur data
- `items` — master barang: kode, nama, satuan, buffer stock, keterangan (status AMAN/BUFFER STOCK),
  dan **satu pool stok** (`stock_tersedia`, `stock_in`, `stock_out`, `stock_fisik`, `selisih_stock`)
- `transactions` — riwayat stock in/out/koreksi yang diinput manual lewat dashboard (menu "Transaksi").
  Kolom `tujuan` (Nilam/Zamrud/Firus) hanya metadata konsumen untuk Stock Out, tidak memecah stok.
- `stock_in_log` — histori penerimaan barang dari vendor, diimport dari sheet "STOCK IN" (menu "Stock In")
- `stock_out_log` — histori pengeluaran barang ke karyawan/estate, diimport dari sheet "STOCK OUT" (menu "Stock Out"),
  kolom `tujuan` diisi dari kolom ESTATE di sheet asli (dinormalisasi dari variasi ejaan seperti "Zambrud"/"Virus")
- `karyawan` — master data karyawan (NIK/NPP, nama, status, estate, lokasi kerja, NIK KTP), diimport dari
  `data_karyawan.csv` (menu "Karyawan"), upsert berdasarkan kolom `nik`
- `alat_berat` — master data kendaraan/alat berat pengguna BBM (kode, jenis unit, nama/model), diimport dari
  `data_alat_berat.csv` (menu "Alat Berat"), upsert berdasarkan kolom `kode`
- `bbm_log` — histori penerimaan & pemakaian Solar dan Bensin. Gudang fisik (kolom `lokasi`) hanya ada di
  3 tempat: **Nilam, WJA, KNS** — masing-masing punya sheet sendiri dengan STOCK AWAL/SALDO sendiri
  (`data_bbm_solar_{nilam,wja,kns}.csv`, `data_bbm_bensin_{nilam,wja,kns}.csv`). Kolom `estate` = tujuan
  distribusi/pemakaian di bawah gudang itu (bukan gudang terpisah): untuk Nilam bisa NILAM/ZAMRUD/FIRUS/AKSS/UKM,
  untuk WJA bisa WJA/LUBAKAN/TAGUL, untuk KNS bisa KNS/MALAPIAK/TAGANG. Sheet Solar "Zamrud" dan "Firus" asalnya
  terlihat seperti gudang sendiri (steker STOCK AWAL/SALDO sendiri) tapi sebenarnya tidak punya gudang fisik —
  diimport sebagai `lokasi=NILAM, estate=ZAMRUD`/`FIRUS` (`data_bbm_solar_{zamrud,firus}.csv`, lihat
  `importBbm.ts`). Karena itu, saldo/stok terkini per gudang (endpoint `/api/bbm/summary`) sengaja hanya
  dihitung dari baris `estate = lokasi` (ledger langsung gudang itu sendiri) — kalau Zamrud/Firus ikut
  dihitung, saldo bisa salah ambil dari ledger yang tidak berkaitan. Re-import dengan `npm run import:bbm`
  menghapus & mengisi ulang seluruh tabel.

## Re-import data dari Excel/Google Sheet baru
Ganti isi `server/data_raw.csv` dengan file CSV baru (export dari Google Sheet: `File > Download > CSV`, atau
export URL `.../export?format=csv&gid=<GID>`), lalu jalankan `npm run import` di folder `server`. Import bersifat
upsert berdasarkan kolom `kode`, jadi aman dijalankan berulang.
