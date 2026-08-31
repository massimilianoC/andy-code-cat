# Prompt Execution SSOT — Architecture Analysis and Refactor Plan

> **Superseded by [../SSOT_STATUS.md](../SSOT_STATUS.md) (2026-08-31).** The remediation this
> document plans has shipped; the "Status: active remediation plan" line below is stale. Keep it as
> the record of the original diagnosis.

**Status:** active remediation plan — no implementation is implied by this document  
**Date:** 2026-08-18  
**Planning authority:** this document is the canonical next-step plan for prompt-execution traceability. It supplements, but does not replace, the implemented layer-composition baseline in [PROMPT_LAYER_SSOT_SPEC.md](PROMPT_LAYER_SSOT_SPEC.md).  
**Applies to:** Workshop/GodMode chat-preview, streaming chat-preview, focused edit, prompt preview, conversation messages, preview snapshots, prompt execution logs, and the Prompt tab.

---

## 1. Decision and non-negotiable outcome

For a provider call, Andy Code Cat must be able to prove the following immutable chain:

```text
UI intent
  → resolved prompt execution envelope
  → persisted dispatch record
  → exact provider message array
  → provider result / failure
  → conversation message + snapshot/artifact links
  → Workshop read model
```

The user-facing rule is:

> What is configured is what is resolved; what is resolved is what is sent; what is sent is persisted by the server; what is persisted is what Workshop displays.

This is stricter than “the system prompt looks correct”. It covers the entire final provider request: system message, retained history, final user message, selected-asset context, focused-edit context, artifacts, model/provider selection and request-level overrides.

“Maximum transparency” never authorizes exposure of credentials, bearer tokens, provider secrets, private raw files outside the project sandbox, or internal security material. The trace must store and display the exact safe provider payload, with explicit redaction metadata where necessary.

## 2. Scope and current architectural baseline

The implemented foundation is valuable and must be preserved:

- `PROMPT_LAYER_DESCRIPTORS` is the current canonical registry for layer identity and order.
- `composeSystemPromptWithLayers()` produces marker-wrapped prompt text and byte-exact layer spans.
- `resolveContext()` is the only production composition call site.
- normal and streaming chat routes call `assertPromptTraceParity()` immediately before the provider request.
- `PromptLayersView` renders persisted `promptingTrace.layers` or a backend dry-run; it does not recompose in the browser.

The current targeted unit suite verifies registry ordering, markers, spans and pre-send parity. It does **not** prove durable persistence, browser-disconnect resilience, selected-snapshot correspondence, or equivalence of the complete provider message array in the UI.

## 3. Findings: vision, requirements, and implementation

### P0 — Server-authoritative persistence is missing

The provider request is built and sent in `llmRoutes.ts`. The resulting `promptingTrace` is then returned to the browser. The browser subsequently calls the conversation-message endpoint to persist it. A successful provider call can therefore occur without a corresponding durable conversation trace if the browser disconnects, crashes, is refreshed, or its follow-up request fails.

`PromptExecutionLog` is not a replacement for the immutable trace: its write is fire-and-forget, it does not retain layer spans or the full message array, and it is currently an observability/cost record rather than the canonical user-visible execution evidence.

**Required decision:** only the API may create and finalize a `PromptExecution` record. The UI may request a generation and consume the result, but it must never be the authority that records what was sent.

### P0 — Workshop does not show the complete provider payload

The Prompt tab shows the persisted system prompt with its layers and then renders only messages whose role is `user`. A provider request may include retained `assistant` and earlier `user` history, as well as runtime-built focus and artifact context embedded in the final user message. Therefore the UI does not currently present the whole provider message array in execution order.

**Required decision:** the read model must render an ordered `messagesSentToProvider[]` view, with an explicit distinction between system layers and user-message blocks. It must not infer or rebuild any part of that sequence.

### P1 — The current dry-run is an incomplete preflight

The dry-run uses the same resolver for provider, model, capability, role and output language, which fixed important historical drift. It does not accept all runtime inputs that can affect a real execution: selected asset IDs, request override, focused-edit context, artifacts, or history.

