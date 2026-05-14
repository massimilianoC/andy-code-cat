#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Andy Code Cat — Installer  v1.0
# ═══════════════════════════════════════════════════════════════════════════════
#
# ┌─────────────────────────────────────────────────────────────────────────────
# │  QUICK START
# │  ──────────
# │  1. Edit the CONFIGURATION section below (MODE, API keys, DOMAIN)
# │  2. Run:   bash install.sh
# │
# │  MODE: local   → http://localhost        no SSL, ready in minutes
# │  MODE: domain  → https://app.DOMAIN      SSL via Let's Encrypt
# │
# │  DNS RECORDS (set these BEFORE running in domain mode):
# │    A   @   →  <your-server-IP>   (handles app.DOMAIN and api.DOMAIN)
# │    A   *   →  <your-server-IP>   (handles published subdomains *.DOMAIN)
# │    Wait for DNS propagation (usually < 5 min) before running this script.
# └─────────────────────────────────────────────────────────────────────────────

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION — edit here, then:  bash install.sh
# ══════════════════════════════════════════════════════════════════════════════

MODE="local"        # "local"  or  "domain"

DOMAIN=""           # Required for domain mode.  Example: "yourdomain.com"
                    # App will be at https://app.DOMAIN
                    # API will be at https://api.DOMAIN
                    # Published sites at https://<slug>.DOMAIN

CERTBOT_EMAIL=""    # Required for domain mode.  Example: "admin@yourdomain.com"

# LLM provider API keys — set at least one.
# SiliconFlow (recommended — affordable, fast):  https://siliconflow.cn/account/api-keys
SILICONFLOW_API_KEY=""
# OpenRouter (multi-model fallback):             https://openrouter.ai/keys
OPENROUTER_API_KEY=""

# ══════════════════════════════════════════════════════════════════════════════
#  END OF CONFIGURATION — do not edit below this line
# ══════════════════════════════════════════════════════════════════════════════

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info() { echo -e "${CYAN}[•]${RESET} $*"; }
ok()   { echo -e "${GREEN}[✓]${RESET} $*"; }
warn() { echo -e "${YELLOW}[!]${RESET} $*"; }
die()  { echo -e "${RED}[✗] $*${RESET}" >&2; exit 1; }
hr()   { echo -e "${BOLD}──────────────────────────────────────────────────────${RESET}"; }

hr
echo -e "${BOLD}  Andy Code Cat — Installer  (MODE=${MODE})${RESET}"
hr

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 0 — Validate configuration
# ══════════════════════════════════════════════════════════════════════════════
info "Validating configuration…"

[[ "$MODE" != "local" && "$MODE" != "domain" ]] && \
    die "MODE must be 'local' or 'domain'. Edit the CONFIGURATION block at the top."

[[ -z "$SILICONFLOW_API_KEY" && -z "$OPENROUTER_API_KEY" ]] && \
    die "Set at least one of SILICONFLOW_API_KEY or OPENROUTER_API_KEY in this script."

if [[ "$MODE" == "domain" ]]; then
    [[ -z "$DOMAIN" ]] && \
        die "DOMAIN is required for domain mode.  Example: DOMAIN=\"yourdomain.com\""
    [[ -z "$CERTBOT_EMAIL" ]] && \
        die "CERTBOT_EMAIL is required for domain mode.  Example: CERTBOT_EMAIL=\"admin@yourdomain.com\""
fi

ok "Configuration valid"

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 1 — Check prerequisites
# ══════════════════════════════════════════════════════════════════════════════
info "Checking prerequisites…"

if ! command -v docker &>/dev/null; then
    die "Docker not found.  Install from https://docs.docker.com/get-docker/"
fi

if ! docker compose version &>/dev/null; then
    die "Docker Compose plugin not found.  Upgrade Docker Desktop or install the Compose plugin."
fi

if ! command -v openssl &>/dev/null; then
    die "openssl not found.  Install it (most systems: sudo apt install openssl)."
fi

ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
ok "Docker Compose $(docker compose version --short)"

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 2 — Generate .env.docker
# ══════════════════════════════════════════════════════════════════════════════
if [[ -f ".env.docker" ]]; then
    warn ".env.docker already exists — skipping generation."
    warn "Delete it and re-run to regenerate with new secrets."
