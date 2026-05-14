# Prompting Pipeline — Agent Guardrails

> **Scope:** Operational rules for all agents working in parallel on the Andy Code Cat system-prompt compositing pipeline.
> Update this document whenever a new agent is added or layer ownership changes.
>
> **Rule IDs** (format `PP-NNN`) are stable identifiers. Cite them in commit messages and PR descriptions to prove compliance. Example: `fix(llm): remove duplicated budget section — PP-006`.
>
> **Language policy:** This document is in English. All additions must be in English.

---

## 1. Layer Ownership Map

The Layer 1 (chat-preview) pipeline composes the system prompt in the following fixed order.
**Each agent has exclusive write ownership over its layer. No agent may modify another agent's layer.**

| Layer | Function / File | Owner | Authorised content |
|---|---|---|---|
| **A** | `buildBaseConstraintsLayer()` in `systemPromptLayers.ts` | **Architecture** (human maintainer or architecture agent) | Immutable structural rules: 1+1+1 output format, CDN-only, no framework, JS exclusively in artifacts.js, HTML compactness |
| **B** | `buildPresetLayerFromPreset()` in `systemPromptLayers.ts` | **Preset agent** | `outputSpec.systemPromptModule` + `cssConstraints` from presets — never free text |
| **C** | `buildStyleContextBlock()` in `styleContextBuilder.ts` | **Style / moodboard agent** | Visual tags, palette, typography, layout, tone — no technical rules |
| **D** | `buildProjectKnowledgeLayer()` *(to be implemented)* in `systemPromptLayers.ts` | **Context / embed agent** | Asset enrichment traces, document briefs, fetched resource snippets — pure content, no technical rules |
| **E** | `prePromptTemplate` via `GetLlmPromptConfig.ts` | **CDN / images / encoding agent** | RESPONSE FORMAT, JSON ENCODING RULES, HTML ATTRIBUTE QUOTING, APPROVED CDN LIBRARIES, LIBRARY SELECTION GUIDANCE, IMAGES, CONVERSATION CONTEXT |
| **F** | `governanceSystemPrompt` from `PlatformConfig` | **Superadmin operator** (parametric UI) | Product governance, operator policies, per-presetId overrides |
| **G** | `roleModel.promptTemplate` (appended to E in `llmRoutes.ts`) | **Models agent** | MODEL-SPECIFIC GUIDANCE per pipeline role (dialogue, coding, vision…) |
| **Budget** | `buildOutputBudgetPolicy()` in `llmMessageBuilder.ts` | **Infra / env agent** | OUTPUT BUDGET POLICY + REASONING BUDGET — dynamic from env, no duplication |
| **Req** | `requestSystemPrompt` | **Runtime** | Per-call override — never persisted |

---

## 2. Frozen Zones — No Agent Touches These Without Consensus

The following sections are **frozen**: modifying them requires explicit review from all active agents plus the human maintainer.

| File | Section / Constant | Reason |
|---|---|---|
| `systemPromptLayers.ts` — `buildBaseConstraintsLayer()` | Entire function | Layer A architectural rules. An error here breaks ALL presets. |
| `systemPromptComposer.ts` — `composeSystemPrompt()` | Layer order and separator `"\n\n---\n\n"` | Changing the order or separator invalidates the expected behaviour of all downstream layers. |
| `llmRoutes.ts` — `resolveContext()` | `effectivePrePromptTemplate` assembly logic and the `composeSystemPrompt` call | Critical production pipeline. Changes require full E2E test coverage. |
| `GetLlmPromptConfig.ts` — `DEFAULT_RESPONSE_FORMAT_VERSION` | The version constant | Increment only with a dedicated PR and explicit DB migration. |

---

## 3. Layer Interface Contracts

Every layer builder must respect these contracts to avoid corrupting the composed prompt.

### 3.1 Return value format (PP-001)

- Each layer returns a **UTF-8 string with no leading or trailing** `---` separators.
- The separator `"\n\n---\n\n"` is the exclusive responsibility of `composeSystemPrompt()`.
- A layer returning an empty string (`""`) is silently omitted by the composer — this is expected behaviour.
- **`PP-001` MUST NOT:** Add `---` at the start or end of any value returned by a layer builder.

### 3.2 Layer A — authoritative JS placement rule (PP-002)

The following statement in `buildBaseConstraintsLayer()` is the **single authoritative source** for where JavaScript must go:

> All JavaScript MUST go exclusively in artifacts.js. Never embed script logic inline in the HTML artifact.

- **`PP-002` MUST NOT:** Any other layer repeat or contradict this rule.
- **`PP-002` MUST NOT:** Any layer contain a directive placing JS inside a `<script>` tag in the HTML artifact.
- If a layer says "include JS in `<script>` in HTML" → direct conflict with Layer A → remove immediately.

### 3.3 Budget policy — single source of truth (PP-003)

`buildOutputBudgetPolicy()` in `llmMessageBuilder.ts` is the **only authoritative source** for:

- Token limits (read from `env.LLM_DEFAULT_MAX_COMPLETION_TOKENS` at runtime)
- REASONING / THINKING BUDGET rules
- "Return ONLY one raw JSON object" rule

- **`PP-003` MUST NOT:** Any other layer contain a section named `## OUTPUT` or `## REASONING`.
- **`PP-003` MUST NOT:** `DEFAULT_PRE_PROMPT` contain hardcoded token count values (they diverge from env).

### 3.4 Layer E — DEFAULT_PRE_PROMPT boundary (PP-004)

Layer E (`prePromptTemplate` default) contains **exclusively**:

- JSON response schema (`## RESPONSE FORMAT`)
- JSON encoding rules with examples (`## JSON ENCODING RULES`)
- HTML single-quote rule (`## HTML ATTRIBUTE QUOTING`)
- Approved CDN catalogue (`## APPROVED CDN LIBRARIES`)
- Library selection guidance (`## LIBRARY SELECTION GUIDANCE`)
- artifacts.css / artifacts.js split rule (`## artifacts.css and artifacts.js`)
- Stock image sources (`## IMAGES`)
- Conversation context rule (`## CONVERSATION CONTEXT`)

- **`PP-004` MUST NOT** belong in Layer E: architectural rules about output files → Layer A; token/reasoning budget → `buildOutputBudgetPolicy()`; JS placement directives → Layer A; preset-specific sections → Layer B; project content (brief, links, assets) → Layer D.
- **`PP-004` MUST NOT:** `DEFAULT_PRE_PROMPT` include dynamic values read from `env` — use `buildOutputBudgetPolicy()` for those.

---

## 4. Agent-Specific Guardrails

### 4.1 Context / embed injection agent (Layer D)

**Files in scope:**

- `apps/api/src/application/llm/systemPromptLayers.ts` — add `buildProjectKnowledgeLayer()`
- `apps/api/src/domain/entities/ProjectMoodboard.ts` — add `resourceLinks?: ResourceLink[]`
- `apps/api/src/domain/entities/AssetEnrichmentTrace.ts` *(new file)*
- `apps/api/src/infra/repositories/MongoProjectMoodboardRepository.ts` — add `resourceLinks` mapping
- Reference spec: `docs/specs/DOCUMENT_CONTEXT_LAYER_SPEC.md`

**Operational rules:**

1. **(PP-005)** Layer D returns **content only** (extracted text, briefs, URL snippets) — zero technical instructions to the LLM.
2. **(PP-006)** The total character length of Layer D content MUST NOT exceed `LLM_CONTEXT_MAX_CHARS / 3` (cap defined in `DOCUMENT_CONTEXT_LAYER_SPEC.md`).
3. **(PP-007)** Do NOT touch `buildStyleContextBlock()` in `styleContextBuilder.ts` — Layer C is owned by the style maintainer.
4. **(PP-008)** Do NOT modify `systemPromptComposer.ts` to wire Layer D without first agreeing on insertion order with the maintainer. According to the spec, Layer D is inserted between Layer B and Layer C.
5. **(PP-009)** The call to `buildProjectKnowledgeLayer()` in `llmRoutes.ts` must be added **only** inside `resolveContext()` — not in the focused-edit path unless explicitly requested.
6. **(PP-010)** Do NOT duplicate in Layer D any field already present in Layer C (visual tags, palette, typography).

**Files this agent MUST NEVER touch:**

- `buildBaseConstraintsLayer()` (Layer A)
- `composeSystemPrompt()` — only extend its input type to accept the new parameter
- `GetLlmPromptConfig.ts`
- `buildOutputBudgetPolicy()` in `llmMessageBuilder.ts`

---

### 4.2 CDN / API keys / stock images agent (Layer E)

**Files in scope:**

- `apps/api/src/application/use-cases/GetLlmPromptConfig.ts` — edit `DEFAULT_PRE_PROMPT`
- Optional: superadmin configuration UI for `## APPROVED CDN LIBRARIES` and `## IMAGES`

**Operational rules:**

1. **(PP-011)** Every new CDN entry in `## APPROVED CDN LIBRARIES` MUST include: exact URL with version (semver or `@latest` with frozen-version note), one-line use-case, and a 1–2 line usage pattern.
2. **(PP-012)** API keys MUST NEVER be injected into the system prompt. They belong in `env` and are consumed by service-layer adapters — not in prompt text.
3. **(PP-013)** New image sources in `## IMAGES` MUST be: free to use without authentication (no API key in the URL), HTTPS, and stable (no experimental or personal CDNs).
4. **(PP-014)** Do NOT add a new CDN not on the existing whitelist without a separate PR that also updates `docs/INDEX.md`.
5. **(PP-015)** Do NOT modify `## RESPONSE FORMAT`, `## JSON ENCODING RULES`, or `## HTML ATTRIBUTE QUOTING` — these sections are stable and tested.
6. **(PP-016)** Do NOT add any section named `## OUTPUT` or `## REASONING` — those are already emitted by `buildOutputBudgetPolicy()`.
7. **(PP-017)** `DEFAULT_PRE_PROMPT` MUST remain a static template string. Do NOT add dynamic values read from `env`.

