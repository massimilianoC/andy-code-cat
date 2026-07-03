# Architecture — Screenshot / PDF Capture (source: Andy Code Cat)

This document describes **how the source project actually implements** artifact-to-image/PDF
capture, as a reference for adapting the pattern elsewhere. Paths below are the *original*
locations in Andy Code Cat (`apps/api/...`) — use them to go read the real code if you need more
detail than this document provides; do not assume these paths exist in the target project.

## 1. Technology choice

| Library | Version (source project) | Role |
|---|---|---|
| `puppeteer` | `^24.40.0` | Headless Chromium — the only rendering engine used |
| `archiver` | `^7.0.1` | ZIP bundling for export-embedded captures |
| `cheerio` | `^1.2.0` | HTML post-processing (extracting inline `<style>`/`<script>`) |

No `html2canvas`, `jspdf`, `wkhtmltopdf`, `weasyprint`, or `playwright` — Puppeteer covers both
screenshot and PDF needs via one browser engine, which avoids maintaining two rendering pipelines
with potentially different CSS support.

## 2. The three flows

```
Artifact created/saved (HTML/CSS/JS in memory or DB)
  │
  ├─[A]─→ Background thumbnail job (fire-and-forget, non-blocking)
  │         captureHtml(doc, "jpg") → store JPEG → update record.thumbnailPath
  │
  ├─[B]─→ On-demand capture (user clicks "Download JPG/PDF")
  │         GET .../capture?format=jpg|pdf → captureHtml(doc, format) → stream buffer
  │
  └─[C]─→ Export-embedded capture (bundling a ZIP with source + preview)
            Promise.all([captureHtml(doc,"jpg"), captureHtml(doc,"pdf")]) → add to ZIP
```

All three call the **same core function**, `captureHtml(html, format, options)`, defined once in
`apps/api/src/infra/capture/PuppeteerCaptureService.ts`. This single-source-of-truth design is the
main thing worth preserving when porting: don't let each flow grow its own Puppeteer
launch/wait/capture logic.

### Flow A — Background thumbnail (`SnapshotThumbnailJob`)

- Triggered right after a content record is created/activated, in the same HTTP handler that
  creates it — but **not awaited**.
- De-duplication: an in-memory `Set<string>` keyed by `${projectId}:${snapshotId}` prevents two
  concurrent Chromium launches for the same content if the user re-triggers quickly.
- Errors are caught and logged; they must never bubble into the HTTP response of the handler that
  scheduled them (the handler has already returned by the time the job runs).
- Result: JPEG buffer written to file storage at a deterministic path
  (`/data/thumbnails/{projectId}/{snapshotId}.jpg` in the source project), then the DB record is
  updated with the storage path. A dedicated `GET .../thumbnail` endpoint streams it with a
  long-lived `Cache-Control` header (thumbnails are immutable per content ID).
- Client UX: the endpoint returns 404 while the job hasn't completed yet; the frontend polls or
  just retries on next page load — no WebSocket/SSE needed for this in the source project.

### Flow B — On-demand capture (`CapturePreviewSnapshot` use-case)

- Synchronous HTTP request: `GET /projects/:projectId/preview-snapshots/:snapshotId/capture?format=jpg|pdf`.
- Loads the content, rebuilds a full HTML document (`buildFullDoc`), optionally resolves a
  "preset" describing PDF layout intent (slide deck vs single long page vs explicit print CSS),
  then calls `captureHtml`.
- Returns the buffer directly as `Content-Disposition: attachment` — no persistence, every
  request re-renders. Acceptable because usage is low-frequency (explicit user action), not a
  cached asset like the thumbnail.
- Latency: 10–30s depending on content complexity; the client shows a loading state
  (spinner/notification) for the duration.

### Flow C — Export-embedded capture (`ExportLayer1Zip` use-case)

- Runs both formats **in parallel** with `Promise.all`, each wrapped in `.catch(() => null)` so a
  capture failure doesn't abort the whole export — the ZIP is built with whatever succeeded.
- Bundled into a ZIP alongside post-processed source files (`index.html`, `style.css`,
  `script.js`) and a dynamically generated `README.md`.
- Download is via a short-lived signed JWT (`sub: exportId`, separate secret from the app's auth
  JWT), so the download endpoint can verify without a DB round-trip and without exposing a raw
  file path.

## 3. Core capture function — `captureHtml(html, format, options)`

Source: `apps/api/src/infra/capture/PuppeteerCaptureService.ts` (261 lines). Behavior, in order:

1. **Launch** headless Chromium with `{ headless: true, args: ["--no-sandbox",
   "--disable-setuid-sandbox"] }`. Honors `PUPPETEER_EXECUTABLE_PATH` env var to point at an
   OS-installed Chromium instead of Puppeteer's bundled download.
2. **New page**, viewport fixed at `1280×800`.
3. **Media emulation**: `"print"` for PDF captures (so `@media print` rules apply), `"screen"`
   for JPEG.
4. **Load content**: `page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 })`.
5. **PDF-only pre-processing** (see §4 below): inject section-aware print CSS and/or annotate
   top-level sections with `data-pdf-section` if the content has no explicit print layout.
6. **Wait for real readiness** — this sequence exists because `networkidle0` alone produced
   blank/partial captures in production:
   - `document.readyState === "complete"` **and** no broken/pending images
     (`waitForFunction`, 15s timeout).
   - `document.fonts.ready` (web font painting).
   - **Auto-scroll**: step through the page in half-viewport increments with a 300ms pause per
     step, then scroll back to top. This triggers `IntersectionObserver`-based lazy-load and lets
     CSS transitions/animations settle before the shot.
   - A final flat **800ms settle delay** for sticky elements and scroll-triggered reveals.
