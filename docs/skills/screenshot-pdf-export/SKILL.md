---
name: html-artifact-screenshot-pdf-export
description: Server-side, framework-agnostic pattern for turning an HTML/CSS/JS artifact, a live URL, or an iframe's content into a JPEG screenshot and/or a paginated PDF using headless Chromium (Puppeteer). Covers synchronous on-demand capture, fire-and-forget background thumbnail generation, and PDF pagination heuristics for content that has no explicit print CSS. Use when asked to add "download as image/PDF", thumbnail generation, or artifact-capture features to a web app.
---

# HTML Artifact → Screenshot / PDF Export

Portable extraction of a working, production-tested capture pipeline. Origin project: **Andy Code Cat**
(`apps/api/src/infra/capture/PuppeteerCaptureService.ts`). This skill packages the *pattern*, not a
copy-paste of the original file — the code templates here are generalized to drop into any
Node/Express (or similar) backend with no dependency on the source project's Mongo/preset model.

## When to use this skill

- "Add a screenshot/PDF export button for the generated page/artifact."
- "Generate a thumbnail preview automatically after a document/page is saved."
- "Turn this iframe's content into a downloadable PDF."
- "Capture a live URL server-side (no client screenshot library, no CORS canvas tainting)."

## Why headless Chromium (Puppeteer) instead of client-side canvas tricks

- `html2canvas` / `dom-to-image` can't reliably rasterize CSS transforms, web fonts, canvas/WebGL,
  iframes, or cross-origin images — they reimplement a CSS renderer in JS.
- A real browser (Puppeteer + Chromium) renders **exactly** what the user sees, including
  JS-driven animations, lazy-loaded content, and print CSS (`@media print`, `@page`).
- Runs server-side → no client memory/CPU cost, works for background jobs, and output is
  identical regardless of the requesting client's browser.

## Three reusable flows

| Flow | Trigger | Blocking? | Use for |
|---|---|---|---|
| **On-demand capture** | User clicks "Download JPG/PDF" | Sync HTTP request (10–30s) | Single-shot export |
| **Background thumbnail** | Content saved/activated | Fire-and-forget, polled/pushed later | Card previews, lists |
| **Export-embedded capture** | ZIP/bundle export | Parallel `Promise.all([jpg, pdf])` inside a larger job | Bundling a static preview alongside source files |

All three flows call **one shared function**: `captureHtml(html, format, options)`. See
`docs/CODE_TEMPLATES/capture-service.ts` for the full, portable implementation.

## Quick start (minimal integration)

1. `npm install puppeteer` in the backend package.
2. Copy `docs/CODE_TEMPLATES/capture-service.ts` into your backend (e.g. `src/infra/capture/`).
3. Copy the Docker Chromium block from `docs/CODE_TEMPLATES/dockerfile-snippet.md` into your
   backend `Dockerfile` (both dev and prod stages) — Puppeteer's bundled Chromium download is
   skipped in favor of the OS package, which is far smaller and avoids sandbox issues in CI.
4. Wire one HTTP route per `docs/CODE_TEMPLATES/express-routes-example.ts` (adapt to your
   framework — the handler logic is ~10 lines regardless of router library).
5. If you need thumbnails: call `captureHtml(html, "jpg")` fire-and-forget after the content is
   created/saved, store the buffer via whatever file storage you already have, never await it
   inside the request handler that creates the content.

Read `AGENTS.md` in this folder before implementing — it is the step-by-step operating contract
for a coding agent porting this feature into a *different* codebase, including the traps that
cost real debugging time in the source project.

## Input modes (artifact string vs URL vs iframe)

The core function takes an **HTML string** (`page.setContent`). Two other common inputs are just
thin adapters over the same `captureHtml` core — see `docs/CODE_TEMPLATES/capture-service.ts` for
`captureUrl()`:

- **Inline artifact** (HTML/CSS/JS stored as strings, e.g. an AI-generated page): assemble into
  one document with `buildFullDoc(html, css, js)`, then `captureHtml(doc, format)`.
- **Live URL** (the artifact is already served, e.g. a preview route): `page.goto(url, { waitUntil:
  "networkidle0" })` instead of `setContent`. Use this when the content depends on
  server-rendered data you don't want to duplicate client-side.
- **Iframe's content specifically** (parent page embeds the target in an `<iframe>`): either (a)
  serve the iframe's `src` directly and use the URL mode above — simplest and preferred — or
  (b) if you must screenshot within the parent page's rendering context, use
  `page.frames().find(f => f.url() === targetSrc)` and call `.evaluate`/measure on that frame,
  then clip the parent screenshot to the iframe's bounding box via `page.screenshot({ clip })`.
  Prefer (a) unless the iframe content is genuinely inseparable from parent-page state.

## Further reading

- `docs/ARCHITECTURE.md` — full end-to-end architecture as implemented in the source project
  (three flows, storage layout, security model, MongoDB shapes) — read this to understand *why*
  each piece exists before adapting it.
- `docs/CODE_TEMPLATES/` — copy-paste-ready, framework-agnostic code.
- `docs/PORTING_CHECKLIST.md` — testable steps to verify the port works end-to-end.
- `AGENTS.md` — operating contract + known gotchas for the agent doing the port.
