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

## Isolation

- Double sandbox is mandatory:
  - user sandbox via JWT sub.
  - project sandbox via ownership check.

## Data Safety

- No plaintext secret in repository.
- .env is local only; .env.example is the template.
- Mongo and Redis exposed on non-default host ports to avoid local conflicts.

## Email Verification

- Email verification flow is modeled as enabled in architecture.
- Current bootstrap phase bypass is controlled by AUTH_BYPASS_EMAIL_VERIFICATION=true.
- Production rollout target: switch AUTH_BYPASS_EMAIL_VERIFICATION=false only after a trusted email delivery and retry/observability path is available.
- Until that rollout is complete, email verification remains a documented security control with low operational priority and explicit bypass.
