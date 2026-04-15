# Platform Governance Policy

## Purpose

This document defines how platform-wide governance settings must be managed inside Andy Code Cat.
It exists to ensure that global prompt controls, HTML/JS injections, nginx runtime settings, and superadmin user operations are handled safely, audibly, and consistently across environments.

## Scope

This policy applies to:

- superadmin actions performed from the admin control plane
- product-level governance entries stored in `PlatformConfig.governanceByProduct`
- platform access controls such as registration and email-verification switches
- superadmin user-management actions that change identity, password, access, or quotas

This policy does not replace environment-secret handling rules defined elsewhere.
Secrets must still be managed only through environment variables and approved deployment procedures.

## Roles And Responsibilities

- `superadmin` is the only role allowed to change platform governance and cross-tenant user settings.
- `admin` and `user` roles must not have write access to platform governance controls.
- Every governance write must be attributable to a specific authenticated superadmin account.

## Governance Domains

### 1. Access Governance

The following switches are runtime-effective and must be treated as operational controls:

- `registrationOpen`
- `emailVerificationRequired`

Changes to these values affect platform-wide user onboarding behavior and should be reviewed before production rollout.

### 2. Product Governance

Each product namespace under `governanceByProduct` may define:

- prompt templates for generation, focused edit, and review
- global HTML injections for `<head>`, header, and footer areas
- global JavaScript injections
- analytics identifiers
- nginx-related deployment defaults

At the current implementation stage, these values are persisted and editable in the admin UI, but they are not yet fully enforced by all generation and publishing runtime paths.
They must therefore be treated as governed configuration state, not as guaranteed live execution behavior.

### 3. User Governance

Superadmin user operations may:

- block or restore a user
- change email, first name, last name, and email verification status
- update user roles
- override per-user limits
- reset a password
- require password reset on the next login
- delete a user

Blocking a user is a security-sensitive action. It invalidates the user sessions and prevents access to public published sites owned by that user.

## Approval Expectations

- High-impact changes should be reviewed before production use.
- High-impact changes include:
  - disabling registration for the full platform
  - enabling mandatory email verification
  - changing shared prompt templates
  - adding global scripts or HTML injections
  - modifying nginx runtime directives
  - resetting credentials or blocking a customer account

## Safety Rules

- Never use governance fields to store secrets.
- Never assume persisted governance settings are already live in every runtime path.
- Never apply user-management actions without an explicit confirmation step in the UI.
- Never bypass role checks for governance routes.
- Never modify tenant-owned project data directly from governance actions unless an explicit admin capability exists and is documented.

## Auditability

- All governance updates must remain attributable to the authenticated superadmin who performed them.
- Operational documentation must be updated whenever governance capabilities or runtime enforcement behavior changes.
- When runtime consumption is incomplete, documentation must state that clearly to avoid false assumptions.

## Rollout Guidance

- Validate governance changes in a controlled environment before production rollout.
- For production environments, pair governance changes with a short rollback note.
- If a governance field becomes runtime-effective in a future release, update this policy and the relevant runbooks at the same time.
