# Screenshot / PDF Export — Portable Skill

Self-contained knowledge package for adding server-side screenshot/PDF capture of an
HTML/CSS/JS artifact (or a live URL / iframe content) to any web app. Extracted from Andy Code
Cat's working implementation so it can be dropped into a different project and driven by a coding
agent with minimal back-and-forth.

## Start here

| File | Purpose |
|---|---|
| [SKILL.md](SKILL.md) | What this does, when to use it, quick-start steps. Read first. |
| [AGENTS.md](AGENTS.md) | Step-by-step operating contract + non-negotiables for the agent doing the port. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full explanation of the source project's implementation — the "why" behind every decision. |
| [docs/CODE_TEMPLATES/](docs/CODE_TEMPLATES/) | Copy-paste-ready, framework-agnostic code (capture service, Express routes, Dockerfile snippet). |
| [docs/PORTING_CHECKLIST.md](docs/PORTING_CHECKLIST.md) | Testable steps to verify the port works end-to-end. |

## Reusing this outside this repo

This folder has no dependency on the rest of the Andy Code Cat codebase — copy the whole
`screenshot-pdf-export/` directory into another project. If the target project uses Claude Code
(or a compatible coding-agent harness), you can additionally copy `SKILL.md` alone into that
project's `.claude/skills/screenshot-pdf-export/SKILL.md` so it's auto-discovered; keep the rest
of this folder alongside it (or under `docs/`) as reference material the skill points to.

## Origin

Distilled from `apps/api/src/infra/capture/PuppeteerCaptureService.ts` and its callers
(`CapturePreviewSnapshot`, `SnapshotThumbnailJob`, `ExportLayer1Zip`) in this repository. See
`docs/specs/EXPORT_AND_PUBLISH_SPEC.md` for this repo's own product-level export/publish spec —
that document is Andy Code Cat–specific (ZIP structure, subdomain publishing) and is *not*
part of the portable package; only the capture mechanics were extracted here.