else
    info "Generating .env.docker with random secrets…"

    JWT_ACCESS_SECRET=$(openssl rand -hex 32)
    JWT_REFRESH_SECRET=$(openssl rand -hex 32)
    EXPORT_SECRET=$(openssl rand -hex 32)

    if [[ "$MODE" == "local" ]]; then
        PUBLIC_DOMAIN="localhost"
        NEXT_PUBLIC_API_URL="http://localhost"
        CORS_ORIGIN="http://localhost"
        MINIO_ENDPOINT="http://minio:9000"
    else
        PUBLIC_DOMAIN="$DOMAIN"
        NEXT_PUBLIC_API_URL="https://api.${DOMAIN}"
        CORS_ORIGIN="https://app.${DOMAIN}"
        MINIO_ENDPOINT="http://minio:9000"
    fi

    cat > .env.docker <<ENV
NODE_ENV=production

# ── JWT secrets (auto-generated — do not share) ──────────────────────────────
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_ACCESS_TTL=2h
JWT_REFRESH_TTL=30d
AUTH_BYPASS_EMAIL_VERIFICATION=false

# ── Database (Docker-internal — do not change) ───────────────────────────────
MONGODB_URI=mongodb://mongodb:27017/andy-code-cat
MONGODB_DB_NAME=andy-code-cat
REDIS_URL=redis://redis:6379

# ── Ports ─────────────────────────────────────────────────────────────────────
API_PORT=4000
WEB_PORT=8081
MONGO_EXTERNAL_PORT=27018

# ── CORS & public domain ──────────────────────────────────────────────────────
CORS_ORIGIN=${CORS_ORIGIN}
PUBLIC_DOMAIN=${PUBLIC_DOMAIN}
NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# ── LLM ───────────────────────────────────────────────────────────────────────
LLM_CATALOG_SOURCE=env
LLM_AUTO_SEED_ON_STARTUP=true
LLM_DEFAULT_PROVIDER=siliconflow
LLM_CONTEXT_MAX_CHARS=64000
LLM_ARTIFACT_CONTEXT_MAX_CHARS=16000
LLM_MAX_HISTORY_MESSAGES=12
LLM_HISTORY_MESSAGE_MAX_CHARS=2000
LLM_DEFAULT_MAX_COMPLETION_TOKENS=167000
LLM_MAX_COMPLETION_TOKENS=167000
LLM_FOCUS_SECTION_CONTEXT=true
LLM_FOCUS_SECTION_HTML_MAX_CHARS=8000
LLM_FOCUS_HISTORY_MODE=user_only

# ── LLM API keys ─────────────────────────────────────────────────────────────
SILICONFLOW_BASE_URL=https://api.siliconflow.com/v1
SILICONFLOW_API_KEY=${SILICONFLOW_API_KEY}
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPEN_ROUTER_API_KEY=${OPENROUTER_API_KEY}

# ── Cost policy ───────────────────────────────────────────────────────────────
COST_POLICY_TEXT_EUR_PER_1K_TOKENS=0.005
COST_POLICY_IMAGE_EUR_PER_ASSET=0.1
COST_POLICY_VIDEO_EUR_PER_ASSET=0.2
COST_POLICY_USD_TO_EUR_RATE=0.92
COST_POLICY_PROVIDER_MARKUP_FACTOR=1.1

# ── Storage ───────────────────────────────────────────────────────────────────
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_ENDPOINT=${MINIO_ENDPOINT}
EXPORT_JWT_SECRET=${EXPORT_SECRET}
EXPORT_DOWNLOAD_TTL=3600
UPLOAD_MAX_SIZE_BYTES=20971520

# ── Document Context Layer (DCL) enrichment ───────────────────────────────────
ENRICHMENT_ENABLED=true
ENRICHMENT_DOCUMENT_PARSING=true
ENRICHMENT_DOCUMENT_LLM_PASS=true
ENRICHMENT_TEXT_PROVIDER=siliconflow
ENRICHMENT_TEXT_MODEL=Qwen/Qwen2.5-72B-Instruct
ENRICHMENT_IMAGE_ANALYSIS=true
ENRICHMENT_VISION_PROVIDER=siliconflow
ENRICHMENT_VISION_MODEL=Qwen/Qwen2.5-VL-72B-Instruct
ENRICHMENT_INJECT_LAYER_D=true
ENRICHMENT_LAYER_D_MAX_CHARS=21000
ENRICHMENT_LAYER_D_MAX_ASSETS=5
ENV

    ok ".env.docker written"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 3 (domain mode only) — Generate nginx config + compose override
