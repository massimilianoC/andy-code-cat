#!/usr/bin/env bash
set -euo pipefail

# Safe production release helper:
# 1) backup source DB
# 2) clone data into target DB (new name)
# 3) update env mapping
# 4) recreate app services only with --no-deps
#
# Usage:
#   scripts/deploy-safe-db-port.sh \
#     --source-db <source-db-name> \
#     --target-db <target-db-name> \
#     --project-dir /opt/docker/projects/<project-dir> \
#     --compose-file docker-compose.droplet.yml \
#     --mongo-container <mongo-container-name>

SOURCE_DB=""
TARGET_DB=""
PROJECT_DIR=""
COMPOSE_FILE="docker-compose.droplet.yml"
MONGO_CONTAINER="mongodb"
ENV_FILE=".env.droplet"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-db)
      SOURCE_DB="$2"; shift 2 ;;
    --target-db)
      TARGET_DB="$2"; shift 2 ;;
    --project-dir)
      PROJECT_DIR="$2"; shift 2 ;;
    --compose-file)
      COMPOSE_FILE="$2"; shift 2 ;;
    --mongo-container)
      MONGO_CONTAINER="$2"; shift 2 ;;
    --env-file)
      ENV_FILE="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ -z "$SOURCE_DB" || -z "$TARGET_DB" || -z "$PROJECT_DIR" ]]; then
  echo "Missing required args: --source-db --target-db --project-dir" >&2
  exit 1
fi

cd "$PROJECT_DIR"

STAMP="$(date +%F-%H%M%S)"
ARCHIVE_IN_CONTAINER="/tmp/${SOURCE_DB}-${STAMP}.archive"
ARCHIVE_LOCAL="./backup-${SOURCE_DB}-${STAMP}.archive"

echo "[1/6] Backup source DB '${SOURCE_DB}' from ${MONGO_CONTAINER}"
docker exec "$MONGO_CONTAINER" sh -lc "mongodump --db '${SOURCE_DB}' --archive='${ARCHIVE_IN_CONTAINER}'"

echo "[2/6] Copy backup archive locally: ${ARCHIVE_LOCAL}"
docker cp "${MONGO_CONTAINER}:${ARCHIVE_IN_CONTAINER}" "${ARCHIVE_LOCAL}"

echo "[3/6] Restore archive into target DB '${TARGET_DB}'"
docker exec "$MONGO_CONTAINER" sh -lc "mongorestore --archive='${ARCHIVE_IN_CONTAINER}' --nsFrom='${SOURCE_DB}.*' --nsTo='${TARGET_DB}.*' --drop"

echo "[4/6] Update ${ENV_FILE} database settings"
if grep -q '^MONGODB_URI=' "$ENV_FILE"; then
  sed -i "s|^MONGODB_URI=.*|MONGODB_URI=mongodb://mongodb:27017/${TARGET_DB}|" "$ENV_FILE"
else
  echo "MONGODB_URI=mongodb://mongodb:27017/${TARGET_DB}" >> "$ENV_FILE"
fi

if grep -q '^MONGODB_DB_NAME=' "$ENV_FILE"; then
  sed -i "s|^MONGODB_DB_NAME=.*|MONGODB_DB_NAME=${TARGET_DB}|" "$ENV_FILE"
else
  echo "MONGODB_DB_NAME=${TARGET_DB}" >> "$ENV_FILE"
fi

echo "[5/6] Deploy app services only (no Mongo/Redis impact)"
docker compose -f "$COMPOSE_FILE" up -d --no-deps --build api web nginx

echo "[6/6] Smoke checks"
docker compose -f "$COMPOSE_FILE" ps
curl -fsS http://127.0.0.1:4000/health >/dev/null && echo "API health OK"

echo "Done. Backup archive: ${ARCHIVE_LOCAL}"
