# Andy Code Cat — Modular Workflow Pipeline Plan

> Status: proposed implementation plan  
> Date: 2026-04-16  
> Scope: zero-effort generation flow, dynamic UX difficulty modes, backend-first orchestration, reusable pipeline templates, and future node-based workflow editor

---

## 1. Executive Summary

The current platform already contains most of the functional building blocks needed for a guided or zero-effort website generation pipeline:

- prompt optimization
- chat preview generation
- preview snapshot versioning
- project moodboard and user style profile
- asset upload and image generation
- export and publish
- execution logging

What is still missing is not the content-generation capability itself, but the orchestration layer that can:

1. normalize a richer user intake
2. execute existing steps in sequence
3. persist progress and results as a pipeline run
4. expose reusable templates for future visual workflow composition

The recommended direction is:

- preserve the current workspace UX as the high-control advanced mode
- add a new optional frontend channel dedicated to Gamma-style guided creation
- actively develop only two UX tracks in the MVP: Zero Effort and GodMode
- pause Curiosity and Nerdy as designed-but-not-yet-prioritized intermediate layers
- move sequencing, branching rules, asset-finalization rules, and persistence decisions into the backend
- introduce a pipeline runtime that can first power monolithic preset flows and later generic node-based workflows without rewriting the core generation logic
- allow the same project to switch interaction difficulty at any time without losing editability or compatibility with the existing workspace

---

## 2. Product Goal

Support a dynamic multi-difficulty UX system with one shared backend runtime and one shared project model.

The key product rule is:

- the current workspace remains valid and becomes the explicit advanced mode
- the new Gamma-like UX is introduced as a parallel frontend channel, not as a destructive refactor
- all modes operate on the same project entities, assets, snapshots, and publish model
- for the current MVP cycle, only Zero Effort and GodMode are active development priorities

### Active MVP personas

The architecture should explicitly support two immediate commercial user families:

- end user, who wants a working site quickly with minimal technical decisions
- reseller or service provider, who wants repeatable generation, fast delivery, and later deep control when needed

Both personas should land on the same shared project model, but through different interaction channels.

### Mode 1 — Zero Effort

This is the new Gamma-style creation flow and should be a dedicated frontend channel.

The user fills one highly guided form or prompt scaffold and gets a live working output with minimal choices.

The system should automate as much as possible:

- brief completion
- preset resolution
- prompt optimization
- image generation
- quality pass
- publish

This is the best mode for:

- final customers
- first-time users
- resellers doing rapid first delivery

### Mode 2 — Curiosity

This mode stays in the design backlog for now.

It will eventually become the exploratory middle ground, but it should not slow down the current MVP roadmap.

### Mode 3 — Nerdy

This mode also stays in the design backlog for now.

It remains useful as a future semi-technical layer once real user behavior shows the right intermediate complexity band.

### Mode 4 — GodMode

This is the current workspace experience and should remain available without regressions.

It keeps:

- full chat-driven control
- inspect and focused editing flows
- snapshots and manual versioning
- direct publish and asset management
- the existing lovable-style advanced experience

This is the best mode for:

- advanced users
- operators
- internal editors
- resellers finishing and customizing delivery

### Mode switching rule

The mode selector should behave like a game difficulty switch in the sidebar:

- Zero Effort
- Curiosity
- Nerdy
- GodMode

Switching mode must change the UI shell and the amount of visible complexity, not the nature of the project itself. Any project created in Zero Effort must remain fully editable later in GodMode.

### MVP focus for the current cycle

The roadmap should explicitly prioritize:

1. Zero Effort as the aggregate pipeline UX
2. GodMode as the granular editing UX
3. shared backend services and orchestration between them
4. deferred design work for Curiosity and Nerdy until after live usage feedback

---

## 3. Core Architectural Principles

1. **Backend is the source of truth for orchestration**  
   The frontend should never be responsible for sequencing multi-step generation logic.

2. **Frontend is a client of the pipeline runtime**  
   UI sends input, displays progress, and edits configuration. It should not encode business workflow rules.

3. **Reuse existing use-cases first**  
   New orchestration should compose the existing application services rather than duplicate them.

4. **Every step should have a typed contract**  
   Each pipeline stage must declare input, output, errors, and side effects.

