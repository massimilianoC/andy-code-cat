# Template Skills Injection — MD Skill Manuals per Template

> Status: **proposed** (plan only — do NOT implement yet, per maintainer)
> Branch target: `develop` (future `feat/template-skills`)
> Date: 2026-07-02
> Related: [PROMPT_LAYER_RESTRUCTURE_PLAN.md](PROMPT_LAYER_RESTRUCTURE_PLAN.md) ·
> [PROMPTING_PIPELINE_AGENT_GUARDRAILS.md](../agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md) ·
> [ProjectPreset.ts](../../apps/api/src/domain/entities/ProjectPreset.ts) ·
> [GetLlmPromptConfig.ts](../../apps/api/src/application/use-cases/GetLlmPromptConfig.ts) (Layer E)

---

## 0. Purpose

Give each template a curated, reusable set of **skill manuals** (Markdown) that are injected into
the generation prompt to strengthen the *technical characterization* of that output type — the
"how to build it well" that is specific to games, slideshows, dashboards, forms, etc.

This complements the two universal contracts already live:
- **Layer A completeness contract** — the universal *what* ("ship a complete, functional MVP").
- **Layer B VIEWPORT MODE** — the universal *layout framing* (fullscreen_app / slide_deck / …).

Skills are the specialized *how* (library patterns, gameplay loops, physics setup, input handling,
data-viz idioms) — too detailed and type-specific to live in Layer A, too reusable to be re-written
inside each preset's `systemPromptModule`.

---

## 1. Motivating evidence (2026-07-02, local Mongo analysis)

A videogame project (proj `6a461943800e4ce92ef44ad8`, "Interactive Gamified Portfolio", Phaser 3)
produced a **structure-only, non-interactive** result and the user reported console errors.
Root-cause analysis on the artifact + DB:

| Symptom | Real cause | Status |
|---|---|---|
| "non vedo interattività nel gioco" | keyboard-only input never reaches the sandboxed iframe (no focus); no touch/pointer fallback; gameplay loop incomplete | **fixed now** in Layer E game rules + Layer A completeness contract |
| `cdn.tailwindcss.com should not be used in production` | an earlier game build loaded Tailwind CDN (dev warning, irrelevant to canvas games) | **fixed now** — Layer E forbids Tailwind CDN for games/fullscreen |
| `Failed to load resource: 404 (…preferredProv…)` | a workspace/launch platform request, NOT the artifact | flagged — needs repro, out of scope for skills |
| `Uncaught (in promise) …kQuotaBytesPerItem quota exceeded` | Chrome **extension** storage API (chrome.storage), not our code (we use localStorage with graceful handling in `thumbnail.ts`) | external noise — not a platform bug |

The engine CDNs were verified live (all HTTP 200), so the failure was **guidance/completeness**,
not a broken catalog. This is exactly the gap a skill pack closes durably.

---

## 2. Interim deterministic fixes already landed (this branch)

To stop the console errors and dead games immediately, without waiting for the skill system,
the following prompt/library corrections were made in **Layer E** (`GetLlmPromptConfig.ts`):

- Richer **Phaser pattern** with arcade physics config + input (cursors + pointer) + scale FIT.
- New **GAME & INTERACTIVE EXPERIENCE RULES** block: input focus + pointer/touch fallback,
  on-screen controls, no storage APIs, vanilla CSS (no Tailwind CDN) for games, self-contained
  procedural assets, and a complete playable loop.
- Selection-guidance pointer to those rules.

These are the "first skill pack" content, inlined as an interim measure. The skill system below
generalises this so every template gets its own curated pack, admin-editable and reseedable.

---

## 3. Architecture

### 3.1 Entity — `TemplateSkill`

