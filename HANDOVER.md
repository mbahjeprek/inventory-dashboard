# Serah Terima: Sistem Inventory (agrobarokah)

Dokumen ini untuk developer yang mengambil alih sistem. Baca dari atas sampai **Langkah pertama**, sisanya
dipakai sebagai rujukan. `README.md` sudah usang (masih menyebut SQLite); yang berlaku adalah dokumen ini.

## 1. Gambaran singkat

Aplikasi web internal untuk inventory dan administrasi estate: Gudang, BBM, Pupuk, Oli, Klinik (obat,
pasien, laporan harian, permintaan obat / barang, barang expired & Berita Acara Pemusnahan), Koperasi
karyawan, Kendaraan, Pruning, Stok Opname, Pinjaman & Transfer antar estate, Persetujuan (tanda tangan
digital), Dokumen & Link, Daftar SOP, Master data, Pengguna & hak akses, Log Aktivitas, Chat.

| Bagian | Tempat | Isi |
|---|---|---|
| Kode | GitHub `mbahjeprek/inventory-dashboard`, branch `master` | Seluruh aplikasi (frontend + API dalam satu repo) |
| Aplikasi live | Vercel, `https://agrobarokah.vercel.app`, region `sin1` | Build otomatis setiap push ke `master` |
| Data | Supabase: Postgres 17 | Semua tabel; skema di `server/src/schema.sql` |
| Foto bukti | Supabase Storage | Foto nota, barang rusak, surat bertanda tangan, dll. (tabel `evidence` menyimpan metadata) |

**Tidak ada data di laptop.** `server/inventory.db` adalah database SQLite lama sebelum pindah ke Supabase
(sudah dimigrasikan lewat `npm run db:migrate`); jangan dipakai.

## 2. Akses yang harus diterima

Minta ke pemilik lama sebelum mulai; centang kalau sudah:

- [ ] **GitHub**: collaborator (atau repo ditransfer) `mbahjeprek/inventory-dashboard`.
- [ ] **Supabase**: diundang ke organization sebagai Owner / Administrator (database, storage, backup, log).
- [ ] **Vercel**: anggota project (paket Hobby tidak bisa menambah anggota, jadi perlu paket Pro atau project
      ditransfer ke akun Anda). Di sini ada environment variables production dan log server.
- [ ] **Isi `.env`** (lihat bagian 3), diberikan lewat password manager, bukan chat.
- [ ] **Akun aplikasi sendiri**: Super User atas nama Anda (jangan memakai akun orang lain, supaya Log
      Aktivitas tetap mencatat siapa melakukan apa).

## 3. Secret / environment variables

Template ada di `.env.example`. File `.env` di-ignore git, jangan pernah di-commit.

| Variabel | Dari mana | Dipakai untuk |
|---|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string, **pooler port 6543** (`?pgbouncer=true`) | Koneksi aplikasi (lokal dan Vercel) |
| `DIRECT_URL` | Connection string port 5432 | Hanya skrip skema / migrasi. Catatan: host `db.<ref>.supabase.co` bisa tidak resolve dari jaringan kantor (IPv6); kalau begitu pakai pooler, lihat bagian 6 |
| `JWT_SECRET` | String acak panjang | Menandatangani cookie login. **Harus sama** di lokal dan Vercel. Mengganti nilainya membuat semua pengguna logout |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Penyimpanan foto bukti |
| `SUPABASE_SERVICE_KEY` | Secret key (`sb_secret_...`) atau `service_role` lama | Penyimpanan foto bukti (tanpa ini, kolom Foto Bukti disembunyikan) |
| `EVIDENCE_DIR`, `PORT`, `DATABASE_SSL` | Opsional | Hanya untuk mode VPS (`deploy/`) |

Nilai production yang berlaku ada di Vercel → Project → Settings → Environment Variables.

## 4. Langkah pertama (laptop baru)

