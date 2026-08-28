# Unified SSOT Program — Prompt Execution, Model Routing and Feedback UI

**Status:** immediate implementation and review priority
**Date:** 2026-08-18
**Decision:** this document unifies and orders the two active refactors: [Prompt Execution SSOT](PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md) and [Vibe → GodMode Model SSOT](VIBE_TO_GODMODE_MODEL_SSOT_REGRESSION_ANALYSIS_2026-08-18.md). For implementation it takes precedence over previous conflicting plans regarding orchestration, fallback, implicit optimizer, browser-owned handoff and the pipeline model.

---

## 1. Single Outcome

The product must make a single chain true and demonstrable:

    user intent and override
      → server-owned PipelineRun
      → centralized model decision
      → immutable canonical brief
      → immutable PromptExecution
      → provider dispatch
      → message, snapshot, costs and Workshop UI

The two SSOT laws are inseparable:

1. **Execution SSOT:** what Workshop shows is the safe payload actually resolved and sent by the server.
2. **Model SSOT:** the model manually selected by the user always wins for the run; no task, fallback, preset, query or browser storage can silently replace it.

PipelineRun and PromptExecution are distinct but related aggregates: the first governs intent, lock, brief and state; the second is the immutable proof of each LLM dispatch. A cost, a badge or an administrative default are not proof of the final generation.

## 2. Binding Decisions

### 2.1 Single LLM Selection Precedence

| Priority | Source | Rule |
| --- | --- | --- |
| 1 | manual user override confirmed at submit | creates PipelineRun.modelLock; always wins |
| 2 | explicitly confirmed capability exception | only if the lock cannot perform a declared capability; visible and audited |
| 3 | administrative policy/configuration per task | default for a **new run with no override**; does not overwrite a lock |
| 4 | runtime catalog and role/capability | proposes and validates the model before the run is created |

The backend rejects (409/422) a dispatch that differs from the lock. If the locked model is unavailable, the run enters blocked: it does not fall back to DeepSeek, MiniMax or another default.

### 2.2 A Single Application Resolver

Introduce ResolveModelSelectionDecision with two modes:

- createRun: validates the manual override, or resolves an administrative default, and freezes the decision, catalog revision and rationale.
- dispatchRun: reads exclusively the run's immutable decision, validates availability/capability, and produces the effective provider/model or a fail-closed error.

Route handler, optimizer, Vibe, Zero Effort and chat-preview do not implement their own cascade. The UI sends a proposal to create a run, never an authoritative pair to alter an existing one.

### 2.3 Brief and Optimization Policy

BuildCanonicalGenerationBrief in the application layer produces a server-owned BriefRevision: text, schema version, hash and provenance. It is the only user message for the automatic GodMode launch.

Vibe → Zero Effort → GodMode sets optimizationPolicy: skip. System prompt and guidelines are composed at dispatch, but the brief is not rewritten. The optimizer remains available only as an explicit command and creates a new revision/run with a derivation relationship.

## 3. Minimal Contracts and Clean Architecture Ownership

packages/contracts is the shared authority for public shapes. The domain does not depend on provider, route or UI.

    ModelSelectionDecision
      - requested: provider, model, source, catalog revision
      - effective: provider, model
      - policy: strict | allow-explicit-capability-exception
      - outcome: exact | explicit-exception | blocked
      - exception: rationale and approval, if present

    BriefRevision
      - content, schema version, content hash, provenance

Responsibilities:

- **domain:** lock/revision/state invariants and repository interface;
- **application:** run creation, brief, model resolution, dispatch and optimizer policy;
- **infra:** catalog/provider adapter, Mongo and costs;
- **presentation:** contracts, double sandbox and read model. No brief composition or decisional fallback.

Every PromptExecution retains pipelineRunId, stage, the decision's requested/effective snapshot, canonicalBriefHash, payloadHash, executionId, and a link to message/snapshot/cost/notification.

## 4. Mandatory User Feedback

The picker exposes a server-derived ModelDecisionView:

| UI state | Minimum content | Action |
| --- | --- | --- |
| Before start | requested, availability, strict lock, capability/estimate | confirm or change |
| Running | stage, effective model, brief hash, optimizer skipped | observe/cancel |
| Blocked | requested model and cause, no alternative dispatch | change model or approve exception |
| Exception | requested/effective, stage, rationale and approval | explicit consent |
| Completed | model snapshot, Prompt tab and costs per stage | opens proof |

