# Prompt Layer Dedup — 2026-07-02

## Scope

This change documents and codifies a small but important prompt-pipeline correction applied to the
Layer 1 generation flow.

Objective:

- reduce prompt-layer repetition that was encouraging some models to loop in internal reasoning
- preserve the same safety and output constraints
- keep each rule family owned by a single authoritative layer

## Problem observed

Some providers were repeatedly re-checking the same constraints instead of producing the final JSON
artifact. The most frequent repeated fragments were about:

- canonical asset filenames: `style.css` and `script.js`
- single external script placement
- visibility-without-JS
- game/fullscreen reliability constraints such as input focus and no Tailwind CDN

The issue was not a database loop and not conversation-history growth. It was a single-turn
reasoning loop triggered by duplicated high-salience rules across multiple prompt layers.

## Changes applied

### 1. Layer A is now the single source of truth for architectural behaviour rules

Updated file:

- `apps/api/src/application/llm/systemPromptLayers.ts`

What changed:

- merged the "exactly one external script" rule into the existing JS-placement rule
- kept canonical `style.css` / `script.js` naming only in Layer A
- kept visibility-without-JS rules only in Layer A
- moved interactive/game reliability guidance into a compact Layer A section instead of keeping a
  second long copy in Layer E

Result:

- the model sees one authoritative architectural checklist instead of multiple paraphrased copies

### 2. Layer E was reduced back to its intended role

Updated file:

- `apps/api/src/application/use-cases/GetLlmPromptConfig.ts`

What changed:

- removed the long `GAME & INTERACTIVE EXPERIENCE RULES` block from `DEFAULT_PRE_PROMPT`
- kept Layer E focused on response format, JSON encoding, approved CDN libraries, media contract,
  and library selection guidance

Result:

- fewer late-layer repetitions, while keeping the same library catalog and generation contract

### 3. The budget layer now discourages self-auditing without repeating Layer A

Updated file:

- `apps/api/src/application/llm/llmMessageBuilder.ts`

What changed:

- removed the duplicated visibility reminder from the output budget policy
- rewrote the reasoning-budget text so it tells the model to plan once, avoid repeated checklist
  audits, and emit the JSON immediately

Result:

- the budget layer still governs output discipline, but no longer restates architectural rules

### 4. Tests were aligned with the new ownership model

Updated file:

- `apps/api/src/application/llm/__tests__/llmMessageBuilder.mediaPolicy.test.ts`

What changed:

- the test now asserts that visibility rules remain authoritative in Layer A
- the test also asserts that the budget layer does not duplicate that visibility block

## Validation

Executed after the change:

- `npx tsc -p apps/api/tsconfig.json --noEmit`
- `npm -w apps/api exec vitest run src/application/llm/__tests__/llmMessageBuilder.mediaPolicy.test.ts`

Observed result:

- TypeScript compile passed
- targeted Vitest file passed (`4/4` tests)

## Operational note

This change reduces one common source of runaway thinking, but it does not enforce provider-side
reasoning limits by itself. Additional runtime controls may still be useful later, for example:

- cut off or downgrade when SSE emits excessive `thinking` chunks without `content`
- provider-specific reasoning-mode reduction for artifact-first generation paths
- server-side max-reasoning controls where supported

## Documentation impact

This report is descriptive.

The normative rule added for future prompt edits is `PP-019` in:

- `docs/agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md`
