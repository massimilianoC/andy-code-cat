# SSOT Refactor — Progress and Resume Point

**Status:** planning complete; implementation has not started  
**Last updated:** 2026-08-18  
**Resume authority:** [SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md](specs/SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md)

## Progress update — 2026-08-18

A read-only Opus verification pass confirmed the structural diagnosis in the three planning
documents (8 independent model-resolution call sites exist today, not the 3 originally claimed),
but found the docs' central causal explanation for the observed Kimi → MiniMax → DeepSeek
incident was factually wrong (the optimizer's `openai-compatible` override gate does not apply to
SiliconFlow, the provider actually involved — SiliconFlow's own catalog entry has
`apiType: "openai-compatible"`), and identified an additional real root cause the docs had missed
entirely: a token-budget bug where `optimize_user_prompt.maxCompletionTokens` was hardcoded to
1200, well below what a full creative-brief rewrite needs. Rather than execute the docs' literal
"U2" step (a big-bang `PipelineRun` / `ModelSelectionDecision` aggregate removing all client-side
model authority in one pass) immediately before a public product demo in September 2026, three
small, staged, zero/low-risk PRs were implemented instead:

1. **Pin current model routing behavior** (`refactor/pin-model-routing-behavior`) — a shared,
   pure, characterization-tested `resolveModelSelection()` function reproducing today's exact
   model-resolution cascades, with zero intended behavior change. A safety net for the future
   `PipelineRun` work, not a replacement for it.
2. **Fix the optimizer's token-budget bug** (`fix/optimize-user-prompt-token-budget`) — raised
   `optimize_user_prompt.maxCompletionTokens` from 1200 to 32000 and extended the existing
   stale-value repair guard to cover it.
3. **Surface silent model fallback + fix always-on double optimization**
   (`fix/model-fallback-visibility-and-double-optimize`) — a workspace notification when a
   preferred model can't be resolved against the hydrated catalog, and removal of a redundant
   second optimizer call on the manual GodMode review handoff.

The `PipelineRun` / `ModelSelectionDecision` aggregate and durable execution journal (U1 onward in
the sequencing below) remain **not started** and are intentionally deferred past the demo.

## Current state

- [x] Prompt Execution SSOT analysis completed.
- [x] Vibe → Zero Effort → GodMode model-routing regression reproduced and documented.
- [x] Unified SSOT implementation program approved as the immediate R2/R3 gate.
- [x] Historical/future documents reclassified so they cannot override the active SSOT direction.
- [ ] No runtime refactor has been implemented yet.

## Resume here next session

Start with **U0 then U1/U2**, in this exact order:

1. Write the ADR/implementation slice for the aggregate boundary:
   PipelineRun owns model decision, canonical brief and optimizer policy; PromptExecution owns
   the immutable proof of each LLM dispatch.
2. Add shared contracts in packages/contracts for ModelSelectionDecision, PipelineRun,
   BriefRevision, PromptExecution references and the server-derived ModelDecisionView.
3. Implement the single application resolver ResolveModelSelectionDecision for run creation and
   dispatch. Enforce the precedence: user override → explicit capability exception → admin
   default for a new run → catalog proposal.
4. Add focused tests that prove a strict Kimi K3 lock cannot dispatch MiniMax or DeepSeek, and
   that an unavailable locked model fails before any provider call.

**Scope of this freeze (narrowed 2026-08-18):** do not rewire live model resolution or remove
client-side model authority — i.e. do not begin the docs' "U2" step (the `PipelineRun` /
`ModelSelectionDecision` aggregate) or anything past it — before these tests pass. This freeze
does **not** block unrelated product or demo-prep work: UI migration, generic workflow
orchestration, Layer S expansion, and new capability work that does not touch model-resolution
call sites may proceed. The three small PRs described in the progress update above (pinning
today's routing behavior, fixing the optimizer token budget, and surfacing the silent fallback)
are explicitly compatible with this freeze and were completed under it.

## Subsequent slices

- **U3:** BuildCanonicalGenerationBrief, BriefRevision persistence, direct server-owned GodMode
  handoff, and optimizationPolicy skip.
- **U4:** server-persisted PromptExecution journal and links to message/snapshot/cost.
- **U5:** Workshop read model, persistent notifications and Docker E2E.

## Definition of ready to continue

Before coding, read:

1. AGENTS.md
2. docs/agents/CODE_AGENT_INDEX.md
3. this progress document
4. the unified SSOT program and both linked analyses

Then verify the running Docker stack before any compose command, per AGENTS.md. The initial
implementation must preserve the double sandbox and Clean Architecture dependency direction.
