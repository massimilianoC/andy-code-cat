# Security Baseline

## Authentication

- Access token: short TTL JWT.
- Refresh token: long TTL JWT, bound to a server-side session identifier and rotated on every successful refresh.
- Refresh token persistence: only the hashed token value is stored in DB sessions.
- Password hashing: bcrypt with cost factor 12.
- Password policy: minimum 12 characters with uppercase, lowercase, number, and symbol.
- Legacy password migration: accounts created before the current password policy remain login-compatible but must complete the authenticated change-password flow.

## Authorization

- Protected routes require bearer token.
- Project endpoints require x-project-id and ownership validation.

## Rate Limiting

- Rate limiting runs before authentication on the project pipeline, PipelineRun, and form-service
  routes so repeated invalid tokens cannot force unbounded authorization work.
- Pipeline mutations are limited to 30 requests/minute per client address.
- PipelineRun and form-service routes are limited to 60 requests/minute per client address;
  pipeline configuration reads are limited to 120 requests/minute.
- nginx keeps the broader production perimeter limits; application limits remain authoritative
  even when the API is reached from another internal network path.

## Isolation

- Double sandbox is mandatory:
  - user sandbox via JWT sub.
  - project sandbox via ownership check.

## Data Safety

- No plaintext secret in repository. `npm run guard:public-repo` fails on tracked `.env*` files
  (except the two templates), private key material and private-infrastructure paths.
- `.env` files are local only; `.env.example` and `.env.deploy.example` are the templates.
- `install.sh` generates every secret it writes (JWT, export token, MinIO credentials) with
  `openssl rand`. Nothing it produces relies on a public default.

## Network Exposure (Docker stacks)

- Only nginx publishes ports on all interfaces (80, and 443 in domain mode).
- MongoDB (27018), the API (4000), the web server (8081) and MinIO (9000/9001) are bound to
  `127.0.0.1` in both compose files. Docker writes its own iptables rules, so a host firewall
  such as ufw does **not** protect a port published on `0.0.0.0`.
- MongoDB runs without authentication inside the compose network. Loopback binding is what keeps
  it private: never publish it on a public interface. Adding MongoDB authentication
  (`MONGO_INITDB_ROOT_*` plus credentials in `MONGODB_URI`) is recommended for shared hosts.
- MinIO is optional (compose profile `minio`). With `STORAGE_ADAPTER=local` (the default) it does
  not run at all.

## Insecure Production Settings

At boot with `NODE_ENV=production` the API logs `[config] INSECURE PRODUCTION SETTING` for:

- `CORS_ORIGIN` containing `*` — the app hosts cannot be identified, so published sites could be
  served on the app's origin, where session tokens live in `localStorage`;
- `EXPORT_JWT_SECRET` left at its public default — export download links could be forged;
- `STORAGE_ADAPTER=minio` with the public `minioadmin` credentials.

These are warnings, not boot failures, so an existing deployment keeps running while its operator
fixes the env file. Treat any of them as a defect.

## Email Verification

- No verification e-mail is sent yet: there is no e-mail delivery path in the platform.
- `install.sh` writes `AUTH_BYPASS_EMAIL_VERIFICATION=false`, so a newly registered account cannot
  log in until a superadmin marks it verified in `/admin/users`. Self-registration therefore acts
  as an access request reviewed by the superadmin. The first superadmin is verified by the
  operator from the host (see `docs/guides/LOCAL_DOCKER_START.md`).
- `.env.example` (development) keeps the bypass on.

## Dependency Advisories

`npm audit --omit=dev` on 2026-11-25, after the non-breaking fixes were applied, still reports
advisories that need a major upgrade or a replacement and are tracked in
`docs/project/KNOWN_ISSUES.md` ("Dependencies — advisories that need a major upgrade").
