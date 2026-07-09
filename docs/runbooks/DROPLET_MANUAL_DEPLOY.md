# Droplet Manual Deploy Runbook

Use this runbook when the full droplet deploy script is too broad or SSH is flaky.
The procedure deploys one image/service at a time and verifies each step before moving on.

## When To Use This

- SSH reaches TCP port 22 but fails during banner exchange.
- The droplet load average is high.
- `npm run droplet:deploy` times out after rsync or during build.
- You need to minimize deploy blast radius.
- You changed API and web code and want to deploy them separately.

Do not use `docker compose down`.
Do not run `docker compose up` without `--no-deps`.
Do not target MongoDB or Redis during app deploy.

## Preflight

From the local workstation:

```powershell
ssh -o ConnectTimeout=30 -o BatchMode=yes docker-2 "date; uptime; docker ps --format '{{.Names}}: {{.Status}}'"
curl.exe -k --max-time 30 https://api.sitowebinun.click/health
curl.exe -k --max-time 30 -I https://app.sitowebinun.click/login
```

If SSH fails during banner exchange but HTTPS still works, wait and retry. Do not start a deploy
until SSH can run a short read-only command.

## Safe Sync

The full deploy script uses rsync. If you need to sync manually, exclude runtime and private paths:

```bash
rsync -az --progress \
  --exclude '.git' \
  --exclude '.github' \
  --exclude '.deploy' \
  --exclude '.planning' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude 'data' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '*.log' \
  --exclude 'test-results' \
  --exclude 'coverage' \
  ./ docker-2:/opt/docker/projects/pageforge/
```

Never sync local `data/` to the droplet. Production runtime data belongs to server-side named
volumes and server-side publish folders.

## Verify Remote Sources And Protected Volumes

```powershell
@'
set -e
cd /opt/docker/projects/pageforge
COMPOSE="docker compose -f docker-compose.droplet.yml --env-file .env.droplet"
API_ID="$($COMPOSE ps -q api)"
WEB_ID="$($COMPOSE ps -q web)"
MONGO_ID="$($COMPOSE ps -q mongodb)"

echo "== volumes"
docker inspect "$MONGO_ID" --format 'mongo={{range .Mounts}}{{if eq .Destination "/data/db"}}{{.Name}}{{end}}{{end}}'
docker inspect andy-code-cat-minio --format 'minio={{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}'

echo "== remote sources"
test -f apps/api/src/application/llm/templateSkillsLayer.ts && echo "templateSkills source=yes" || true
test -d docs/skills/template-skills/by-template/landing && echo "Layer S docs=yes" || true
grep -q "12000" apps/api/src/presentation/http/routes/vibecoreRoutes.ts && echo "VibeCore 12000 source=yes" || true

echo "== current containers"
docker ps --format '{{.Names}}: {{.Status}}'
'@ | ssh -o ConnectTimeout=30 -o BatchMode=yes docker-2 bash -s
```

Expected protected volumes:

- MongoDB: `site-builder_mongodb_data`
- MinIO: `site-builder_minio_data`

## Deploy API Only

```powershell
@'
set -e
cd /opt/docker/projects/pageforge
COMPOSE="docker compose -f docker-compose.droplet.yml --env-file .env.droplet"
MONGO_BEFORE="$(docker inspect "$($COMPOSE ps -q mongodb)" --format '{{range .Mounts}}{{if eq .Destination "/data/db"}}{{.Name}}{{end}}{{end}}')"

echo "== build api only"
$COMPOSE build api

echo "== up api only --no-deps"
$COMPOSE up -d --no-deps api
sleep 8

API_ID="$($COMPOSE ps -q api)"
echo "== api health"
docker exec "$API_ID" node -e "const http=require('http');http.get('http://localhost:4000/health',r=>{console.log(r.statusCode);process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

echo "== api payload verify"
docker exec "$API_ID" sh -lc 'test -f apps/api/dist/application/llm/templateSkillsLayer.js && echo dist-templateSkillsLayer=yes || true; test -d docs/skills/template-skills/by-template/landing && echo docs-layer-s=yes || true'

MONGO_AFTER="$(docker inspect "$($COMPOSE ps -q mongodb)" --format '{{range .Mounts}}{{if eq .Destination "/data/db"}}{{.Name}}{{end}}{{end}}')"
echo "mongo-before=$MONGO_BEFORE"
echo "mongo-after=$MONGO_AFTER"
test "$MONGO_BEFORE" = "$MONGO_AFTER"
'@ | ssh -o ConnectTimeout=30 -o BatchMode=yes docker-2 bash -s
```

