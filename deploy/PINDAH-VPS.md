# Pindah dari Vercel + Supabase ke VPS sendiri

Sekarang: tampilan + API di Vercel (`agrobarokah.vercel.app`), database Postgres 17 dan foto bukti
di Supabase. Setelah pindah: semuanya di satu VPS — Node.js (aplikasi), PostgreSQL 17 (database),
foto bukti di disk, Nginx + HTTPS di depan, backup harian otomatis.

Kode aplikasi sama untuk keduanya: Vercel tetap jalan dari `api/index.ts` sampai hari pindah, VPS
memakai `server/src/serve.ts` (`npm start`).

## 1. Yang perlu disiapkan

| Apa | Keterangan |
|---|---|
| VPS | Ubuntu 24.04 (atau 22.04), minimal 1 vCPU, 2 GB RAM, 20 GB disk. Lokasi Indonesia/Singapura. Akses root lewat SSH. |
| Domain | `*.vercel.app` tidak bisa diarahkan ke VPS, jadi perlu domain/subdomain sendiri, mis. `inventory.barokahperkasagroup.com`. Buat **A record** ke IP VPS. |
| Email | Untuk sertifikat HTTPS Let's Encrypt (pemberitahuan kedaluwarsa). |

## 2. Setup VPS (± 15 menit)

Login ke VPS sebagai root, lalu:

```bash
# dari laptop: scp deploy/setup-vps.sh root@IP_VPS:/root/
DOMAIN=inventory.contoh.com EMAIL=admin@contoh.com bash /root/setup-vps.sh
```

Pertama kali, skrip berhenti di clone repo dan menampilkan **public key**. Daftarkan di GitHub →
repo `inventory-dashboard` → Settings → Deploy keys → Add (read-only), lalu jalankan skrip lagi.

Skrip memasang Node 22, PostgreSQL 17, Nginx, HTTPS, firewall, service `agrobarokah`, dan backup
harian jam 02:30 (`/var/backups/agrobarokah`, 14 hari).

Ganti `JWT_SECRET` di `/opt/agrobarokah/.env` dengan nilai yang sama seperti di Vercel / `.env`
laptop, supaya user tidak perlu login ulang.

## 3. Uji coba (data masih di Supabase)

Opsional, untuk mencoba VPS sebelum hari-H: sementara isi `DATABASE_URL` di `.env` VPS dengan URL
Supabase, `systemctl start agrobarokah`, buka `https://DOMAIN`. Kembalikan ke URL lokal sebelum langkah 4.

## 4. Hari-H: pindah data (± 30 menit, input dihentikan dulu)

1. Umumkan ke admin estate: **jangan input** selama pindahan.
2. Di VPS, salin database dari Supabase (pakai *Session pooler* port 5432 — koneksi langsung
   `db.xxx.supabase.co` hanya IPv6):

   ```bash
   cd /tmp
   pg_dump "postgresql://postgres.lenwetjhfvbncysjnmqy:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres" \
     --schema=public --no-owner --no-privileges -Fc -f supabase.dump
   sudo -u postgres pg_restore --no-owner --role=agro -d inventory supabase.dump
   ```

   Pesan `schema "public" already exists` boleh diabaikan.
3. Salin foto bukti (`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` ambil dari Vercel → Settings → Environment Variables):

   ```bash
   cd /opt/agrobarokah
   sudo -u agro SUPABASE_URL=https://lenwetjhfvbncysjnmqy.supabase.co SUPABASE_SERVICE_KEY=... npm run evidence:copy
   ```
4. Jalankan: `systemctl start agrobarokah`, buka `https://DOMAIN`, cek login, stok, riwayat, foto bukti.
5. Arahkan alamat lama ke yang baru: ganti `vercel.json` dengan redirect ke domain baru dan push,
   supaya bookmark `agrobarokah.vercel.app` tetap sampai.
6. Supabase jangan dihapus dulu — simpan 1–2 minggu sebagai cadangan.

## 5. Sesudah pindah

- **Update aplikasi**: `bash /opt/agrobarokah/deploy/update.sh` (pull, build, restart). Push ke
  master tidak lagi otomatis live seperti di Vercel.
- **Log**: `journalctl -u agrobarokah -f`
- **Restart**: `systemctl restart agrobarokah`
- **Restore backup**: `sudo -u postgres pg_restore --clean --if-exists -d inventory /var/backups/agrobarokah/db-XXXX.dump`
- Sesekali salin isi `/var/backups/agrobarokah` ke luar server (Google Drive, laptop).
