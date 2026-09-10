# Public Repository Checklist

Use this checklist before pushing to the public GitHub remote.

---

## 1) Secrets and Sensitive Data

- Ensure no live secrets are committed (`.env.docker`, `.env.droplet`, `.env.deploy`).
- Ensure only template files are tracked (`.env.example`, `.env.deploy.example`).
- Search for accidental key leaks in changed files before pushing.
- Private key material is now enforced, not just requested: `scripts/public-repo-guard.mjs` fails on
  key filenames (`id_rsa`, `id_ed25519`, `vps_admin`, `*.pem`, `*.p12`, `*.pfx`, anything under
  `.ssh/`) **and** on any tracked text file under 16 KB containing a `BEGIN … PRIVATE KEY` block —
  because the dangerous case is the one that does not look like a key. `.gitignore` covers the same
  names as a second line of defence.
- The droplet deploy key lives at `~/.ssh/vps_admin` and is referenced by `~/.ssh/config`. It never
  belongs in the repository, in a backup folder inside the repository, or in a scratch file.

---

## 2) Private Infrastructure Files

These must stay local (gitignored) and must never be pushed:

- `docker-compose.droplet.yml`
- `.deploy/`
- `nginx/sites-enabled/*.conf` **except** `nginx/sites-enabled/local.conf` — that file is
  load-bearing: it is mounted read-only by `docker-compose.yml`, `docker-compose.deploy.yml`, and
  `docker-compose.droplet.yml`, and it contains nothing sensitive (`server_name localhost` and
  Docker's internal DNS resolver only). Do not delete it and do not gitignore it. The rule is
  about droplet/production vhost configs (real domains, real upstreams), not the tracked local
  default.
- `docs/deploy/`
- `docs/review/`
- `docs/_archive/`
- private deploy scripts and local backup artifacts

These must never be tracked either — junk, not infrastructure, but just as capable of piling up
in a public repo if nothing enforces it:

- `.playwright-mcp/` (Playwright MCP accessibility dumps — session scratch)
- `debug/` (probe output, ad-hoc screenshots, throwaway exports)
- loose screenshots at the repository root (`*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`) —
  documentation images belong under `docs/`
- `*.bak`, `*.orig`, `*.rej`, editor backups, and `*.tsbuildinfo` build artifacts

### Local working notes

Local-only analysis notes, drafts, and scratch documents (including notes kept in Italian) belong
under `/notes/` at the repository root. That directory is gitignored on purpose: it is where the
operator's working material lives without ever being a candidate for the public tree. Do not add
files there expecting them to be committed, and do not move genuine project documentation into it
to dodge the English rule below — `/notes/` is for scratch, not for deferred translation.

---

## 3) Public Documentation Quality

- Keep docs in English for public contributors.
- Keep examples sanitized (`yourdomain.com`, no live server paths/IPs).
- Update [docs/INDEX.md](../INDEX.md) when adding new guides/runbooks.
- Run `npm run guard:public-repo` before pushing — it fails the build on tracked junk, tracked
  non-example `.env*` files, tracked private-infrastructure paths, and newly added `.md` files
  that are predominantly Italian. See `scripts/public-repo-guard.mjs` for exactly what it checks;
  it also runs in CI on every pull request into `develop` and `main`
  (`.github/workflows/public-repo-guard.yml`) — that CI check is the non-bypassable one.
- Optional local pre-commit hook (no husky, no added dependency): run once per clone,
  `git config core.hooksPath scripts/hooks`, to run the same guard before every commit. Skipping
  this is fine — the CI workflow above still catches everything before merge.

---

## 4) Deploy Safety Notes

- Never run cross-stack commands without checking active stack first.
- Use `--no-deps` when updating a single service in production.
- Do not run `docker compose down` on a live environment unless explicitly planned.

---

## 5) Final Pre-Push Checks

```bash
git status --short
git diff -- . ':!docs/_archive/**'
npm run guard:public-repo
```

Then push only sanitized commits to the public remote.

---

## 6) Known Debt — Pre-Existing Italian Documents (2026-09-09)

29 of 227 tracked `.md` files were found to be substantially Italian. Three of them — the guides
a contributor is most likely to open — were translated in full as part of this pass:
`docs/guides/LLM_JSON_PARSING_GUIDELINES.md`, `docs/guides/OPENROUTER_INTEGRATION_GUIDE.md`, and
`docs/guides/MULTIPROVIDER_LLM_BEST_PRACTICES.md`.

The remaining 26 are deliberately deferred rather than translated in the same change, to keep
that change reviewable. `npm run guard:public-repo` does not flag any of them — the guard only
fails on a **newly added** Italian document, so this list is debt, not a violation. Translate them
opportunistically or in a dedicated pass; do not let the list grow.

**Branch `chore/public-repo-hygiene` (unmerged) already contains full translations for 25 of the
26 files below — recover and rebase that work rather than re-translating from scratch.** Only
`docs/runbooks/BETA_LAUNCH_HARDENING_PLAN.md` is not covered there.

- [ ] `docs/archive/specs/EXTERNAL_API_KEYS_PLATFORM_SPEC.deprecated.md`
- [ ] `docs/archive/specs/IMAGE_PICKER_SPEC.deprecated.md`
- [ ] `docs/archive/vision/TARGET-VISION_2026-05-14.md`
- [ ] `docs/runbooks/BETA_LAUNCH_HARDENING_PLAN.md`
- [ ] `docs/specs/DASHBOARD_LOVABLE_CHAT_SPEC.md`
- [ ] `docs/specs/DB_PLATFORM_SPEC.md`
- [ ] `docs/specs/EXPORT_AND_PUBLISH_SPEC.md`
- [ ] `docs/specs/FORM_RUNTIME_BAAS_IMPLEMENTATION_PLAN.md`
- [ ] `docs/specs/GEN_AI_MEDIA_MODE_SPEC.md`
- [ ] `docs/specs/IMAGE_FETCH_PERSISTENCE_REFACTOR_PROPOSAL.md`
- [ ] `docs/specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md`
- [ ] `docs/specs/ONBOARDING_AND_STYLE_PROFILING_SPEC.md`
- [ ] `docs/specs/OUTPUT_LANGUAGE_CONTROL_SPEC.md`
- [ ] `docs/specs/PREPROMPT_ENGINE_SPEC.md`
- [ ] `docs/specs/PRESET_TYPED_SPECS.md`
- [ ] `docs/specs/PROMPT_OPTIMIZER_SPEC.md`
- [ ] `docs/specs/PROVIDER_SPEC.md`
- [ ] `docs/specs/RAG_CHATBOT_SPEC.md`
- [ ] `docs/specs/SPEC.md`
- [ ] `docs/specs/SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md`
- [ ] `docs/specs/UX_REVIEW_AND_PUBLISH_SPEC.md`
- [ ] `docs/specs/UX_SPEC.md`
- [ ] `docs/specs/VIBE_TO_GODMODE_MODEL_SSOT_REGRESSION_ANALYSIS_2026-08-18.md`
- [ ] `docs/specs/WORKFLOWS.md`
- [ ] `docs/specs/WYSIWYG_EDIT_MODE_SPEC.md`
- [ ] `docs/specs/ZERO_EFFORT_MEDIA_ASYNC_EVOLUTION_SPEC.md`
