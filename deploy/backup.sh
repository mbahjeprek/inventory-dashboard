#!/usr/bin/env bash
# Daily backup on the VPS (cron, set up by setup-vps.sh): the database and the foto bukti folder,
# kept 14 days in /var/backups/agrobarokah. Copy them off the server now and then too.
set -euo pipefail
DIR=/var/backups/agrobarokah
STAMP=$(date +%Y%m%d-%H%M)
sudo -u postgres pg_dump -Fc inventory > "$DIR/db-$STAMP.dump"
tar -czf "$DIR/foto-$STAMP.tar.gz" -C /var/lib/agrobarokah evidence
find "$DIR" -type f -mtime +14 -delete
