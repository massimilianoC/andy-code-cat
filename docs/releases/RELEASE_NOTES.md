# Release Notes

Andy Code Cat uses date-based release identifiers (`YYYY.MM.DD.N`, see
[`RELEASE_VERSION`](../../RELEASE_VERSION)). Every release is a git tag on `main`. Newest first.

Upgrading an existing installation: read the **Upgrade notes** of every release between yours and
the target. Rebuild and restart only the application services
(`docker compose -f docker-compose.deploy.yml up -d --build --no-deps api worker web`), never the
database.

---

## 2026.11.25.3 — Work recovered from stale branches

The branches that had sat unmerged for months were reviewed against the current code. What was still
valid was ported and tested; the remaining ideas are recorded as nice-to-haves in the
[roadmap](../project/ROADMAP.md#nice-to-have--ideas-from-retired-branches-2026-11-25).

### Features

- **More document formats as project context:** legacy Word `.doc`, OpenDocument `.odt` and `.rtf`
  attachments are parsed and enriched like the others. Legacy `.doc` files were previously sent to
  the DOCX parser, which cannot read them.

### Fixes

- **Model selection:** the image-prompt optimizer, the image-direction suggester and the admin
  template drafter now choose their model through the same catalog cascade as all other generation.
  A model the operator switched off is no longer dispatched, and no hardcoded model id is sent.
- **Malformed model replies:** a reply that separates its JSON fields with `;` instead of `,` is
  repaired instead of failing to parse.
- **Superadmin:** "View owner in Users" on the projects page opens that user's detail.

### Repository

- **CI:** every pull request into `develop` or `main` runs the gitflow and version checks, `tsc` and
  the api and web test suites (`.github/workflows/ci.yml`).
- The pull-request template asks for the risk tier, acceptance and verification evidence.

### Upgrade notes

- No configuration change. `npm ci` installs two new parser dependencies (`rtf-parser`,
  `word-extractor`); rebuild the api and worker images.

---

## 2026.11.25.2 — Public-release readiness

A hygiene and hardening release: no product feature changes. It makes the repository safe to
publish and the default Docker stack safe to run on a public server.

### Security

- **Internal services are no longer exposed on the network.** Both compose files bound MongoDB
  (no authentication), the API, the web server, MinIO and Redis to every interface. Docker bypasses
  host firewalls, so on a public server the database was reachable from the internet. Every port
  except nginx's is now bound to `127.0.0.1`.
- **No public default credentials.** `install.sh` now generates MinIO credentials instead of
  writing `minioadmin` / `minioadmin`.
- **Insecure production settings are reported at boot.** With `NODE_ENV=production` the API logs
  `[config] INSECURE PRODUCTION SETTING` for a wildcard `CORS_ORIGIN` (published sites could then
  run on the app's origin), the public `EXPORT_JWT_SECRET` default, and default MinIO credentials.
- **Dependencies:** `npm audit fix` (non-breaking) closes 12 of 39 production advisories,
  including the critical one in `proxy-addr`. The remaining ones need major upgrades (Next.js 16,
  zod 4, puppeteer 25, a maintained `xlsx` build) and are listed in
  [KNOWN_ISSUES.md](../project/KNOWN_ISSUES.md).

### Deployment

- **Redis removed.** No code used it; the service, its volume and `REDIS_URL` are gone.
- **MinIO is optional.** The API stores files on local disk by default (`STORAGE_ADAPTER=local`).
  MinIO starts only with `--profile minio`.
- **`install.sh`** picks the default LLM provider from the key you set (OpenRouter-only installs
  no longer default to SiliconFlow) and keeps document parsing on, with LLM enrichment off, when
  there is no SiliconFlow key.
- **First superadmin: documented as it actually works.** The `/install` wizard the docs pointed
  to was never implemented. The installer, README and guides now give the working path: register,
  then verify and promote the account with one `mongosh` command.
- Domain mode needs DNS records for `app` and `api` only; the wildcard is optional (subdomain site
  addresses).
- The dev stack's `workspace` container moves from Node 20 (EOL) to `node:22.23.5-alpine`.

### Repository

- Removed operator-specific material: deploy scripts and runbooks for one particular server, its
  DNS-provider certificate hooks, a session handoff log, `droplet:*` npm scripts, and real domain
  names, hostnames and LAN addresses in tests, docs and UI examples (replaced by `example.com`,
  `example.test` and RFC 5737 addresses).
- The 25 specification and archive documents still in Italian are now in English. The repository
  documentation is English throughout.
- `.gitignore` ignores every `.env.*` file except the two templates.

### Upgrade notes

- If you ran the deploy stack and reached MongoDB, the API or MinIO directly from **another
  machine**, that stops working: use an SSH tunnel, or publish the port in a
  `docker-compose.override.yml` you control.
- If you use MinIO, start the stack with `--profile minio` and make sure `STORAGE_ADAPTER=minio`
  and real `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` values are set.
- Remove `REDIS_URL` from your `.env.docker` (harmless if left). The old `redis_data` volume can be
  deleted with `docker volume rm andy-code-cat_redis_data` once you no longer need it.
- Check the API log after the upgrade for `INSECURE PRODUCTION SETTING` lines.

---

## 2026.11.25.1

- Deploy: certificate-hook scripts are committed executable.

## 2026.11.24.5 — Superadmin reorganised

- The superadmin area is organised around five sections, lighter and clearer.
- Inspecting a user's project version records a reason in the audit log.

## 2026.11.24.4 — Background-run limits

- Vibe runs in **Auto** mode by default, with **Review** as the alternative. "Create with AI" waits
  when the user's run limit is reached.
- Run limits are a superadmin setting (Admin → Platform), read at every use.

## 2026.11.24.3 — Background Vibe runs

- The home Vibe chat can generate a site in the background: the run continues when the browser
  is closed and reports progress in the notification manager, with a duration estimate.
- Classify, prefill and launch stages share one wiring between the API and the worker.

## 2026.11.24.2 — Worker service

- New `worker` service and a MongoDB-backed run queue (`BackgroundRun` aggregate).
  **Upgrade:** the deploy stack has a new service; rebuild with `--build` so it starts.

## 2026.11.24.1

- The generation engine persists the chat turn it produces on the server, instead of relying on
  the browser to save it. Characterisation tests cover the generation core before it was moved.

## 2026.11.23.5

- A live site whose owner account no longer exists keeps being served (and is logged).

## 2026.11.23.4 — Security review of published sites

- `/p/media/` never serves uploads in an executable form; only passive types are inline.
- Slugs shaped like a publish id are reserved; `/p/{x}` serves live deployments only.
- A unique index locks a slug before any site directory is written.
- The sites origin is an allow-list; preview asset ids are validated; the workspace accepts
  `postMessage` only from its own preview iframe.

## 2026.11.23.3 — Sites never run on the app origin

- Published-site content requested on an app host (a hostname in `CORS_ORIGIN`) is redirected to
  the site's own address, or refused when there is none. **Upgrade:** a single-host installation
  must configure a separate sites origin first — see
  [PUBLISHED_SITE_ADDRESSES.md](../guides/PUBLISHED_SITE_ADDRESSES.md).

## 2026.11.23.2 — Published-site addresses

- Sites answer at `/{slug}/` as well as `/p/{publishId}/`. The address shown to users (path or
  subdomain) is a superadmin setting. **Upgrade:** `PUBLIC_DOMAIN` is removed; set the address
  mode with `set-public-sites.js` or in Admin → Config.

## 2026.11.23.1 — Node 22

- API and web images move off EOL Node 20 to `node:22.23.5-alpine`.
- The composed system prompt no longer depends on the host locale or line endings.

## 2026.10.02.1

- Zero Effort generation gets a larger reasoning budget (24k floor, 32k ceiling).

## 2026.10.01.1

- The default model no longer depends on the order of the provider list.
- Style onboarding is offered in a dialog instead of being imposed.
- New accounts start without a default project.

## Earlier releases

Releases from `2026.04.10` (initial public release) to `2026.09.11.4` are recorded in the git
history: `git log --oneline <previous-tag>..<tag>` lists the changes of any release.