1. Pasang **Node.js 22** dan **Git**.
2. `git clone https://github.com/mbahjeprek/inventory-dashboard.git` lalu `cd inventory-dashboard`.
3. `npm install` (jangan menyalin folder `node_modules` dari laptop lain).
4. Buat `.env` dari `.env.example`, isi dengan nilai di bagian 3.
5. `npm run dev`, buka **http://localhost:5199**. Hanya satu port: API Express berjalan di dalam dev server
   Vite (`vite.config.ts`, plugin `dev-api`), perubahan di `server/src` langsung berlaku di request berikutnya.
6. Login dengan akun Super User Anda.

**Penting:** aplikasi lokal tersambung ke **database production yang sama**. Apa pun yang disimpan dari
localhost langsung terlihat oleh semua pengguna. Untuk mencoba sesuatu, beri tanda jelas (mis. "DEMO") dan
hapus lagi, atau siapkan project Supabase terpisah.

## 5. Alur kerja sehari-hari

- **Cek sebelum push:** `npm run build` (menjalankan `tsc -b` lalu `vite build`). Tidak ada test otomatis;
  typecheck + build adalah pemeriksaan minimum. Untuk server: `npx tsc -p server --noEmit`. Lint: `npm run lint`.
- **Deploy:** commit lalu `git push origin master`. Vercel membangun dan menayangkan otomatis (± 1-2 menit).
  Sejauh ini perubahan langsung di-push ke `master` tanpa branch / PR.
- **Rollback:** Vercel → Deployments → pilih deployment sebelumnya → Promote to Production, lalu perbaiki kode.
- **Log error production:** Vercel → Project → Logs (fungsi `api/index`).

## 6. Mengubah database

- Skema lengkap: `server/src/schema.sql`, ditulis idempoten (`CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`). Setiap perubahan skema **ditambahkan ke file ini** juga.
- `npm run db:schema` menjalankan seluruh file lewat `DIRECT_URL`. Kalau `DIRECT_URL` tidak bisa dijangkau,
  jalankan **hanya pernyataan baru** lewat `DATABASE_URL` (pooler) dengan skrip `pg` kecil, atau tempel di
  Supabase → SQL Editor.
