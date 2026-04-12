#!/bin/bash
# certbot-renew.sh — Renew all certs, copy to Docker mount, reload nginx
# Run via cron from project path, e.g.:
# 0 3 * * 1 /absolute/path/to/project/scripts/certbot-renew.sh >> /var/log/certbot-renew.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOY_CONFIG_FILE="${PROJECT_DIR}/.deploy/certbot.env"

if [ -f "${DEPLOY_CONFIG_FILE}" ]; then
  # shellcheck source=/dev/null
  source "${DEPLOY_CONFIG_FILE}"
fi

COMPOSE_FILE="${DEPLOY_COMPOSE_FILE:-docker-compose.droplet.yml}"

echo "[$(date -Iseconds)] Starting cert renewal..."

certbot renew \
  --manual-auth-hook "${SCRIPT_DIR}/certbot-dns-auth.sh" \
  --manual-cleanup-hook "${SCRIPT_DIR}/certbot-dns-cleanup.sh"

# Copy renewed certs (dereference symlinks) to Docker-mounted path
cp -rL /etc/letsencrypt/live "${PROJECT_DIR}/data/certs/live"
cp -rL /etc/letsencrypt/archive "${PROJECT_DIR}/data/certs/archive"

# Reload nginx inside container to pick up new certs (no downtime)
cd "${PROJECT_DIR}"
docker compose -f "${COMPOSE_FILE}" exec nginx nginx -s reload

echo "[$(date -Iseconds)] Renewal complete, nginx reloaded"