It is therefore a valid **baseline composition preview**, but not necessarily the exact “next request”. Calling it the latter risks misleading users and operators.

**Required decision:** introduce a typed preflight endpoint that accepts the same safe generation-intent contract as the real call, performs no provider request and returns a complete `PromptExecutionEnvelope`. Until then, label the existing endpoint “baseline dry-run”, not “next request”. Prefer `POST` for this endpoint; request-level text must not be carried in URL query parameters.

### P1 — Snapshot and prompt trace are not first-class peers

Snapshots receive a reduced prompt trace and are associated to a conversation message indirectly through `sourceMessageId`. The Prompt tab independently selects the most recent assistant trace, not necessarily the trace that produced the snapshot currently selected in Workshop.

**Required decision:** every generated snapshot must carry an immutable `promptExecutionId`; Workshop must resolve the prompt from the selected snapshot/execution first, falling back to the latest execution only when no snapshot is selected and labelling that state clearly.

### P1 — Layer provenance is insufficiently granular

The current Layer E concatenates project pre-prompt text and model-specific guidance. The trace source can say `project-config+model-template`, but it cannot identify their separate byte spans. This is readable but not audit-grade provenance.

**Required decision:** keep the established layer order unless an architecture decision changes it, but add nested segments to composite layers (`project-template`, `model-template`) with source, span and content hash. Do not rename Layer G for model guidance: the actual registry reserves G for Global Brand Identity. Documentation must reflect that reality.

### P1 — Shared contracts are duplicated at boundaries

`packages/contracts/src/llm.ts` defines `LlmPromptingTrace` and layer entries, while web API modules and domain entities duplicate compatible but non-identical shapes. This breaks the repository rule that contracts are the API source of truth.

**Required decision:** define the public execution envelope, layer/segment trace, provider message and UI projection DTOs once in `packages/contracts`. API/domain/web should import them or explicitly map them at their boundary; no local structural copies.

### P2 — Composition orchestration is in the presentation layer

`resolveContext()` in the HTTP route coordinates repositories, project/config resolution, asset context, provider/model selection, governance and composition. This breaches the required direction `presentation → application → domain` and makes the prompt pipeline hard to reuse from future background jobs or other entry modes.

**Required decision:** extract an application use case, e.g. `ResolvePromptExecution`, with domain repository ports and application services injected at composition root. Routes retain authentication, double-sandbox enforcement, input validation, transport mapping and SSE mechanics only.

### P2 — The documentation graph can reactivate obsolete work

The baseline audit found conflicting statuses: Layer S was described as both runtime-implemented and future/unwired; the older execution plan said steps were unimplemented; the guardrail ownership map assigned Layer G to model guidance despite the live registry assigning it to brand identity; Layer D was labelled “to be implemented” despite being used in the resolver. This documentation change corrects those entry points; the disposition table below prevents their historical wording from becoming active guidance again.

This document establishes the disposition below. Any future plan that conflicts with it requires an explicit Architecture Decision Record (ADR) or a newer dated replacement document.

## 4. Target contract: PromptExecutionEnvelope

The following is a target contract, not a request to implement it in one change:

```ts
interface PromptExecutionEnvelope {
  id: string;
  version: "prompt-execution-v1";
  projectId: string;
  userId: string;
  conversationId?: string;
  snapshotId?: string;
  mode: "chat-preview" | "focused-edit" | "preflight";
  status: "resolved" | "dispatched" | "completed" | "failed" | "cancelled";
  provider: string;
  model: string;
  messagesSentToProvider: ProviderMessage[];
  systemPrompt: string;
  layers: PromptLayerTraceEntry[];
  userBlocks: PromptMessageBlockTrace[];
  inputFingerprint: string;
  payloadHash: string;
  redactions: PromptRedaction[];
  resolvedAt: string;
  dispatchedAt?: string;
  completedAt?: string;
  failure?: SafePromptExecutionFailure;
}
```

Rules:

