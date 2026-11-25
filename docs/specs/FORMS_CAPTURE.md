# Forms Capture — saved form submissions

> **Status:** implemented (`forms.capture` v1)
> **Last aligned:** 2026-11-25
> **Architecture:** [Platform Capability Runtime](../architecture/PLATFORM_CAPABILITY_RUNTIME.md)
> **Previous mode:** [Form Runtime — mailto foundation](FORM_RUNTIME_MAILTO_FOUNDATION.md)

`capture` is the second delivery mode of the platform form runtime. A form on a **published** site
sends its fields to the platform, which validates them against the deployed service manifest and
stores them for the project owner. The owner browses, exports and deletes them from the project
data panel (`ProjectDataCapability` id `forms`).

```text
mailto  → local hand-off to the visitor's email app; nothing is stored
capture → validated server-side, stored in form_submissions, owner reads it in the data panel
```

## Owner configuration

`PUT /v1/projects/:projectId/services/forms` (double sandbox), validated by
`projectFormSettingsSchema` (`packages/contracts/src/forms.ts`), a discriminated union on `mode`:

| Field | mailto | capture |
|---|---|---|
| `enabled` | required | required |
| `recipientEmail` | required | optional, kept from an earlier mailto configuration and never used |
| `privacyNotice` (`version`, HTTPS `url`, `controllerName`, `contactEmail`) | required | required |

Settings stored by the mailto-only version keep validating unchanged.

UI: **Forms** button, left side of the footer of the project settings popup
(`apps/web/components/forms/FormSettingsDialog.tsx`). It replaced the inline settings panel — one UI
for one setting.

A published site carries the runtime compiled at publish time. A change of mode reaches a site the
next time it is published; until then the server refuses submissions that the current settings do
not allow (see below), and the form shows an error instead of claiming success.

## Runtime (browser)

`prepareArtifactServices()` selects the browser module from `settings.mode`:

| mode | modules |
|---|---|
| mailto | `pf-runtime-core`, `pf-runtime-config`, `pf-forms-ui`, `pf-forms-mailto` |
| capture | `pf-runtime-core`, `pf-runtime-config`, `pf-forms-ui`, `pf-forms-capture` |

Platform code stays in separate `pf-*.v1.js` files; the generated `script.js` is never modified.

Only **publish** knows the site's publishId, so only publish passes it (`prepareArtifactServices({ publishId })`)
and only a published site gets `submitUrls` in its runtime config:

```json
{ "forms": { "mode": "capture", "submitUrls": { "contact": "/p/ab12cd34/_pf/forms/contact/submit" } } }
```

The path is absolute and same-origin, so it works from `/p/{publishId}/` and from `/{slug}/` alike.
The capture config contains no recipient and nothing secret.

**Preview and ZIP have no backend.** Their config has `submitUrls: null`; the form shows, before and
after a click, that it saves data only on the published site, and sends nothing. Data is never
silently dropped.

States are announced through the form's `role="status"` region; the form carries `data-pf-state`
(`sending`, `success`, `error`, `unavailable`) and `aria-busy`; fields the server rejected get
`aria-invalid="true"` and the first visible one is focused. Messages are Italian when the page
language is Italian or unset (as the rest of the form runtime), English otherwise. Browser events
(`pf:form-capture`) carry form id and outcome, never values.

A honeypot input (`pf_hp`, off-screen, `aria-hidden`, no tab stop) is rendered in capture forms.

## Public submit — trust boundary

```text
POST /p/{publishId}/_pf/forms/{formId}/submit
Content-Type: application/json
{ "fields": { "<field id>": "<value>" }, "hp": "<honeypot, normally absent>" }
```

**Why same-origin `/p/` and not `/v1`.** A sites origin (or a subdomain vhost) forwards only `/p/`,
slug paths and `/health` to the API; `/v1` is not reachable there. Same-origin also needs no CORS.
The route is mounted ahead of the global 8 MB JSON parser (`app.ts`) so its own 16 KB limit applies.

Checks, in order (`publishedFormSubmitRoutes.ts`, then `SubmitPublishedForm`):

