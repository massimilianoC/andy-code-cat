# AGENTS.md — Operating Contract for Porting Screenshot/PDF Capture

This file is a self-contained checklist for a coding agent asked to add "screenshot/PDF export of
an artifact" to a **different** project. It assumes no memory of the source project
(Andy Code Cat) — read `docs/ARCHITECTURE.md` first for the "why", then follow this file for the
"how".

## 0. Confirm the target environment before writing code

Ask/verify (don't assume):

1. Is the backend Node.js? Puppeteer is a Node library — if the target backend is not Node,
   this pattern still applies conceptually (any language can shell out to a headless-Chromium
   CLI, or run a small Node microservice dedicated to capture), but the code templates need
   translation.
2. Does the deployment run in Docker / a container with control over installed packages? If the
   target is a serverless platform (e.g. Vercel functions, AWS Lambda) with no OS package
   control, you need `@sparticuz/chromium` (or equivalent) instead of an `apk`/`apt` Chromium
   install — the code templates assume you control the container image.
3. What is the content source: an HTML/CSS/JS string already in memory (most common for
   AI-generated or CMS artifacts), or a URL the app already serves? This decides whether you use
   `page.setContent()` or `page.goto()` (see SKILL.md "Input modes").
4. Is there an existing file storage abstraction (local disk, S3/MinIO, etc.)? Reuse it — do not
   invent a new storage layer. The capture service only needs to return a `Buffer`; storage is
   the caller's concern.
5. Sync or async needed? If captures can take 10–30s and users won't tolerate a blocked request,
   plan for the "background job" flow from day one instead of retrofitting it later.

## 1. Implementation order

1. **Install Puppeteer** and add the Chromium OS package to the Docker image (see
   `docs/CODE_TEMPLATES/dockerfile-snippet.md`). Do this first and verify with a throwaway
   script that `puppeteer.launch()` succeeds inside the actual container — Chromium sandbox
   failures are a container/OS problem, not a code problem, and are far easier to debug in
   isolation than inside a full feature.
2. **Copy `capture-service.ts`** (from `docs/CODE_TEMPLATES/`) into the backend. Keep it
   dependency-free from the rest of the app (no imports from your domain/entity layer) — it
   should only take `(html, format, options)` and return `Buffer`. This is what makes it
   reusable across projects in the first place.
3. **Wire the on-demand capture route.** One HTTP endpoint, auth-protected the same way every
   other mutating/read route in your app is protected. Do not add a separate, weaker auth path
   for this endpoint just because it "just returns a file."
4. **Add the background thumbnail flow** only if you need list/card previews. Fire-and-forget
   from the create/save handler; never `await` it inline. De-duplicate concurrent jobs for the
   same content ID (see the `inFlight` Set pattern in the architecture doc) so a user rapidly
   re-saving doesn't spawn N parallel Chromium instances.
5. **Add PDF pagination only if you actually need multi-page PDFs.** For a single full-page
   screenshot exported as PDF, skip `resolvePdfCapturePolicy`/`annotatePdfSections` entirely and
   just call `page.pdf({ printBackground: true })`. Only pull in the pagination heuristic when
   the content is long-form (articles, reports, slide decks) and needs sane page breaks.

## 2. Non-negotiables (carried over from the source project's incident history)

- **`--no-sandbox --disable-setuid-sandbox` launch args are required in most containers** (root
  user inside Docker, restricted seccomp in CI). Without them, `puppeteer.launch()` throws or
  hangs. This is safe *only* because you control what HTML is rendered (your own artifacts/URLs)
  — never point this capture service at arbitrary user-supplied URLs without additional
  sandboxing (see §4).
- **Never pass native JS function references to `page.evaluate()`/`page.waitForFunction()`** if
  your build uses `esbuild`/`tsx`/similar dev-mode transpilers — they can inject helper functions
  (e.g. `__name()`) into the closure that only exist in Node's module scope, causing
  `ReferenceError` inside the browser context. Pass the function body **as a string** instead
  (`page.evaluate(\`(() => { ... })()\`)`), exactly as done in `capture-service.ts`.
- **Always wait for more than `networkidle0`.** `setContent`/`goto` resolving does not mean
  images are decoded, web fonts are painted, or lazy-load/IntersectionObserver content has
  fired. The template's wait sequence (readyState → images → fonts.ready → auto-scroll → settle
  delay) exists because skipping any one step produced blank or half-rendered captures in
  production. Don't strip steps to "optimize" latency without testing against real content.
- **Close the browser in a `finally` block.** A thrown error mid-capture must not leak a
  Chromium process — leaked processes are the #1 cause of container OOM in capture-heavy
  services.
- **One browser launch per capture call, not a shared long-lived browser**, unless you've
  measured that launch overhead (~200–500ms) actually matters and you've built proper page-pool
  lifecycle management. A shared browser instance that accumulates open pages/tabs will leak
  memory silently.
- **Storage paths must be derived from server-verified IDs (auth/session), never from raw
  request input**, if captures are persisted to disk/object storage — same path-traversal
  discipline as any file-serving feature.

## 3. Decisions the agent must make explicit (don't silently default)

- **Screenshot format**: JPEG (smaller, lossy, fine for previews) vs PNG (lossless, needed for
  transparency/precision). The template defaults to JPEG quality 92.
- **Viewport size**: 1280×800 is a reasonable desktop default; adjust if the target content is
  mobile-first or has a fixed aspect ratio (e.g. slide decks).
- **PDF page format**: fixed `A4` fallback vs `preferCSSPageSize` (respects the content's own
  `@page` rules). Default to fallback unless the content author controls print CSS.
- **Where does the JWT/download-token pattern apply?** If captures are downloaded via a
  short-lived signed link (so the download endpoint doesn't need a DB round-trip), reuse
  whatever token/secret infra the project already has for other downloads — don't introduce a
  second auth mechanism.

## 4. Explicit non-goals / do not do

- Do not point this capture service at **arbitrary externally-supplied URLs** without a
  dedicated SSRF review (headless Chromium fetching an attacker-controlled URL is a classic SSRF
  vector — it can reach internal network services). This pattern is designed for
  **your own trusted artifacts/URLs**, not a general "screenshot any website" feature.
- Do not build a bespoke queueing system for captures unless the project already has a job queue
  (BullMQ, etc.) or genuinely needs one at the traffic volume in question. Fire-and-forget +
  in-memory de-dupe (as in the template) is sufficient for most single-instance deployments.
- Do not skip the Docker verification step (§1.1) and debug Chromium launch failures inside a
  half-built feature — isolate that risk first.

## 5. Testable steps after porting

See `docs/PORTING_CHECKLIST.md` for the full list. Minimum smoke test:

1. `POST`/`GET` the capture endpoint with `format=jpg` on a known-good artifact → 200, valid JPEG
   bytes, non-trivial file size (not a blank white image).
2. Same for `format=pdf` → 200, valid PDF, correct page count for multi-page content.
3. Trigger the background thumbnail flow twice in rapid succession for the same content ID →
   only one Chromium launch happens (verify via logs), not two.
4. Kill the request mid-capture (or force an error in `page.pdf()`) → confirm no orphaned
   Chromium process remains (`ps aux | grep chrome` in the container).
