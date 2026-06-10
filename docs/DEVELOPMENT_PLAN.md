# Development Plan

This document is the stable planning entry point for coding agents and contributors.
It summarizes the current delivery state, the active milestones, and the source documents
that define Andy Code Cat's near-term direction.

Use this file as the high-level status view. For implementation detail, always pair it with
`docs/project/ROADMAP.md`, `docs/agents/CODE_AGENT_INDEX.md`, the latest implementation reports,
and the relevant specs under `docs/specs/`.

---

## Current Status

Last aligned review: 2026-06-03

Andy Code Cat is beyond the original bootstrap phase.

The platform already has a working foundation for:

- authenticated multi-project usage with double sandbox isolation
- Layer 1 AI website generation in the workspace
- typed preset-aware prompting
- onboarding, style profiling, and moodboard context
- WYSIWYG editing, snapshot versioning, export, and path-based publish
- multi-provider LLM catalog and runtime selection
- media resolution with persisted project assets and snapshot linkage
- execution logging, notifications, and cost-tracking foundations
- Zero Effort / guided-entry work that feeds into the same project model

At this point, the project should be understood as:

- `R0`: complete
- `R1`: functionally delivered
- `R2`: active
- `R3`: started
- `R3.5`: planned
- `R4+`: intentionally deferred until R2/R3 are hardened

This supersedes older references that still describe `R1` as the sole current focus.

---

## Current Product Direction

The current product direction is centered on one shared platform with multiple entry modes
that converge on the same project, asset, snapshot, and publish model.

### Active experience tracks

- **GodMode**: the existing advanced workspace remains the expert path
- **Zero Effort / guided generation**: a simplified launch flow for faster project creation
- **Dashboard entry / VibeCore direction**: single-prompt entry, intent classification,
  structured prefill, and fast handoff into guided or advanced flows

### Current architecture emphasis

- backend orchestration remains the source of truth
- frontend modes are additive shells, not separate products
- prompt composition, media resolution, and publish/export rules stay centralized in the API
- observability and governance are now as important as generation quality

---

## Active Milestones

### R2 - Execution Logging, Cost Visibility, and Operational Observability

Status: active

Already in place:

- execution log infrastructure
- prompt usage summaries
- project-level cost aggregation foundations
- notification persistence for media/publish/export outcomes

Current R2 priorities:

- complete coverage for export/publish/workspace operational flows
- expose backend observability through owner-facing and admin-facing dashboard UI
- improve auditability of generation, snapshot, media, and publish paths

Primary references:

- `docs/project/ROADMAP.md`
- `docs/specs/EXECUTION_LOG_SPEC.md`
- `docs/specs/COST_TRANSACTION_LEDGER_SPEC.md`
- `docs/specs/COST_ANALYTICS_DASHBOARDS_SPEC.md`

### R3 - Publish Hardening, Slug/Domain Management, and Runtime Delivery

Status: started

Already in place:

- path-based publish
- slug/public URL foundations
- export pipeline baseline

Current R3 priorities:

- wildcard subdomain hardening
- custom domain mapping
- nginx automation and SSL workflow completion
- stronger runtime controls and publish governance

Primary references:

- `docs/project/ROADMAP.md`
- `docs/specs/EXPORT_AND_PUBLISH_SPEC.md`
- `docs/specs/MULTIDOMAINS_IMPLEMENTATION_PLAN.md`

### Media Orchestrator Continuation

Status: active cross-cutting track inside R2/R3

This is one of the clearest current execution areas and must be treated as live platform work,
not future theory.

Already in place:

- `asset://media/<key>` placeholder contract
- backend media resolution before persisted snapshots
- persisted `ProjectAsset` lineage and `MediaResolutionTrace`
- unresolved-media guardrails on snapshot activation, publish, and export
- conversation-to-snapshot media parity wave 1

Current priorities:

- unsupported manifest strategy coverage (`image_generation`, `project_asset`, `user_library`)
- browser E2E for prompt -> manifest -> resolved snapshot -> regenerate -> publish/export
- failed-trace completeness and admin observability surfaces
- strategy registry and policy expansion

