# Platform Capability Runtime — Architecture Decision

> **Status:** target architecture for deferred R4/BaaS work; not a declaration that networked
> capabilities are enabled in the canonical stack
> **Last aligned:** 2026-11-25 (forms capture)
> **Implementation plan:** [Form Runtime + BaaS Delivery](../specs/FORM_RUNTIME_BAAS_IMPLEMENTATION_PLAN.md)
> **Legacy parent spec:** [BaaS Services Layer](../specs/BAAS_SERVICES_SPEC.md)

The bounded local `mailto` foundation is implemented in the integration candidate through Layer V,
`service-manifest-v1`, `runtime-plan-v1` and allowlisted browser assets. `capture` (saved form
submissions) is implemented as specified in [Forms Capture](../specs/FORMS_CAPTURE.md). Public
`relay` and the broader networked capability catalog remain deferred until their roadmap gate is
reopened.

This document is the current source of truth for capability-runtime boundaries, tenant data
isolation and the order in which BaaS services should be introduced. Where the older BaaS spec
describes LLM-generated SDK calls, direct public notification/webhook triggers, or one-off
service mechanics, this decision supersedes those mechanics. The form implementation plan remains
the executable source for the first bounded capability.

## Decision

Adopt a deterministic, versioned platform runtime for operational capabilities such as forms,
email delivery, capture, payments, catalog access, Telegram, and webhooks.

The LLM describes **what** the artifact needs. The platform owns **how** it executes:

1. The LLM emits empty declarative slots and a validated `serviceManifest`.
2. Owner/project settings provide trusted delivery configuration and secrets by reference.
3. A platform registry selects allowlisted runtime modules and produces one `runtimePlan`.
4. A single `prepareArtifactServices()` boundary prepares equivalent preview, publish, and ZIP
   outputs.

The LLM must not generate submit handlers, `mailto:` construction, public endpoints, credentials,
or copies of platform runtime functions.

## Product boundary

Andy Code Cat remains frontend-artifact-first. It does not generate or execute an arbitrary
backend for every artifact. A generated artifact can request only a capability registered by the
platform, for example:

```text
forms.capture
collections.records
notifications.email
integrations.webhook
jobs.schedule
storage.files
auth.members
```

Every capability is versioned, policy-bound and implemented by an allowlisted adapter. The LLM
can describe intent and presentation; it cannot choose physical collections, database names,
query filters, recipients, credentials, retention, destinations or authorization policy.

```text
LLM response
  ├─ artifacts.html: empty declarative slot
  └─ serviceManifest-v1: typed capability intent
              │
              ▼
shared-contract validation + platform policy
              │
              ▼
capability instance bound to owner + project + deployment
              │
              ▼
allowlisted runtime module + application use case + domain repository port
              │
              ▼
MongoDB / provider adapters
```

## Runtime packaging

Platform logic must be shipped in separate files, never concatenated to LLM-generated
`artifacts.js`:

```text
pf-runtime-core.v1.js
pf-forms-ui.v1.js
pf-forms-mailto.v1.js
pf-forms-relay.v1.js
pf-forms-capture.v1.js
```

Only the modules required by the active capabilities are included. The generated `script.js`
remains isolated, so one syntax error in LLM code cannot disable a platform-owned form runtime.
Runtime assets are pinned by version/content hash and copied locally into published and ZIP
artifacts.

`mailto` is a local form adapter, not a BaaS network operation. `relay` and `capture` are public
BaaS adapters and must use server-side validation, origin policy, rate limiting, redacted logs,
and the active published manifest.

## Formal boundaries

- `serviceManifest`: versioned, strict shared contract describing capability intent and fields.
- `Project.serviceConfig`: owner-controlled mode, recipient/profile references, origin and privacy
  policy; never supplied to the LLM.
- `runtimePlan`: public, non-secret list of exact platform modules and compatible versions.
- runtime registry: application-owned allowlist mapping capability + mode to a module; the LLM
  cannot select a URL or arbitrary JavaScript implementation.
- platform events: versioned and free of submitted values or complete `mailto:` URIs.
- generated-JS gate: syntax validation occurs before snapshot activation and publish. Invalid
  generated JS must produce an actionable diagnostic even though separate platform modules remain
  independently loadable.

## LLM slot protocol

For an operational form the LLM emits only a documented empty slot, for example:

```html
<div data-pf-form-id="commercial-contact"></div>
```

The matching manifest defines form purpose, steps and fields. Layer V owns this protocol and its
prohibitions; Layer S may guide form UX and styling without redefining runtime behaviour.

Future capabilities should prefer declarative action markers plus typed manifest entries rather
than imperative SDK calls generated by the model.

## Prompt Inspector and runtime visibility

