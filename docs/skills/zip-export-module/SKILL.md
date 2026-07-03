---
name: llm-artifact-zip-export
description: Framework-agnostic pattern for turning the HTML/CSS/JS output of an LLM coding/design agent into a downloadable, deploy-ready ZIP (index.html, style.css, script.js, README.md) behind a single one-click "export" button. Covers inline-style/script extraction and dedup, asset-placeholder detection, README generation, ZIP assembly, and short-lived signed download tokens. Use when asked to add "download as ZIP", "export the generated site", "package this for deploy", or similar.
---

# LLM Artifact → ZIP Export

Portable extraction of a working, production-tested export pipeline. Origin project: **Andy Code
Cat** (`apps/api/src/application/use-cases/ExportLayer1Zip.ts`). This skill packages the *pattern*,
not a copy-paste of the original file — the code templates here are generalized to drop into any
Node/Express (or similar) backend with no dependency on the source project's Mongo/multi-tenant model.

## When to use this skill

- "Add a 'download as ZIP' button next to the generated preview/artifact."
- "Let users export the AI-generated page as a standalone site they can deploy anywhere."
- "Package the chat agent's HTML/CSS/JS output into a clean, deploy-ready bundle."
- "The agent embeds CSS/JS inline for live preview — I need real separate files on export."

Do not use this skill for: zipping an arbitrary build output directory (`dist/` from a real
bundler — that's a much simpler "archive a folder" task with no post-processing needed), or for
server-side site publishing/hosting (a related but separate concern — see
`docs/specs/EXPORT_AND_PUBLISH_SPEC.md` in the source repo if that's also in scope).

## Why this needs a dedicated post-processor, not just `zip -r`

LLM agents that support a live iframe preview typically embed CSS/JS **inline** in the HTML (so a
single `srcdoc`/`setContent` render works), even when they *also* expose CSS/JS as separate
fields for in-app editing. A naive export either (a) ships an HTML file full of inline
`<style>`/`<script>` — ugly and hard for a human to then hand-edit — or (b) naively concatenates
"the separate field" + "what's inline in HTML" and ships duplicated CSS/JS rules. The
post-processor's whole job is picking exactly one canonical source per file and rewriting the
HTML to reference the separated files.

## Quick start (minimal integration)

1. Copy `docs/CODE_TEMPLATES/post-processor.ts` into your backend — it is pure (no I/O), so it
   ports with zero adaptation beyond your project's `Artifacts` shape.
2. Copy `docs/CODE_TEMPLATES/export-zip-use-case.ts`, adapting the storage/persistence stand-ins
   (`yourFileStorage`, `yourExportRepository`) to whatever your project already has — do not
   invent a new storage layer or DB model just for this feature.
3. `npm install archiver jsonwebtoken` in the backend package.
4. Wire one or two HTTP routes per `docs/CODE_TEMPLATES/express-routes-example.ts` (adapt to your
   framework — the handler logic is short regardless of router library).
5. Add the export button per `docs/CODE_TEMPLATES/frontend-export-button.tsx` next to wherever the
   agent's live output is rendered.
6. Set a dedicated `EXPORT_JWT_SECRET` env var — **not** the same secret used for session/auth
   JWTs (see `docs/ARCHITECTURE.md` § Security model).

Read `AGENTS.md` in this folder before implementing — it is the step-by-step operating contract
for a coding agent porting this feature into a *different* codebase, including the invariants that
are easy to get subtly wrong.

## The three parts, and where each one lives

| Part | What it does | Reference |
|---|---|---|
| Post-processor | Extract inline CSS/JS, dedupe, rewrite `<link>`/`<script>` tags, detect placeholders, generate README | `docs/CODE_TEMPLATES/post-processor.ts` |
| Export use case + routes | Build the ZIP, persist an `ExportRecord`, sign a short-TTL download token, stream the file | `docs/CODE_TEMPLATES/export-zip-use-case.ts`, `docs/CODE_TEMPLATES/express-routes-example.ts` |
| Frontend button | One-click state machine: create export → fetch blob with auth header → trigger browser download | `docs/CODE_TEMPLATES/frontend-export-button.tsx` |

## Further reading

- `docs/ARCHITECTURE.md` — full end-to-end architecture as implemented in the source project
  (entities, storage layout, security model, lifecycle/TTL) — read this to understand *why* each
  piece exists before adapting it.
- `docs/CODE_TEMPLATES/` — copy-paste-ready, framework-agnostic code.
- `docs/PORTING_CHECKLIST.md` — testable steps to verify the port works end-to-end.
- `AGENTS.md` — operating contract + known gotchas for the agent doing the port.
