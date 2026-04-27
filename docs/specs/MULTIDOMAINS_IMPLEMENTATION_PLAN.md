# Multi-Domain Deployment — Implementation Plan

**Status:** Planned — R3 sub-milestones  
**Branch target:** `feat/multi-domain` (branches from `develop`)  
**Author:** Architecture team  
**Date:** 2026-04-27  
**Language:** English (canonical)

---

## Overview

This document is the authoritative implementation plan for adding **multi-domain support** to the
andy-code-cat platform. The goal is to allow a single deployed cluster to serve published sites
across multiple apex domains, each with its own wildcard SSL certificate, while users are
transparently associated with the domain they registered through.

The plan is designed around **maximum backward compatibility**: the existing `sitowebinun.click`
deployment continues to work without any data migration. A second domain (`andycode.cat`) is wired
in as the first multi-domain test, configured outside version control.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Architecture Overview](#2-architecture-overview)
3. [Domain Model and Backward Compatibility](#3-domain-model-and-backward-compatibility)
4. [Database Schema Changes](#4-database-schema-changes)
5. [nginx Configuration Strategy](#5-nginx-configuration-strategy)
6. [SSL Certificate Automation](#6-ssl-certificate-automation)
7. [Registration Flow](#7-registration-flow)
8. [Assign User to Domain — Use Case](#8-assign-user-to-domain--use-case)
9. [Admin API — /v1/admin/domains](#9-admin-api--v1admindomains)
10. [Admin UI — Domains Tab](#10-admin-ui--domains-tab)
11. [Infrastructure Changes](#11-infrastructure-changes)
12. [Sub-milestone Breakdown](#12-sub-milestone-breakdown)
13. [Test Configuration — andycode.cat](#13-test-configuration--andycodecat)
14. [Dummy Domain Examples](#14-dummy-domain-examples)
15. [Security Notes](#15-security-notes)

---

## 1. Design Principles

| Principle | How it is applied |
|---|---|
| **Backward compatibility** | Existing domain becomes the seeded default `Domain` document. Zero data migration. |
| **publishId independence** | The filesystem key (`/data/www/{slug}/`) is domain-agnostic. Domain change = DB field update + nginx reload only. |
| **Separation of concerns** | `domains` collection owns DNS/SSL/nginx metadata. Users and deployments reference it by ID. |
| **Config outside git** | DNS records and domain credentials live in `.env.droplet` (gitignored). The `domains` collection is seeded at first boot from these env vars. |
| **Admin-owned lifecycle** | Only `superadmin` can create, toggle, or delete domains. |
| **Audit trail** | All domain write operations persist `updatedByUserId` + timestamp. |

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                     nginx (dynamic)                       │
│                                                           │
│  app.sitowebinun.click ──────────────────► web:8081      │
│  api.sitowebinun.click ──────────────────► api:4000      │
│  *.sitowebinun.click   ──────────────────► static files  │
│                                                           │
│  app.andycode.cat      ──────────────────► web:8081      │ ← NEW
│  api.andycode.cat      ──────────────────► api:4000      │ ← NEW
│  *.andycode.cat        ──────────────────► static files  │ ← NEW
└──────────────────────────────────────────────────────────┘
         │
         │  /data/nginx-sites/  (writable — not tracked in git)
         │        sitowebinun.click.conf   (generated)
         │        andycode.cat.conf        (generated)
         │
         ▼
┌────────────────────────────────────────────────────────────┐
│  API — NginxController                                      │
│  • generates .conf via Nunjucks template                    │
│  • runs `nginx -t` before reloading                         │
│  • calls `nginx -s reload` via Docker socket proxy          │
└────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────┐
│  BullMQ Workers                                             │
│  • SslRenewalWorker   — checks expiry, runs certbot        │
│  • DeployWorker       — existing, no change                 │
└────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────┐
│  MongoDB collections                                        │
│  • domains            — NEW                                 │
│  • users              — 2 new fields                        │
│  • deployments        — 2 new fields                        │
└────────────────────────────────────────────────────────────┘
```

Single upstream pair (`web:8081` / `api:4000`) is shared across all domains.
Only the nginx server blocks and SSL certs differ per domain.

---

## 3. Domain Model and Backward Compatibility

### 3.1 Backward compatibility guarantee

The current production domain `sitowebinun.click` is converted into the **first seeded `Domain`
document** at first boot. No existing user record, project, or deployment record changes at this
step — the domain fields on those models are nullable and default to this seed domain when absent.

```
Phase 0 (before implementation):
  User: { email: "alice@example.com" }                    ← no domain field
  Deployment: { slug: "abc123", url: "https://abc123.sitowebinun.click" }

Phase 1 (after implementation, seed run):
  Domain: { id: "dom_001", apex: "sitowebinun.click", isDefault: true }
  User: { email: "alice@example.com", assignedDomainId: null }
    → null resolves to isDefault domain at read time
  Deployment: { slug: "abc123", url: "https://abc123.sitowebinun.click", domainId: null }
    → null resolves to isDefault domain at read time
```

Existing clients that do not send `domainId` continue to work. The API resolves `null` → default
domain in all places where a domain is needed.

### 3.2 Default domain resolution

```typescript
// shared utility: resolves domain, falls back to default
async function resolveDomain(domainId?: string | null): Promise<Domain> {
  if (domainId) return await DomainRepo.findById(domainId);
  return await DomainRepo.findDefault();
}
```

`DomainRepo.findDefault()` returns the document where `isDefault: true`. Exactly one `Domain`
document must carry this flag at all times (enforced by the repo layer).

---

## 4. Database Schema Changes

### 4.1 New collection: `domains`

```typescript
interface Domain {
  _id: ObjectId;
  id: string;             // "dom_" + nanoid(8), e.g. "dom_g5hk2p1a"

  // DNS identity
  apex: string;           // e.g. "sitowebinun.click" or "acme.com"
  label: string;          // human display name, e.g. "Sito Web in un Click"

  // Lifecycle
  isActive: boolean;      // false = suspended (returns 503 on all subdomains)
  isDefault: boolean;     // exactly one domain carries this flag

  // nginx config
  nginx: {
    appSubdomain: string;       // e.g. "app"  → app.sitowebinun.click
    apiSubdomain: string;       // e.g. "api"  → api.sitowebinun.click
    confPath: string;           // absolute path inside container: /data/nginx-sites/sitowebinun.click.conf
    confChecksum: string;       // sha256 of last written conf (idempotency check)
    lastReloadAt: Date | null;
  };

  // SSL certificates
  ssl: {
    appCertPath: string;        // /etc/letsencrypt/live/app.sitowebinun.click/fullchain.pem
    appCertExpires: Date;
    wildcardCertPath: string;   // /etc/letsencrypt/live/sitowebinun.click/fullchain.pem
    wildcardCertExpires: Date;
    lastRenewalAt: Date | null;
    renewalMethod: 'http01' | 'dns01';
    dnsProviderKey: string;     // reference to env var name (never stored value)
                                // e.g. "HOSTINGER_API_KEY_SITOWEB" — key name only
  };

  // Stats (denormalized counters, updated on user/deployment writes)
  stats: {
    userCount: number;
    deploymentCount: number;
  };

  // Audit
  createdAt: Date;
  updatedAt: Date;
  updatedByUserId: string | null;
}
```

**Indexes:**
```
{ apex: 1 }         unique
{ isDefault: 1 }    sparse (only one document)
{ isActive: 1 }
```

### 4.2 `users` collection — additions

Two new optional fields (non-breaking, default `null`):

```typescript
// added to existing User interface:
registrationDomainId: string | null;  // domain through which the user registered
assignedDomainId: string | null;      // current domain for new publications
                                      // null = resolved to isDefault domain
```

No index required on `registrationDomainId` unless a filtered admin query is needed.
`assignedDomainId` gets a regular index for the per-domain user list query.

```
{ assignedDomainId: 1 }  regular index
```

### 4.3 `deployments` collection — additions

Two new optional fields (non-breaking, default `null`):

```typescript
// added to existing SiteDeployment interface:
domainId: string | null;    // null = sitowebinun.click (isDefault)
publishUrl: string;         // canonical public URL including domain
                            // e.g. "https://abc123.acme.com"
```

> **Note:** The existing `url` field remains present for backward compatibility. New code should
> write to both `url` and `publishUrl`. When `publishUrl` is present, it takes precedence.

---

## 5. nginx Configuration Strategy

### 5.1 Template (`nginx-templates/vhost.conf.njk`)

One Nunjucks template generates the entire conf for a single domain. It replaces the current
static `andy-code-cat.conf`.

```nginx
# =============================================================================
# Generated by NginxController — DO NOT EDIT MANUALLY
# Domain: {{ apex }}
# Generated at: {{ generatedAt }}
# =============================================================================

upstream web_{{ safeApex }} {
    server web:8081;
    keepalive 16;
}

upstream api_{{ safeApex }} {
    server api:4000;
    keepalive 32;
}

# --- Shared SSL for {{ apex }} ---
# app + api certificate (HTTP-01)
ssl_certificate     {{ ssl.appCertPath }};
ssl_certificate_key {{ ssl.appKeyPath }};
ssl_protocols       TLSv1.2 TLSv1.3;
ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
ssl_session_cache   shared:SSL_{{ safeApex }}:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
ssl_stapling        on;
ssl_stapling_verify on;

# --- HTTP → HTTPS redirect: app + api ---
server {
    listen 80;
    server_name {{ nginx.appSubdomain }}.{{ apex }} {{ nginx.apiSubdomain }}.{{ apex }};
    return 301 https://$host$request_uri;
}

{% if not isActive %}
# --- Domain suspended by superadmin ---
server {
    listen 443 ssl http2;
    server_name ~^.+\.{{ apexEscaped }}$  {{ nginx.appSubdomain }}.{{ apex }}  {{ nginx.apiSubdomain }}.{{ apex }};
    ssl_certificate     {{ ssl.wildcardCertPath }};
    ssl_certificate_key {{ ssl.wildcardKeyPath }};
    return 503;
}
{% else %}

# --- app.{{ apex }} → Next.js web app ---
server {
    listen 443 ssl http2;
    server_name {{ nginx.appSubdomain }}.{{ apex }};

    add_header X-Frame-Options           "SAMEORIGIN" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy        "camera=(), microphone=(), geolocation=()" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    location / {
        proxy_pass         http://web_{{ safeApex }};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}

# --- api.{{ apex }} → Express API ---
server {
    listen 443 ssl http2;
    server_name {{ nginx.apiSubdomain }}.{{ apex }};

    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "DENY" always;
    add_header Referrer-Policy           "no-referrer" always;
    add_header Permissions-Policy        "camera=(), microphone=(), geolocation=()" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    location ~ ^/v1/auth/ {
        limit_req zone=ratelimit_auth burst=5 nodelay;
        limit_req_status 429;
        proxy_pass         http://api_{{ safeApex }};
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 30s;
    }

    location / {
        limit_req zone=ratelimit_api burst=60 nodelay;
        limit_req_status 429;
        proxy_pass              http://api_{{ safeApex }};
        proxy_http_version      1.1;
        proxy_set_header        Host              $host;
        proxy_set_header        X-Real-IP         $remote_addr;
        proxy_set_header        X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header        X-Forwarded-Proto $scheme;
        proxy_buffering         off;
        proxy_cache             off;
        proxy_read_timeout      300s;
        proxy_send_timeout      300s;
        chunked_transfer_encoding on;
    }
}

# --- HTTP → HTTPS redirect for published subdomains ---
server {
    listen 80;
    server_name "~^(?<publishId>[a-z0-9][a-z0-9-]{0,28}[a-z0-9])\.{{ apexEscaped }}$";
    return 301 https://$host$request_uri;
}

# --- Published sites: *.{{ apex }} ---
server {
    listen 443 ssl http2;
    server_name "~^(?<publishId>[a-z0-9][a-z0-9-]{0,28}[a-z0-9])\.{{ apexEscaped }}$";

    ssl_certificate     {{ ssl.wildcardCertPath }};
    ssl_certificate_key {{ ssl.wildcardKeyPath }};

    root  /var/www/andy-code-cat/$publishId;
    index index.html;

    if (!-d /var/www/andy-code-cat/$publishId) {
        return 404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(css|js|jpg|jpeg|png|gif|webp|svg|ico|woff2|woff|ttf)$ {
        expires    7d;
        add_header Cache-Control "public, immutable";
    }

    add_header X-Frame-Options         "SAMEORIGIN" always;
    add_header X-Content-Type-Options  "nosniff" always;
    add_header X-Robots-Tag            "noindex" always;
    add_header Referrer-Policy         "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;" always;
}

{% endif %}
```

> **`safeApex`** is `apex` with `.` replaced by `_`, used in nginx upstream names.
> Example: `sitowebinun.click` → `sitowebinun_click`.
>
> **`apexEscaped`** is `apex` with `.` escaped as `\.` for nginx regex server_name.
> Example: `sitowebinun.click` → `sitowebinun\.click`.

### 5.2 NginxController (infrastructure layer)

```typescript
// apps/api/src/infrastructure/nginx/NginxController.ts

class NginxController {
  private readonly confDir: string;        // e.g. /data/nginx-sites
  private readonly templatePath: string;   // nginx-templates/vhost.conf.njk

  async writeConf(domain: Domain): Promise<void> {
    const rendered = nunjucks.render(this.templatePath, buildTemplateContext(domain));
    const checksum = sha256(rendered);
    if (domain.nginx.confChecksum === checksum) return; // idempotent
    await fs.writeFile(domain.nginx.confPath, rendered, 'utf8');
    await DomainRepo.setChecksum(domain.id, checksum);
  }

  async testConf(): Promise<void> {
    // docker exec andy-code-cat-nginx nginx -t
    await execDocker(['exec', 'andy-code-cat-nginx', 'nginx', '-t']);
  }

  async reload(): Promise<void> {
    await this.testConf();  // always validate before reload
    await execDocker(['exec', 'andy-code-cat-nginx', 'nginx', '-s', 'reload']);
    await DomainRepo.updateAllLastReloadAt();
  }

  async removeConf(domain: Domain): Promise<void> {
    await fs.unlink(domain.nginx.confPath);
  }
}
```

All `writeConf` + `reload` sequences run inside a **per-domain advisory lock** (implemented with a
Redis `SET NX` key) to prevent concurrent writes on the same file.

### 5.3 Volume change in docker-compose.droplet.yml

The static `./nginx/sites-enabled` mount (read-only) is replaced by a writable runtime directory:

```yaml
# BEFORE:
volumes:
  - ./nginx/sites-enabled:/etc/nginx/sites-enabled:ro

# AFTER:
volumes:
  - ./nginx/sites-enabled:/etc/nginx/sites-enabled:ro   ← kept for local.conf / fallback
  - ./data/nginx-sites:/etc/nginx/conf.d                ← NEW: generated domain confs
```

> `./nginx/sites-enabled` is kept for the static `nginx.conf` include directives and the
> `local.conf` (dev). Generated per-domain files go into `./data/nginx-sites/` which maps to
> `/etc/nginx/conf.d/` inside the container. Nginx includes `conf.d/*.conf` by default.
>
> **`./data/nginx-sites/` must be listed in `.gitignore`** since it contains generated
> environment-specific files.

The API container also needs this volume to write conf files:

```yaml
api:
  volumes:
    - ./data/www:/workspace/data/www
    - ./data/nginx-sites:/workspace/data/nginx-sites   # ← NEW
```

---

## 6. SSL Certificate Automation

### 6.1 Certificate strategy per domain

| Subdomain | Certificate type | Method | Coverage |
|---|---|---|---|
| `app.{apex}` + `api.{apex}` | Dedicated SAN cert | HTTP-01 via certbot | exactly the two names |
| `*.{apex}` | Wildcard cert | DNS-01 via certbot + DNS API | all published subdomains |

### 6.2 SslRenewalWorker (BullMQ)

```typescript
// Job: check all active domains for certs expiring within 30 days

interface SslRenewalJob {
  domainId: string;
  certType: 'app' | 'wildcard';
}

class SslRenewalWorker {
  async process(job: Job<SslRenewalJob>): Promise<void> {
    const domain = await DomainRepo.findById(job.data.domainId);
    if (!domain.isActive) return;

    if (job.data.certType === 'app') {
      // certbot renew --cert-name app.{apex} --non-interactive
      await runCertbot(['renew', '--cert-name', `app.${domain.apex}`, '--non-interactive']);
    } else {
      // certbot renew --cert-name {apex} --non-interactive (DNS-01)
      await runCertbot(['renew', '--cert-name', domain.apex, '--non-interactive']);
    }

    await DomainRepo.updateSslExpiry(domain.id, job.data.certType, newExpiry);
    await NginxController.reload();
    await AuditLog.write({ action: 'ssl_renewal', domainId: domain.id, certType: job.data.certType });
  }
}
```

A **scheduler job** (BullMQ repeatable, cron `0 3 * * *`) checks all active domains and enqueues
renewal jobs for certs expiring within 30 days. Uses the `DomainRepo.findExpiringCerts(days: 30)`
query.

### 6.3 First-time cert acquisition

Manual step documented in the deploy runbook, not automated in R3.1. The superadmin creates a new
`Domain` doc via the API, then SSH into the droplet and runs:

```bash
# App + api cert (HTTP-01) — nginx must be running and port 80 reachable
certbot certonly --nginx \
  -d app.andycode.cat \
  -d api.andycode.cat

# Wildcard cert (DNS-01) — requires DNS API credentials
certbot certonly --dns-hostinger \
  -d "*.andycode.cat" \
  --dns-hostinger-credentials /root/.secrets/hostinger.ini
```

After issuance, the superadmin updates the `Domain` doc cert paths and expiry dates via `PATCH
/v1/admin/domains/:domainId`. The API then regenerates and reloads the nginx conf.

---

## 7. Registration Flow

### 7.1 Capturing the registration domain

When a user registers, the API inspects the `Host` request header to identify which domain
originated the request.

```typescript
// RegisterUserUseCase

async execute(dto: RegisterUserDTO, host: string): Promise<AuthTokens> {
  // Resolve which domain the request came through
  const domain = await DomainRepo.findByHost(host);
  // findByHost: matches "app.{apex}" or "{apex}" against apex field, falls back to default

  const user = await UserRepo.create({
    ...userFields,
    registrationDomainId: domain.id,
    assignedDomainId: domain.id,   // start assigned to registration domain
  });

  // ... issue tokens
}
```

`DomainRepo.findByHost(host: string)`:
- strips `app.` prefix if present
- matches against `Domain.apex` (exact)
- returns default domain if no match found

### 7.2 New user default: default domain

If registration occurs via direct API call (no `Host` or unrecognised host), `registrationDomainId`
and `assignedDomainId` both default to the `isDefault` domain.

---

## 8. Assign User to Domain — Use Case

### 8.1 Use case: AssignUserToDomain

```typescript
// apps/api/src/application/admin/AssignUserToDomainUseCase.ts

interface AssignUserToDomainDTO {
  userId: string;
  targetDomainId: string;
  migratePublishedUrls: boolean;  // default true
}

async execute(dto: AssignUserToDomainDTO, actorId: string): Promise<void> {
  const user = await UserRepo.findById(dto.userId);
  const targetDomain = await DomainRepo.findById(dto.targetDomainId);
  if (!targetDomain.isActive) throw new DomainInactiveError();

  const sourceDomain = await resolveDomain(user.assignedDomainId);

  // 1. Update user assignment
  await UserRepo.setAssignedDomain(dto.userId, dto.targetDomainId);

  // 2. Optionally migrate published deployment URLs (DB only — no file movement)
  if (dto.migratePublishedUrls) {
    const deployments = await DeploymentRepo.findByOwner(dto.userId, { status: 'published' });
    for (const dep of deployments) {
      const newUrl = buildPublishUrl(dep.slug, targetDomain);
      await DeploymentRepo.updatePublishUrl(dep.id, {
        domainId: targetDomain.id,
        publishUrl: newUrl,
      });
      await ProjectRepo.updateSiteUrl(dep.projectId, newUrl);
    }
  }

  // 3. Counters
  await DomainRepo.decrementUserCount(sourceDomain.id);
  await DomainRepo.incrementUserCount(targetDomain.id);

  // 4. Audit
  await AuditLog.write({
    action: 'assign_user_domain',
    actorId,
    userId: dto.userId,
    fromDomainId: sourceDomain.id,
    toDomainId: targetDomain.id,
  });
}
```

> **No file movement.** The slug folder `/data/www/{slug}/` stays in place.
> The nginx wildcard `*.sitowebinun.click` already matched `slug.sitowebinun.click`;
> the new wildcard `*.andycode.cat` will match `slug.andycode.cat`.
> Both confs serve files from the same `/data/www/` volume.

### 8.2 Edge case: hardcoded absolute URLs in generated HTML

LLM-generated HTML may contain hardcoded absolute URLs pointing to the old domain. These are not
rewritten automatically. The use case logs a warning when `migratePublishedUrls: true` if any
deployed project has its latest snapshot containing `https://{oldApex}`. The admin UI surfaces
this count in the domain assignment confirmation modal.

---

## 9. Admin API — /v1/admin/domains

All routes require `requireSuperAdmin` middleware.

### 9.1 Route table

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/admin/domains` | Paginated domain list |
| `POST` | `/v1/admin/domains` | Create new domain |
| `GET` | `/v1/admin/domains/:domainId` | Domain detail with stats |
| `PATCH` | `/v1/admin/domains/:domainId` | Update domain fields (label, nginx, ssl paths) |
| `PATCH` | `/v1/admin/domains/:domainId/toggle` | Activate / suspend domain |
| `DELETE` | `/v1/admin/domains/:domainId` | Delete domain (requires user count = 0) |
| `POST` | `/v1/admin/domains/:domainId/reload-nginx` | Regenerate conf and reload nginx |
| `POST` | `/v1/admin/domains/set-default/:domainId` | Promote to default domain |

### 9.2 Create domain — request body

```typescript
interface CreateDomainDTO {
  apex: string;               // "acme.com"
  label: string;              // "Acme Web Builder"
  nginx: {
    appSubdomain: string;     // "app"
    apiSubdomain: string;     // "api"
  };
  ssl: {
    appCertPath: string;      // "/etc/letsencrypt/live/app.acme.com/fullchain.pem"
    appKeyPath: string;       // "/etc/letsencrypt/live/app.acme.com/privkey.pem"
    appCertExpires: string;   // ISO date
    wildcardCertPath: string; // "/etc/letsencrypt/live/acme.com/fullchain.pem"
    wildcardKeyPath: string;  // "/etc/letsencrypt/live/acme.com/privkey.pem"
    wildcardCertExpires: string;
    renewalMethod: 'http01' | 'dns01';
    dnsProviderKey: string;   // env var name, e.g. "HOSTINGER_API_KEY_ACME"
  };
}
```

On successful create: `NginxController.writeConf(domain)` + `NginxController.reload()`.

### 9.3 Toggle domain — request body

```typescript
interface ToggleDomainDTO {
  isActive: boolean;
}
```

On toggle: regenerates conf (the template renders a 503 block when `isActive: false`) + reload.

### 9.4 Delete domain — guards

- Returns `400` if `domain.stats.userCount > 0`.
- Returns `400` if `domain.isDefault === true` (cannot delete the default).
- On success: removes conf file + reload.

---

## 10. Admin UI — Domains Tab

### 10.1 Route

`/admin/domains` — added alongside the existing admin pages.

### 10.2 Page layout

```
/admin/domains
  ├── Domain list (table)
  │     columns: label, apex, status (active/suspended), users, deployments, ssl expiry, actions
  │     actions: Edit | Toggle | Reload nginx | Delete
  │
  └── Domain detail modal (or /admin/domains/[domainId])
        sections:
          • Identity      — apex, label, isDefault badge
          • nginx         — app/api subdomains, conf path, checksum, last reload
          • SSL           — cert paths, expiry dates, renewal method, renew now button
          • Statistics    — user count, deployment count
          • Users         — paginated list of users assigned to this domain
                           (with "Reassign to…" action per user)
          • Danger zone   — Suspend / Delete (with confirmation modal)
```

### 10.3 Confirmation modals

**Suspend domain**: `"Suspending this domain will return HTTP 503 for all {n} published sites.
Type the domain name to confirm."` — free-text confirmation requires exact apex string.

**Delete domain**: only enabled when `userCount === 0`. Confirmation: `"This action is irreversible.
Type the domain name to confirm."`.

**Assign user to domain**: shows list of projects that will have their URL migrated + hardcoded URL
warning count if > 0.

---

## 11. Infrastructure Changes

### 11.1 File system additions

```
/data/
  nginx-sites/          ← NEW: writable, gitignored, generated conf files
    sitowebinun.click.conf
    andycode.cat.conf
  www/                  ← unchanged: published site static files
  certs/                ← unchanged: Let's Encrypt certs
```

`.gitignore` addition:
```
/data/nginx-sites/
```

### 11.2 nginx.conf — conf.d include

The main `nginx/nginx.conf` must include the generated conf files. Add:

```nginx
# in http block:
include /etc/nginx/conf.d/*.conf;
```

This is separate from `include /etc/nginx/sites-enabled/*.conf;` which covers static confs
(rate limit zones, `local.conf`). The split keeps generated files isolated from committed files.

### 11.3 docker-compose.droplet.yml changes summary

```yaml
api:
  volumes:
    - ./data/www:/workspace/data/www
    - ./data/nginx-sites:/workspace/data/nginx-sites    # ← NEW

nginx:
  volumes:
    - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    - ./nginx/sites-enabled:/etc/nginx/sites-enabled:ro
    - ./data/www:/var/www/andy-code-cat:ro
    - ./data/certs:/etc/letsencrypt:ro
    - ./data/nginx-sites:/etc/nginx/conf.d              # ← NEW (writable)
```

### 11.4 Environment variables (non-committed)

`.env.droplet` additions for the `andycode.cat` test domain:

```dotenv
# Multi-domain: seed domains at first boot
# Format: comma-separated JSON or individual keys per domain index

SEED_DOMAIN_1_APEX=sitowebinun.click
SEED_DOMAIN_1_LABEL=Sito Web in un Click
SEED_DOMAIN_1_IS_DEFAULT=true
SEED_DOMAIN_1_APP_CERT=/etc/letsencrypt/live/app.sitowebinun.click/fullchain.pem
SEED_DOMAIN_1_APP_KEY=/etc/letsencrypt/live/app.sitowebinun.click/privkey.pem
SEED_DOMAIN_1_APP_CERT_EXPIRES=2026-07-08
SEED_DOMAIN_1_WILDCARD_CERT=/etc/letsencrypt/live/sitowebinun.click/fullchain.pem
SEED_DOMAIN_1_WILDCARD_KEY=/etc/letsencrypt/live/sitowebinun.click/privkey.pem
SEED_DOMAIN_1_WILDCARD_CERT_EXPIRES=2026-07-08
SEED_DOMAIN_1_RENEWAL_METHOD=dns01
SEED_DOMAIN_1_DNS_PROVIDER_KEY=HOSTINGER_API_KEY_SITOWEB

SEED_DOMAIN_2_APEX=andycode.cat
SEED_DOMAIN_2_LABEL=Andy Code Cat
SEED_DOMAIN_2_IS_DEFAULT=false
SEED_DOMAIN_2_APP_CERT=/etc/letsencrypt/live/app.andycode.cat/fullchain.pem
SEED_DOMAIN_2_APP_KEY=/etc/letsencrypt/live/app.andycode.cat/privkey.pem
SEED_DOMAIN_2_APP_CERT_EXPIRES=2026-07-08
SEED_DOMAIN_2_WILDCARD_CERT=/etc/letsencrypt/live/andycode.cat/fullchain.pem
SEED_DOMAIN_2_WILDCARD_KEY=/etc/letsencrypt/live/andycode.cat/privkey.pem
SEED_DOMAIN_2_WILDCARD_CERT_EXPIRES=2026-07-08
SEED_DOMAIN_2_RENEWAL_METHOD=dns01
SEED_DOMAIN_2_DNS_PROVIDER_KEY=HOSTINGER_API_KEY_ANDYCAT
```

These keys are read by the boot seed script (`apps/api/src/scripts/seed.ts`) which upserts `Domain`
documents without overwriting existing data (idempotent by `apex`).

---

## 12. Sub-milestone Breakdown

### R3.1 — Foundation (no user-facing change)

**Goal:** All infrastructure in place, existing domain migrated to `Domain` document, conf
generation works, second domain can be added manually.

Tasks:
- [ ] Create `domains` MongoDB collection + indexes + Zod schema + repo
- [ ] Add `registrationDomainId` / `assignedDomainId` to User model (nullable, no migration)
- [ ] Add `domainId` / `publishUrl` to Deployment model (nullable, no migration)
- [ ] Write Nunjucks vhost template (`nginx-templates/vhost.conf.njk`)
- [ ] Implement `NginxController.writeConf` + `testConf` + `reload` + `removeConf`
- [ ] Change `docker-compose.droplet.yml`: add writable `data/nginx-sites` volume to nginx + api
- [ ] Update `nginx/nginx.conf` to include `conf.d/*.conf`
- [ ] Write boot seed script that upserts `Domain` docs from `SEED_DOMAIN_*` env vars
- [ ] Generate `sitowebinun.click.conf` from template on first boot, verify nginx reloads cleanly
- [ ] Add `/data/nginx-sites/` to `.gitignore`
- [ ] Add `.env.droplet.example` entries for `SEED_DOMAIN_*` keys

**Acceptance:** On `npm run droplet:up`, both old static conf and new generated conf coexist; nginx
serves `app.sitowebinun.click` correctly.

---

### R3.2 — Admin API + second domain test

**Goal:** Superadmin can manage domains via API. `andycode.cat` added and serving published sites.

Tasks:
- [ ] Implement `/v1/admin/domains` CRUD routes + controllers
- [ ] Implement `AssignUserToDomainUseCase`
- [ ] Implement `PATCH /v1/admin/users/:userId/domain` route
- [ ] Update `RegisterUserUseCase` to capture `registrationDomainId` from `Host` header
- [ ] Update `DeployWorker` to write `domainId` + `publishUrl` using `user.assignedDomainId`
- [ ] Obtain `andycode.cat` SSL certificates on the droplet (manual, see §6.3)
- [ ] Add `andycode.cat` domain via admin API or seed script
- [ ] End-to-end test: register user → user auto-assigned to domain → publish site → site
  accessible at `{slug}.andycode.cat`

**Acceptance:** A user registered through `app.andycode.cat` has `assignedDomainId` pointing to
`andycode.cat`, and their published site is accessible at `{slug}.andycode.cat`.

---

### R3.3 — Admin UI — Domains Tab

**Goal:** Superadmin can manage domains, toggle, assign users, view stats in the browser.

Tasks:
- [ ] Add `/admin/domains` page and list table
- [ ] Add domain detail modal with all sections (§10.2)
- [ ] Add confirmation modals for Suspend + Delete (§10.3)
- [ ] Add "Assign user to domain" modal on user detail page
- [ ] Add SSL expiry warning indicator (< 30 days = amber, < 7 days = red)
- [ ] Add "Reload nginx" button with success/error feedback

---

### R3.4 — SSL Automation + Monitoring

**Goal:** Certs renew automatically. Expiry alerts surface in the admin UI.

Tasks:
- [ ] Implement `SslRenewalWorker` (§6.2)
- [ ] Implement scheduler: daily cron job enqueues renewal checks for expiring certs
- [ ] Store renewal result (success/failure) in `Domain.ssl.lastRenewalAt`
- [ ] Surface renewal failures as an admin notification in the Domains tab header
- [ ] Document manual renewal fallback in deploy runbook

---

## 13. Test Configuration — andycode.cat

This section describes how to wire `andycode.cat` as the second domain for production deploy
testing. All values below belong in `.env.droplet` (never committed to git).

### 13.1 Pre-requisites on the droplet

1. DNS: add `A` records pointing `app.andycode.cat`, `api.andycode.cat`, and `*.andycode.cat`
   to the droplet's IP.
2. Port 80 accessible for HTTP-01 challenge (already open for `sitowebinun.click`).
3. Hostinger DNS API credentials configured for DNS-01 wildcard challenge.

### 13.2 Certificate acquisition (SSH into droplet)

```bash
# 1. App + API cert (HTTP-01)
certbot certonly --nginx \
  -d app.andycode.cat \
  -d api.andycode.cat \
  --non-interactive \
  --agree-tos \
  --email admin@andycode.cat

# 2. Wildcard cert (DNS-01 via Hostinger plugin)
certbot certonly \
  --dns-hostinger \
  --dns-hostinger-credentials /root/.secrets/hostinger-andycat.ini \
  -d "*.andycode.cat" \
  --non-interactive \
  --agree-tos \
  --email admin@andycode.cat
```

### 13.3 .env.droplet additions (template)

```dotenv
# === andycode.cat second domain (R3 test) ===
SEED_DOMAIN_2_APEX=andycode.cat
SEED_DOMAIN_2_LABEL=Andy Code Cat
SEED_DOMAIN_2_IS_DEFAULT=false
SEED_DOMAIN_2_APP_CERT=/etc/letsencrypt/live/app.andycode.cat/fullchain.pem
SEED_DOMAIN_2_APP_KEY=/etc/letsencrypt/live/app.andycode.cat/privkey.pem
SEED_DOMAIN_2_APP_CERT_EXPIRES=2026-07-08
SEED_DOMAIN_2_WILDCARD_CERT=/etc/letsencrypt/live/andycode.cat/fullchain.pem
SEED_DOMAIN_2_WILDCARD_KEY=/etc/letsencrypt/live/andycode.cat/privkey.pem
SEED_DOMAIN_2_WILDCARD_CERT_EXPIRES=2026-07-08
SEED_DOMAIN_2_RENEWAL_METHOD=dns01
SEED_DOMAIN_2_DNS_PROVIDER_KEY=HOSTINGER_API_KEY_ANDYCAT
HOSTINGER_API_KEY_ANDYCAT=<your-hostinger-api-key-for-andycode.cat>
```

### 13.4 Verification checklist

```
[ ] curl -I https://app.andycode.cat           → 200, served by Next.js
[ ] curl -I https://api.andycode.cat/v1/health → 200, served by Express
[ ] curl -I https://abc123.andycode.cat        → 200 or 404 (slug present or absent)
[ ] curl -I https://abc123.sitowebinun.click   → still 200 (existing domain unaffected)
[ ] openssl s_client -connect app.andycode.cat:443 -servername app.andycode.cat
    → verify: issuer is Let's Encrypt, CN = app.andycode.cat
[ ] openssl s_client -connect abc123.andycode.cat:443 -servername abc123.andycode.cat
    → verify: wildcard cert, SAN includes *.andycode.cat
```

---

## 14. Dummy Domain Examples

This section illustrates the multi-domain model using fictional domain names. These examples appear
in the code, tests, and local fixtures.

### 14.1 Domain catalogue (test fixtures)

| ID | apex | label | isDefault | Use in |
|---|---|---|---|---|
| `dom_default` | `sitowebinun.click` | Sito Web in un Click | `true` | seed / production |
| `dom_andycat` | `andycode.cat` | Andy Code Cat | `false` | R3 deploy test |
| `dom_acme` | `acme-builder.com` | Acme Web Builder | `false` | unit tests |
| `dom_agency` | `partner-agency.dev` | Partner Agency | `false` | integration tests |
| `dom_example` | `example-sites.io` | Example Sites | `false` | e2e fixtures |

### 14.2 Nginx conf output — acme-builder.com

Given a `Domain` document for `acme-builder.com`, `NginxController.writeConf` produces
`/data/nginx-sites/acme-builder.com.conf`. Abbreviated:

```nginx
upstream web_acme-builder_com { server web:8081; keepalive 16; }
upstream api_acme-builder_com { server api:4000; keepalive 32; }

server {
    listen 443 ssl http2;
    server_name app.acme-builder.com;
    ssl_certificate /etc/letsencrypt/live/app.acme-builder.com/fullchain.pem;
    ...
}
server {
    listen 443 ssl http2;
    server_name "~^(?<publishId>[a-z0-9][a-z0-9-]{0,28}[a-z0-9])\.acme-builder\.com$";
    ssl_certificate /etc/letsencrypt/live/acme-builder.com/fullchain.pem;
    root /var/www/andy-code-cat/$publishId;
    ...
}
```

### 14.3 Registration flow — example.io

1. User opens `https://app.example-sites.io` and clicks "Sign up".
2. Browser sends `POST /v1/auth/register` with `Host: app.example-sites.io`.
3. `RegisterUserUseCase` calls `DomainRepo.findByHost("app.example-sites.io")`:
   - strips `app.` → `example-sites.io`
   - finds `Domain { id: "dom_example", apex: "example-sites.io" }`
4. User created with `registrationDomainId: "dom_example"`, `assignedDomainId: "dom_example"`.
5. User publishes project with slug `my-portfolio`.
6. `DeployWorker` writes `publishUrl: "https://my-portfolio.example-sites.io"`.
7. Site accessible at `https://my-portfolio.example-sites.io`.

### 14.4 Domain migration — partner-agency.dev

Admin migrates user `alice@example.com` from `example-sites.io` to `partner-agency.dev`:

```
PATCH /v1/admin/users/usr_alice/domain
{
  "domainId": "dom_agency",
  "migratePublishedUrls": true
}
```

Result:
- `alice.assignedDomainId` → `"dom_agency"`
- All Alice's published deployments: `domainId` → `"dom_agency"`, `publishUrl` →
  `https://{slug}.partner-agency.dev`
- `example-sites.io.conf` stats: `userCount--`
- `partner-agency.dev.conf` stats: `userCount++`
- No files moved, no nginx reload needed (nginx already serves both domains).

---

## 15. Security Notes

### 15.1 Cookie scope isolation

Auth cookies must be scoped to the exact subdomain:
```
Set-Cookie: access_token=...; Domain=app.sitowebinun.click; SameSite=Strict; Secure; HttpOnly
```
This prevents the auth cookie from being sent to `{slug}.sitowebinun.click` (published user sites).
Verify current `Set-Cookie` headers before R3.1 ships.

### 15.2 nginx -t before every reload

`NginxController.reload()` always calls `nginx -t` first. If the config test fails, the reload is
aborted and the error is written to the `Domain` document (`nginx.lastConfError`) and surfaced in
the admin UI. This prevents an invalid conf from taking down all running sites.

### 15.3 Content-Security-Policy on published sites

The Nunjucks template (§5.1) adds a `Content-Security-Policy` header to the published sites server
block. This is a gap fix compared to the current static conf which omits CSP. Adjust the policy
values per domain via `extraServerDirectives` if stricter rules are needed.

### 15.4 Docker socket proxy

The `execDocker` helper in `NginxController` must use the Docker socket proxy sidecar (e.g.
`docker-socket-proxy` with `EXEC: 1` and `POST: 1` only). Do not mount `/var/run/docker.sock`
directly into the API container.

### 15.5 Private key material

The `ssl.dnsProviderKey` field stores only the **name** of the environment variable holding the
DNS API key, not the key value itself. The actual key lives only in `.env.droplet` (gitignored) and
in the process environment. Never persist it to MongoDB.

---

## Related Documents

- [EXPORT_AND_PUBLISH_SPEC.md](EXPORT_AND_PUBLISH_SPEC.md) — DeployWorker and NginxController baseline
- [DB_PLATFORM_SPEC.md](DB_PLATFORM_SPEC.md) — User and Deployment base schemas
- [SUPER_ADMIN_SPEC.md](SUPER_ADMIN_SPEC.md) — Admin route pattern, requireSuperAdmin, governance model
- [SECURITY_BASELINE.md](../security/SECURITY_BASELINE.md) — Double sandbox and auth rules
- [PRODUCTION_HARDENING_PLAN.md](../runbooks/PRODUCTION_HARDENING_PLAN.md) — Deploy safety checklist