Layer V contains only the instructions sent to the LLM. It explains the slot and manifest
protocol and must appear in the API `layers[]` trace. It is non-empty only when the selected
preset or trusted project settings enable a supported capability.

The browser runtime is not prompt text and must not be pasted into Layer V. Runtime modules are
selected after generation by `prepareArtifactServices()` and included as separate platform-owned
files. Consequently:

- Prompt Inspector shows Layer V and the exact provider message;
- preview/publish/ZIP show the compiled platform behavior;
- generated `artifacts.js` stays byte-separated from platform runtime code;
- an old prompt trace is never backfilled with a layer that was not sent at generation time.

## Multi-tenant data architecture

### Default: shared collections with mandatory compound scope

The default storage model is one shared collection per capability domain, not one collection per
tenant and not one database per generated artifact:

```text
form_submissions
capability_instances
automation_jobs
integration_connections
capability_audit_events
```

Every tenant-owned document carries at least:

```ts
interface CapabilityScope {
    ownerUserId: string;
    projectId: string;
    capabilityInstanceId: string;
}
```

`ownerUserId` is the current tenant boundary. `projectId` is the mandatory project sandbox.
`capabilityInstanceId` distinguishes forms, collections and future app-like services inside the
same project. Repository methods must accept a complete `CapabilityScope`; no tenant filter may be
optional or supplied as a free-form query fragment.

Minimum repository shape:

```ts
interface FormSubmissionRepository {
    create(scope: CapabilityScope, submission: NewFormSubmission): Promise<FormSubmission>;
    list(scope: CapabilityScope, query: SubmissionListQuery): Promise<SubmissionPage>;
    findById(scope: CapabilityScope, submissionId: string): Promise<FormSubmission | null>;
    deleteById(scope: CapabilityScope, submissionId: string): Promise<boolean>;
}
```

