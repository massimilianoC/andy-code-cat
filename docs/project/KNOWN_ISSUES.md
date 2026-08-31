# Known Issues — Next Review / Refactor / Fix Pass

Cross-cutting defects and small feature gaps that were found during real use and are not yet
scheduled into a specific increment. This file exists so the next agent that touches these
areas — human or automated — starts from what is already known instead of rediscovering it.

Add an entry here instead of only a local task tracker item: task trackers are per-session,
this file is tracked in git and visible to every future agent and contributor.

When an item is picked up, move it into a real fix/PR and delete the entry here rather than
marking it done in place — this file is a queue, not a changelog.

---

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
  URL instead of an absolute `https://api.sitowebinun.click/p/media/:assetId` one — a symptom of
  `PUBLIC_API_BASE_URL` being unset or wrong at the moment that specific project's HTML was
  generated (`ResolveAndPersistHtmlImages.ts:36`, `assetPublicUrl()`). Because the URL is
  persisted, not recomputed, fixing today's env value does not retroactively repair already-baked
  artifacts.
- A live scan of production (`data/www/*/index.html` on the droplet, 2026-08-31) found **10 of 88**
  published sites affected: `533f3b31`, `5864d85d`, `6c84b195`, `a92ec46d`, `ae299aaf`, `b0db29be`,
  `b35f5b65`, `b56ad1bd`, `creative-coding-26`, `d4286322`.
- **Mitigated**, not root-caused: added a `location /p/media/ { proxy_pass ...; }` block to the
  wildcard-subdomain vhost (`nginx/sites-enabled/andy-code-cat.conf`, section 3b) so a relative
  `/p/media/:id` request now reaches the API instead of silently falling through to the SPA
  `index.html` fallback (previously: 200 text/html for every path, including binary asset
  requests — no console/network error, images just never decoded). Deployed live to `docker-2`
  and verified (`curl` against `a92ec46d.sitowebinun.click/p/media/...` now returns the real
  `image/jpeg`, not the index page). This file is gitignored from the public repo on purpose
  (see `docs/guides/GITFLOW_RELEASE_POLICY.md`), so the change is not visible as a normal commit
  here — it is recorded there instead.
- **Still open**: no startup-time guard exists to catch `PUBLIC_API_BASE_URL` being unset/wrong
  again before it bakes a bad URL into new artifacts. Worth a fail-fast check in
  `apps/api/src/config.ts` (reject boot in `production` if the var is unset, rather than silently
  defaulting to `http://localhost:${API_PORT}`) as a real fix, separate from the nginx mitigation.
