# Known Issues — Next Review / Refactor / Fix Pass

Cross-cutting defects and small feature gaps that were found during real use and are not yet
scheduled into a specific increment. This file exists so the next agent that touches these
areas — human or automated — starts from what is already known instead of rediscovering it.

Add an entry here instead of only a local task tracker item: task trackers are per-session,
this file is tracked in git and visible to every future agent and contributor.

When an item is picked up, move it into a real fix/PR and delete the entry here rather than
marking it done in place — this file is a queue, not a changelog.

---

## Dependencies — advisories that need a major upgrade

Measured with `npm audit --omit=dev` on 2026-11-25, after `npm audit fix` (non-breaking) brought
the count from 39 to 27. What is left needs a major upgrade or a replacement, each with its own
regression pass:

- **`next` 14.2.x (critical)** — the 14 line gets no further fixes; the advisories close at 16.x.
  The biggest item: App Router, middleware and `next.config.mjs` need a migration pass.
- **`xlsx` 0.18.5 (high, no npm fix)** — SheetJS no longer publishes to npm. Either install the
  maintained build from the SheetJS CDN tarball or replace it. Exposure: spreadsheets uploaded as
  project documents are parsed server-side.
- **`puppeteer` 24 → 25**, **`sharp` → 0.35**, **`zod` 3 → 4**, **`minio` 7.1**, **`archiver` 8**,
  **`adm-zip` 0.6**, **`grapesjs` 0.23** — major bumps; `zod` is shared through
  `packages/contracts` and touches every schema.
- `npm audit fix` also moved `puppeteer` to 24.43, whose types drop `networkidle0` for
  `page.setContent` (`PuppeteerCaptureService.ts`). It is held at 24.40.0 until the capture code is
  adapted.

## First install — no guided wizard yet

`docs/specs/FIRST_INSTALL_SETUP_SPEC.md` (status: Planned) describes a `/install` wizard. It does not
exist: the first superadmin is created by registering and promoting the account with `mongosh`
(`install.sh` prints the command; see `docs/guides/LOCAL_DOCKER_START.md`). No verification e-mail
is sent either, so with `AUTH_BYPASS_EMAIL_VERIFICATION=false` every later account waits for a
superadmin to mark it verified in `/admin/users`.

## Deploy stack — MongoDB without authentication

Both compose files run MongoDB without authentication. Since 2026-11-25 every non-nginx port is
bound to `127.0.0.1`, which keeps it private on a single host; a shared or multi-host setup should
add `MONGO_INITDB_ROOT_*` and credentials in `MONGODB_URI`. In domain mode the stack still mounts
`nginx/sites-enabled/local.conf` (see "two CSPs" below, item 2).

## Admin — LLM Model Console (`/admin/models`)

Reported by the account owner during production use, 2026-08-28.

1. ~~**Activating/deactivating a model does not update the displayed state.**~~ **Fixed**,
   `origin/develop@872c4b7` / released `2026.08.28.2`. Root cause was two-fold, not a display
   bug: `SeedLlmCatalog` was wiping operator activations on every restart whenever a provider's
   live discovery returned a different model set (SiliconFlow especially — 13 vs 77 models
   between restarts), and a deprecated-but-still-selected model was silently skipped rather than
   activated. See `docs/specs/ADMIN_MODEL_CONSOLE_UX_SPEC.md` for what was actually broken vs.
   what remains a genuine UX gap.
2. **No search field**, and **the model list scrolls with the page instead of independently.**
   Still open — recorded as UX requests, not bugs, in
   `docs/specs/ADMIN_MODEL_CONSOLE_UX_SPEC.md`. Explicitly deferred at the owner's request
   ("non strafare, usa componenti esistenti"); reuse `ProviderModelPicker.tsx` rather than
   building a second filtering surface.

## Model routing — three call sites still bypass the operator's catalog choice

Found during the 2026-08-31 SSOT consolidation review (`docs/SSOT_STATUS.md`), not yet fixed.
`OptimizeImagePrompt.ts`, `SuggestProjectImageIdea.ts`, and `DraftProjectTemplate.ts` each pick
their own model independently, with a hardcoded `MiniMaxAI/MiniMax-M3` fallback, instead of going
through the shared cascade/lock the rest of the programme now enforces. An operator switching a
model off in `/admin/models` does not govern these three paths. Same bug class the SSOT programme
existed to eliminate — see `docs/SSOT_STATUS.md` §"Top open items" for the full citation trail.

## Publishing — media resolution on the published site