1. Rate limits, before any work: per client IP (20 / 10 min, across all sites) and per publishId
   (300 / 10 min, from any IP) — `express-rate-limit` in-memory store. Redis was removed from the
   stack and the API is a single instance; a second instance needs a shared store. The client IP is
   `req.ip`, which is only right when `TRUST_PROXY_HOPS` matches the proxies in front of the API
   (1 = the stack's nginx; 2 when Caddy, Traefik or a load balancer sits in front of it). → `429`
2. `Content-Type: application/json` → else `415`.
3. Host: the same rule as page content (`decideSiteRequest`). A POST on an app host, or on any host
   other than a configured sites origin, is **refused**, never redirected. → `403 FORM_SITE_HOST_REFUSED`
4. `Origin`, else `Referer`, when present, must name the request's hostname; `null` and malformed
   values are refused. → `403 FORM_ORIGIN_REFUSED`
5. Body ≤ 16 KB (`FORM_SUBMISSION_MAX_BYTES`) → else `413`; malformed JSON or envelope → `400`.
6. Honeypot filled → `202 { ok: true }`, nothing stored.
7. Server-side resolution, from the publishId only:
   - live deployment (`status: "live"`) → else `404 FORM_SITE_NOT_FOUND`;
   - not admin-blocked; owner exists and is not blocked → else `403 FORM_SITE_SUSPENDED`
     (stricter than page serving: a deleted owner leaves no controller to receive personal data);
     owner lookup failure → `503`;
   - project exists and `project.ownerUserId === deployment.userId` → else `404`;
   - form settings `enabled && mode === "capture"` → else `409 FORM_CAPTURE_DISABLED`;
   - the **deployed snapshot's** `serviceManifest` declares `formId` → else `404 FORM_NOT_FOUND`.
8. Fields validated against that form definition (`FormSubmissionValidator.ts`) → else
   `400 FORM_SUBMISSION_INVALID` with `issues: [{ field, reason }]`.
9. Stored → `201 { ok: true }`.

The request never chooses owner, project, snapshot, privacy version or anything else; it only
addresses a publishId and a formId, both resolved against their source of truth.

### Validation

The deployed form definition is the only authority:

- a key the form does not declare → `unknown_field` (the key itself is not echoed);
- `required` (a required checkbox must be checked; blank strings count as missing);
- types: strings for text-like fields; numbers (or numeric strings) for `number`; booleans
  (`true`/`"true"`/`"on"`) for `checkbox`;
- `minLength`/`maxLength` (default caps: 500, `textarea` 5000), `min`/`max`;
- formats: `email`, `tel`, `url` (http/https only), `date` (real calendar date), `time`;
- `select`/`radio` values must be one of the declared options;
- control characters are refused; line breaks only in `textarea`.

`patternKey` is not enforced in v1.

### Errors and logs

Error bodies are `{ ok: false, error, code, issues? }`. They never contain a submitted value;
body-parser and JSON errors are mapped before they reach the global error handler (their messages
can quote the body). Logs (`[form-capture] refused …`) carry publishId, formId, status and code —
never the payload. A test asserts no submitted value reaches `console.*`.

## Data stored

One shared collection, `form_submissions` — never a collection or database per project. Index
`{ ownerUserId: 1, projectId: 1, formId: 1, createdAt: -1 }`.

| Field | Content |
|---|---|
| `_id` | UUID |
| `ownerUserId`, `projectId`, `formId` | scope, resolved from the live deployment |
| `publishId`, `snapshotId` | the deployment and the artifact version the visitor saw |
| `fields` | validated values only (string / number / boolean) |
| `privacyNoticeVersion` | the project's privacy notice version in force at submission |
| `ipHash` | `sha256(salt + IP)`; the raw IP is never stored |
| `createdAt` | server time |

Salt: `FORM_IP_HASH_SALT` when set, otherwise derived from `EXPORT_JWT_SECRET` (so the hash is
never unsalted). The hash is for abuse investigation by the operator and is not shown to the owner
in the data panel.

The repository port (`domain/repositories/FormSubmissionRepository.ts`) takes a whole scope on every
method; the Mongo implementation spreads it into every filter.

## Owner access — project data capability

`FormsProjectDataCapability` (`apps/api/src/application/forms/FormsProjectDataCapability.ts`), wired in `apps/api/src/composition/composeProjectData.ts`
implements `ProjectDataCapability` (`id: "forms"`, label "Form submissions"):

- groups: one per form id with submissions; label = form title from the live deployment's manifest,
  else the form id;
- list: page / limit, newest first, plain-text case-insensitive search over string values (the text
  is escaped: never a pattern or a query operator);
- export: newest first, up to the given maximum;
- delete one; clear one form or all forms of the project.

Records expose `fields`, `privacyNoticeVersion`, `publishId`, `snapshotId` — not `ipHash`.
Registration in the project data registry, the data routes and project deletion are owned by the
project data panel (`composeProjectData.ts`).

## Retention

v1 has no automatic expiry: submissions are kept until the owner deletes them (one, one form, all)
from the data panel, or the project is deleted (the project data registry purges every capability).
A server-calculated `expiresAt` with a TTL index is the planned next step
(PLATFORM_CAPABILITY_RUNTIME.md, "Forms Inbox").

## GDPR note

The **project owner is the controller** of the personal data their forms collect; the platform acts
on their behalf. The platform does not claim compliance; it supplies the tools:

- the privacy notice (controller, contact, HTTPS policy URL, version) is required to enable forms
  and is shown with every form; its **version is stored with each submission** as evidence of the
  notice in force;
- only fields declared by the manifest are accepted; no hidden collection;
- no raw IP; operational logs carry no values;
- access, export and **physical deletion** through the data panel; project deletion purges them.

Data subject requests are fulfilled by the owner through the data panel (search, export, delete).
Special-category data, marketing consent workflows and double opt-in are out of scope for v1.

## Deployment note — subdomain addresses

In `subdomain` URL mode a site is served at `https://{slug}.{publicDomain}/`, often from the
published files by the wildcard vhost. That vhost **must proxy `/p/` to the API**, or capture forms
on those sites cannot reach their submit path. Path mode (`/p/` and slugs on the sites origin) needs
no change.

## Tests

- `apps/api/src/presentation/http/routes/__tests__/formsCapture.e2e.test.ts` — real app,
  MongoMemoryServer, temporary DATA_DIR: publish through the API with capture, store, refusals
  (disabled / mailto, unknown form, invalid fields, not live, admin-blocked, blocked and deleted
  owner, honeypot, oversize, non-JSON, app host, foreign Origin, sites-origin host rule), per-IP and
  per-site rate limits, no values in logs, and cross-project isolation through the capability.
- `apps/api/src/application/forms/__tests__/FormSubmissionValidator.test.ts` — manifest validator.
- `apps/api/src/application/forms/__tests__/FormCaptureRuntime.test.ts` — module selection, submit
  path only on publish, byte-separate `script.js`, browser adapter behaviour in a VM.
- `packages/contracts/src/__tests__/forms.contract.test.ts` — settings union and submit envelope.