5. **Pipeline templates must be data-driven**  
   The future node editor should save JSON workflow definitions that resolve to the same runtime stage catalog.

6. **Keep sandbox rules intact**  
   All new endpoints and runs must preserve JWT user isolation plus project sandbox checks.

7. **No regressions to the current workspace**  
   The existing advanced UX must remain functional and first-class throughout the rollout.

8. **New UX branch, not forced migration**  
   The Gamma-style experience should be added as an optional interaction channel and should reuse the same backend services and project state.

---

## 4. What Already Exists and Should Be Reused

### 4.1 Existing reusable primitives

The following backend capabilities should be treated as stage candidates, not replaced:

- project context and preset resolution
- prompt optimization services
- image prompt optimization and context enrichment
- image generation with placeholder-first UX
- preview snapshot creation and activation
- generation workspace preparation
- export and publish services
- execution and prompt logs

### 4.2 Current frontend-heavy but valid areas

The current workspace UI is valid and should remain the GodMode path. Some of its orchestration-adjacent logic should still be extracted into backend services, but this should happen without weakening or replacing the existing UX.

High-value extraction targets:

- rules for when a new snapshot should be created automatically
- logic that waits for image-generation completion and then persists a new version
- prompt assembly decisions that belong to product policy rather than UI state
- publish/update logic coupled to version state
- artifact mutation and finalization rules after media application
- future end-to-end generation chaining

What should stay in the frontend:

- user input forms
- preview rendering
- visual inspect/selection tools
- node editor canvas interactions
- progress visualization and notifications

---

## 5. Recommended Backend Refactor Boundary

## 5.1 Keep in frontend

These concerns are presentation-only and should remain UI-side:

- form state and onboarding UX
- element selection in iframe preview
- draft local editor interactions
- temporary visual loading states
- drag/drop and node positioning in the future workflow canvas

## 5.2 Move to backend

These concerns should be centralized server-side:

- workflow sequencing
- stage enable/disable logic per preset
- prompt-task selection and model routing
- automatic asset enrichment policy
- final publish decision policy
- snapshot creation rules after successful stages
- smoke test orchestration and scoring
- branching or retry logic
- reusable template execution logic

---

## 6. UX Channel Strategy

The recommended implementation is not a single refactor of the existing workspace. It is a two-channel frontend architecture sharing one backend runtime.

### Channel A — Current workspace

This remains the advanced editing environment and corresponds to GodMode.

Recommended rule:

- keep the current route and interaction model stable
- continue evolving it for advanced users
- let it consume any new orchestration or pipeline data opportunistically

### Channel B — New guided creation shell

This is the Gamma-style experience.

Recommended characteristics:

- separate route group or dedicated shell in the web app
- highly guided question flow
- simpler panels and fewer simultaneous tools
- progress-driven generation instead of open-ended manual control
- ability to jump into the current workspace at any time

### Shared project identity

Both channels must operate on the same project object so that:

- a site created in Zero Effort is still a normal project
- assets and snapshots remain reusable in both directions
- publish state remains consistent
- switching UI mode never forks project data

### Sidebar difficulty toggle

Recommended UI behavior:

- global or per-project difficulty selector in the sidebar
- state labels: Zero Effort, Curiosity, Nerdy, GodMode
- switching difficulty changes shell complexity and available actions
- the underlying project, snapshots, and publish state stay unchanged

This produces a dynamic UX system without creating separate product silos.

---

## 7. Proposed Runtime Model

Introduce a generic but minimal orchestration model.

### 6.1 New domain concepts

#### PipelineTemplate

Describes a reusable workflow shape.

Suggested fields:

- id
- key
- label
- description
- version
- category
- triggerType
- nodeGraph or linearStages
- defaultInputs
- enabled
- createdBy
- updatedAt

#### PipelineRun

Represents one execution for one project.

Suggested fields:

- id
- templateId
- projectId
- userId
- status: queued | running | completed | failed | cancelled
- mode: zero_effort | guided | pro
- currentStage
- inputEnvelope
- outputSummary
- startedAt
- finishedAt
- errorSummary

#### PipelineStageRun

Stores stage-by-stage audit and resume data.

Suggested fields:

- id
- runId
- stageKey
- status
- startedAt
- finishedAt
- inputRef
- outputRef
- logs
- retryCount

### 6.2 Stage catalog

Define backend stage handlers such as:

- normalize_intake
- resolve_preset
- optimize_user_brief
- build_site_artifacts
- generate_missing_images
- finalize_snapshot
- quality_smoke_check
- publish_site
- attach_optional_services

Each stage should implement the same contract:

- validate input
- execute one responsibility
- return typed output
- emit logs
- avoid direct HTTP coupling

## 6.3 Autonomous end-to-end content loops

Yes — the new backend-first media flow can be used as part of a fully automated website generation loop without forcing intermediate manual edits.

Recommended chain:

1. normalize the intake brief
2. resolve preset, audience, tone, and CTA
3. generate page structure and copy
4. detect missing media slots or weak placeholders
5. call the image-suggestion stage for each slot
6. run image generation with the resolved suggestion in the focus-patch context
7. apply media patches and create the resulting snapshot
8. run a final quality pass and publish only if checks pass

Important rule: this should be implemented as a controlled backend loop, not as an unbounded recursive agent.

Required safeguards:

- max iteration count per section and per pipeline run
- confidence threshold before auto-accepting generated images
- fallback path when image generation fails or looks off-brand
- explicit publish gate after the final smoke-check
- full traceability of which prompt bundle generated which asset and snapshot

This makes the system viable for a true zero-effort mode while still preserving reproducibility and product safety.

---

## 7. New Endpoints — Minimum Viable Set

## 7.1 Phase 1 endpoints

These are enough to ship the first zero-effort flow.

### Execute the zero-effort pipeline

POST /v1/projects/:projectId/pipelines/zero-effort

Input should include:

- identity and business brief
- audience and goal
- CTA and contact data
- style/reference hints
- uploaded asset ids
- optional preferred slug
- optional toggles like autoPublish and smokeCheck

Response:

- runId
- status
- startedAt
- templateKey

### Get pipeline status

GET /v1/projects/:projectId/pipeline-runs/:runId

Returns:

- current stage
- stage summaries
- partial output
- final deployment when available

### Stream pipeline progress

GET /v1/projects/:projectId/pipeline-runs/:runId/events

SSE events:

- stage_started
- stage_progress
- stage_completed
- stage_failed
- run_completed

## 7.2 Phase 2 endpoints

Once the first orchestration is stable, add generic runtime endpoints.

- GET /v1/pipeline-templates
- POST /v1/pipeline-templates
- PATCH /v1/pipeline-templates/:id
- POST /v1/projects/:projectId/pipelines/:templateId/execute
- POST /v1/projects/:projectId/pipelines/validate

This creates the bridge to the future node editor.

---

## 8. Zero-Effort Intake Model

Define one normalized payload for all beginner-friendly generation flows.

Suggested sections:

### Identity

- person or brand name
- role
- activity sector
- short brand bio

### Goal

- desired output
- primary action to drive
- target audience
- tone and positioning

### Contact block

- phone
- email
- website
- address
- preferred CTA text
- publish slug preference

### Assets and references

- uploaded images
- logo files
- PDFs or docs
- reference URLs
- style references

### Optional automation toggles

- auto-generate images
- auto-publish
- run smoke check
- attach optional services later

This normalized structure should feed all future templates and workflows.

---

## 9. Detailed Implementation Phases

## Phase 0 — backend foundation plus safe parallel UX branch

### Objective

Build the orchestration layer first and prepare a new frontend channel without destabilizing the current workspace.

### Deliverables

- introduce a backend PipelineOrchestrator service in the application layer
- create a shared intake DTO for Zero Effort and future templates
- create typed stage result interfaces
- add a new optional guided frontend shell that talks to the orchestrator
- keep the current workspace untouched except for optional reuse of newly extracted backend services

### Key extraction targets from the current UI

1. image-generation completion polling and final snapshot save
2. rules for when to persist a new version after media mutation
3. publish/update decision logic
4. prompt optimization sequencing rules

### Expected benefit

The backend becomes the only place where workflow decisions live, while the current workspace remains stable and a new optional UX channel can evolve faster without regressions.

---

## Phase 1A — Zero Effort track

### Objective

Ship the first full beginner flow with maximum reuse of existing services.

### Template shape

A linear workflow is enough initially:

1. normalize_intake
2. resolve_preset
3. optimize_user_brief
4. generate initial site artifacts
5. generate missing or placeholder images
6. finalize snapshot
7. optionally run smoke check
8. publish