# ══════════════════════════════════════════════════════════════════════════════
COMPOSE_FILES="-f docker-compose.deploy.yml"

if [[ "$MODE" == "domain" ]]; then
    info "Preparing nginx domain config (phase 1 — HTTP only for ACME challenge)…"

    mkdir -p nginx/sites-enabled data/certs data/certbot-webroot

    # Phase 1: HTTP-only.  No SSL blocks — nginx can start before certs exist.
    # Certbot will place the ACME challenge token in /var/www/certbot.
    cat > nginx/sites-enabled/install.conf <<NGINX
# Generated by install.sh — phase 1 (HTTP + ACME challenge only)
# Domain: ${DOMAIN}

upstream web_upstream { server web:8081; keepalive 16; }
upstream api_upstream  { server api:4000; keepalive 32; }

server {
    listen 80;
    server_name app.${DOMAIN} api.${DOMAIN};

    # ACME HTTP-01 challenge path for certbot
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect everything else to HTTPS (active once certs are obtained)
    location / {
        return 301 https://\$host\$request_uri;
    }
}
NGINX

    # docker-compose.override.yml adds the extra nginx mounts needed for domain mode.
    # Docker Compose merges (appends) volumes from base + override files.
    cat > docker-compose.override.yml <<OVERRIDE
# Generated by install.sh — domain mode.
# Adds cert and certbot-webroot volumes to nginx, and mounts install.conf.
services:
  nginx:
    volumes:
      - ./nginx/sites-enabled/install.conf:/etc/nginx/sites-enabled/install.conf:ro
      - ./data/certs:/etc/letsencrypt:ro
      - ./data/certbot-webroot:/var/www/certbot:ro
    ports:
      - "80:80"
      - "443:443"
OVERRIDE

    COMPOSE_FILES="-f docker-compose.deploy.yml -f docker-compose.override.yml"
    ok "nginx/sites-enabled/install.conf (phase 1) written"
    ok "docker-compose.override.yml written"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 4 — Build and start all containers
# ══════════════════════════════════════════════════════════════════════════════
hr
info "Building and starting containers…"
info "First build takes 3–8 minutes — subsequent starts are instant."
echo ""

# shellcheck disable=SC2086
docker compose --env-file .env.docker ${COMPOSE_FILES} up --build -d

ok "All containers running"

# ══════════════════════════════════════════════════════════════════════════════
#  STEP 5 (domain mode only) — Obtain SSL certificates via certbot
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$MODE" == "domain" ]]; then
    hr
    info "Waiting for nginx to be ready…"
    sleep 4

    info "Requesting SSL certificate for app.${DOMAIN} and api.${DOMAIN}…"
    info "(Uses certbot HTTP-01 challenge via nginx webroot — no DNS changes needed.)"
    echo ""

    docker run --rm \
        -v "$(pwd)/data/certs:/etc/letsencrypt" \
        -v "$(pwd)/data/certbot-webroot:/var/www/certbot" \
        certbot/certbot certonly \
            --webroot \
            --webroot-path /var/www/certbot \
            --email "${CERTBOT_EMAIL}" \
            --agree-tos \
            --no-eff-email \
            -d "app.${DOMAIN}" \
            -d "api.${DOMAIN}" \
        || die "Certbot failed. Check that DNS A records for app.${DOMAIN} and api.${DOMAIN} point to this server and have propagated."

    ok "SSL certificate obtained: app.${DOMAIN} + api.${DOMAIN}"

    # ── Phase 2: rewrite install.conf with full HTTPS config ─────────────────
    info "Applying full HTTPS nginx config (phase 2)…"

    cat > nginx/sites-enabled/install.conf <<NGINX
# Generated by install.sh — phase 2 (full HTTPS)
# Domain: ${DOMAIN}

upstream web_upstream { server web:8081; keepalive 16; }
upstream api_upstream  { server api:4000; keepalive 32; }

# ── Shared SSL settings ───────────────────────────────────────────────────────
ssl_certificate     /etc/letsencrypt/live/app.${DOMAIN}/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/app.${DOMAIN}/privkey.pem;
ssl_protocols       TLSv1.2 TLSv1.3;
ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
ssl_session_cache   shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;