- **Blok kunci RLS harus tetap di paling akhir `schema.sql`.** Sejak 28-10-2026 semua tabel publik RLS-nya
  aktif dan role `anon` / `authenticated` tidak punya hak (REST API Supabase tidak memberi apa pun). Server
  aplikasi terhubung sebagai `postgres` sehingga tidak terpengaruh. Tabel baru: letakkan di atas blok itu dan
  aktifkan RLS-nya (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY; REVOKE ALL ... FROM anon, authenticated;`).
- Perubahan DDL di production: lakukan dengan sadar (sebaiknya saat sepi) dan uji dulu SQL-nya.

## 7. Peta kode

| File / folder | Isi |
|---|---|
| `server/src/app.ts` | Seluruh API Express (± 13 ribu baris), dikelompokkan per modul dengan komentar `// ----` |
| `server/src/auth.ts` | Login, sesi JWT (7 hari), hash password, **daftar semua hak akses (`ALL_PERMS`)** |
| `server/src/schema.sql` | Skema database |
| `server/src/db.ts` | Pool Postgres, `queryOne` / `queryMany` / `execute` / `withTransaction` (parameter bernama `@nama`) |
| `api/index.ts` | Entry Vercel (mengekspor `app`) |
| `server/src/serve.ts` | Entry mode VPS (`npm start`) |
| `src/App.tsx` | Daftar halaman / route |
| `src/lib/api.ts` | Semua pemanggilan API + tipe data frontend |
| `src/lib/access.ts` | Cerminan hak akses di frontend (hanya menentukan apa yang ditampilkan) + label centang di menu Pengguna |
| `src/pages/`, `src/components/` | Halaman dan komponen (mis. `KoperasiPage.tsx`, `KlinikPermintaanTab.tsx`, `BaPemusnahan.tsx`) |
| `src/lib/surat.ts`, `permintaanSurat.ts`, `suratBarang.ts` | Template surat yang dicetak (kop, Permintaan Obat, Permintaan Barang Klinik) |
| `public/` | Logo perusahaan dan gambar kop |
| `deploy/` | Skrip & panduan pindah ke VPS sendiri (`PINDAH-VPS.md`) |

## 8. Hak akses (wajib dipahami sebelum menambah fitur)

- Dua role: `superuser` (semua estate, semua hak) dan `estate` (hanya estate dan hak yang dicentang di
  menu **Pengguna**).
- Hak modul: `gudang|bbm|pupuk|klinik|oli` × `view|input|edit|delete|opname|approve`, ditambah hak khusus
  (mis. `klinik.ttd_*`, `klinik.barang_ttd_*`, `klinik.ttd_offline`, `ba.setujui`, `koperasi.*`,
  `koreksi.approve`, `sop.*`, `master.*`, `dokumen.*`, `monitor.log_user`).
- **Batas keamanan sebenarnya ada di server:** middleware memanggil `requiredPerms()` di `app.ts` untuk setiap
  request `/api`. **Setiap endpoint baru harus dipetakan di `requiredPerms()`**; route juga memeriksa estate
  (mis. `checkKlinik`, `estateAllowed`).
- Menambah hak baru = tiga tempat: `ALL_PERMS` di `server/src/auth.ts`, label di peta `other` dekat
  `permLabel` di `app.ts`, dan centang + label di `OTHER_PERMS` `src/lib/access.ts`.

## 9. Alur bisnis yang sering ditanyakan

- **Persetujuan:** satu halaman berisi semua yang menunggu tanda tangan akun itu. Badge di sidebar dan
  pengingat setelah login membaca `/api/persetujuan/jumlah`; dokumen baru yang butuh tanda tangan harus
  ditambahkan di sana.
- **Permintaan Obat:** 4 kotak berurutan (Dibuat → Diketahui → Disetujui 1 → Disetujui 2), kotak berikutnya
  ditawarkan ke orang yang namanya tertulis (kalau namanya akun estate itu) atau akun dengan centangnya.
  Bisa juga upload surat yang sudah ditandatangani di kertas.
- **Permintaan Barang Klinik (non-obat):** template surat klinik, Dimohon → Diperiksa → Disetujui; tabel
  `klinik_surat_barang`.
- **Barang Rusak / Expired:** input + foto → diperiksa orang kedua → Berita Acara Pemusnahan (pelaksana dan
  2 saksi tanda tangan → disetujui Estate Manager → dimusnahkan → ditutup). Banner muncul kalau ada barang
  disetujui yang belum dibuat BA-nya.
- **Stok Opname** mengunci pergerakan stok lokasi itu selama opname terbuka.
- **Master Alat Berat** (`alat_berat`): unit untuk Stock Out BBM. Transaksi menyimpan `kode`, jadi `nama`
  aman diubah, `kode` jangan.

## 10. Akun & operasional

- Buat / hapus akun lewat menu **Pengguna** (Super User). Darurat lewat terminal:
  `npm run user:create -- <username> <password> "<nama>"`, `npm run user:list`, `npm run user:delete -- <username>`.
- **Backup:** cek Supabase → Database → Backups untuk apa yang tersedia di paket yang dipakai. Disarankan tetap
  membuat `pg_dump` berkala ke tempat aman (contoh skrip: `deploy/backup.sh`).
- **Waktu:** semua tampilan memakai zona `Asia/Jakarta`.
- **Foto bukti:** hanya gambar, dikecilkan di browser (sisi terpanjang 1280 px, JPEG 70%) sebelum diupload.

## 11. Kalau pemilik lama lepas sepenuhnya

Setelah semua akses berpindah: ganti password database dan `SUPABASE_SERVICE_KEY`, perbarui di Vercel dan
`.env`, lalu cabut akses akun lama di GitHub / Vercel / Supabase. Ganti `JWT_SECRET` hanya bila perlu (semua
pengguna akan logout).
