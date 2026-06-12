# Didactic Mode — Progress Log

> Branch: `feat/didactic-mode` (from `develop`)
> Started: 2026-06-10
> Spec: `docs/specs/DIDACTIC_MODE_SPEC.md`

## Guidelines
- Extend, do not rewrite. No regression to build mode.
- All changes documented here so another agent can resume.
- Commit after every wave completion with Conventional Commits.

---

## Wave 1 — Contracts-first freeze ✅
**Files:**
- `packages/contracts/src/didactic.ts` — Zod schemas + types (DidacticArtifactKnowledge, DidacticQnaEntry, anchors, topics, quizzes, generate/ask inputs)
- `packages/contracts/src/index.ts` — export didactic
- `apps/api/src/domain/entities/DidacticArtifactKnowledge.ts`
- `apps/api/src/domain/entities/DidacticQnaEntry.ts`
- `apps/api/src/domain/repositories/DidacticArtifactKnowledgeRepository.ts`
- `apps/api/src/domain/repositories/DidacticQnaRepository.ts`

## Wave 2 — Backend + Cost Labels ✅
**Lane BE:**
- `apps/api/src/infra/repositories/MongoDidacticArtifactKnowledgeRepository.ts` — upsert + findByProjectAndSnapshot
- `apps/api/src/infra/repositories/MongoDidacticQnaRepository.ts` — insert + listByProject
- `apps/api/src/application/didactic/instrumentArtifactHtml.ts` — cheerio-based HTML instrumenter + anchor validator
- `apps/api/src/application/llm/didacticPrompts.ts` — buildDidacticPrompt (generate + ask modes)
- `apps/api/src/application/use-cases/GenerateDidacticKnowledge.ts` — instrument → prompt → LLM → JSON parse → validate anchors → persist → cost log
- `apps/api/src/application/use-cases/GetDidacticKnowledge.ts` — cache read + groundingHash stale check
- `apps/api/src/application/use-cases/AskDidacticQuestion.ts` — prompt → LLM (sync) → persist Q&A
- `apps/api/src/application/use-cases/ListDidacticQna.ts` — project-level Q&A history
- `apps/api/src/presentation/http/routes/didacticRoutes.ts` — `/v1/projects/:id/didactic/*` (knowledge, generate, ask/stream, qna)
- `apps/api/src/app.ts` — register `createDidacticRoutes()` before `createProjectRoutes()`

**Lane COST:**
- `apps/api/src/domain/entities/CostTransaction.ts` — added `LLM_DIDACTIC_KNOWLEDGE` and `LLM_DIDACTIC_ASK`
- `apps/web/components/cost/CostBreakdownTree.tsx` — Italian labels for didactic resource types

**Lane FE-FND (WP0):**
- `apps/web/components/workspace/WorkspaceHeader.tsx` — Build/Didact segmented toggle
- `apps/web/app/workspace/[projectId]/page.tsx` — `workMode` state + pass to header
- `apps/web/components/workspace/DualView.tsx` — standalone dual-pane layout component (WP1 deferred)

**PlatformConfig updates:**
- `features.didacticMode` kill-switch (default true)
- `DEFAULT_PROMPT_TASK_SETTINGS` — `didactic_knowledge_generate` + `didactic_ask`

## Wave 3 — Frontend Panel + Integration ✅
- `apps/web/lib/api/didactic.ts` — client API (getKnowledge, generateKnowledge, streamAsk, listQna)
- `apps/web/components/didactic/DidacticPanel.tsx` — tab shell (Esplora / Chiedi)
- `apps/web/components/didactic/DidacticExploreTab.tsx` — overview, topics grouped by category with difficulty badges, 5 quizzes with ephemeral self-check
- `apps/web/components/didactic/DidacticAskTab.tsx` — focus chip, question input, streamed answer, project Q&A history
- `apps/web/app/workspace/[projectId]/page.tsx` — conditionally render `DidacticPanel` in left column when `workMode === "didactic"`

## Type-check status
- ✅ Frontend (`apps/web`): `npx tsc --noEmit` — clean
- ✅ Backend (`apps/api`): `npx tsc --noEmit` — clean

## Docker deploy / test status
- Stack attivo: `andy-code-cat` deploy stack (mongodb, redis, api, web, nginx, minio)
- API rebuild: `docker compose -f docker-compose.deploy.yml up -d --build --no-deps api` → ✅ successo
- Web rebuild: `docker compose -f docker-compose.deploy.yml up -d --build --no-deps web` → ✅ successo
- Smoke tests:
  - `GET /health` → 200
  - `GET /v1/projects/123/didactic/knowledge?snapshotId=abc` → 401 (auth required, route exists)
  - `GET http://localhost/` (via nginx) → 200
- ⚠️ Test funzionali E2E (generazione knowledge, Q&A streaming) richiedono login + progetto con snapshot.

## Remaining TODO (Wave 4 / next agent)
1. **Click-to-ask routing in Didactic mode**
   - In `page.tsx`, when `workMode === "didactic"`, route `pf-select` (preview click) and Monaco `onCodeSelectionChange` to set the DidacticPanel focus chip instead of opening the build inspector/focus context.
   
2. **Dual-view integration (WP1)**
   - Add "Dual" toggle in preview tab bar.
   - When active, render `DualView` component with left=preview iframe and right=code/prompt editor.
   - Topic click should open dual-view + highlight the anchor.

3. **Feature flag wiring**
   - Fetch `PlatformConfig.features.didacticMode` and hide the Build/Didact toggle when false.

4. **i18n**
   - Replace hardcoded Italian strings in didactic components with `useTranslation("didactic")` keys.

5. **Topic → dual-view + highlight**
   - `DidacticTopicLauncher` logic: click topic → set `dualView=true`, switch right pane to anchor kind, trigger preview highlight via `pf-edit-scroll-to` and Monaco `revealRangeInCenter`.

6. **Tests**
   - Anchor validation test (invalid pfId dropped)
   - Cache hit/miss via `groundingHash`
   - Structured-JSON parse test
   - Read-only invariant (no snapshot created after generate/ask)
   - Sandbox denial test

7. **Documentation**
   - Update `docs/architecture/BOOTSTRAP_ARCHITECTURE.md` if entity list changed.
   - Update `docs/runbooks/TESTABLE_STEPS.md` with didactic E2E steps.

## Commits on `feat/didactic-mode`
- `c6a9d56` feat(didactic): wave 1 — contracts-first freeze
- `a26cf31` feat(didactic): wave 2 — backend + cost labels
- `ceebf33` feat(didactic): wp0 — workMode toggle in WorkspaceHeader + page.tsx state
- `45f6cbb` feat(didactic): wave 3 — DidacticPanel frontend + API client + page.tsx integration
- `bf55331` fix(didactic): resolve all TypeScript errors in backend + routes
