# Andy Code Cat — Prompting Service Platform Spec

> Status: Proposed  
> Date: 2026-04-15  
> Scope: reusable internal service layer for prompt optimization, summarization, classification, and prompt-driven helper tasks  
> Audience: maintainers, contributors, backend/frontend agents, superadmin operators

---

## 1. Why this document exists

The current platform already has a strong system-prompt pipeline:

- Layer A — base architectural constraints
- Layer B — preset-specific output module
- Layer C — style context block
- Layer D — per-project pre-prompt template
- Layer E — governance prompt injection

This works well for output structure and technical consistency.

### The new product need

When the user writes a short or weak brief, generation quality improves significantly if the raw user text is first rewritten into a richer, more content-oriented prompt.

Example:

- Raw input: “landing page for a pet care startup”
- Optimized input: a stronger, more explicit brief that clarifies audience, tone, value proposition, content priorities, CTA direction, media cues, and brand atmosphere

### Key principle

This new layer must optimize the user intent and content direction only.
It must not leak technical output rules such as:

- single HTML document
- embedded JS
- CSS architecture
- code formatting rules
- JSON response format

Those concerns already belong to the existing system-prompt pipeline and must remain there.

---

## Direction Update — Template-first governance

The primary product target is now the governance of **project-type template models**.

The prompting platform must therefore support two connected layers:

1. template-model governance for project types such as landing, website, keynote, games, VR, print formats, and similar output families
2. optimized preprompting that reads the active template model and injects its prompt module into the existing generation flow

The advanced LLM runtime catalog is intentionally de-prioritized and kept as a secondary technical surface.

## 2. Product goal

Introduce an on-demand action in the workspace chat input:

- Button: “Optimize prompt”
- Behavior: take the current project context + raw user prompt + optional assets
- Result: replace the input box content with a higher-quality prompt before the user sends it

This should become the first concrete use case of a broader internal Prompting Service Platform.

A second key use case is **AI-assisted template authoring for superadmin**:

- the superadmin defines a new project-type template with a few instructions
- the optimizer enriches and structures the brief, style direction, and preprompt module
- the result can be saved as a new editable template model in the admin catalog

Status update: this direction is now implemented in a low-impact way through a shared admin workbench and reusable prompt-task settings, without introducing a second prompting stack.

For the next planned extension focused on project assets, link references, document summaries, and screenshot-assisted vision analysis, see `docs/specs/ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md`.

That platform should later support additional prompt-driven tasks with the same infrastructure:

- optimize user prompt
- summarize project brief
- classify intent
- classify project type
- extract content signals from uploaded material
- vision-based asset description
- governance review prompts
- content QA prompts

---

## 3. Decision lock — approved product choices

The following product decisions are now confirmed and should be treated as implementation defaults.

### 3.1 Project type source of truth

The optimizer must read the active project's current preset and configuration from the existing preset catalog already used by the platform.

Implementation rule:

- use the active project preset as the canonical project type signal
- do not invent a second project-type catalog unless the existing preset system is explicitly replaced
- if a project has no preset, fall back to a neutral generic mode

### 3.2 Rewrite intensity policy

The optimizer must:

- preserve the original user intent
- preserve explicit preferences already stated by the user
- enrich and extend the brief coherently so the user gets a much stronger output with minimal effort
- leave room for later manual edits and focused patch refinement

### 3.3 Tone policy

The optimizer must generate a tone that is:

- modern
- fresh
- vivid
- professional
- coherent with the project type
- coherent with the business domain described by the user
- coherent with the user's existing script and preferences

### 3.4 Superadmin governance policy

The superadmin must be able to:

- choose the provider for this preprompting layer
- choose the model for this layer
- edit the layer instruction directly from the governance dashboard
- monitor optimization cost from MongoDB-backed logs

### 3.5 Fallback provider/model

Default fallback for this feature:

- provider: SiliconFlow
- model: MiniMaxAI/MiniMax-M2.5

This fallback should remain the safe baseline until a better cost/quality default is validated.

## 4. Required information before implementation

The following information is needed to implement the feature well without product ambiguity.

### 3.1 Business and UX inputs

1. Supported project classes
   - landing page
   - mini-site
   - portfolio
   - event page
   - restaurant site
   - startup product page
   - other future presets