**Files this agent MUST NEVER touch:**

- `buildBaseConstraintsLayer()` (Layer A)
- `systemPromptComposer.ts`
- `llmRoutes.ts` — no changes to the assembly pipeline
- `buildOutputBudgetPolicy()` in `llmMessageBuilder.ts`

---

## 5. Safe-Change Protocol

Before modifying any layer file:

```
1. Read this document to verify ownership of the target layer.
2. Verify the change does not duplicate content already present in another layer.
   → grep the first 3 words of the new directive across all other layer builder files.
3. Verify the change does not contradict Layer A architectural rules.
4. Verify the change does not add token budget or reasoning rules outside buildOutputBudgetPolicy().
5. If the target is a frozen zone → stop. Open an issue or discuss with the maintainer.
6. Commit on a separate feat/* branch per agent — do not mix changes from different layers in one commit.
```

### 5.1 Pre-commit anti-conflict checklist

Answer each question before committing. A single "yes" is a blocker.

- [ ] Does my change introduce a section named `## OUTPUT` or `## REASONING`? → **PP-003 violation** — move it to `buildOutputBudgetPolicy()`
- [ ] Does my change specify where to place JS (inline, `<script>`, `artifacts.js`)? → **PP-002 violation** — belongs in Layer A
- [ ] Does my change replicate the JSON schema `{ chat, artifacts }`? → **PP-004 violation** — already in `## RESPONSE FORMAT` of Layer E
- [ ] Does my change touch `composeSystemPrompt()` or the layer order? → **frozen zone** — consensus required
- [ ] Does my layer builder return a string that starts or ends with `---`? → **PP-001 violation** — remove the separator

---

## 6. Quick Navigation Index

| Purpose | File |
|---|---|
| Layer composer (structure) | `apps/api/src/application/llm/systemPromptComposer.ts` |
| Layer A + B builders | `apps/api/src/application/llm/systemPromptLayers.ts` |
| Layer C builder (style) | `apps/api/src/application/llm/styleContextBuilder.ts` |
| Layer D builder (to be implemented) | `apps/api/src/application/llm/systemPromptLayers.ts` |
| Layer E default (DEFAULT_PRE_PROMPT) | `apps/api/src/application/use-cases/GetLlmPromptConfig.ts` |
| Budget policy (dynamic from env) | `apps/api/src/application/llm/llmMessageBuilder.ts` |
| Pipeline assembly (resolveContext) | `apps/api/src/presentation/http/routes/llmRoutes.ts` |
| Deterministic artifact safety repair | `apps/api/src/application/llm/artifactSafetyRepair.ts` |
| Layer D spec (document context) | `docs/specs/DOCUMENT_CONTEXT_LAYER_SPEC.md` |
| Preset structure spec | `apps/api/src/domain/entities/ProjectPreset.ts` |
| Moodboard entity (Layer C/D data) | `apps/api/src/domain/entities/ProjectMoodboard.ts` |
| Model guidance (Layer G) | `apps/api/src/application/llm/modelRegistryPresets.ts` |

---

## 7. Deterministic Post-Generation Safety Layer

In addition to the prompt-side rules above, the pipeline runs a deterministic
defense-in-depth pass on every generated artifact triple before it is stored as
a snapshot. This layer is owned by the **infra agent** and lives in
`apps/api/src/application/llm/artifactSafetyRepair.ts` (`repairArtifactsForVisibility`).

It must remain:

- **Idempotent** — re-running on a repaired artifact is a no-op.
- **No-LLM** — pure string transformations only; no second model call.
- **Conservative** — every repair triggers only on a verified failing pattern,
  never on borderline structures.

Current repairs (extend by adding a new `R-N` block plus a tag in the `repairs`
array; never remove an existing repair without consensus):

| Tag | Trigger | Action |
|---|---|---|
| `aos-script-injected` | `data-aos="..."` present, `aos.js` script tag missing | Inject the official AOS script tag before `</body>` |
| `aos-init-injected` | `data-aos` present, no `AOS.init()` call anywhere | Append a guarded `AOS.init()` to `artifacts.js` |
| `aos-orphan-css-stripped` | AOS stylesheet linked but no markers and no script | Remove the orphan stylesheet link |
| `aos-css-opacity-neutralized` | Inline `[data-aos]{opacity:0}` rule with no AOS JS at all | Remove the `opacity:0` declaration |
| `css-literal-escapes-unescaped` | Literal `\n` / `\t` / `\r` inside the CSS artifact | Convert to real whitespace |
| `phaser-parent-canvas-rewritten` | Phaser `parent: 'X'` while `<canvas id='X'>` exists | Rewrite that `<canvas>` element to a `<div>` with the same id |

When a repair fires, the route emits an `artifact_repaired` execution-log event
containing the list of triggered tags. Use those events as the canary metric for
prompt regressions: a sustained rise in any tag means the corresponding prompt
directive is losing effectiveness and should be revisited at the prompt layer
first, then strengthened in the repair if necessary.
