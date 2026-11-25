# Public Repository Checklist

Use this checklist before pushing to the public GitHub remote.

---

## 1) Secrets and Sensitive Data

- Ensure no live secrets are committed (`.env.docker`, `.env.deploy`, any other non-example `.env.*`).
- Ensure only template files are tracked (`.env.example`, `.env.deploy.example`).
- Search for accidental key leaks in changed files before pushing.
- Private key material is now enforced, not just requested: `scripts/public-repo-guard.mjs` fails on
  key filenames (`id_rsa`, `id_ed25519`, `vps_admin`, `*.pem`, `*.p12`, `*.pfx`, anything under
  `.ssh/`) **and** on any tracked text file under 16 KB containing a `BEGIN … PRIVATE KEY` block —
  because the dangerous case is the one that does not look like a key. `.gitignore` covers the same
  names as a second line of defence.
- Server deploy keys live in `~/.ssh/` and are referenced by `~/.ssh/config`. They never belong in
  the repository, in a backup folder inside the repository, or in a scratch file.

---

## 2) Private Infrastructure Files

These must stay local (gitignored) and must never be pushed:

- host-specific compose overrides (`docker-compose.override.yml`, legacy `docker-compose.droplet.yml`)
- `.deploy/`
- `nginx/sites-enabled/*.conf` **except** `nginx/sites-enabled/local.conf` — that file is
  load-bearing: it is mounted read-only by `docker-compose.yml` and `docker-compose.deploy.yml`, and it contains nothing sensitive (`server_name localhost` and
  Docker's internal DNS resolver only). Do not delete it and do not gitignore it. The rule is
  about production vhost configs (real domains, real upstreams), not the tracked local
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

## 6) Language — Resolved Debt (2026-11-25)

The 2026-09-09 audit found 29 tracked `.md` files written substantially in Italian. Three guides
were translated then. On 2026-11-25, 25 of the remaining 26 were replaced by the translations
prepared on `chore/public-repo-hygiene`; the last one, `docs/runbooks/BETA_LAUNCH_HARDENING_PLAN.md`,
was already English apart from one phrase, fixed the same day. No tracked document is predominantly
Italian any more, and the guard (check 4) keeps it that way for new documents.

---

## 7) Operator Denylist (private terms)

Real domain names, host aliases, server paths and LAN addresses are private, so the list of them
cannot live in the public tree. Keep it in `.deploy/public-repo-denylist.txt` (gitignored), one
literal term per line. When the file exists, `npm run guard:public-repo` fails on any tracked file
containing one of the terms and reports only the file and the count, never the term. CI does not
have the file; enable the local hook (`git config core.hooksPath scripts/hooks`) so it runs before
every commit on the operator's machine.

Git history is public too. Removing a term from the current tree does not remove it from earlier
commits; that needs a history rewrite, which this repository's Gitflow rules forbid on shared
branches.
