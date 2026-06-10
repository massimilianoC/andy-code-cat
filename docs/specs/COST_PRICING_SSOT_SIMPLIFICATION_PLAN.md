# Cost Pricing SSOT Simplification Plan

**Status:** Implementation plan  
**Date:** 2026-06-09  
**Audience:** coding agents working on cost, pricing, analytics, project totals, and SuperAdmin cost policy  
**Related specs:**
- [COST_TRANSACTION_LEDGER_SPEC.md](COST_TRANSACTION_LEDGER_SPEC.md)
- [COST_ANALYTICS_DASHBOARDS_SPEC.md](COST_ANALYTICS_DASHBOARDS_SPEC.md)
- [SUPER_ADMIN_SPEC.md](SUPER_ADMIN_SPEC.md)

---

## 1. Purpose

This plan standardizes pricing and cost tracking with low development overhead.

The goal is not to introduce a new billing subsystem. The goal is to simplify the current implementation by making the existing cost ledger the single source of truth and by reusing the existing `CostTransactionService` as the central cost computation and recording path.

After this work:

- Every billable action records exactly one `cost_transactions` row.
- Every project/user/admin total shown in the UX is derived from `cost_transactions`.
- SuperAdmin markup and rate settings in `PlatformConfig.costRates` are the runtime pricing policy.
- Existing `prompt_execution_logs`, `project_assets.generationMetadata.cost`, and `conversation.totalCost` remain useful operational metadata, but they stop being canonical cost sources.

---

## 2. Current Problem

The current codebase has multiple cost-tracking contexts:

| Context | Current role | Problem |
| --- | --- | --- |
| `cost_transactions` | Ledger used by cost popups and admin cost endpoints | Correct direction, but not yet used everywhere |
| `prompt_execution_logs.costEstimate.amount` | LLM analytics and project-list totals | Parallel accounting path |
| `project_assets.generationMetadata.cost.amount` | Image analytics and project-list totals | Parallel accounting path |
| `conversation.totalCost` | Running conversation total | Denormalized counter using message metadata |
| `estimateCost()` | Request-time cost estimate | Uses env-only policy and can diverge from ledger policy |
| `CostTransactionService` | Ledger write and breakdown computation | Should become the only canonical computation path |

The visible symptom is inconsistent totals across popups, project cards, AI analytics, and admin dashboards.

---

## 3. Non-Goals

Agents must keep this change intentionally small.

Do not:

- Create a separate billing service.
- Create a new pricing collection.
- Replace `cost_transactions`.
- Rewrite all analytics dashboards from scratch.
- Remove existing cost metadata fields immediately.
- Introduce credits, payment collection, invoices, or account balance enforcement.
- Change Docker stack behavior or run compose commands unless explicitly needed for verification.

This is a consistency and simplification pass, not a monetization rebuild.

---

## 4. Target Architecture

### 4.1 Single Source Of Truth

`cost_transactions` is the only canonical source for recorded costs.

Canonical definitions:

| Metric | Definition |
| --- | --- |
| Project total | Sum of settled `cost_transactions.totalEur` for `projectId` |
| User total | Sum of settled `cost_transactions.totalEur` for `userId` |
| Platform total | Sum of settled `cost_transactions.totalEur` |
| Provider cost | Sum of `providerCostEur` |
| Infra cost | Sum of `infraCostEur` |
| Markup | Sum of `platformMarkupEur` |
| Resource breakdown | Grouped by `resourceType` from the ledger |

### 4.2 Central Runtime Engine

The existing `CostTransactionService` becomes the central runtime engine.

It owns:

- rate resolution from `PlatformConfig.costRates`
- fallback to env defaults when DB policy is absent
- per-resource-type overrides
- provider-cost conversion
- flat-rate fallback from units
- infra and markup calculation
- immutable `ratesSnapshot`
- ledger write

### 4.3 Supporting Metadata

The following fields may remain, but they are not authoritative:

- `PromptExecutionLog.costEstimate`
- `ProjectAsset.generationMetadata.cost`
- `Conversation.totalCost`
- frontend `costEstimate` shown during streaming/generation

Use these fields only for local traceability, recent request context, or temporary display before the ledger response is available.

---

## 5. Pricing Policy Rules

### 5.1 Runtime Policy Source

Pricing policy priority:

1. `PlatformConfig.costRates`
2. env defaults from `apps/api/src/config.ts`

SuperAdmin changes are written through:

- `PATCH /v1/admin/cost/rates`

The endpoint already exists and must remain the only write path for live cost policy.

### 5.2 Calculation Rule

Every transaction should follow the same formula:

```text
baseCostEur =
  providerCostUsd * usdToEurRate
  OR flat-rate fallback from consumed units

infraCostEur = baseCostEur * infraCostPct
platformMarkupEur = (baseCostEur + infraCostEur) * platformMarkupPct + fixedFeeEur
totalEur = baseCostEur + infraCostEur + platformMarkupEur
```

Where:

