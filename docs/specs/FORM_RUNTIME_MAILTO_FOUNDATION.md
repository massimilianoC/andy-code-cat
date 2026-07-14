# Declarative Form Runtime — mailto v1 definitive specification

Status: implemented and covered by an isolated browser E2E. Public BaaS delivery modes remain
disabled.

## Architectural decision

The feature is split into three independently versioned concerns:

1. `service-manifest-v1` is the immutable, declarative artifact contract emitted by the LLM.
2. `Project.serviceConfig.forms` is private owner configuration protected by JWT and the project
   sandbox.
3. The `FormRuntimeAdapter` registry selects an explicitly supported platform mode and
   `FormRuntimeCompiler` combines the two only at a delivery boundary: preview response,
   thumbnail, publish, or ZIP export.

Snapshots store the original HTML slot plus manifest, never the compiled runtime or recipient.
This preserves snapshot immutability, avoids leaking owner configuration into prompting, and lets
an owner change the recipient or privacy notice without another LLM generation.

## Prompt layer ownership

- **Layer V — Service contract** is deterministic and non-editable. It owns the slot protocol,
  the manifest envelope, allowed field types, cardinality, and the prohibition on endpoints,
  recipients, secrets, and custom submission code.
- **Layer S — Template skills** owns form craft: field minimisation, labels, autocomplete,
  accessibility, and UX review. It must not restate or redefine the structural protocol.
- The provider structured-output schema uses the same full contract exported by
  `packages/contracts/src/serviceManifest.ts`.

Layer V is active for the `form` preset or whenever the project form capability is enabled. Its
source is visible in the normal prompt trace. There is no second hidden prompt path.

## Contracts and limits

- Up to 5 forms per artifact, 5 steps per form, 5 fields per step, and 20 fields per form.
- IDs are lowercase kebab-case and unique at their relevant scope.
- Supported v1 fields: text, email, tel, textarea, number, select, radio, checkbox, date, time,
  URL, and hidden context.
- Select/radio options are bounded and strict; unknown JSON properties fail validation.
- A form requires exactly one empty `data-pf-form-id='<id>'` slot.
- Project settings accept only `mode: "mailto"`, a valid recipient, and an HTTPS privacy notice.

## Deterministic runtime behaviour

- The compiler fails closed with `422` when a declared slot is absent or duplicated.
- Multi-step forms render as accessible fieldsets with Back/Continue navigation.
- Native field constraints are checked before advancing and before delivery.
- Submission builds a local `mailto:` draft; values are not sent to or persisted by the API.
- The runtime reports only that a draft was opened, never that a message was sent.
- Long payloads are copied locally when possible instead of constructing an oversized URI.
- A cancelable `pf:mailto` browser event exposes the proposed URI for host integration and
  deterministic testing; preventing it suppresses external-protocol navigation.

## Owner UI

Configuration lives in a collapsible **Operational forms** panel inside the existing project
configuration dialog. It is not a permanent workspace code/preview tab: it is operational owner
configuration, not an LLM artifact editor or a required generation step.

## Security and forward compatibility

- `GET/PUT /v1/projects/:projectId/services/forms` require access JWT, `x-project-id`, and owner
  binding through the existing double sandbox.
- The LLM never receives recipient or privacy contact values.
- No anonymous public endpoint, SMTP relay, capture database, webhook, or arbitrary URL is
  enabled in v1.
- Future `smtp`, `capture`, or external adapters must implement the typed delivery interface and be
  registered explicitly in the application layer; they also require a hardened public router.
  They must not change the manifest into executable instructions or
  silently fall back to mailto.

## Acceptance and E2E

`tests/e2e/form-runtime.spec.ts` proves the owner and cross-tenant API boundary, Layer V trace,
snapshot creation, runtime recompilation after a recipient change, two-step browser behaviour,
published output, and ZIP inclusion of `serviceManifest.json`.

The isolated stack is `tests/e2e/docker-compose.form-runtime.yml`. It uses unique container names,
port `4100`, and tmpfs storage, so it does not touch either canonical MongoDB storage strategy.
Run it only after checking the active containers:

```powershell
docker ps --format '{{.Names}}'
docker compose -f tests/e2e/docker-compose.form-runtime.yml up -d --build
$env:E2E_API_URL='http://localhost:4100'
$env:E2E_BASE_URL='http://localhost:4100'
npx playwright test tests/e2e/form-runtime.spec.ts --project=chromium
```

Stop/remove only the three `andy-code-cat-forms-e2e-*` containers when finished. Never use the
canonical dev/deploy compose file for this scenario while another stack is live.
