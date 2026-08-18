# Andy Code Cat — Multimode UX MVP Execution Spec

> Status: operational execution spec  
> Date: 2026-04-16  
> Scope: Guided Mode + Workspace MVP, shared backend runtime, parallel multi-agent implementation, zero-regression rollout

---

## 1. Objective

Start implementation immediately with an additive architecture that:

- preserves the current advanced workspace UX
- introduces a new Gamma-style frontend channel for Guided Mode generation
- shares backend services and orchestration across both modes
- keeps new services and endpoints generic so they can later support other UX flows
- allows parallel work by multiple implementation agents without stepping on each other

This is the execution spec for the MVP, not a long-term theoretical vision document.

---

## 2. Non-Negotiable Rules

1. **Zero regressions on the current workspace**  
   The current advanced UX remains the active Workspace path and must continue to work during all rollout phases.

2. **No destructive frontend refactor**  
   The new UX is a separate frontend channel or route group. The existing workspace is not replaced.

3. **One project model only**  
   Projects created in Guided Mode remain normal projects and must open immediately in Workspace.

4. **Backend is the orchestration source of truth**  
   Workflow sequencing, retries, publish policy, and stage transitions must live in the backend.

5. **Generic services first, UX-specific shells second**  
   Do not build special-case frontend-only orchestration.

6. **Parallel implementation must be conflict-aware**  
   Each wave owns a clear file boundary to enable safe multi-agent work.

---

## 3. Active MVP Tracks

## 3.1 Guided Mode

Purpose:

- end users
- first-time users
- resellers doing fast first delivery

Experience:

- guided intake
- minimal visible complexity
- automatic pipeline execution
- live working output with optional publish

Pipeline style:

- aggregate
- opinionated
- mostly automatic

## 3.2 Workspace

Purpose:

- advanced users
- operators
- internal editors
- resellers who need full refinement and full control

Experience:

- existing workspace UX
- granular controls
- direct snapshot, asset, prompt, and publish control

Pipeline style:

- modular
- inspectable
- manually steerable

## 3.3 Paused for now

The following modes remain planned but intentionally not prioritized in the MVP:

- Curiosity
- Nerdy

They must remain representable in the UX-mode data model, but they do not block implementation.

---

## 4. Product Model

The sidebar difficulty switch should exist conceptually from the start:

- Guided Mode
- Curiosity
- Nerdy
- Workspace

For the MVP:

- Guided Mode is active
- Workspace is active
- Curiosity and Nerdy are placeholders or disabled states

Switching mode changes:

- UI density
- visible tools
- how much the system automates
- which pipeline template is the default

Switching mode does **not** change:

- project identity
- project assets
- snapshots
- publish state
- ownership and sandbox rules

---

## 5. Shared Backend Runtime — Mandatory Core

The two active UX tracks must share a backend orchestration core.

## 5.1 Generic services to introduce

These services should be generic enough for future UX flows:

- IntakeNormalizer
- UXModeResolver
- PipelineTemplateResolver
- PipelineOrchestrator
- PipelineEventPublisher
- ArtifactFinalizer
- PublishGateService
- ProjectLaunchSummaryBuilder

These are domain/application services, not route-level glue.

## 5.2 New domain entities

### PipelineTemplate

Describes the workflow configuration.

Suggested fields:

- id
- key
- label
- version
- active
- supportedUxModes
- linearStages or graph
- defaultSettings
- createdAt
- updatedAt

### PipelineRun

Represents one execution of a workflow.

Suggested fields:

- id
- projectId
- userId
- templateKey
- uxMode
- status
- currentStage
- intakeSummary
- outputSummary
- errorSummary
- startedAt
- finishedAt

### PipelineStageRun

Stores stage-by-stage trace.

Suggested fields:

- id
- runId
- stageKey
- status
- retryCount
- inputSummary
- outputSummary
- startedAt
- finishedAt

---

## 6. New Generic Endpoints

These endpoints must be generic and reusable beyond Guided Mode.

## 6.1 Execution

### Start a pipeline run

POST /v1/projects/:projectId/pipelines/execute

Request body:

- templateKey
- uxMode
- intake
- options

This is the preferred generic execution entrypoint.

### Convenience alias for Guided Mode

POST /v1/projects/:projectId/pipelines/zero-effort

This can internally call the same generic execution use-case with a default templateKey.

## 6.2 Status and events

### Get run state