### Important note

This phase does not require a full node runtime. A linear orchestrator is sufficient as long as each step is isolated and typed.

### Reuse strategy

- reuse current prompt optimization services
- reuse current snapshot model
- reuse image generation flow
- reuse publish service
- reuse execution logs

### Deliverables

- one backend endpoint to run the whole flow
- one progress/status endpoint
- one dedicated beginner UI channel in the web app
- one mode switch that can later open the same project in GodMode

---

## Phase 1B — GodMode track

### Objective

Continue evolving the existing advanced workspace in parallel without regressions, while reusing any newly centralized backend services.

### Focus areas

- keep the current power-user UX stable and productive
- progressively consume new orchestration endpoints where useful
- preserve granular control over prompt, assets, snapshots, and publish state
- avoid duplicating backend logic that now belongs in shared pipeline services

### Deliverables

- reuse shared backend orchestration and logging services where helpful
- keep direct editing and manual review first-class
- ensure every project created from Zero Effort can be opened and refined in GodMode immediately

---

## Phase 2 — generic backend stage catalog

### Objective

Make the monolithic flow internally modular so it can power multiple preset pipelines.

### Changes

- refactor the linear orchestrator into stage handlers
- make stages independently testable
- add stage config per preset or per template
- persist stage outputs in PipelineStageRun records

### Benefit

At this point, multiple product templates can share the same runtime and differ only by configuration.

---

## Phase 3 — workflow template model and node editor support

### Objective

Allow superadmins or advanced users to assemble workflows visually.

### Recommended model

The node editor should save a JSON graph such as:

- nodes with stageKey and config
- edges with execution order
- optional conditional branches
- max iteration policies

The backend should compile this graph into an executable plan. The frontend must not execute the graph directly.

### Strict rule

React Flow should be an editor for workflow definitions, not the workflow engine.

---

## Phase 4 — quality loops and accessory services

### Objective

Add controlled loops and optional integrations after the main path is stable.

Examples:

- smoke check with Playwright and report persistence
- retry on failed image or publish stages
- attach Telegram or bot widgets from parameterized services
- future document chat or RAG add-ons as optional post-publish stages

This is the correct place to add the user’s point 5 without blocking the core architecture.

---

## 10. Frontend Agnosticism Plan

The target frontend contract should be simple.

The UI should only need to do the following:

1. collect input
2. call execute
3. subscribe to progress
4. render results
5. optionally open advanced editors

The frontend should not need to know:

- which prompt task runs first
- whether images are generated before or after a snapshot
- which provider/model was selected by policy
- what fallback path the publish stage used
- how retries or loops are resolved

This backend-first contract is what will make future web, admin, and node-editor experiences consistent.

---

## 11. Specific Logic Recommended for Extraction from the Current Workspace UI

The workspace page currently contains orchestration-adjacent logic that is useful but should be progressively moved server-side.

### Extract first

- media apply finalization policy
- auto-versioning policy after AI mutation
- polling and persistence of generated image replacement
- prompt-to-stage chaining decisions
- publish stale-state handling as part of the publish domain service

### Keep for now, then reduce later

- element selection capture
- local preview rendering and visual feedback
- manual save controls

### Do not move

- drag state
- UI modals and interactions
- selection overlays
- client-only editor affordances

---

## 12. Suggested Folder Additions

The new backend orchestration should fit the existing clean architecture layout.

Suggested additions:

- application/use-cases/ExecutePipeline.ts
- application/pipeline/stages/
- application/pipeline/runtime/
- domain/entities/PipelineRun.ts
- domain/entities/PipelineTemplate.ts
- domain/repositories/PipelineRunRepository.ts
- infra/repositories/MongoPipelineRunRepository.ts
- presentation/http/routes/pipelineRoutes.ts
- packages/contracts/src/pipeline.ts

This keeps orchestration within the current architecture rather than introducing a separate subsystem.

---

## 13. Concrete File-by-File Rollout Map

A practical first implementation should touch the codebase in this order.

### Backend contracts and entities

Create:

- packages/contracts/src/pipeline.ts
- domain/entities/PipelineRun.ts
- domain/entities/PipelineTemplate.ts
- domain/repositories/PipelineRunRepository.ts
- domain/repositories/PipelineTemplateRepository.ts
- infra/repositories/MongoPipelineRunRepository.ts
- infra/repositories/MongoPipelineTemplateRepository.ts

