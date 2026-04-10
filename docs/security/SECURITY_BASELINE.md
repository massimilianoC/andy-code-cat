# Security Baseline

## Authentication

- Access token: short TTL JWT.
- Refresh token: long TTL JWT; only hashed value stored in DB sessions.
- Password hashing: bcrypt with cost factor 12.

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