2. Desired optimization depth
   - light rewrite
   - standard enrichment
   - aggressive strategic rewrite

3. Tone policy
   - should the optimizer preserve the user tone exactly?
   - or should it infer and improve tone from project/domain context?

4. Allowed inference level
   - safe inference only from explicit project context
   - moderate inference from domain keywords
   - strong creative expansion

5. Undo expectations
   - one-click restore original prompt
   - compare original vs optimized
   - version history per optimization

### 3.2 Admin and governance inputs

1. Which tasks must be configurable by superadmin?
2. Should each task choose provider and model independently?
3. Are product presets allowed to override the global default task config?
4. Must logs be exportable for cost analysis and prompt tuning?
5. Should task execution be feature-flagged by environment and by product?

---

## 4. Non-regression integration strategy

This feature must be added as an additive layer, not as a rewrite of the current LLM pipeline.

### 4.1 Safe insertion point

The optimized flow should sit before the current generation request:

1. user types raw prompt
2. user clicks “Optimize prompt”
3. Prompting Service returns optimized prompt text
4. user reviews or edits the text
5. existing chat-preview and stream flow continue unchanged

### 4.2 What must remain untouched

- current system prompt composition logic
- current project prompt config behavior
- focused-edit prompt behavior
- existing conversation persistence rules
- existing publish/export paths

### 4.3 Failure behavior

If optimization fails for any reason:

- no mutation of the generation pipeline
- raw prompt remains available
- the user can still send the original text immediately
- the event is logged as failed in the dedicated optimization log collection

---

## 5. Current building blocks already available

The repository already contains solid primitives that this feature should reuse:

- `apps/api/src/application/llm/systemPromptComposer.ts`
- `apps/api/src/application/llm/llmMessageBuilder.ts`
- `apps/api/src/domain/entities/LlmPromptConfig.ts`
- `apps/api/src/domain/entities/PlatformConfig.ts`
- `apps/api/src/presentation/http/routes/llmRoutes.ts`
- `apps/web/app/admin/governance/page.tsx`

This means the project does not need a second prompt system. It needs a reusable service layer that sits next to the existing one.

---

## 6. Proposed architecture

## 6.1 New internal module family

```text
apps/api/src/
  domain/
    entities/
      PromptTaskConfig.ts
      PromptExecutionLog.ts
    repositories/
      PromptTaskConfigRepository.ts
      PromptExecutionLogRepository.ts

  application/
    prompting/
      PromptingTaskRegistry.ts
      PromptingTemplateRenderer.ts
      PromptingModelResolver.ts
      PromptingExecutionService.ts
      PromptingAuditService.ts
      tasks/
        optimizeUserPrompt.ts
        summarizeProject.ts
        classifyPromptIntent.ts
        describeAssetVision.ts

  infra/
    repositories/
      MongoPromptTaskConfigRepository.ts
      MongoPromptExecutionLogRepository.ts

  presentation/http/routes/
      promptingRoutes.ts
```

### 6.2 Responsibility split

- domain: task config and run log contracts
- application: task orchestration, prompt rendering, provider/model resolution, audit write
- infra: MongoDB persistence
- presentation: thin HTTP route adapters only

This respects the repository clean-architecture contract.

---

## 7. Prompting Service Platform model

## 7.1 Generic task configuration