MongoDB recommends shared collections with a `tenantId` discriminator when tenant count can grow
and schemas/query patterns are consistent. It explicitly recommends avoiding a collection per
tenant in one database. See [MongoDB multi-tenant architecture](https://www.mongodb.com/docs/atlas/build-multi-tenant-arch/).

### Optional enterprise isolation tier

A dedicated database or cluster is an infrastructure policy for a small, stable number of tenants
that require data residency, dedicated backup/restore, custom scaling or stricter credentials. It
must use the same domain ports and use cases so storage placement does not change application
authorization rules.

Do not encode a tenant identifier into dynamic names such as `form:{tenantId}`. Dynamic physical
names make index management, migrations, change streams, retention, backups and cross-tenant
operations harder without replacing authorization.

### Current MongoDB decision

Do not introduce PostgreSQL only for the first Forms Inbox. MongoDB and the existing clean
architecture are sufficient when every application query enforces the compound scope (Redis was
removed from the stack in 2026-11). If a future
generic relational service exposes tables through an API, database-enforced row policies such as
[PostgreSQL/Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
must be evaluated in a separate architecture decision.

## Forms Inbox: first persistent capability

`forms.capture` is the first networked and persistent capability. It is the natural evolution of
the local `mailto` adapter. **Implemented v1:** [Forms Capture](../specs/FORMS_CAPTURE.md) — the
scope is `{ ownerUserId, projectId, formId }` (the form id is the capability instance), records
store `fields`, `privacyNoticeVersion`, `publishId`, `snapshotId`, a salted `ipHash` and
`createdAt`, and owner access goes through the project data capability `forms`. Status workflow,
`expiresAt`/TTL and allowlisted `searchableFields` below are not in v1.

```text
mailto  → local hand-off; no Andy Code Cat persistence
relay   → validated server delivery; payload discarded after delivery
capture → validated persistence + owner inbox + optional notifications/automations
```

Suggested canonical record:

```ts
interface FormSubmission {
    id: string;
    ownerUserId: string;
    projectId: string;
    capabilityInstanceId: string;
    deploymentId: string;
    snapshotId: string;
    formId: string;
    formKind: string;
    schemaVersion: string;
    purposeKey: string;
    values: Record<string, string | number | boolean>;
    searchableFields: Record<string, string | number | boolean>;
    consentEvidence: {
        privacyNoticeVersion: string;
        privacyAcknowledgedAt: Date;
        marketingConsent?: boolean;
        marketingConsentAt?: Date;
    };
    status: "new" | "read" | "qualified" | "archived" | "pending_opt_in";
    submittedAt: Date;
    expiresAt: Date;
}
```

`searchableFields` contains only normalized, policy-allowlisted values. Arbitrary full-text search
over PII is not enabled by default. Sensitive values can use application-level field encryption;
encrypted fields are not silently made searchable.

Required indexes start with the sandbox dimensions:

```text
{ ownerUserId: 1, projectId: 1, capabilityInstanceId: 1, submittedAt: -1 }
{ ownerUserId: 1, projectId: 1, capabilityInstanceId: 1, status: 1, submittedAt: -1 }
{ expiresAt: 1 } with expireAfterSeconds: 0
```

The TTL index is lifecycle enforcement, not the only deletion mechanism. Owner deletion and data
subject deletion physically remove values immediately; audit records retain only identifiers,
actor, reason and outcome.

## API trust boundaries

### Public submit

Canonical route (same origin as the published site):

```text
POST /p/{publishId}/_pf/forms/{formId}/submit
```

It replaces the earlier `/v1/public/svc/:projectKey/...` design: a sites origin or subdomain vhost
forwards only `/p/`, slug paths and `/health` to the API, so `/v1` is not reachable from a
published site, and a same-origin request needs no CORS. Sites on subdomain addresses need their
wildcard vhost to proxy `/p/` to the API.

`publishId` is a public routing identifier, not a secret. The server resolves it to the live
deployment and derives `ownerUserId`, `projectId`, the form (capability instance), the deployed
snapshot's manifest and form schema. The request body can never select or override those values.

Before persistence or delivery, the public path enforces (details in
[Forms Capture](../specs/FORMS_CAPTURE.md)):

1. live deployment, site/owner suspension rules and enabled capability resolution;
2. the site host rule (`decideSiteRequest`; refused, never redirected, on an app host) and
   `Origin`/`Referer` equal to the request host when present; CORS is not authentication;
3. strict validation against the deployed manifest, unknown-field rejection and a 16 KB body limit;
4. per-IP and per-site rate limits — in-memory (`express-rate-limit`), since Redis was removed and
   the API runs as one instance; a multi-instance API needs a shared store; salted IP hash only;
5. honeypot (optional CAPTCHA/managed challenge: not in v1);
6. idempotency key or server-issued submission nonce: not in v1;
7. privacy notice version evidence (retention and consent policy: not in v1);
8. redacted errors and logs: no submitted value in either.

### Owner reads and mutations

Every inbox, export, status and delete operation requires:

```text
JWT subject
  + x-project-id
  + project.ownerUserId == jwt.sub
  + capability belongs to project
  + repository query uses the same compound scope
```

Routes call application use cases. Presentation code never accesses MongoDB directly.

### Notifications, CRM and webhooks

Anonymous visitors must not call a generic `telegram.notify` or `webhook.trigger` endpoint. A
validated form submission emits a typed internal event; server-side automation policy decides
whether to enqueue email, Telegram, CRM or webhook delivery.

External connectors run asynchronously through an outbox/job model with bounded retries,
idempotency and a dead-letter state. Webhook egress requires HTTPS, destination allowlisting or
verification, DNS/IP anti-SSRF checks on every attempt, disabled cross-host redirects, short
timeouts, response-size limits and HMAC signatures. Provider secrets stay server-side as encrypted
references and are decrypted only inside the adapter at point of use.

Database-triggered webhooks can be useful for asynchronous integrations, but the product contract
should remain an application event/outbox rather than exposing raw database changes. See the
[Supabase Database Webhooks reference](https://supabase.com/docs/guides/database/webhooks) for the
event pattern.

## Privacy and GDPR policy baseline

The platform supplies secure defaults and compliance tooling; it must never claim automatic GDPR
compliance. Each persistent capability defines:

- `purposeKey`, data categories and allowed/minimum fields;
- privacy notice identifier and immutable version evidence;
- legal-basis configuration owned by the controller, never inferred by the LLM;
- marketing consent separate from service/contact submission;
- default and maximum retention, with server-calculated `expiresAt`;
- special-category data forbidden by default;
- export, access, correction and physical deletion workflows;
- double opt-in for newsletter subscriptions, with one-time token stored only as a hash;
- encryption in transit, encryption at rest and optional field-level encryption;
- redacted operational logs and access/audit events without submitted values;
- processor, residency and backup information exposed to operators where applicable.

These controls are platform policy and cannot be weakened by a manifest, hidden form field,
project setting or generated script.

## Capability roadmap

### Phase C1 — Forms Capture and Inbox

- capture persistence with double sandbox repositories;
- owner list/detail/read/archive/delete UI;
- exact filters, pagination and allowlisted search;
- retention, consent evidence and newsletter double opt-in;
- notification event after successful persistence.

### Phase C2 — Notifications and automations

- email and Telegram adapters triggered only from internal events;
- scheduled summaries, follow-ups and retention reminders;
- job/outbox status, retry policy and operator visibility.

### Phase C3 — CRM connectors and AI enrichment

- server-side connectors for existing CRM/data-processing services;
- lead classification, deduplication, summaries and scoring;
- periodic project reports with traceable source submission IDs;
- webhook/HMAC integration for n8n, Make and custom systems.

### Phase C4 — Structured Collections

- versioned schemas and capability instances;
- owner CRUD, filters, pagination, export and audit;
- public access disabled by default; narrowly scoped public write/read policies only;
- no arbitrary Mongo query language or collection naming exposed to the LLM.

### Phase C5 — Broader app capabilities

- file storage with quota, type checks and malware scanning;
- member authentication and project-owned profiles;
- scheduled jobs and, only when justified, realtime events;
- payments as a separately reviewed financial/security capability.

Catalog, Telegram, webhook and payment ideas from the earlier BaaS spec remain valid capability
candidates, but they adopt this manifest/runtime/event model instead of LLM-generated imperative
SDK code.

## Implementation sequence and gates

1. Finish and integrate the bounded mailto foundation and Layer V trace parity.
2. Introduce `CapabilityScope` and repository contract tests before persistent public routes.
3. Implement `forms.capture` write path with fake adapters and cross-tenant negative tests.
4. Add owner inbox use cases and UI only after the repository sandbox is proven.
5. Add privacy lifecycle and double opt-in before newsletter capture is enabled.
6. Add outbox notifications, then CRM connectors and AI enrichment.
7. Generalize proven primitives into Structured Collections; do not start with a generic database.

No networked capability can be enabled by default until security/privacy review and these gates are
green:

- cross-user, cross-project and cross-capability reads/writes fail;
- no payload or secret appears in logs, errors, metrics or audit records;
- public routes fail closed when policy resolution (deployment, owner, settings) is unavailable;
- preview, publish and ZIP resolve the same manifest/runtime plan;
- schema migration, TTL, backup/restore and physical deletion have tests/runbooks;
- feature flag and rollback leave existing static artifacts functional.

## Prompt trace invariant

Layer V is part of the canonical prompt SSOT when the capability runtime is integrated. It must be
registered in `PROMPT_LAYER_DESCRIPTORS`, composed only by `composeSystemPromptWithLayers()`, and
returned to the Prompt Inspector even when empty (`chars: 0`, source `empty`). It is non-empty only
when the selected preset or project configuration enables a supported capability.

For every real provider call, MongoDB and the UI must expose the complete prompt actually sent:

- `messagesSentToLlm` is the exact ordered provider message array;
- `effectiveSystemPrompt` is byte-identical to the system message in that array;
- `layers[]` contains every registered layer in canonical order, including empty layers;
- each non-empty layer span resolves exactly inside `effectiveSystemPrompt`;
- focused-mode, governance, model or runtime additions cannot be appended after composition: they
  must be represented by a registered layer and persisted in the same trace.

The Prompt Inspector must render the persisted trace for a completed request and clearly separate
it from the dry-run preview of the next request. Missing Layer V, missing `layers[]`, truncated
prompt text, or a difference between the stored system message and `effectiveSystemPrompt` is a
trace-integrity failure.

## Remaining design work

1. Final `runtimePlan-v1` schema, compatibility rules and asset hashing strategy.
2. Generic `PlatformRuntimeModule`/registry interface and migration from `FormRuntimeAdapter`.
3. Separate browser bundles, build pipeline, CSP policy and preview `srcdoc` loading.
4. Generated JavaScript parser/gate and narrowly scoped repair of misplaced known manifests.
5. Form rendering/theming contract: stable classes, CSS custom properties and accessible DOM.
6. Mailto behaviour: RFC encoding, long-body/manual-copy fallback and honest protocol-handler UX.
7. Public `relay` error envelope and nonce/idempotency (capture has its envelope and in-memory
   limits: FORMS_CAPTURE.md).
8. Data subject request workflow, encryption/search trade-offs and retention policy ownership.
9. Capability evolution for payments, Telegram, webhooks and catalogs without a monolithic SDK.
10. Tests: real LLM-to-manifest flow, invalid generated JS isolation, preview/publish/ZIP parity,
    cross-tenant settings, CSP, and relay/capture abuse cases.
11. Prompt-trace parity tests for Layer V, empty layers, focused mode, Mongo persistence and UI
    rendering of the exact provider message array.

## Related sources

- [Form Runtime + BaaS Delivery](../specs/FORM_RUNTIME_BAAS_IMPLEMENTATION_PLAN.md)
- [Forms Capture](../specs/FORMS_CAPTURE.md)
- [BaaS Services Layer](../specs/BAAS_SERVICES_SPEC.md)
- [Prompting Pipeline Agent Guardrails](../agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md)
- [MongoDB: Build a Multi-Tenant Architecture](https://www.mongodb.com/docs/atlas/build-multi-tenant-arch/)
- [Lovable Cloud capabilities](https://docs.lovable.dev/integrations/cloud)
- [Lovable integration security](https://docs.lovable.dev/features/security)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks)
