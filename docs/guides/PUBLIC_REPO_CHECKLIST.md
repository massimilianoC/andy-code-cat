# Public Repository Checklist

Use this checklist before pushing to the public GitHub remote.

---

## 1) Secrets and Sensitive Data

- Ensure no live secrets are committed (`.env.docker`, `.env.droplet`, `.env.deploy`).
- Ensure only template files are tracked (`.env.example`, `.env.deploy.example`).
- Search for accidental key leaks in changed files before pushing.

---

## 2) Private Infrastructure Files

These must stay local (gitignored) and must never be pushed:

- `docker-compose.droplet.yml`
- `.deploy/`
- `nginx/sites-enabled/`
- `docs/deploy/`
- `docs/review/`
- `docs/_archive/`
- private deploy scripts and local backup artifacts

---

## 3) Public Documentation Quality

- Keep docs in English for public contributors.
- Keep examples sanitized (`yourdomain.com`, no live server paths/IPs).
- Update [docs/INDEX.md](../INDEX.md) when adding new guides/runbooks.

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
```

Then push only sanitized commits to the public remote.
