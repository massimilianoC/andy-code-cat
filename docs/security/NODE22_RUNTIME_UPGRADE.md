# Node.js 22 Runtime Upgrade (CVE-2026-111497)

Status: **applied in code — `node:22.23.5-alpine` (2026-11-23); runtime check pending on first deploy**
Created: 2026-10-23

## Why

- CVE-2026-111497 (Node.js, severity High): out-of-bounds write in the Brotli decoder of `node:zlib`, can lead to remote code execution when the process decompresses attacker-controlled `br` data (inbound request bodies or fetched responses).
- Fixed in **22.23.4 / 24.22.1 / 26.12.1** (Node.js security release of 2026-10-21).
- **Node.js 20 is End-of-Life (2026-04-30) and will not receive the fix.** Both production images (`api`, `web`) are built on `node:20-alpine`.
- Containers ship their own runtime: the fix requires an image rebuild and redeploy.

## Exposure assessment (2026-10-23)

- Inbound: Express 4 + body-parser 1.x only inflate gzip/deflate; `Content-Encoding: br` is rejected with 415. No direct `zlib`/Brotli usage in `apps/` or `packages/`. Not reachable.
- Outbound: native `fetch()` (undici) transparently decodes `br` responses. Current calls target fixed HTTPS provider endpoints (image providers, LLM providers); no fetch of user-supplied URLs was found. Low risk, requires a compromised upstream.
- **Any future feature that fetches user-supplied URLs must not ship on Node 20.**

## Required changes

| File | Change |
|---|---|
| `apps/api/Dockerfile` | `FROM node:20-alpine AS base` and `FROM node:20-alpine AS prod` -> `FROM node:22.23.5-alpine` (22.23.4 was the first fixed patch; 22.23.5 is current) |
| `apps/web/Dockerfile` | `FROM node:20-alpine AS base` and `FROM node:20-alpine AS prod` -> `FROM node:22.23.5-alpine` (22.23.4 was the first fixed patch; 22.23.5 is current) |
| `package.json` | `"engines": { "node": ">=20.0.0" }` -> `">=22.23.4"` |
| `.github/workflows/public-repo-guard.yml` | `node-version: 20` -> `22` |
| Local dev | use Node 22 LTS (`nvm install 22 && nvm use 22`) |

Pin the exact patch tag (Docker Baseline: no floating tags in production). On each Node.js security release, bump the patch tag (`22.x.y-alpine`).

## Build and verify

```bash
docker compose -f docker-compose.deploy.yml build --pull --no-cache api web
docker run --rm <api-image>:<tag> node -v   # expected: v22.23.4 or newer
docker run --rm <web-image>:<tag> node -v   # expected: v22.23.4 or newer
```

Smoke test before release: login/refresh, project creation, generation run, image search (Pexels/Unsplash/Pixabay), upload, preview.

## Compatibility notes

- Next.js 14.2.x and Express 4.x support Node 22.
- Native modules (e.g. bcrypt, sharp) are rebuilt by the clean image build; do not copy `node_modules` from a Node 20 build.
- Watch the logs for new deprecation warnings after the first deploy.

## Rollback

Before deploying, retag the currently running images (e.g. `:rollback-<date>-node20`) and point the compose file back to them if the release fails. This restores the vulnerable runtime and must be temporary.

## Definition of done

- [x] Both Dockerfiles on `node:22.23.5-alpine`
- [x] `engines` and CI aligned to Node 22
- [ ] `node -v` verified inside the running `api` and `web` containers
- [ ] Smoke test passed
- [ ] This document status set to **done** with release version
