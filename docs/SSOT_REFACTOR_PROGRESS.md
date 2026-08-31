# SSOT Refactor — Progress and Resume Point

> **Superseded by [SSOT_STATUS.md](SSOT_STATUS.md) (2026-08-31).** Read that first — it is verified
> against the code. This tracker's remaining work (`I18`–`I20`) is defined in no document, and its
> "resume here" instruction should not be followed.

**Status:** I0–I17 implemented and merged to `develop`; I18–I20 remain  
**Last updated:** 2026-08-28
**Resume authority:** [SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md](specs/SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md)

**2026-08-19 scope note:** the "deferred past the demo" framing below (2026-08-18) was explicitly
overridden the next day — no increment in this program is gated on the September 2026 demo
calendar. The only legitimate gate on any remaining increment (I15–I20) is technical readiness.
The `PipelineRun` aggregate this section originally called "not started" has since been built and
is the only live guided-launch path, with real dispatch call sites wired in I12–I14. The temporary
runtime rollback flags were removed on 2026-08-28 under Rule Zero; rollback is now revert + redeploy.

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

**2026-08-19 update — I0–I14 landed.** The `PipelineRun` / `ModelSelectionDecision` aggregate and
durable execution journal (U1 onward in the sequencing below) are no longer "not started". The
increments and their `develop` merge commits are:

- **I0–I3** (`develop@b884ee2`): docs baseline, pure `resolveModelSelection()`, optimizer
  token-budget fix, fallback visibility — these are the "three small PRs" the 2026-08-18 note
  above describes.
- **I4–I6** (`develop@4e100b6`): `packages/contracts` additions (`modelRouting.ts`,
  `promptExecution.ts`, `pipelineRun.ts`), `taskPromptRegistry` routing extension.
- **I7–I8** (`develop@db6294d`): `PipelineRun` domain entity + Mongo persistence,
  `ResolvePipelineModelLock` (`createRun()`/`dispatch()`), shadow-mode observation (compute-only,
  zero behavior change).
- **I9** (`develop@5a4f614`): `buildCanonicalGenerationBrief()`, kills the two-brief-builder
  divergence.
- **I10** (`develop@e04cd87`): `ResolvePromptExecution` extracted as the sole composer for
  `/llm/prompt-preview`, `/llm/chat-preview`, `/llm/chat-preview/stream`.
- **I11** (`develop@047d452`): durable `PromptExecutionLog` journal + idempotency keys.
- **I12–I13** (`develop@a6b4d54`, renamed GodMode→Workspace in `develop@9e716e8`): server-owned
  `LaunchWorkspacePipeline` + `POST /pipeline/launch-workspace`; strict cutover wave 1
  (`OptimizeUserPrompt`, gated on an optional `pipelineRunId`).
- **I14** (`develop@af772ab`): strict cutover wave 2 — `ResolvePromptExecution` (chat-preview,
  chat-preview/stream, focused-edit) gated the same way. This is the call site that serves 100%
  of real generation traffic, so a locked/blocked model now genuinely cannot dispatch — a strict
  Kimi K3 lock cannot silently fall back to MiniMax or DeepSeek, and an unavailable locked model
  fails (409) before any provider call, in every strict-dispatch call site that exists.
- **I14.1 hardening:** fixed 4 issues an independent review found in I7–I14 — a
  blocked→blocked dispatch retry throwing 500 instead of 409, a fabricated fallback model being
  written into the audit journal when strict dispatch blocked, missing project-scoping on
  `dispatch()`, and incomplete strict-dispatch coverage. The later Rule Zero cutover removed the
  runtime flag itself and the legacy fallback it could reactivate.

## Current state

- [x] Prompt Execution SSOT analysis completed.
- [x] Vibe → Zero Effort → Workspace model-routing regression reproduced, documented, and fixed.
- [x] `PipelineRun` aggregate built, persisted, and wired into real dispatch call sites (I7–I14).
- [x] Strict-dispatch invariant (never silently substitute a locked model) holds at every call
  site that currently exists — verified by an independent coherence review, hardened in I14.1.
- [x] Frontend run-based handoff landed (I15, PR #74), then became the sole guided-launch path.
  The frontend/backend flags and the legacy handoff were removed on 2026-08-28; every launch now
  creates a PipelineRun and uses the server-owned strict chain.
- [x] Workshop pure server projection + persisted run notifications landed (I16–I17, PR #75).
- [ ] I18–I20 (typed POST preflight + Layer-E nested segments, Kimi K3 E2E acceptance test,
  legacy call-site removal) not started.

## Resume here next session

Continue with **I18**: typed POST preflight and Layer-E nested segments. See the full increment
list and test plan in the implementation program linked above.

## Subsequent slices

- **I19:** Kimi K3 E2E acceptance test.
- **I20:** legacy call-site removal — gated on I12–I19 being landed, tested, and confirmed stable,
  not on calendar/demo timing.

## Definition of ready to continue

Before coding, read:

1. AGENTS.md
2. docs/agents/CODE_AGENT_INDEX.md
3. this progress document
4. the unified SSOT program and both linked analyses

Then verify the running Docker stack before any compose command, per AGENTS.md. The initial
implementation must preserve the double sandbox and Clean Architecture dependency direction.
