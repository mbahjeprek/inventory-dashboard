#!/usr/bin/env bash
# Sets up a fresh Ubuntu 22.04 / 24.04 VPS for the inventory dashboard (see deploy/PINDAH-VPS.md):
# Node 22, PostgreSQL 17, Nginx + HTTPS (Let's Encrypt), firewall, the app as a systemd service and
# a daily backup. Run as root:   DOMAIN=inventory.contoh.com EMAIL=admin@contoh.com bash setup-vps.sh
# Safe to run again (each step checks what is already there).
set -euo pipefail

DOMAIN="${DOMAIN:?isi DOMAIN, mis. DOMAIN=inventory.contoh.com}"
EMAIL="${EMAIL:?isi EMAIL untuk sertifikat HTTPS}"
APP_DIR=/opt/agrobarokah
DATA_DIR=/var/lib/agrobarokah
REPO=https://github.com/mbahjeprek/inventory-dashboard.git
DB_NAME=inventory
DB_USER=agro

echo "== Paket sistem"
apt-get update -y
apt-get install -y curl git nginx certbot python3-certbot-nginx ufw ca-certificates gnupg

echo "== Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== PostgreSQL 17 (sama dengan Supabase)"
if ! command -v psql >/dev/null || ! psql --version | grep -q " 17"; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-17
fi

echo "== User sistem, folder data"
id agro >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/agro --shell /bin/bash agro
install -d -o agro -g agro "$APP_DIR" "$DATA_DIR" "$DATA_DIR/evidence" /var/backups/agrobarokah

echo "== Database"
if [ ! -f "$DATA_DIR/db-password" ]; then
  openssl rand -hex 24 > "$DATA_DIR/db-password"
  chmod 600 "$DATA_DIR/db-password"
fi
DB_PASS="$(cat "$DATA_DIR/db-password")"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -q 1 ||
  sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 ||
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"

echo "== Kode aplikasi (repo public, tanpa kunci)"
[ -d "$APP_DIR/.git" ] || sudo -u agro git clone "$REPO" "$APP_DIR"

echo "== File .env"
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
DIRECT_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
DATABASE_SSL=false
# Samakan dengan JWT_SECRET di Vercel supaya user tidak perlu login ulang setelah pindah.
JWT_SECRET=$(openssl rand -hex 32)
EVIDENCE_DIR=$DATA_DIR/evidence
EOF
  chown agro:agro "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

echo "== Build aplikasi"
sudo -u agro bash -c "cd $APP_DIR && npm ci && npm run build"

echo "== Service systemd"
cp "$APP_DIR/deploy/agrobarokah.service" /etc/systemd/system/agrobarokah.service
systemctl daemon-reload
systemctl enable agrobarokah

echo "== Nginx + HTTPS"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/agrobarokah
ln -sf /etc/nginx/sites-available/agrobarokah /etc/nginx/sites-enabled/agrobarokah
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect || \
  echo "!! Sertifikat HTTPS gagal: pastikan DNS $DOMAIN sudah mengarah ke IP VPS ini, lalu: certbot --nginx -d $DOMAIN"

echo "== Firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "== Backup harian (database + foto, simpan 14 hari)"
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/agrobarokah-backup
echo "30 2 * * * root /usr/local/bin/agrobarokah-backup" > /etc/cron.d/agrobarokah-backup

echo
echo "Selesai. Langkah berikutnya: pindahkan data (deploy/PINDAH-VPS.md langkah 4), lalu: systemctl start agrobarokah"
