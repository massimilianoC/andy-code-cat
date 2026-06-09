# Preset Template Model Reseed

This runbook updates the Mongo-backed project template registry from the static `PRESET_CATALOG`.

Use it after changing:

- `apps/api/src/domain/entities/ProjectPreset.ts`
- preset `briefTemplate`
- preset `styleTemplate`
- preset `outputSpec.systemPromptModule`
- preset default tags
- preset visibility (`isActive`)

The reseed is idempotent and upserts by `preset.id`. It does not create users or projects.

## Safety Rules

Before any Docker command, verify which stack is running:

```bash
docker ps --format '{{.Names}}'
```

Do not run `docker compose down` during a live session unless the operator explicitly asks for it.

Do not mix these stacks:

- `docker-compose.yml` uses the dev bind mount `./data/mongodb`.
- `docker-compose.deploy.yml` uses the named volume `andy-code-cat_mongodb_data`.
- Droplet uses its own remote compose file and remote MongoDB volume.

## Local Host Reseed

Use this when running the API from the host or when `.env.docker` points at the intended local MongoDB:

```bash
npm run seed:presets
```

This calls:

```bash
npm run seed:presets -w apps/api
```

## Local Dev Docker Stack

Use when the running stack is `docker-compose.yml` and MongoDB is the dev bind mount.

```bash
docker ps --format '{{.Names}}'
docker compose up -d --no-deps api
docker exec andy-code-cat-api npm run seed:presets
```

If the API container does not have the latest source mounted or was rebuilt from an older image, rebuild only the API service:

```bash
docker compose build api
docker compose up -d --no-deps api
docker exec andy-code-cat-api npm run seed:presets
```

## Local Deploy/Test Docker Stack

Use when the running stack is `docker-compose.deploy.yml` and MongoDB is the named Docker volume.

```bash
docker ps --format '{{.Names}}'
docker compose -f docker-compose.deploy.yml build api
docker compose -f docker-compose.deploy.yml up -d --no-deps api
docker exec andy-code-cat-api node apps/api/dist/scripts/seed-presets.js
```

The `--no-deps` flag is required when restarting `api`; it avoids recreating MongoDB, Redis or MinIO.

## Droplet Reseed

Deploy the new API image first so `dist/scripts/seed-presets.js` exists in the remote container.

```bash
npm run droplet:deploy
```

Then reseed only the template model registry:

```bash
npm run droplet:seed -- --only-presets
```

To reseed presets together with the regular idempotent user/project seed:

```bash
npm run droplet:seed -- --presets
```

To run the remote command manually:

```bash
ssh docker-2 'docker ps --format "{{.Names}}"'
ssh docker-2 'cd /opt/docker/projects/pageforge && docker compose -f docker-compose.droplet.yml --env-file .env.droplet ps -q api'
ssh docker-2 'docker exec <api-container-name> node apps/api/dist/scripts/seed-presets.js'
```

## Verification

After reseed, check the admin template registry or call:

```bash
curl -s http://localhost:4000/v1/presets
```

Expected outcomes:

- `landing`, `website`, `form`, `manifesto`, `slideshow`, `keynote`, `a4poster`, `infographic`, `videogame`, `seriousgame`, `game3d`, `vr-aframe`, and `interactive-story` are active standard choices.
- `freerunner` and `data-dashboard` remain in the registry but are hidden from the standard dashboard picker because `isActive=false`.
- Feature tags use the valid `feat:*` prefix.