GET /v1/projects/:projectId/pipeline-runs/:runId

### Stream live events

GET /v1/projects/:projectId/pipeline-runs/:runId/events

SSE event types:

- run_started
- stage_started
- stage_progress
- stage_completed
- stage_failed
- run_completed
- run_failed

## 6.3 Template discovery

### List templates

GET /v1/pipeline-templates

### Validate template

POST /v1/pipeline-templates/validate

## 6.4 UX mode persistence

Optional but recommended:

- GET /v1/projects/:projectId/ux-mode
- PATCH /v1/projects/:projectId/ux-mode

This allows the frontend shell to remember the user’s preferred interaction difficulty without coupling it to the project data model itself.

---

## 7. Guided Mode UX Channel — Frontend Spec

This must be a **new** channel, not a replacement of the current workspace.

## 7.1 Route strategy

Recommended options:

- a separate route group for guided creation
- or a dedicated create shell for each project

Examples of acceptable route patterns:

- /create/:projectId
- /guided/:projectId
- /launch/:projectId

The exact naming can be chosen during implementation, but it must remain distinct from the current workspace route.

## 7.2 UI behavior

Guided Mode should present:

- one guided intake experience
- simplified preview and progress states
- suggested copy rather than open-ended free tooling everywhere
- a prominent action to open the same project in Workspace

## 7.3 Minimum screens

1. intake screen
2. progress screen
3. live result screen
4. handoff action to Workspace

## 7.4 Coherence with current design

The new shell must remain visually coherent with the existing product by reusing:

- design tokens
- button hierarchy
- cards and dialogs
- spacing system
- existing dark theme language

But it should **not** reuse the same interaction density or same layout assumptions as the advanced workspace.

---

## 8. Workspace Continuity Spec

The current workspace remains the advanced branch.

Required behavior:

- no removal of existing controls
- no forced migration to the new channel
- new backend services can be reused from Workspace only when they improve the flow without reducing control
- every Guided Mode project must open as a normal project in Workspace immediately after creation

This is how the product serves both end users and resellers without splitting the system.

---

## 9. Shared Pipeline Stage Catalog

The first implementation can stay linear internally, but it must already use a stage model.

Recommended stage keys:

1. normalize_intake
2. resolve_preset
3. optimize_brief
4. generate_site_draft
5. generate_or_replace_images
6. finalize_snapshot
7. smoke_check_optional
8. publish_optional
9. build_launch_summary

Guided Mode uses these as a mostly automatic aggregate flow.

Workspace can later call or expose some of the same stages more granularly.

---

## 10. Multi-Agent Parallel Delivery Plan

Implementation should proceed in parallel waves with strict file ownership.

## Wave 0 — foundation and contracts

Goal:

- establish shared types and entities before UI work branches out

Owned files:

- contracts package
- domain pipeline entities
- repository interfaces

Deliverables:

- pipeline DTOs
- ux mode DTOs
- initial entities and repository ports

Dependency level:

- must land first or nearly first

## Wave A — backend runtime and orchestration

Goal:

- build the generic execution engine

Owned files:

- application pipeline runtime
- stage handlers
- execute use-cases

Deliverables:

- PipelineOrchestrator
- stage registry
- zero-effort execution use-case

## Wave B — API surface and SSE events

Goal:

- expose the generic runtime safely

Owned files:

- HTTP routes
- request validation
- SSE progress stream handling

Deliverables:

- generic execution endpoint
- zero-effort alias endpoint
- status and events endpoints

## Wave C — Guided Mode frontend channel

Goal:

- build the new Gamma-style UX shell

Owned files:

- new route group
- intake flow UI
- pipeline progress UI
- mode switch UI

Deliverables:

- dedicated guided channel
- handoff to Workspace

## Wave D — Workspace compatibility and reuse

Goal:

- keep the current workspace stable while integrating reusable backend pieces where helpful

Owned files:

- small compatibility touches in the existing workspace
- optional mode switch entrypoints
- no destructive refactors

Deliverables:

- safe reuse of shared services
- no regression in the current workspace behavior

## Wave E — regression and verification

Goal:

- verify nothing broke and both active tracks are viable

Owned files:

- tests
- smoke checks
- runbooks

Deliverables:

- regression checklist
- build and route verification
- UX handoff validation

---

## 11. Parallel Work Rules

To support multi-agent implementation safely:

1. each wave should have a primary file boundary
2. avoid editing the same major file from multiple waves at once
3. use integration checkpoints after Wave 0 and after Wave A/B
4. keep the current workspace route protected from broad refactors
5. prefer additive route registration and additive components

Safe examples of parallelization:

- contracts and entities in one wave
- runtime/stages in another wave
- guided frontend shell in a separate wave
- regression harness and tests in a separate wave

Unsafe examples:

- multiple agents heavily rewriting the current workspace page at the same time
- UI-only orchestration logic being duplicated in parallel in several places

---

## 12. Zero-Regression Safety Rules

These rules are mandatory during implementation:

- do not remove or replace the current workspace route
- do not change existing publish or snapshot behavior unless the change is backward-compatible or clearly bug-fixing
- do not move advanced user controls out of the current workspace as part of this MVP
- do not hardwire Guided Mode assumptions into generic services
- do not create UX-specific APIs when a generic endpoint can serve the same purpose

---

## 13. Concrete File Targets for the First Implementation Slice

### Shared contracts and domain

Create:

- packages/contracts/src/pipeline.ts
- packages/contracts/src/uxMode.ts
- apps/api/src/domain/entities/PipelineRun.ts
- apps/api/src/domain/entities/PipelineTemplate.ts
- apps/api/src/domain/repositories/PipelineRunRepository.ts
- apps/api/src/domain/repositories/PipelineTemplateRepository.ts

### Backend runtime

Create:

- apps/api/src/application/pipeline/runtime/PipelineContext.ts
- apps/api/src/application/pipeline/runtime/PipelineStage.ts
- apps/api/src/application/pipeline/runtime/PipelineOrchestrator.ts
- apps/api/src/application/pipeline/stages/NormalizeIntakeStage.ts
- apps/api/src/application/pipeline/stages/ResolvePresetStage.ts
- apps/api/src/application/pipeline/stages/OptimizeBriefStage.ts
- apps/api/src/application/pipeline/stages/GenerateSiteDraftStage.ts
- apps/api/src/application/pipeline/stages/GenerateImagesStage.ts
- apps/api/src/application/pipeline/stages/FinalizeSnapshotStage.ts
- apps/api/src/application/pipeline/stages/PublishStage.ts

### API layer

Create:

- apps/api/src/application/use-cases/ExecutePipeline.ts
- apps/api/src/application/use-cases/ExecuteZeroEffortPipeline.ts
- apps/api/src/presentation/http/routes/pipelineRoutes.ts

Update:

- apps/api/src/app.ts

### Frontend guided channel

Create:

- apps/web/lib/api/pipelines.ts
- a new guided route group or create shell
- a mode selector component
- a Guided Mode intake page
- a Guided Mode progress screen
- a Workspace handoff control

---

## 14. Implementation Sequence

## Sprint 1

Shared backend foundation:

- contracts and domain entities
- generic orchestrator
- generic execution endpoint
- run persistence and event streaming skeleton

## Sprint 2

Guided Mode activation:

- new guided frontend channel
- guided intake flow
- live progress and publish result
- open in Workspace handoff

## Sprint 3

Workspace reuse and hardening:

- consume shared services where useful
- keep the existing advanced flow stable
- remove only duplicated orchestration logic that clearly belongs in backend services

Curiosity and Nerdy remain paused until user evidence justifies their exact design.

---

## 15. Acceptance Criteria

The MVP is ready when all of the following are true:

- Guided Mode can create a working project through one guided flow
- Workspace remains fully usable with no functional regressions
- the same project can move from Guided Mode to Workspace without conversion
- shared orchestration lives in the backend, not in the UI
- generic endpoints are reusable for later UX flows
- the new UI feels visually coherent with the current product, even if the pipeline is different

---

## 16. Baseline Verification Note

As of this planning checkpoint, the local baseline is healthy:

- the recent build commands completed successfully for contracts, API, and web
- the local API and web endpoints returned successful responses in the latest workspace verification context

This gives a good starting point for a zero-regression implementation approach.

---

## 17. Final Execution Recommendation

Start immediately with the shared backend runtime and the new Guided Mode frontend channel in parallel.

Do not wait for the intermediate modes.
Do not refactor away the current workspace.
Do not build UX-specific orchestration that cannot be reused.

Build one strong shared backend core, then let:

- Guided Mode provide the aggregate automated path
- Workspace provide the granular expert path

This is the fastest route to a broader MVP that serves both end users and resellers.