- `providerCostUsd` is used when a provider reports real cost or when a provider-specific price table derives USD cost.
- flat-rate fallback uses `totalTokens`, `imageCount`, `videoSeconds`, and later `computeMs` or `storageBytes`.
- per-type overrides may replace global `markupPct`, `infraPct`, `fixedFeeEur`, `tokenRateEurPer1k`, or `assetRateEur`.

### 5.3 `precomputedTotalEur`

`precomputedTotalEur` is the main source of ambiguity today.

Agents should treat it as legacy compatibility only:

- Prefer passing `providerCostUsd` and `units`.
- Let `CostTransactionService` compute `totalEur`.
- If `precomputedTotalEur` must remain temporarily, fix its branch so `providerCostEur + infraCostEur + platformMarkupEur === totalEur`.
- Do not add new call sites that depend only on `precomputedTotalEur`.

---

## 6. Implementation Plan

### Phase 1 - Fix The Existing Ledger Engine

Files:

- `apps/api/src/application/cost/CostTransactionService.ts`
- focused tests under `apps/api/src/application/cost/__tests__/` or the nearest existing test pattern

Tasks:

1. Make `computeBreakdown()` internally consistent for all branches.
2. Ensure `totalEur` always equals the sum of the persisted components.
3. Prefer unit/provider-based calculation when inputs are available.
4. Preserve existing public API shape to minimize callers changed in this phase.
5. Add tests for:
   - provider-cost transaction
   - flat token fallback
   - per-type markup override
   - fixed fee
   - legacy `precomputedTotalEur` branch

Acceptance:

- Every returned/persisted transaction satisfies:

```text
round6(providerCostEur + infraCostEur + platformMarkupEur) === totalEur
```

### Phase 2 - Standardize New Ledger Call Inputs

Files to review and adjust:

- `apps/api/src/presentation/http/routes/llmRoutes.ts`
- `apps/api/src/presentation/http/routes/conversationRoutes.ts`
- `apps/api/src/application/use-cases/OptimizeUserPrompt.ts`
- `apps/api/src/application/use-cases/DraftProjectTemplate.ts`
- `apps/api/src/application/use-cases/VibeClassify.ts`
- `apps/api/src/application/use-cases/VibePrefill.ts`
- `apps/api/src/application/use-cases/GenerateProjectImage.ts`
- `apps/api/src/application/prompting/OptimizeImagePrompt.ts`
- `apps/api/src/application/prompting/SuggestProjectImageIdea.ts`
- `apps/api/src/application/documents/enrichment/AssetEnrichmentPipeline.ts`

Tasks:

1. Ensure each billable action calls `CostTransactionService.instance.record()`.
2. Pass `providerCostUsd` where available or derivable.
3. Pass consumed units consistently:
   - LLM: `promptTokens`, `completionTokens`, `totalTokens`
   - image: `imageCount`
   - video: `videoSeconds`
   - compute/storage later when those resources are recorded
4. Keep `sourceRef` populated enough to trace the origin.
5. Avoid new logic that manually computes final recorded totals.

Acceptance:

- No new cost-producing path writes only to `prompt_execution_logs`, `project_assets`, or conversation metadata without a ledger transaction.

### Phase 3 - Make Project Totals Read From Ledger

Files:

- `apps/api/src/presentation/http/routes/projectRoutes.ts`
- `apps/api/src/infra/repositories/MongoCostTransactionRepository.ts`
- `apps/api/src/domain/repositories/ICostTransactionRepository.ts`

Tasks:

1. Add or reuse a repository method that returns `projectId -> totalEur` for a user.
2. Change `GET /v1/projects` so `totalCostEur` is derived from `cost_transactions`, not from `prompt_execution_logs` plus `project_assets`.
3. Keep deployment URL and thumbnail enrichment unchanged.

Acceptance:

- Project cards and workspace project cost badges match `GET /v1/projects/:projectId/cost`.

### Phase 4 - Make AI Analytics Cost Read From Ledger

Files:

- `apps/api/src/application/use-cases/GetProjectAiAnalytics.ts`
- `apps/api/src/infra/repositories/MongoCostTransactionRepository.ts`
- `apps/api/src/domain/repositories/ICostTransactionRepository.ts`

Tasks:

1. Use ledger aggregations for:
   - `totals.totalCost`
   - `totals.llmCost`
   - `totals.imageCost`
   - top model/resource cost
2. Continue using `prompt_execution_logs` and `project_assets` only for:
   - prompt preview
   - status
   - media resolution summary
   - createdAt
   - provider/model metadata when the ledger row does not carry enough context
3. Prefer ledger `resourceType` for kind classification:
   - `llm.*` -> `llm`
   - `image.*` -> `image`

Acceptance:

- AI usage total cost equals the ledger cost for the same project/user scope.

### Phase 5 - Clarify Estimate vs Recorded Cost In UX

Files:

- `apps/web/lib/api/llm.ts`
- `apps/web/lib/api/conversations.ts`
- `apps/web/components/AiUsageSummaryPanel.tsx`
- `apps/web/components/cost/CostDetailDrawer.tsx`
- any workspace component that shows `costEstimate`

Tasks:

1. Use ledger-backed endpoints for project/user/admin cost panels.
2. Label live generation values as estimates where they are not ledger-backed.
3. Keep cost popup copy focused on recorded ledger transactions.
4. Do not add new frontend-side cost math except formatting.

Acceptance:

- Recorded-cost UI reads from cost endpoints.
- Streaming/request-time UX can show estimates, but not as canonical project totals.

### Phase 6 - Documentation And Guardrails

Files:

- `docs/INDEX.md`
- `docs/specs/COST_TRANSACTION_LEDGER_SPEC.md`
- `docs/specs/COST_ANALYTICS_DASHBOARDS_SPEC.md`
- `docs/runbooks/TESTABLE_STEPS.md` if verification steps change
- `docs/agents/CODE_AGENT_INDEX.md` if agent navigation should mention the SSOT rule

Tasks:

1. Add the SSOT rule to relevant cost specs.
2. Mark env cost variables as bootstrap defaults, not live source of truth when `PlatformConfig.costRates` exists.
3. Add a short verification path for project total consistency.

Acceptance:

- Docs state that recorded costs come only from `cost_transactions`.
- No doc tells agents to use prompt logs or asset metadata as canonical cost totals.

---

## 7. Agent Rules

Agents implementing cost-related work must follow these rules:

1. Do not add a new cost total field as a source of truth.
2. Do not aggregate recorded cost from `prompt_execution_logs` or `project_assets` when a ledger endpoint/repository can answer it.
3. Do not compute markup in route handlers or frontend components.
4. Do not bypass `CostTransactionService` for billable actions.
5. Do not hardcode pricing or markup in UI.
6. Do not update `PlatformConfig.costRates` outside SuperAdmin-protected routes.
7. Preserve sandboxing:
   - user-facing project cost reads must verify `jwt.sub` and `x-project-id`
   - mutable cost-policy writes require `superadmin`
8. When adding a new billable action, add or reuse a `ResourceType`.
9. Every transaction must carry enough `sourceRef` or `meta` to trace its origin.
10. If a change affects totals, update tests or add a focused smoke check.

---

## 8. Minimal Acceptance Matrix

| Surface | Expected source | Required check |
| --- | --- | --- |
| Project card `totalCostEur` | `cost_transactions` | Equals project cost endpoint summary |
| Workspace header cost badge | `cost_transactions` | Opens popup with same total |
| Cost popup | `cost_transactions` | Breakdown sums to total |
| User cost dashboard | `cost_transactions` | User total is ledger sum |
| Admin cost dashboard | `cost_transactions` | Platform total is ledger sum |
| AI usage panel cost | `cost_transactions` | Does not sum prompt logs/assets as canonical cost |
| Live generation display | shared estimate logic | Clearly non-canonical until recorded |

---

## 9. Suggested Verification Commands

Run checks according to the repo's available scripts. Prefer focused checks first.

Suggested local verification:

```powershell
npm run typecheck -w apps/api
npm run typecheck -w apps/web
npm test -w apps/api -- CostTransactionService
```

If scripts differ, inspect `package.json` and run the closest available type/test commands.

For Docker verification, follow `AGENTS.md` first:

1. Run `docker ps --format '{{.Names}}'`.
2. Identify whether the dev or deploy stack is running.
3. Use `--no-deps` for single-service API restarts.
4. Never run `docker compose down` without explicit operator confirmation.

---

## 10. Recommended Delivery Order

Use small PRs or commits:

1. `fix(cost): make ledger breakdown internally consistent`
2. `refactor(cost): derive project totals from cost ledger`
3. `refactor(cost): derive ai usage costs from cost ledger`
4. `refactor(cost): standardize cost transaction inputs`
5. `docs(cost): document pricing ssot simplification`

Each change should be independently testable.

---

## 10.1 Implementation Progress Log

### 2026-06-09

Started work with two low-risk backend changes:

1. `CostTransactionService` was tightened so persisted component fields stay internally consistent with `totalEur`, including the legacy `precomputedTotalEur` path.
2. `GET /v1/projects` was redirected to read `totalCostEur` from `cost_transactions` instead of combining `prompt_execution_logs` and `project_assets` cost metadata.

Scope intentionally avoided in the same pass:

- `llmRoutes.ts`
- AI analytics aggregation refactor
- admin/frontend cost surfaces already touched by other local work

Verification completed for this slice:

- focused `vitest` coverage for `CostTransactionService`
- full API test suite
- full repository build

---

## 11. Final Target Statement

The final system rule is:

```text
Recorded cost lives in cost_transactions.
CostTransactionService is the single runtime path for recorded cost calculation and ledger writes.
PlatformConfig.costRates is the SuperAdmin-managed runtime pricing policy.
All other cost fields are estimates, metadata, or cache only.
```
