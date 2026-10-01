#!/usr/bin/env bash
# Deploys the latest master on the VPS: pull, install, build, restart. Run as root:
#   bash /opt/agrobarokah/deploy/update.sh
set -euo pipefail
cd /opt/agrobarokah
sudo -u agro git pull --ff-only
sudo -u agro npm ci
sudo -u agro npm run build
systemctl restart agrobarokah
sleep 2
systemctl is-active agrobarokah && curl -fsS -o /dev/null -w "OK %{http_code}\n" http://127.0.0.1:3000/