7. **Capture**:
   - JPEG: `page.screenshot({ type: "jpeg", quality: 92, fullPage: true })`.
   - PDF: `page.pdf({ printBackground: true, format: <policy>, preferCSSPageSize: <policy>,
     margin: 0 })`.
8. **Always `browser.close()` in a `finally` block**, even on error.

## 4. PDF pagination heuristic (`resolvePdfCapturePolicy`)

Long-form single-page content (e.g. an AI-generated landing page) usually has no `@page`/`@media
print` rules and no natural page breaks — printed naively, it produces PDFs that slice images and
text boxes mid-element at arbitrary points. The source project handles this with a three-way
decision:

```
if pageModel is "slide_deck" or "print_a4", OR the content already declares
  @page / @media print / a "slide"/"page"/"pdf-page-break" class / data-pdf-page(-section):
    → respect the content's own print layout as-is
    → emulateMedia: "print", preferCssPageSize: true
    → (print_a4 also sets a hard "A4" fallback format)

else (no explicit print intent):
    → emulateMedia: "print", preferCssPageSize: false, fallbackFormat: "A4"
    → inject SECTION_AWARE_PRINT_STYLES (see below)
    → auto-annotate top-level sections with data-pdf-section (see below)
```

`SECTION_AWARE_PRINT_STYLES` — a `@media print` block that:
- Zeroes body margin/padding, forces `print-color-adjust: exact` so backgrounds/colors survive
  printing.
- Sets `break-inside: avoid-page` on `img`, `svg`, `canvas`, `table`, `pre`, `blockquote`, and any
  `[data-pdf-section]` — prevents mid-element page splits.
- Forces a page break **before** each `[data-pdf-section]` that follows another one — one section
  per page (roughly).
- Keeps headings (`h1`/`h2`/`h3`) attached to the content that follows them
  (`break-after: avoid-page`).

`annotatePdfSections(page)` — injected browser-context JS (passed **as a string**, not a function
reference — see AGENTS.md gotchas) that, only if no explicit markers already exist:
- Marks direct semantic children of `<body>` (`header`, `section`, `article`, `footer` — not
  `main`) as sections.
- Inside `<main>`, marks children that are either semantic tags or "big enough"
  (height ≥ 260px or containing a heading) as sections; if none qualify, marks `<main>` itself as
  one section.
- Uses a visibility check (`rect.height >= 120`, not `display:none`/`visibility:hidden`) so
  hidden/collapsed elements aren't marked.

This heuristic is content-agnostic — it works without knowing anything about the specific HTML
structure beyond generic semantic tags and size thresholds. Worth keeping as-is when porting;
it's the most "clever" piece of the whole pipeline and the part most likely to need retuning per
project's typical content shape.

## 5. Storage layout (source project)

```
/data/
├── thumbnails/{projectId}/{snapshotId}.jpg   ← Flow A output
├── exports/{userId}/{projectId}/{exportId}.zip ← Flow C output (includes jpg+pdf inside)
```

Behind an `IFileStorage` interface with two implementations (`LocalFileStorage` — disk bind
mount, `MinioFileStorage` — S3-compatible), selected via an env var. **The capture service itself
has zero knowledge of storage** — it only returns a `Buffer`; storage is entirely the caller's
responsibility. This separation is what makes `capture-service.ts` portable — replicate it.

## 6. Security model

- **Auth**: every capture/export route sits behind the same auth + tenant-ownership middleware as
  every other mutating/reading route in the app (in the source project: JWT auth + a
  "double sandbox" check verifying `project.ownerUserId == jwt.sub`). The capture endpoint is not
  treated as a special "just returns a file" exception.
- **No SSRF surface**: the content rendered is always the caller's own stored artifact
  (HTML/CSS/JS strings from the DB) — Puppeteer never navigates to an arbitrary
  externally-supplied URL. If you extend this pattern to accept URLs, that introduces an SSRF
  vector and needs its own review (allowlisting, network isolation, etc.) — see AGENTS.md §4.
- **Download tokens**: the export flow signs a short-lived JWT (separate secret from the main
  auth JWT) so the download endpoint can verify without a DB round-trip, and the storage path is
  derived entirely from the verified JWT payload (`exportId`, `userId`, `projectId`) — never from
  raw request input, preventing path traversal.

## 7. Docker / runtime setup

The Puppeteer-bundled Chromium download is skipped in favor of an OS package, both to shrink the
image and to avoid known sandboxing friction with the bundled binary in constrained containers:

```dockerfile
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

Applied identically in **both** the dev and prod Docker stages — Chromium is needed at runtime in
every environment that calls `captureHtml`, not just production.

## 8. Performance characteristics (as observed in the source project)

| Parameter | Value | Rationale |
|---|---|---|
| Viewport | 1280×800 | Standard desktop preview size |
| JPEG quality | 92 | Good size/quality tradeoff for previews |
| `waitForFunction` timeout | 15s | Images/fonts readiness |
| `setContent` timeout | 30s | Hard ceiling on total load wait |
| Settle delay | 800ms | Sticky elements, scroll-triggered reveals |
| Thumbnail job latency | ~5–10s | Background, non-blocking |
| On-demand capture latency | 10–30s | Foreground, user waits |
| Export (jpg+pdf parallel) | 20–60s | Part of a larger ZIP-build job |

No shared browser pool — every call launches and closes its own Chromium instance. Simpler and
safer (no leaked-page accumulation) at the traffic volumes this pattern was built for; revisit
only if capture volume grows enough that launch overhead (~200–500ms) becomes a measured
bottleneck.