# ── HTTP → HTTPS redirect ─────────────────────────────────────────────────────
server {
    listen 80;
    server_name app.${DOMAIN} api.${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

# ── app.${DOMAIN}  →  Next.js web app ────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name app.${DOMAIN};

    add_header Strict-Transport-Security  "max-age=63072000; includeSubDomains" always;
    add_header X-Frame-Options            "SAMEORIGIN" always;
    add_header X-Content-Type-Options     "nosniff" always;
    add_header Referrer-Policy            "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy         "camera=(), microphone=(), geolocation=()" always;

    location / {
        proxy_pass         http://web_upstream;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       \$host;
        proxy_set_header   X-Real-IP  \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }
}

# ── api.${DOMAIN}  →  Express API (SSE-aware) ────────────────────────────────
server {
    listen 443 ssl http2;
    server_name api.${DOMAIN};

    add_header Strict-Transport-Security  "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options     "nosniff" always;
    add_header X-Frame-Options            "DENY" always;
    add_header Referrer-Policy            "no-referrer" always;

    location ~ ^/v1/auth/ {
        limit_req      zone=ratelimit_auth burst=5 nodelay;
        limit_req_status 429;
        proxy_pass         http://api_upstream;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 30s;
    }

    location / {
        limit_req      zone=ratelimit_api burst=60 nodelay;
        limit_req_status 429;
        proxy_pass              http://api_upstream;
        proxy_http_version      1.1;
        proxy_set_header        Host              \$host;
        proxy_set_header        X-Real-IP         \$remote_addr;
        proxy_set_header        X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header        X-Forwarded-Proto \$scheme;
        proxy_buffering         off;
        proxy_cache             off;
        proxy_read_timeout      300s;
        proxy_send_timeout      300s;
        chunked_transfer_encoding on;
    }
}
NGINX

    # Reload nginx inside the running container (no restart needed)
    docker exec andy-code-cat-nginx nginx -s reload
    ok "nginx reloaded with HTTPS config"

    # ── Wildcard cert (optional — needed for published subdomains *.DOMAIN) ──
    hr
    echo -e "${YELLOW}  OPTIONAL: Published subdomains (*.${DOMAIN})${RESET}"
    echo ""
    echo "  To enable published sites at https://<slug>.${DOMAIN} you need a"
    echo "  wildcard SSL certificate, which requires a DNS-01 challenge."
    echo "  This cannot be automated without a DNS provider API key."
    echo ""
    echo "  Run this manually after installation:"
    echo ""
    echo "    docker run --rm -it \\"
    echo "      -v \"\$(pwd)/data/certs:/etc/letsencrypt\" \\"
    echo "      certbot/certbot certonly \\"
    echo "        --manual \\"
    echo "        --preferred-challenges dns \\"
    echo "        --email ${CERTBOT_EMAIL} \\"
    echo "        --agree-tos \\"
    echo "        -d \"*.${DOMAIN}\""
    echo ""
    echo "  Then run:  docker exec andy-code-cat-nginx nginx -s reload"
    echo "  And add the wildcard server block from the docs to install.conf."
    hr
fi

# ══════════════════════════════════════════════════════════════════════════════
#  Done — print access URL and next steps
# ══════════════════════════════════════════════════════════════════════════════
hr
echo ""
if [[ "$MODE" == "local" ]]; then
    echo -e "${GREEN}${BOLD}  Installation complete!${RESET}"
    echo ""
    echo -e "  Open the setup wizard:   ${BOLD}http://localhost/install${RESET}"
    echo ""
    echo "  The wizard will guide you through:"
    echo "    1. Creating your superadmin account"
    echo "    2. Configuring the platform"
    echo ""
    echo "  After setup, the app is at:  http://localhost"
else
    echo -e "${GREEN}${BOLD}  Installation complete!${RESET}"
    echo ""
    echo -e "  Open the setup wizard:   ${BOLD}https://app.${DOMAIN}/install${RESET}"
    echo ""
    echo "  The wizard will guide you through:"
    echo "    1. Creating your superadmin account"
    echo "    2. Configuring the platform"
    echo ""
    echo "  After setup:"
    echo "    App:  https://app.${DOMAIN}"
    echo "    API:  https://api.${DOMAIN}"
fi
echo ""
echo "  Useful commands:"
echo "    Logs:          docker compose ${COMPOSE_FILES} logs -f api"
echo "    Stop:          docker compose ${COMPOSE_FILES} down"
echo "    Restart:       docker compose ${COMPOSE_FILES} up -d"
echo ""
hr