### Backend runtime and stages

Create:

- application/pipeline/runtime/PipelineContext.ts
- application/pipeline/runtime/PipelineStage.ts
- application/pipeline/runtime/PipelineOrchestrator.ts
- application/pipeline/stages/NormalizeIntakeStage.ts
- application/pipeline/stages/ResolvePresetStage.ts
- application/pipeline/stages/OptimizeBriefStage.ts
- application/pipeline/stages/GenerateImagesStage.ts
- application/pipeline/stages/FinalizeSnapshotStage.ts
- application/pipeline/stages/PublishStage.ts

### Backend entrypoints

Create:

- application/use-cases/ExecuteZeroEffortPipeline.ts
- presentation/http/routes/pipelineRoutes.ts

Update:

- app.ts to register the new routes
- execution logging so every stage emits consistent run events

### Parallel frontend channel

Create:

- web/lib/api/pipelines.ts
- a new guided route group or shell for the Gamma-style UX
- a beginner-oriented intake component or page
- a difficulty selector component for Zero Effort, Curiosity, Nerdy, and GodMode
- a pipeline progress panel that only consumes the backend run state

Refactor only where reusable backend extraction is clearly beneficial:

- extract orchestration sequencing from the workspace page over time
- keep the workspace as the advanced review and editing surface
- do not require a redesign or migration of the current UX

### Extraction order from current UI

1. move image-finalization persistence rules to the backend
2. move auto snapshot creation policy to the backend
3. move publish sequencing to the backend pipeline service
4. reduce the workspace page to interaction and display logic only

---

## 14. Minimum Effort Delivery Recommendation

If the goal is to move fast without overbuilding, the best path is:

### Sprint 1 — shared backend foundation

- create normalized intake payload
- create ExecutePipeline use-case
- wire one Zero Effort endpoint
- persist run logs and progress
- scaffold the new optional guided frontend channel
- expose shared services that GodMode can reuse without regressions

### Sprint 2 — Zero Effort MVP plus GodMode continuity

- add the Zero Effort guided form and progress flow
- add the difficulty toggle in the sidebar or shell
- allow switching from the new channel into GodMode for the same project
- add auto-publish option and optional smoke test report
- harden the existing GodMode workspace against any shared-backend changes

### Sprint 3 — post-MVP modularization

- convert the internal steps to a generic stage catalog
- introduce pipeline templates
- prepare React Flow integration for superadmin or advanced workflow authoring
- keep Curiosity and Nerdy intentionally paused until real usage data clarifies the right intermediate UX

This sequence gives product value early while staying fully compatible with future modular workflows and a two-track MVP.

---

## 15. Risks and Anti-Patterns to Avoid

1. **Do not keep orchestration in the workspace page**  
   That would make the node editor and future clients hard to support.

2. **Do not make React Flow the executor**  
   The executor must remain in the backend.

3. **Do not duplicate use-cases behind new endpoints**  
   New orchestration must compose the existing services.

4. **Do not couple publish, image generation, and prompt optimization directly to UI state**  
   Treat them as backend stages.

5. **Do not introduce parallel prompt systems**  
   Reuse the existing governed prompt-task platform.

---

## 16. Success Criteria

The first phase is successful when:

- a new end user can submit one guided brief and receive a published website
- a reseller can use the same flow for rapid delivery and then hand the same project into GodMode refinement
- the entire flow is triggered from one backend execution endpoint
- progress and failures are visible through persisted run state
- the same orchestration can later be called from dashboard, workspace, or admin UIs
- the frontend does not need custom sequencing logic for each generation mode
- the system is ready to map a future node editor onto the same backend runtime

---

## 17. Final Recommendation

The platform is already close enough to deliver a strong zero-effort workflow with limited new code if the next implementation step is focused on orchestration and boundary cleanup.

The recommended order is:

1. shared backend orchestrator first
2. Zero Effort frontend channel second
3. GodMode reuse and hardening in parallel
4. pipeline run persistence and template abstraction next
5. Curiosity and Nerdy later, only when validated by usage
6. node editor last

This maximizes reuse, minimizes waste, protects the current advanced experience, and keeps the architecture aligned with a future modular workflow engine.
