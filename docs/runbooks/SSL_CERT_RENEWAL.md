# SSL Certificate Renewal — sitowebinun.click Droplet

How TLS certificates are issued and auto-renewed on `docker-2`, and what to check if
`https://app.sitowebinun.click` or a published site ever shows an expired-cert warning.

## Current Architecture (since 2026-07-09)

Two independent cert lineages, both auto-renewed with **zero nginx downtime**:

| Cert | Domains | Challenge | Auth config |
| --- | --- | --- | --- |
| `app.sitowebinun.click` | `app.sitowebinun.click`, `api.sitowebinun.click` | HTTP-01, webroot | `authenticator = webroot`, `webroot_path = /opt/docker/projects/pageforge/data/certbot-webroot` |
| `sitowebinun.click` | `*.sitowebinun.click` (published sites) | DNS-01, Hostinger API | `authenticator = manual`, hooks: `scripts/certbot-dns-auth.sh` / `certbot-dns-cleanup.sh` |

Renewal trigger: the distro-provided **`certbot.timer`** systemd unit (runs `certbot renew`
twice daily — standard Debian/Ubuntu certbot package behavior). There is **no project-specific
cron job** for renewal; do not re-add one, it would race with the timer.

Deploy step: `/etc/letsencrypt/renewal-hooks/deploy/10-sync-docker-nginx.sh` (installed from
`scripts/certbot-deploy-hook.sh`) runs automatically after **any** successful renewal of **any**
cert, regardless of what triggered it. It copies `/etc/letsencrypt/{live,archive}` into the
project's Docker-mounted `data/certs/` and reloads the nginx container (`nginx -s reload`,
no restart, no downtime).

Why webroot instead of standalone for the app cert: `standalone` binds port 80/443 directly,
which conflicts with nginx already holding those ports — every unattended renewal would fail
unless something stops nginx first. `webroot` lets certbot drop a file under
`data/certbot-webroot/` that nginx (already running) serves at
`/.well-known/acme-challenge/` (see the HTTP server block in
`nginx/sites-enabled/andy-code-cat.conf`) — no coordination with nginx's lifecycle needed.

## Verifying Renewal Health

```bash
ssh docker-2 "certbot certificates"
ssh docker-2 "certbot renew --dry-run --no-random-sleep-on-renew"
ssh docker-2 "systemctl is-enabled certbot.timer; systemctl is-active certbot.timer"
```

`--no-random-sleep-on-renew` matters for interactive/manual runs: `certbot renew` without it
sleeps a random delay (can be several minutes) before doing anything, by design, to avoid
thundering-herd load on Let's Encrypt when many hosts renew via the same daily timer. Always
add this flag when running `certbot renew` by hand so it doesn't appear to hang.

## Incident History — 2026-07-09

Both certs expired 2026-07-08. Root cause: the old renewal mechanism was a weekly cron job
(`0 3 * * 1`) calling `scripts/certbot-renew.sh`, but that script (plus its two DNS-01 hook
scripts and `.deploy/certbot.env`) had **CRLF line endings** — committed that way because the
repo had no `.gitattributes` and was authored on Windows with `core.autocrlf=true`. A CRLF
shebang (`#!/bin/bash\r`) makes the kernel look for an interpreter literally named `bash\r`,
which doesn't exist, so every weekly run failed silently with `not found` in
`/var/log/certbot-renew.log` for three months without alerting anyone.

Fixes applied:
- Added root-level `.gitattributes` (`*.sh`, `Dockerfile*`, `docker-compose*.yml`, `*.conf`,
  `.env*` forced to `eol=lf`) so this class of bug cannot recur from a Windows checkout.
- Replaced the standalone-authenticator + weekly-cron design (single point of failure, silent
  failure mode, brief downtime by construction) with webroot + systemd timer + global
  deploy-hook, all of which are certbot's own documented mechanisms rather than
  project-specific plumbing.
- Retired `scripts/certbot-renew.sh` and the crontab entry — superseded by
  `scripts/certbot-deploy-hook.sh` installed as a global deploy hook.

If a cert ever expires again, check `journalctl -u certbot.service` first (that's now the
single source of truth for renewal attempts) rather than a cron log.