1. `payloadHash` is calculated over a canonical serialization of the safe final provider payload.
2. `messagesSentToProvider` is ordered exactly as transmitted; no message is synthesized for display.
3. `layers` and `userBlocks` are spans into persisted text, not duplicated content.
4. A `preflight` record is never represented as sent.
5. `dispatched` is written before or atomically with the outbound request according to the chosen reliability design; it must survive a browser disconnect.
6. A snapshot, assistant message, prompt execution log and cost record reference the same execution ID.
7. The double sandbox is checked before every read and write of an execution record.

## 5. Delivery plan: small, reversible increments

### Phase 0 — Decision and baseline certification

**Goal:** establish truth before modifying runtime behavior.

- Freeze the current layer order and identifier meanings in `PROMPT_LAYER_DESCRIPTORS`.
- Write an ADR for the execution-envelope lifecycle, retention, redaction policy, retry/idempotency key and hash algorithm.
- Capture representative fixtures for normal generation, stream, focused edit, selected assets, Layer D, form Layer V, Layer S, request override and non-English output.
- Add an inventory test that fails if production composition gains another call site.

**Exit criteria:** approved lifecycle; fixture inventory; no ambiguity over whether a document is historical, active or deferred.

### Phase 1 — Contract convergence

**Goal:** eliminate competing DTO definitions before data migration.

- Add `PromptExecutionEnvelope` and related trace types to `packages/contracts`.
- Replace structural copies in API and web with imports/mappers.
- Add schemas for transport payloads, including a safe redaction representation.
- Maintain additive compatibility for legacy conversation traces; do not silently reinterpret them as verified executions.

**Exit criteria:** one public type vocabulary and contract tests proving API/web compatibility.

### Phase 2 — Application-layer extraction

**Goal:** move composition orchestration out of HTTP routes without changing output.

- Introduce `ResolvePromptExecution` under `application/use-cases` (or a focused application service).
- Inject repository interfaces and existing application helpers; keep MongoDB adapters in `infra`.
- Make normal, streaming and preflight paths call this use case.
- Retain parity checks at the final provider adapter boundary.

**Exit criteria:** identical golden payload hashes before/after extraction for the Phase 0 fixtures; routes contain no repository-driven composition logic.

### Phase 3 — Durable server-side execution journal

**Goal:** make the audit chain resilient to UI failure.

- Introduce a `PromptExecution` entity, repository port and Mongo adapter with project/user indexes and retention policy.
- Persist `resolved` and `dispatched` states server-side; finalize with result/failure metadata.
- Use an idempotency key to prevent duplicate provider sends after client retries.
- Link execution IDs to conversation messages, snapshots, execution logs and cost transactions.
- Define reconciliation for a process failure between dispatch and completion; never report an uncertain record as completed.

**Exit criteria:** a forced client disconnect still leaves a retrievable `dispatched` or terminal execution record; retries are auditable and do not create silent duplicate sends.

### Phase 4 — Exact Workshop transparency

**Goal:** make the UI a projection of the server record, not a second execution system.

- Add an authorized execution-read endpoint scoped by project/user.
- Render the selected snapshot’s execution in Workshop; show model, provider, timestamp, execution status and payload hash.
- Render all provider messages in order, then layer/segment accordions from persisted spans.
- Add clear state badges: `REALMENTE INVIATO`, `PREFLIGHT NON INVIATO`, `BASELINE DRY-RUN`, `LEGACY TRACE`.
- Do not expose raw secrets; show redaction reason and affected block instead.

**Exit criteria:** screenshot/E2E assertion proves displayed payload equals the stored server envelope for every fixture.

### Phase 5 — Complete preflight and governance

**Goal:** make prospective transparency honest and configuration provenance inspectable.

- Add typed `POST` preflight using the same intent fields as generation.
- Add nested source/segment provenance for composite Layer E.
- Build the deferred SuperAdmin read surface from the same registry/resolver; non-editable layers remain read-only.
- Do not enable arbitrary stored overrides for architectural safety layers A, V or P.