Primary references:

- `docs/reports/ARTIFACT_MEDIA_IMPLEMENTATION_STATUS_2026-05-29.md`
- `docs/reports/MINIMAX_M3_PARITY_IMPLEMENTATION_2026-06-02.md`
- `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`
- `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md`
- `docs/specs/MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md`

### Guided Entry, VibeCore, and Zero Effort Evolution

Status: active additive product track

This work extends the front door of the product without replacing the current workspace.

Already in place or partially implemented:

- pipeline launch/config route surface
- dashboard-first guided creation direction
- VibeCore classify/prefill API surface
- Zero Effort prefill behavior and project handoff concepts

Current priorities:

- keep guided entry, Zero Effort, and GodMode on one shared backend orchestration path
- preserve zero regression on the current workspace UX
- improve intake classification, prefill quality, and launch ergonomics
- converge new entry flows with prompt governance and asset-aware context

Primary references:

- `docs/specs/MULTIMODE_UX_MVP_EXECUTION_SPEC.md`
- `docs/specs/DASHBOARD_LOVABLE_CHAT_SPEC.md`
- `docs/specs/ZERO_EFFORT_PREFILL_SPEC.md`
- `docs/project/WORKFLOW_PIPELINE_MODULARIZATION_PLAN.md`

### R3.5 - Settings and API Keys

Status: planned, not current implementation focus

This remains the next structured platform milestone after R2/R3 hardening.

Scope:

- user-owned API keys
- unified `/settings` shell
- role-scoped configuration surface for users and superadmins

Primary reference:

- `docs/specs/USER_SETTINGS_AND_API_KEYS_SPEC.md`

---

## Delivered Foundations That Should Not Be Re-planned As New

The following are already delivered enough that they should be treated as established platform
capabilities unless a specific gap is documented elsewhere:

- auth register/login/refresh baseline
- double sandbox project isolation
- preset-aware prompting and layered prompt assembly
- onboarding and style profile propagation
- WYSIWYG edit mode baseline
- focused edit workflow
- snapshot persistence and activation
- Layer 1 ZIP export
- path-based publish
- provider/model catalog runtime
- local or MinIO-backed media/file persistence

If a plan or agent note still presents these as greenfield roadmap items, that plan is stale.

---

## What Is Not The Main Focus Right Now

The following areas remain valid long-term directions, but they are not the current center
of execution as of 2026-06-03:

- broad new prompt-architecture build-out as if R1 were still incomplete
- fully new async generation platform as the primary milestone
- BaaS services expansion before publish/observability hardening
- RAG chatbot expansion before runtime governance is more mature

Those remain backlog or deferred tracks unless a newer spec explicitly reactivates them.

---

## Source Documents To Use Together

Read these together when planning or coding:

| Document | Role |
| --- | --- |
| `docs/project/ROADMAP.md` | Canonical release and milestone status |
| `docs/agents/CODE_AGENT_INDEX.md` | Agent navigation and implementation boundaries |
| `docs/architecture/BOOTSTRAP_ARCHITECTURE.md` | Current platform shape and route/service map |
| `docs/runbooks/TESTABLE_STEPS.md` | Validation and smoke path |
| `docs/reports/ARTIFACT_MEDIA_IMPLEMENTATION_STATUS_2026-05-29.md` | Certified current media-orchestrator state |
| `docs/reports/MINIMAX_M3_PARITY_IMPLEMENTATION_2026-06-02.md` | Latest parity/lineage implementation wave |
| `docs/specs/` | Detailed implementation specs for active and planned tracks |

---

## Maintenance Rule

Update this file when either of the following changes:

- the active milestone focus changes
- a major implementation wave materially advances the current state beyond this summary

When updating this file, verify consistency with:

- `docs/INDEX.md`
- `docs/project/ROADMAP.md`
- `docs/agents/CODE_AGENT_INDEX.md`

This file should remain concise, but it must reflect the real development state rather than an
older milestone narrative.