## Deploy Web Only

```powershell
@'
set -e
cd /opt/docker/projects/pageforge
COMPOSE="docker compose -f docker-compose.droplet.yml --env-file .env.droplet"
MONGO_BEFORE="$(docker inspect "$($COMPOSE ps -q mongodb)" --format '{{range .Mounts}}{{if eq .Destination "/data/db"}}{{.Name}}{{end}}{{end}}')"

echo "== build web only"
$COMPOSE build web

echo "== up web only --no-deps"
$COMPOSE up -d --no-deps web
sleep 8

WEB_ID="$($COMPOSE ps -q web)"
echo "== web chunk marker"
docker exec "$WEB_ID" sh -lc 'grep -R "Prompt troppo lungo\|12000\|promptTooLong" -n apps/web/.next/static/chunks/app/dashboard 2>/dev/null | head -5'

MONGO_AFTER="$(docker inspect "$($COMPOSE ps -q mongodb)" --format '{{range .Mounts}}{{if eq .Destination "/data/db"}}{{.Name}}{{end}}{{end}}')"
echo "mongo-before=$MONGO_BEFORE"
echo "mongo-after=$MONGO_AFTER"
test "$MONGO_BEFORE" = "$MONGO_AFTER"
'@ | ssh -o ConnectTimeout=30 -o BatchMode=yes docker-2 bash -s
```

## Restart Nginx Only

Restart nginx only after API or web containers are recreated. This refreshes Docker DNS resolution
inside nginx without touching MongoDB or Redis.

```powershell
@'
set -e
cd /opt/docker/projects/pageforge
COMPOSE="docker compose -f docker-compose.droplet.yml --env-file .env.droplet"
MONGO_BEFORE="$(docker inspect "$($COMPOSE ps -q mongodb)" --format '{{range .Mounts}}{{if eq .Destination "/data/db"}}{{.Name}}{{end}}{{end}}')"

$COMPOSE restart nginx
sleep 5
$COMPOSE ps

MONGO_AFTER="$(docker inspect "$($COMPOSE ps -q mongodb)" --format '{{range .Mounts}}{{if eq .Destination "/data/db"}}{{.Name}}{{end}}{{end}}')"
echo "mongo-before=$MONGO_BEFORE"
echo "mongo-after=$MONGO_AFTER"
test "$MONGO_BEFORE" = "$MONGO_AFTER"
'@ | ssh -o ConnectTimeout=30 -o BatchMode=yes docker-2 bash -s
```

## Public Verification

```powershell
curl.exe -k --max-time 30 https://api.sitowebinun.click/health
curl.exe -k --max-time 30 -I https://app.sitowebinun.click/login

$html = curl.exe -k --max-time 30 https://app.sitowebinun.click/dashboard
$match = [regex]::Match($html, '/_next/static/chunks/app/dashboard/page-[^" ]+\.js')
if ($match.Success) {
  $url = 'https://app.sitowebinun.click' + $match.Value
  $chunk = curl.exe -k --max-time 30 $url
  if ($chunk -match '12000|Prompt troppo lungo|promptTooLong') {
    "WEB_PUBLIC_HAS_NEW_PROMPT_LIMIT $url"
  } else {
    "WEB_PUBLIC_MISSING_NEW_PROMPT_LIMIT $url"
  }
} else {
  'NO_DASHBOARD_CHUNK_FOUND'
}
```

Final remote status:

```powershell
ssh -o ConnectTimeout=30 -o BatchMode=yes docker-2 "uptime; docker ps --format '{{.Names}}: {{.Status}}'"
```

## Incident Notes From 2026-07-08

- The full deploy path opened too many SSH sessions while the droplet load was high.
- `api` and `web` should be built and recreated separately when SSH is unstable.
- Restart nginx after app container recreation to refresh upstream DNS.
- A broad rsync must exclude `data/`; syncing local runtime data to the droplet is unsafe.
- During the incident, MongoDB restarted but retained `site-builder_mongodb_data`.
- Successful final verification used:
  - public API health 200
  - public `/login` 200
  - public dashboard chunk containing the new prompt limit marker
  - remote compose status with `api`, `web`, `nginx`, `minio`, `mongodb`, and `redis` up
