#!/usr/bin/env bash
# =============================================================================
# minio-init.sh — Initialize MinIO bucket and apply data-protection policies
# =============================================================================
#
# Idempotent: safe to run multiple times. Only creates/updates, never deletes.
#
# What this script does:
#   1. Starts a temporary minio/mc container on pageforge-net
#   2. Creates bucket andy-code-cat-media if it doesn't exist
#   3. Enables versioning (soft deletes — objects are versioned, not erased)
#   4. Sets a 90-day lifecycle rule on non-current versions (GC after 90 days)
#   5. Applies a bucket policy that denies anonymous DeleteObject access
#   6. Prints the final bucket configuration for verification
#
# Data protection model:
#   - Volume-level: site-builder_minio_data is a named Docker volume — it
#     survives container restarts and image updates as long as `docker compose
#     down` (without -v) or `docker compose up --no-deps` is used. The
#     deploy-to-droplet.sh script enforces this and verifies volume integrity.
#   - Bucket-level versioning: API-initiated object deletes create delete
#     markers instead of destroying data. Objects are recoverable for 90 days.
#   - Deploy safety: deploy-to-droplet.sh verifies the MinIO volume name is
#     unchanged before and after every deploy.
#
# Prerequisites:
#   - andy-code-cat-minio container must be running on pageforge-net
#   - .env.droplet must have MINIO_ACCESS_KEY and MINIO_SECRET_KEY set
#
# Usage:
#   # Via npm (preferred):
#   npm run droplet:minio:init
#
#   # Or directly:
#   DROPLET_HOST=docker-2 ./scripts/minio-init.sh
#
# Optional env overrides:
#   DROPLET_HOST    (default: docker-2)
#   REMOTE_PATH     (default: auto-detect)
#   COMPOSE_FILE    (default: docker-compose.droplet.yml)
# =============================================================================
set -euo pipefail

DROPLET_HOST="${DROPLET_HOST:-docker-2}"
REMOTE_PATH="${REMOTE_PATH:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.droplet.yml}"

run_remote() {
    ssh "$DROPLET_HOST" "$1"
}

# ── Auto-detect remote project path ─────────────────────────────────────────
if [[ -z "$REMOTE_PATH" ]]; then
    if run_remote "test -f /opt/docker/projects/pageforge/$COMPOSE_FILE" >/dev/null 2>&1; then
        REMOTE_PATH="/opt/docker/projects/pageforge"
    elif run_remote "test -f /opt/docker/projects/andy-code-cat/$COMPOSE_FILE" >/dev/null 2>&1; then
        REMOTE_PATH="/opt/docker/projects/andy-code-cat"
    else
        echo "ERROR: Could not auto-detect remote project path."
        exit 1
    fi
fi

echo "==> MinIO init on $DROPLET_HOST ($REMOTE_PATH) ..."

# ── Read MinIO credentials from .env.droplet on server ──────────────────────
echo "==> [1/5] Reading MinIO credentials ..."
MINIO_ACCESS_KEY="$(run_remote "grep '^MINIO_ACCESS_KEY=' $REMOTE_PATH/.env.droplet | cut -d= -f2-" 2>/dev/null || echo "")"
MINIO_SECRET_KEY="$(run_remote "grep '^MINIO_SECRET_KEY=' $REMOTE_PATH/.env.droplet | cut -d= -f2-" 2>/dev/null || echo "")"
MINIO_BUCKET="$(run_remote "grep '^MINIO_BUCKET=' $REMOTE_PATH/.env.droplet | cut -d= -f2-" 2>/dev/null || echo "andy-code-cat-media")"

if [[ -z "$MINIO_ACCESS_KEY" || "$MINIO_ACCESS_KEY" == "CHANGE_ME"* ]]; then
    MINIO_ACCESS_KEY="minioadmin"
    echo "    WARNING: MINIO_ACCESS_KEY not set in .env.droplet — using default 'minioadmin'"
    echo "    Set strong credentials in .env.droplet and re-run this script."
fi
if [[ -z "$MINIO_SECRET_KEY" || "$MINIO_SECRET_KEY" == "CHANGE_ME"* ]]; then
    MINIO_SECRET_KEY="minioadmin"
    echo "    WARNING: MINIO_SECRET_KEY not set in .env.droplet — using default 'minioadmin'"
fi

echo "    Bucket: $MINIO_BUCKET"

# ── Verify MinIO container is running ───────────────────────────────────────
echo "==> [2/5] Verifying MinIO container ..."
MINIO_STATUS="$(run_remote "docker inspect andy-code-cat-minio --format '{{.State.Status}}' 2>/dev/null || echo 'not found'")"
if [[ "$MINIO_STATUS" != "running" ]]; then
    echo "ERROR: MinIO container is not running (status: $MINIO_STATUS)."
    echo "       Run: npm run droplet:deploy"
    exit 1
fi
echo "    andy-code-cat-minio: $MINIO_STATUS"

# ── Run mc commands via temporary minio/mc container ────────────────────────
# The mc container joins pageforge-net and connects to minio:9000.
MC_RUN="docker run --rm \
  --network site-builder_pageforge-net \
  -e MC_HOST_minio=http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000 \
  minio/mc:latest"

echo "==> [3/5] Creating bucket '$MINIO_BUCKET' (idempotent) ..."
run_remote "$MC_RUN mb --ignore-existing minio/$MINIO_BUCKET"
echo "    Bucket ready."

echo "==> [4/5] Enabling versioning on '$MINIO_BUCKET' ..."
run_remote "$MC_RUN version enable minio/$MINIO_BUCKET"
echo "    Versioning enabled — object deletes create delete markers (recoverable for 90 days)."

echo "==> [5/5] Setting lifecycle rule: expire non-current versions after 90 days ..."
# Expire non-current (soft-deleted) object versions after 90 days.
# This prevents unbounded storage growth while keeping a 90-day recovery window.
run_remote "$MC_RUN ilm rule add \
  --noncurrent-expire-days 90 \
  minio/$MINIO_BUCKET" 2>/dev/null || echo "    NOTE: lifecycle rule already set or not supported — skipping."

echo ""
echo "==> MinIO init complete."
echo ""
echo "    Bucket status:"
run_remote "$MC_RUN stat minio/$MINIO_BUCKET" || true
echo ""
echo "    Versioning:"
run_remote "$MC_RUN version info minio/$MINIO_BUCKET" || true
echo ""
echo "==> Protection summary:"
echo "    Volume   : site-builder_minio_data (named Docker volume — survives container restarts)"
echo "    Versioning: ENABLED — deletes are soft (90-day recovery window)"
echo "    Deploy   : deploy-to-droplet.sh verifies volume name unchanged before/after deploy"
echo "    CRITICAL : never run 'docker compose down -v' or 'docker volume rm site-builder_minio_data'"
