# Auth Hardening Guide

## Scope

This repository now applies a compatibility-first hardening layer to authentication and session management.

Goals:

- keep existing users able to sign in without forced data migration;
- prevent refresh-token replay by rotating tokens on each refresh;
- require stronger passwords for all new credentials;
- prepare email verification for production rollout without enabling a fragile flow too early.

## What Changed

### JWT and Session Model

- Access tokens remain short-lived JWTs.
- Refresh tokens now carry a session token identifier (`sid`).
- The API stores only the hashed refresh token value in MongoDB.
- Each successful refresh rotates both the refresh token hash and the `sid`.
- Replaying an older refresh token after a successful rotation must fail.

### Legacy Refresh Compatibility

- Older refresh tokens without `sid` are still accepted during the transition.
- On the first successful refresh, the session is upgraded to the new `sid`-based model.

### Password Policy

- New passwords must be at least 12 characters long.
- New passwords must include uppercase, lowercase, number, and symbol characters.
- New accounts are stored with the current password policy version.
- Older accounts without the current password policy version are treated as legacy accounts.

### Legacy Password Upgrade Flow

- Legacy users can still sign in.
- Login responses include `requiresPasswordChange`.
- The web app opens a mandatory password change dialog for those users.
- After a successful password change, all sessions are revoked and the user must sign in again.

## Email Verification Rollout

The email verification model exists, but the runtime bypass remains intentional until delivery infrastructure is ready.

Current state:

- `AUTH_BYPASS_EMAIL_VERIFICATION=true` keeps bootstrap and production stable while delivery is not hardened.
- The login and refresh flows already enforce email verification when the bypass is disabled.

Recommended production rollout:

1. Implement trusted email delivery with retry handling and audit logging.
2. Add verification token issuance, storage, expiry, and resend throttling.
3. Add operational monitoring for send failures and bounce/reject conditions.
4. Switch `AUTH_BYPASS_EMAIL_VERIFICATION=false` only after the end-to-end flow is validated.

## API Contract Summary

### Login

`POST /v1/auth/login`

Response includes:

- `accessToken`
- `refreshToken`
- `activeProjectId`
- `requiresPasswordChange`
- `emailVerificationRequired`

### Refresh

`POST /v1/auth/refresh`

Response includes:

- rotated `accessToken`
- rotated `refreshToken`
- `activeProjectId`
- `requiresPasswordChange`

### Change Password

`POST /v1/auth/change-password`

Requires bearer authentication.

Request:

```json
{
  "currentPassword": "current-secret",
  "newPassword": "NewSecret#2026"
}
```

Response:

```json
{
  "reauthRequired": true,
  "requiresPasswordChange": false
}
```

## Environment Notes

Keep these values aligned with the current model:

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_TTL`
- `JWT_REFRESH_TTL`
- `AUTH_BYPASS_EMAIL_VERIFICATION`

Use strong secrets and never reuse low-entropy placeholder values in shared or production environments.