Notifications are persisted run events, not toasts inferred by the client: MODEL_LOCKED, MODEL_UNAVAILABLE, CAPABILITY_EXCEPTION_REQUIRED, OPTIMIZATION_SKIPPED, BRIEF_REVISION_DISPATCHED, ARTIFACT_GENERATED.

## 5. Implementation and Review Sequence

### U0 — Governance and Baseline

- Single ADR for lifecycle, idempotency, hash, retention, redactions and model policy.
- Document matrix: active / implemented / deferred / historical.
- Frozen fixtures for Vibe, prefill, GodMode, stream, focused edit and asset.

**Gate:** no active document authorizes an implicit optimizer, silent fallback or browser authority.

### U1 — Domain and Shared Contracts

- Contracts for PipelineRun, ModelSelectionDecision, CanonicalBriefEnvelope, PromptExecution and UI DTO.
- PipelineStageExecutionRef for LLM stages points to PromptExecution, with no second competing journal.
- Additive compatibility for legacy data, always labeled unverified.

**Gate:** API and web use a single contractual vocabulary.

### U2 — Single Server-side Model Resolution

- Extract ResolveModelSelectionDecision.
- Converge Vibe, Zero Effort, optimizer and GodMode onto the resolver.
- Block before dispatch when the lock cannot be satisfied.
- Remove preferredProvider, preferredModel, query, localStorage and local selectors as authorities.

**Gate:** a selected Kimi stays Kimi at every stage; an absent Kimi generates zero alternative calls.

### U3 — Run and Canonical Brief

- Persist the run on the first submit and extract BuildCanonicalGenerationBrief.
- Pass only pipelineRunId to GodMode.
- optimizationPolicy: skip for the requested path and the server-owned launch-godmode endpoint.

**Gate:** brief.contentHash matches dispatchedUserMessageHash; no optimizer in a skip run.

### U4 — Prompt Execution and Durable Journal

- Extract ResolvePromptExecution from the route.
- Persist server-side resolved → dispatched → terminal.
- Link execution to run, message, snapshot, log and cost; introduce an idempotency key.

**Gate:** refresh/disconnection does not lose the proof; retry does not duplicate sends.

### U5 — UI, Notifications and E2E Review

- Workshop shows the ordered payload, layer, brief revision and the requested/effective model of the selected snapshot.
- Costs grouped by pipelineRunId and stage.
- Docker E2E: Vibe → prefill → brief → GodMode → snapshot → Prompt tab → costs/notifications.

**Gate:** UI and notifications derive exclusively from the server-side read model.

## 6. Roadmap Order

1. U0–U3: next implementation work.
2. U4–U5: completion of the R2/R3 gate.
3. Only after that: Layer S, new capabilities, BaaS, RAG, Gen AI Media, workflow/node editor, Curiosity/Nerdy and speculative automations.

R3 publish hardening is not cancelled, but no expansion of prompting or new entry flow goes ahead of the U2–U5 gates.

## 7. Disposition of the Specs

| Document | New status |
| --- | --- |
| PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md | active: proof/payload/Workshop |
| VIBE_TO_GODMODE_MODEL_SSOT_REGRESSION_ANALYSIS_2026-08-18.md | active: lock/brief/direct handoff |
| this program | ordering and review authority |
| ZERO_EFFORT_PREFILL_SPEC.md | implemented baseline, partially superseded for storage/handoff/fallback |
| PROMPT_OPTIMIZER_SPEC.md | active only for explicit optimization |
| PROMPTING_SERVICE_PLATFORM_SPEC.md | governance reference; defaults valid only without a lock |
| MULTIMODE_UX_MVP_EXECUTION_SPEC.md | historical: vision still useful, delivery sequence superseded |
| DASHBOARD_LOVABLE_CHAT_SPEC.md | historical: UX/design reference |
| MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md | historical: generic playbook |
| WORKFLOW_PIPELINE_MODULARIZATION_PLAN.md | deferred future work, not P0 authority |

## 8. Exit Criterion

A repeatable E2E, on the same pipelineRunId, must demonstrate: a locked Kimi K3 override; the same model for every text stage or an approved exception; an unchanged brief hash; no implicit optimization on the skip path; snapshot/costs/Prompt tab linked to the dispatch; understandable feedback for success, block and exception.

Until then, any feature that adds an LLM resolver, fallback, browser prompt storage or new handoff is rejected in review for violating SSOT/Clean Architecture.