```ts
export type PromptTaskKey =
  | "optimize_user_prompt"
  | "summarize_project"
  | "classify_intent"
  | "describe_asset_vision"
  | "review_content_quality";

export interface PromptTaskConfig {
  id: string;
  taskKey: PromptTaskKey;
  enabled: boolean;
  scope: "global" | "product";
  productKey?: string;
  provider: string;
  model: string;
  temperature: number;
  maxCompletionTokens: number;
  systemTemplate: string;
  userTemplate: string;
  outputMode: "text" | "json";
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Why this matters

Instead of hardcoding each helper feature separately, every prompt-driven tool can be configured the same way:

- choose task
- choose provider/model
- choose template
- choose limits
- enable/disable

This makes the system modular and future-proof.

---

## 8. Dedicated logging collection

The user explicitly requested that optimization flows are not stored as normal project conversations.
That is the correct design choice.

### 8.1 Proposed collection

Collection name:

- `prompt_execution_logs`

### 8.2 Proposed document shape

```ts
export interface PromptExecutionLog {
  id: string;
  taskKey: string;
  projectId?: string;
  conversationId?: string;
  sessionId?: string;
  userId: string;
  provider: string;
  model: string;
  inputPrompt: string;
  optimizedPrompt?: string;
  renderedSystemPrompt?: string;
  renderedUserPrompt?: string;
  contextMeta: {
    projectPresetId?: string;
    detectedDomain?: string[];
    assetIds?: string[];
    usedMoodboard: boolean;
    usedUserProfile: boolean;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costEstimate?: {
    currency: "EUR";
    amount: number;
    source?: "provider" | "flat-rate";
  };
  status: "succeeded" | "failed";
  errorMessage?: string;
  durationMs: number;
  createdAt: Date;
}
```

### 8.3 Benefits

- separate analytics from chat history
- cost transparency by task type
- prompt quality analysis over time
- safer experimentation with templates and models
- future reporting in superadmin dashboards

---

## 9. Superadmin modular governance extension

The current governance view already manages prompt templates for generation, focused edit, and review.
That should be extended rather than replaced.

## 9.1 Proposed additive config shape

```ts
interface ProductPromptTaskSettings {
  [taskKey: string]: {
    enabled: boolean;
    provider: string;
    model: string;
    temperature: number;
    maxCompletionTokens: number;
    systemTemplate: string;
    userTemplate: string;
  };
}
```

Then add it as an additive field under product governance:

```ts
interface ProductGovernanceConfig {
  promptTemplates: ProductPromptTemplates;
  promptTaskSettings?: ProductPromptTaskSettings;
  injections: ProductInjectionConfig;
  nginx: ProductNginxConfig;
}
```

### 9.2 Why additive is important

This preserves backward compatibility with the current governance storage and UI.
Existing keys keep working.
The new module becomes an optional extension.

### 9.3 Admin UX recommendation

Add a new superadmin governance section:

- Prompting Tasks
  - Optimize user prompt
  - Summarize project
  - Classify intent
  - Vision describe asset
  - Review content quality

For each task:

- enabled toggle
- provider selector
- model selector
- temperature
- max tokens
- system template editor
- user template editor
- test-run button

---

## 10. On-demand user prompt optimization flow

## 10.1 Frontend

Workspace chat input gains:

- Optimize button
- loading state
- restore original action
- optional compare drawer

### Frontend API call

```http
POST /v1/projects/:projectId/llm/optimize-prompt
```

### Example request

```json
{
  "rawPrompt": "landing page for a pet care startup with warm colors",
  "conversationId": "optional",
  "sessionId": "optional",
  "assetIds": ["optional"]
}
```

### Example response

```json
{
  "optimizedPrompt": "Create a landing page for a modern pet care startup...",
  "taskKey": "optimize_user_prompt",
  "provider": "openrouter",
  "model": "openai/gpt-4.1-mini",
  "usage": {
    "promptTokens": 820,
    "completionTokens": 260,
    "totalTokens": 1080
  },
  "costEstimate": {
    "currency": "EUR",
    "amount": 0.0042
  }
}
```

## 10.2 Backend resolution logic

Input sources for optimization should be combined in this order:

1. current project preset and project type
2. project moodboard and brief
3. user style profile
4. prompt raw text
5. optional asset-derived content signals

### Important rule

The service must enrich:

- business objective
- target audience
- visual direction
- emotional tone
- CTA suggestions
- content priorities
- asset usage hints

The service must not inject:

- HTML structure constraints
- code implementation constraints
- output serialization rules

---

## 11. Seed strategy for first installation

The platform should not depend on pre-populated MongoDB data for boot.

### 11.1 Seed source of truth

Store default task templates in TypeScript seed modules:

```text
apps/api/src/scripts/seeds/
  promptTaskConfigs.seed.ts
  promptTaskTemplates.seed.ts
```

### 11.2 Seed behavior

On first startup or explicit seed run:

- if the collection is empty, insert default prompt task configs
- if task exists, keep user-edited version
- if version is older and marked as platform-managed, allow migration

### 11.3 Minimum default tasks

- optimize_user_prompt
- summarize_project
- classify_intent
- describe_asset_vision

This ensures the system works from day one even without manual Mongo initialization.

---

## 12. Rollout plan

## Phase 1 — Safe MVP

Goal: ship the optimize button without changing the core generation pipeline.

Deliverables:

- new endpoint for on-demand prompt optimization
- dedicated task config seed
- dedicated log collection
- frontend optimize button + restore original
- default global config only

## Phase 2 — Superadmin control

Deliverables:

- modular task configuration in admin governance
- provider/model selector per task
- template editor per task
- enable/disable by product key

## Phase 3 — Shared Prompting Platform

Deliverables:

- task registry abstraction
- summary/classification/vision tasks reusing the same engine
- analytics dashboard for costs and outcomes

## Phase 4 — Optimization intelligence

Deliverables:

- A/B template testing
- score feedback loop
- prompt quality ranking
- recommended model routing by task type

---

## 12.1 Deferred future extension — async background generation orchestration

This capability is intentionally **documented but deferred**.
It should not be added in the current delivery cycle, because the UX value is high but the regression surface is also high.

### Target UX when revisited

- user starts a long prompt/artifact generation flow
- API returns quickly with a durable job identifier and running state
- the global process popup can show progress events similar to ZIP/publish
- the dashboard project card can show a running spinner/badge
- the user can leave the project and later re-enter without losing the execution context
- the workspace can rebuild progress from persisted task state, logs, and snapshots

### Recommended architecture direction

When this is revisited, the source of truth should move from the open page stream to a **durable project job state**:

1. enqueue a project-scoped generation job instead of relying on the active tab alone
2. persist status transitions such as `queued`, `running`, `completed`, `failed`, `cancelled`
3. keep chat/task state and snapshot writes ordered and idempotent
4. enforce at most one mutable generation run per project unless explicit locking rules are introduced
5. use SSE/websocket updates only as a read model for the UI, not as the sole execution owner

### Expected impact and main risks

- **medium/high backend impact** on orchestration and persistence
- **high concurrency risk** if multiple runs target the same project/conversation
- risk of **stale dashboard state** or stuck spinners when a worker fails badly
- more complex **cancel/resume** semantics than the current live stream
- possible **double counting** of tokens/cost if retries are not idempotent
- worker execution must preserve the same auth/sandbox guarantees as the request path

### Current decision

- keep the current inline generation flow as the operational default
- do not schedule this for immediate implementation
- track it as a future roadmap item after observability and publishing hardening

---

## 13. Regression prevention checklist

The following rules are mandatory during implementation:

1. No breaking change to existing chat-preview routes
2. No breaking change to current project prompt config shape
3. No storage of optimizer runs inside normal conversation messages
4. Feature is optional and fully bypassable
5. Failure of the optimizer must never block generation
6. Model selection must always have a default fallback
7. Audit logging must never crash the main user flow

---

## 14. Test plan

### Backend tests

- optimize endpoint validates input contract
- task config fallback works when DB is empty
- optimization logs are written on success and failure
- prompt optimization never mutates conversation history directly
- provider/model resolution respects task config and fallback

### Frontend tests

- optimize button appears only when prompt is meaningful
- optimized text replaces textarea content
- restore original works
- normal send still works without optimization
- error state preserves the raw prompt

### Integration tests

- project with preset + moodboard yields context-aware prompt enrichment
- project with no moodboard still works from raw prompt only
- admin can update task template without affecting existing generation system behavior

---

## 15. Public GitHub collaboration plan

Recommended issue breakdown:

1. docs: add Prompting Service Platform RFC
2. api: add prompt task config entities and repositories
3. api: add optimize-prompt endpoint and audit log collection
4. web: add optimize prompt UX in workspace input
5. admin: add task-based prompting governance editor
6. tests: add regression coverage for optimizer isolation

This keeps pull requests small, reviewable, and contributor-friendly.

---

## 16. Recommended decision

Proceed with an additive MVP that delivers the on-demand user prompt optimization first, but design it from day one as a generic Prompting Service Platform.

That gives the product:

- immediate quality improvements in content generation
- no regressions in the current architectural prompting stack
- reusable infrastructure for future prompt-driven features
- observability, cost tracking, and superadmin governance from the start
