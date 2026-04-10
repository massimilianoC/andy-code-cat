#!/bin/bash
# certbot-dns-cleanup.sh — Hostinger DNS-01 cleanup hook for certbot
# Removes _acme-challenge TXT record via Hostinger API
# Called automatically by certbot after DNS-01 challenge
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOSTINGER_API_TOKEN=$(grep '^HOSTINGER_API_TOKEN=' "$PROJECT_DIR/.env.droplet" | cut -d= -f2 | tr -d '\r\n')

DOMAIN="sitowebinun.click"
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