**Exit criteria:** preflight and send produce the same payload hash when supplied identical intent; an operator can inspect the effective source of every editable contribution.

### Phase 6 — Migration, verification and cleanup

**Goal:** retire ambiguity safely.

- Backfill only safe execution links where an exact legacy trace exists; label all other records as legacy/unverified.
- Add API integration and browser E2E coverage for normal/stream/focused/preflight/disconnect/retry/snapshot selection.
- Mark superseded documents at their header and remove obsolete “execute this blindly” instructions from agent reading paths.
- Publish an implementation status report with residual gaps and a rollback procedure.

**Exit criteria:** all active planning documents agree on status; no active agent instruction points to a known-stale plan as executable work.

## 6. Documentation authority and disposition

| Document | Status from 2026-08-18 | How to use it |
|---|---|---|
| `AGENTS.md` | active, highest authority | Mandatory architecture, sandbox, security and documentation rules. |
| `docs/INDEX.md` | active navigation authority | Must link every active plan and mark historical material. |
| `docs/DEVELOPMENT_PLAN.md` | active delivery-status summary | Current milestone status only; no low-level instructions. |
| `docs/project/ROADMAP.md` | active product sequencing authority | Release priority and deferrals; must agree with Development Plan. |
| `docs/project/PRODUCT_VISION.md` | active product intent | Explains why, not implementation steps. |
| `docs/specs/PROMPT_LAYER_SSOT_SPEC.md` | active implemented-baseline spec | Registry, markers and layer-level invariants; read with this analysis. |
| `docs/specs/PROMPT_LAYER_SSOT_EXECUTION_PLAN.md` | historical execution record | Do not execute as-is; its completed/stale steps are superseded for future work by this plan. |
| `docs/agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md` | active operational guardrail | Layer ownership and frozen-zone rules; corrected to match the live registry. |
| `docs/specs/PREPROMPT_ENGINE_SPEC.md` | historical/deferred architecture reference | It must not be treated as a current implementation roadmap where it conflicts with the live composer. |

Document lifecycle rules:

1. Every active spec must state `Status`, `Owner`, `Last verified` and `Supersedes/Superseded by` where relevant.
2. A plan that has been executed is converted to an implementation record or marked historical; it is never left “ready for execution”.
3. A deferred feature is not an active dependency. It cannot be used to justify changes in an active flow without an explicit roadmap update.
4. `docs/INDEX.md`, `docs/DEVELOPMENT_PLAN.md` and `docs/project/ROADMAP.md` must be updated together for any change in active priority.
5. When documents disagree, use the order in `AGENTS.md`, then the three active planning documents above, then dated active specs. Archived documents never win.

## 7. Acceptance matrix

| Invariant | Automated proof | Browser/operational proof |
|---|---|---|
| One composition path | static call-site test | code review gate |
| Exact system prompt | parity + span/hash test | raw prompt equals execution record |
| Exact full request | final message-array hash test | Workshop renders every provider message in order |
| Durable audit | repository integration test | refresh/disconnect does not lose dispatched execution |
| Snapshot correspondence | executionId linkage test | selecting snapshot changes shown execution |
| Preflight truthfulness | same-intent hash equality test | UI distinguishes preflight from sent |
| Sandbox isolation | owner/non-owner API tests | unauthorized execution reads return denial |
| No documentation drift | status/links lint or review checklist | current planning documents agree |

## 8. Non-goals and guardrails

- Do not redesign layer semantics, reorder layers or relax PP safety rules as part of traceability work.
- Do not expose provider credentials, raw private content outside authorized project scope, or security middleware internals in Workshop.
- Do not start the deferred broad async/OpenCode pipeline merely to solve durable prompt execution; this remediation applies to the existing Layer 1 runtime.
- Do not create a second browser-side prompt composer or a parallel layer registry.
- Do not backfill fabricated “exact” traces for legacy executions.

## 9. Immediate next action

Before any code change, approve Phase 0 as a dedicated architecture task. The first implementation PR should be Phase 1 only: contracts and characterization tests, without persistence migration or UI behavior changes.