Root cause found and mitigated 2026-08-31 (see `docs/guides/GITFLOW_RELEASE_POLICY.md` §"Private,
deploy-critical files" for why the fix isn't a normal PR).

- Some published artifacts had `/p/media/:assetId` baked into their stored HTML as a **relative**
  URL instead of an absolute `https://api.<your-domain>/p/media/:assetId` one — a symptom of
  `PUBLIC_API_BASE_URL` being unset or wrong at the moment that specific project's HTML was
  generated (`ResolveAndPersistHtmlImages.ts:36`, `assetPublicUrl()`). Because the URL is
  persisted, not recomputed, fixing today's env value does not retroactively repair already-baked
  artifacts.
- A scan of one production installation (`data/www/*/index.html`, 2026-08-31) found **10 of 88**
  published sites affected.
- **Mitigated**, not root-caused: add a `location /p/media/ { proxy_pass ...; }` block to the
  wildcard-subdomain vhost of the production nginx (a host-specific, untracked file) so a relative
  `/p/media/:id` request now reaches the API instead of silently falling through to the SPA
  `index.html` fallback (previously: 200 text/html for every path, including binary asset
  requests — no console/network error, images just never decoded). Verify with `curl` against
  `<publishId>.<your-domain>/p/media/<assetId>`: it must return the real image type, not the index
  page. Production vhosts are not tracked in this repository (see
  `docs/guides/GITFLOW_RELEASE_POLICY.md`).
- **Still open**: no startup-time guard exists to catch `PUBLIC_API_BASE_URL` being unset/wrong
  again before it bakes a bad URL into new artifacts. Worth a fail-fast check in
  `apps/api/src/config.ts` (reject boot in `production` if the var is unset, rather than silently
  defaulting to `http://localhost:${API_PORT}`) as a real fix, separate from the nginx mitigation.
- **Re-measured 2026-09-11**: 12 of 92 published sites still carry
  `http://localhost:4000/p/media/:id` absolute URLs in their stored HTML — the same default the
  bullet above describes. The newest was published 2026-07-02; nothing published since is
  affected, so the env is right today and the damage is historical. The browser blocks these as
  mixed content under the published CSP, and they would not resolve for a visitor anyway. They
  need a republish or a one-off rewrite of the stored HTML.

## Publishing — two CSPs for the same published site

Found 2026-09-11 from a user report: an A-Frame site worked in preview and failed published with
`EvalError … 'unsafe-eval' is not an allowed source of script`, then `AFRAME is not defined`.

- A published site is reachable two ways with **different** headers. The public subdomain is
  served statically by nginx from a hand-written wildcard vhost on the production host
  (untracked); `/p/:publishId/` is served by the API with
  `PUBLISHED_PAGE_CSP` (`publishRoutes.ts`). The API's policy allowed `'unsafe-eval'`; nginx's did
  not. Preview runs under no CSP, so nothing surfaced before publishing.
- It was not only A-Frame. A survey of the live sites found **every Alpine.js site** broken on the
  public URL (`Alpine Expression Error … unsafe-eval`) — 18 of 92 use Alpine. Tailwind (play CDN),
  GSAP, AOS, Lucide, Phaser and Matter.js were unaffected.
- **Hotfixed live the same day**: `'unsafe-eval'` added to that one directive, nothing else.
  Before/after header snapshots of every host (app, api, `/p/`, subdomains, HTTP redirect) differ
  only in that directive; a re-run of the survey shows Alpine and A-Frame working and every other
  site with exactly the errors it had before. `'unsafe-eval'` adds little exposure here: the policy
  already allows `'unsafe-inline'` and any `https:` script, and the isolation that matters is the
  separate origin.
- If you run a hand-written publish vhost, apply the same directive there and keep the file under
  your own private version control (see `GITFLOW_RELEASE_POLICY.md`).

**For the cumulative fix** (not done yet):

1. Version the wildcard publish vhost as a domain-parameterised template in the repo, with the CSP
   defined once and shared with `PUBLISHED_PAGE_CSP` — `install.sh` does not generate a publish
   vhost at all today, so a fresh domain install serves published sites only under `/p/`.
2. Stop shipping `nginx/sites-enabled/local.conf` to production hosts. Deploys copy it and `nginx.conf`
   includes `sites-enabled/*.conf`, so production answers `Host: localhost` over plain HTTP,
   outside the `/v1/auth/` rate limit the production vhost applies.
3. In the publish vhost, the `location ~* \.(css|js|…)$` block sets its own `add_header`, which in
   nginx discards every server-level `add_header` — static assets are served without the security
   headers. Harmless for the CSP (it governs documents), not for the rest.
4. Generated-code errors seen in the survey, independent of routing: `missing ) after argument
   list` in two sites, a duplicate `const Engine` declaration in one.
