# ZIP Export Module — Portable Skill

Self-contained knowledge package for adding a "one-click export as ZIP" feature to any web app
whose content is produced by an LLM coding/design agent (HTML, optionally with inline CSS/JS).
Extracted from Andy Code Cat's working implementation so it can be dropped into a different
project and driven by a coding agent with minimal back-and-forth.

## Start here

| File | Purpose |
|---|---|
| [SKILL.md](SKILL.md) | What this does, when to use it, quick-start steps. Read first. |
| [AGENTS.md](AGENTS.md) | Step-by-step operating contract + non-negotiables for the agent doing the port. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full explanation of the source project's implementation — the "why" behind every decision. |
| [docs/CODE_TEMPLATES/](docs/CODE_TEMPLATES/) | Copy-paste-ready, framework-agnostic code (post-processor, use case, Express routes, frontend button). |
| [docs/PORTING_CHECKLIST.md](docs/PORTING_CHECKLIST.md) | Testable steps to verify the port works end-to-end. |

## Reusing this outside this repo

This folder has no dependency on the rest of the Andy Code Cat codebase — copy the whole
`zip-export-module/` directory into another project. If the target project uses Claude Code
(or a compatible coding-agent harness), you can additionally copy `SKILL.md` alone into that
project's `.claude/skills/zip-export-module/SKILL.md` so it's auto-discovered; keep the rest
of this folder alongside it (or under `docs/`) as reference material the skill points to.

## Origin

Distilled from `apps/api/src/application/use-cases/ExportLayer1Zip.ts` and its supporting files
(`ExportRecord` entity, `exportRoutes.ts`, `apps/web/lib/api/exports.ts`, and the workspace export
button) in this repository. See `docs/specs/EXPORT_AND_PUBLISH_SPEC.md` for this repo's own
product-level export/publish spec — that document is Andy Code Cat–specific (web publishing,
subdomains, NGINX) and is *not* part of the portable package; only the "agent output → ZIP"
post-processing and download mechanics were extracted here.

Related portable skill: [docs/skills/screenshot-pdf-export/](../screenshot-pdf-export/README.md) —
this module's `ExportLayer1Zip` optionally embeds a JPG/PDF preview screenshot in the ZIP using
that same capture pattern (Flow C in that skill). The two are complementary but independent; you
can implement ZIP export without the screenshot capture skill.
