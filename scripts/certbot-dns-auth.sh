#!/bin/bash
# certbot-dns-auth.sh — Hostinger DNS-01 auth hook for certbot
# Creates _acme-challenge TXT record via Hostinger API
# Called automatically by certbot during DNS-01 challenge
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOSTINGER_API_TOKEN=$(grep '^HOSTINGER_API_TOKEN=' "$PROJECT_DIR/.env.droplet" | cut -d= -f2 | tr -d '\r\n')

DOMAIN="sitowebinun.click"
API_URL="https://developers.hostinger.com/api/dns/v1/zones/${DOMAIN}"

echo "[certbot-dns-auth] Adding TXT _acme-challenge = ${CERTBOT_VALIDATION}"

HTTP_CODE=$(curl -s -o /tmp/certbot-dns-auth-response.json -w "%{http_code}" \
  -X PUT \
  -H "Authorization: Bearer ${HOSTINGER_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"overwrite\": false,
    \"zone\": [{
      \"name\": \"_acme-challenge\",
      \"type\": \"TXT\",
      \"ttl\": 300,
      \"records\": [{\"content\": \"${CERTBOT_VALIDATION}\"}]
    }]
  }" \
  "${API_URL}")

if [ "$HTTP_CODE" != "200" ]; then
  echo "[certbot-dns-auth] ERROR: Hostinger API returned HTTP ${HTTP_CODE}"
  cat /tmp/certbot-dns-auth-response.json 2>/dev/null
  exit 1
fi

echo "[certbot-dns-auth] TXT record created. Waiting 30s for DNS propagation..."
sleep 30
echo "[certbot-dns-auth] Done"
