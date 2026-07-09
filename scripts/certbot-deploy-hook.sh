#!/bin/bash
# certbot-deploy-hook.sh — global certbot deploy hook for the sitowebinun.click droplet
#
# Install by copying this file to /etc/letsencrypt/renewal-hooks/deploy/ on the droplet
# (chmod +x). Certbot runs everything in that directory automatically after ANY successful
# renewal of ANY cert — regardless of what triggered it (systemd certbot.timer, cron, or a
# manual `certbot renew`/`certbot certonly`). This replaces the old approach of running a
# separate wrapper script from cron, which only covered the DNS-01 wildcard cert and left
# the HTTP-01 app cert unhandled.
#
# Do NOT rely on relative paths here — this script runs from outside the project directory.
set -euo pipefail

PROJECT_DIR="/opt/docker/projects/pageforge"
COMPOSE_FILE="docker-compose.droplet.yml"

echo "[$(date -Iseconds)] certbot-deploy-hook: syncing renewed certs into Docker mount..."
cp -rL /etc/letsencrypt/live/. "${PROJECT_DIR}/data/certs/live/"
cp -rL /etc/letsencrypt/archive/. "${PROJECT_DIR}/data/certs/archive/"

cd "${PROJECT_DIR}"
docker compose -f "${COMPOSE_FILE}" exec -T nginx nginx -s reload

echo "[$(date -Iseconds)] certbot-deploy-hook: nginx reloaded with renewed certs"
