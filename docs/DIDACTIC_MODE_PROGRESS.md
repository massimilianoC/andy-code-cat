# Didactic Mode — Progress Log

> Branch: `feat/didactic-mode` (from `develop`)
> Started: 2026-06-10
> Spec: `docs/specs/DIDACTIC_MODE_SPEC.md`

## Guidelines
- Extend, do not rewrite. No regression to build mode.
- All changes documented here so another agent can resume.
- Commit after every wave completion with Conventional Commits.

---

## Wave 1 — Contracts-first freeze
**Status:** IN PROGRESS
**Goal:** Freeze `packages/contracts/src/didactic.ts` + domain entities + repo interfaces.
**Files:**
- `packages/contracts/src/didactic.ts` (new)
- `packages/contracts/src/index.ts` (export)
- `apps/api/src/domain/entities/DidacticArtifactKnowledge.ts` (new)
- `apps/api/src/domain/entities/DidacticQnaEntry.ts` (new)
- `apps/api/src/domain/repositories/DidacticArtifactKnowledgeRepository.ts` (new)
- `apps/api/src/domain/repositories/DidacticQnaRepository.ts` (new)
