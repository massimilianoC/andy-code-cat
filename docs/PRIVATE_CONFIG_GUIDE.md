# Private Configuration & Two-Project Strategy

This document is for the repository owner. It explains what stays local and how to maintain both the public open-source project and the private production deployment.

---

## What Belongs Where

### Public GitHub repo (this repo)

| Category | Examples |
|---|---|
| All source code | `apps/`, `packages/` |
| Generic Docker Compose files | `docker-compose.yml`, `docker-compose.deploy.yml` |
| Template env files | `.env.example`, `.env.deploy.example` |
| Documentation | `docs/specs/`, `docs/guides/`, `docs/agents/`, `docs/architecture/` |
| Architecture contract | `AGENTS.md`, `CONTRIBUTING.md`, `ROADMAP.md` |
| LICENSE, README | `LICENSE`, `README.md` |

### Private — stays on your machine only (gitignored)

| Category | Files |
|---|---|
| Live env files | `.env.docker`, `.env.droplet`, `.env.deploy` |
| Private deploy scripts | `scripts/deploy-to-droplet.sh`, `scripts/seed-droplet.sh` |
| Private compose file | `docker-compose.droplet.yml` |
| Production nginx vhost | `nginx/sites-enabled/pageforge.conf` |
| Billing data | `docs/cost-providers/bills_*.csv` |
| Internal reviews | `docs/review/` |
| Archived Italian docs | `docs/_archive/` |
| Deploy runbooks with live IPs | `docs/deploy/` |

---

## Recommended: Single Repo, Two Remotes

You don't need two separate repos. One repo with two remotes is simpler:

```bash
# Public remote (open-source, sanitized)
git remote add public https://github.com/massimilianoC/andy-code-cat.git

# Private remote (your full working copy — use a private GitHub repo or a local bare repo)
git remote add private git@github.com:massimilianoC/andy-code-cat-private.git
# Or a local network backup:
# git remote add private /path/to/backup/andy-code-cat.git
```

**Push public (safe to share):**

```bash
git push public main
```

**Push private (full backup including private branches, notes, etc.):**

```bash
git push private main
```

This way the private remote is your full working backup. The public remote only ever receives properly sanitized commits.

---

## What to Never Push to the Public Remote

Before every `git push public main`, mentally check:

1. No `.env.*` files (except `.env.example` and `.env.deploy.example`)
2. No live server IPs or SSH key names
3. No API keys in any file
4. No billing CSVs
5. No `docs/deploy/` contents (they have production IPs)
6. No `docker-compose.droplet.yml`

The `.gitignore` already covers all of these — as long as you never `git add -f` a gitignored file.

---

## Local Backup Strategy (Recommended)

Your private configs (`.env.docker`, `.env.droplet`, `docs/deploy/`, etc.) are **gitignored** and will only exist on your machine. Back them up:

### Option 1: Private GitHub repo

Create a private repo `andy-code-cat-private` and add it as the `private` remote (see above). Push periodically. This gives you cloud backup + history.

### Option 2: Encrypted local archive

```bash
# Create encrypted backup of private files
tar czf - .env.docker .env.droplet docs/deploy/ docs/_archive/ docs/review/ scripts/deploy-to-droplet.sh scripts/seed-droplet.sh nginx/sites-enabled/ | gpg --symmetric > private-backup-$(date +%Y%m%d).tar.gz.gpg
```

Store in a safe location (external drive, Bitwarden Send, etc.).

### Option 3: Bitwarden / 1Password Secure Notes

For the small set of secrets (API keys, JWT secrets), a password manager is the simplest and most secure option.

---

## Adding Private Files Back After a Fresh Clone

If you clone the public repo on a new machine:

```bash
git clone https://github.com/massimilianoC/andy-code-cat.git
cd andy-code-cat

# Restore your private env files from your secure backup
cp ~/Backup/andy/.env.docker .env.docker
cp ~/Backup/andy/.env.droplet .env.droplet
# etc.
```

---

## Keeping the Two Remotes in Sync

Only one `main` branch. No divergence. Workflow:

```bash
# Work normally, commit locally
git add -A
git commit -m "feat: ..."

# Push to private remote (full backup — do this often)
git push private main

# Push to public remote (only when ready; double-check .gitignore)
git push public main
```

If you have private branches (e.g., `ops/droplet-config`):

```bash
# Push private branch to private remote only
git push private ops/droplet-config

# Never push private branches to public remote
```