```ts
export interface TemplateSkill {
  id: string;
  title: string;
  body: string;              // Markdown manual, injected verbatim (budget-capped)
  appliesTo: {
    presetIds?: string[];        // e.g. ["videogame","game3d","freerunner"]
    viewportModels?: ProjectPreset["outputSpec"]["viewportModel"][]; // e.g. ["fullscreen_app"]
    all?: boolean;               // universal skill (rare)
  };
  tags?: string[];           // e.g. ["physics","input","dataviz"]
  priority: number;          // lower = injected first
  maxChars?: number;         // per-skill budget hint
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

Storage: Mongo collection `template_skills` (reuse the `MongoProjectPresetRepository` pattern),
plus a static seed catalog `TEMPLATE_SKILL_CATALOG` (same static→Mongo→reseed model as presets).

### 3.2 Resolution + injection — new Layer S (skills)

- `ResolveTemplateSkills.execute({ presetId, viewportModel })` → ordered active skills.
- `buildTemplateSkillsLayer(skills, { maxChars })` → a `## TEMPLATE SKILLS` block, deterministic,
  budget-capped by dropping whole skills (never mid-skill), same discipline as brand-doc Layer D.
- Composed **adjacent to Layer B** (it is format characterization, same ownership as the preset).
  Proposed order: `… layerB (preset + VIEWPORT MODE) → layerS (skills) → layerC → layerG → layerD …`.
- Wired in `resolveContext()` (generation) and the prompt-preview endpoint — like brand docs.

### 3.3 Governance / ownership (guardrails)

- New PP rule: skills are **Layer B-adjacent** — technical *how-to* per template; never universal
  rules (Layer A) and never layout framing beyond the preset's `viewportModel`.
- Admin-editable (superadmin), reuse existing admin CRUD + auth patterns.
- Budget: a global cap (e.g. `LLM_SKILLS_MAX_CHARS`) so skills never crowd out Layer D/context.

---

## 4. First skill packs (seed catalog)

| Skill id | appliesTo | Content focus |
|---|---|---|
| `game-input-and-loop` | viewportModels: fullscreen_app | iframe focus + pointer/touch fallback, on-screen controls, complete loop, no storage (generalises the interim Layer E rules) |
| `arcade-physics-phaser` | presetIds: videogame, freerunner, seriousgame | Phaser arcade physics, colliders, tween juice, spawn/despawn, difficulty ramp |
| `physics-sim-matter` | tags: physics | Matter.js world/bodies/constraints, mouse constraint, ragdoll/puzzle patterns |
| `creative-canvas-p5` | presetIds: (creative), tags: generative | p5.js instance mode, particle systems, flow fields, seeded randomness, resize handling |
| `webgl-scene-three` | presetIds: game3d, tags: 3d | Three.js 0.160 global build scene/camera/renderer, animation loop, resize, lightweight GLTF-free primitives |
| `webxr-aframe` | presetIds: vr-aframe | A-Frame scene graph, gaze/cursor interaction, performance budget |
| `slide-deck-craft` | viewportModels: slide_deck | full-viewport slides, keyboard/touch paging, transitions, speaker rhythm |
| `dataviz-chartjs` | tags: dataviz | Chart.js idioms, responsive canvases, accessible legends/tooltips |
| `form-ux-validation` | presetIds: form | client validation, error UX, submit handling, progress/steps |

Each is a well-documented MD manual referencing ONLY the approved pinned CDNs, with copy-ready
patterns — the durable version of what §2 inlined.

---

## 5. Wave plan (when approved)

| Wave | Scope | Risk |
|---|---|---|
| 1 | `TemplateSkill` entity + contracts + Mongo repo + static catalog (additive) | none |
| 2 | `ResolveTemplateSkills` + `buildTemplateSkillsLayer` + unit tests | low |
| 3 | Wire Layer S into `resolveContext` + prompt-preview (composer order) | medium (frozen composer order) |
| 4 | Seed the first skill packs (§4) + reseed | medium (content) |
| 5 | Admin CRUD UI for skills | low |
| 6 | Guardrails PP rule + PROMPT panel shows Layer S + TESTABLE_STEPS | low |

Reseed is MANDATORY per deploy when the skill catalog changes (same rule as presets).

---

## 6. Open decisions for the maintainer

1. Separate **Layer S**, or fold skills into the existing Layer B preset block? (Recommendation:
   separate Layer S — independently budgetable, admin-editable, reusable across presets.)
2. Skill selection key: by `presetId`, by `viewportModel`, by `tags`, or all three? (Recommendation:
   all three, OR-combined, deduped.)
3. Global skills budget value (`LLM_SKILLS_MAX_CHARS`) and precedence vs Layer D when the prompt
   is tight.
4. Should users (not only superadmin) be able to attach project-scoped skills, mirroring brand
   assets' platform→user→project hierarchy?
