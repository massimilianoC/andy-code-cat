#!/bin/bash
# certbot-dns-cleanup.sh — Hostinger DNS-01 cleanup hook for certbot
# Removes _acme-challenge TXT record via Hostinger API
# Called automatically by certbot after DNS-01 challenge
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOY_CONFIG_FILE="${PROJECT_DIR}/.deploy/certbot.env"

if [ -f "${DEPLOY_CONFIG_FILE}" ]; then
  # shellcheck source=/dev/null
  source "${DEPLOY_CONFIG_FILE}"
fi

if [ -z "${HOSTINGER_API_TOKEN:-}" ] && [ -f "${PROJECT_DIR}/.env.droplet" ]; then
  HOSTINGER_API_TOKEN=$(grep '^HOSTINGER_API_TOKEN=' "${PROJECT_DIR}/.env.droplet" | cut -d= -f2- | tr -d '\r\n')
fi

if [ -z "${DOMAIN:-}" ]; then
  echo "[certbot-dns-cleanup] ERROR: DOMAIN is not set. Configure .deploy/certbot.env"
  exit 1
fi

if [ -z "${HOSTINGER_API_TOKEN:-}" ]; then
  echo "[certbot-dns-cleanup] ERROR: HOSTINGER_API_TOKEN is not set. Configure .deploy/certbot.env or .env.droplet"
  exit 1
fi

API_URL="https://developers.hostinger.com/api/dns/v1/zones/${DOMAIN}"

echo "[certbot-dns-cleanup] Removing TXT _acme-challenge"

HTTP_CODE=$(curl -s -o /tmp/certbot-dns-cleanup-response.json -w "%{http_code}" \
  -X DELETE \
  -H "Authorization: Bearer ${HOSTINGER_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"filters\": [{
      \"name\": \"_acme-challenge\",
      \"type\": \"TXT\"
    }]
  }" \
  "${API_URL}")

if [ "$HTTP_CODE" != "200" ]; then
  echo "[certbot-dns-cleanup] WARNING: Hostinger API returned HTTP ${HTTP_CODE}"
  cat /tmp/certbot-dns-cleanup-response.json 2>/dev/null
fi

echo "[certbot-dns-cleanup] Cleanup done"
