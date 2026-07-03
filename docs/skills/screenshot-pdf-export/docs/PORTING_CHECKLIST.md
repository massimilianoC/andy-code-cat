# Porting Checklist — Screenshot / PDF Capture

Run through this after implementing the feature in a new project (see `AGENTS.md` for the
implementation order this assumes).

## Environment

- [ ] `puppeteer` installed in the backend package that will call `captureHtml`/`captureUrl`.
- [ ] Chromium OS package added to **every** Dockerfile stage that runs capture code (dev + prod).
- [ ] `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and `PUPPETEER_EXECUTABLE_PATH` set as image `ENV`,
      before `npm install`/`npm ci`.
- [ ] `verify-puppeteer.js` (see `dockerfile-snippet.md`) runs successfully **inside the built
      container image**, not just on the host machine.

## Core function

- [ ] `capture-service.ts` (or your adapted version) has **no imports** from the app's
      domain/DB/auth layers — it only takes `(html | url, format, options)` and returns `Buffer`.
- [ ] `browser.close()` happens in a `finally` block — verified by forcing an error mid-capture
      and checking no Chromium process leaks (`ps aux | grep chrom` in the container).
- [ ] Functions passed to `page.evaluate()`/`page.waitForFunction()` are template strings, not
      native function references (if your build uses esbuild/tsx/similar).

## Flow B — on-demand capture

- [ ] Endpoint sits behind the same auth/ownership middleware as every other route touching this
      content — not a weaker "just a file download" exception.
- [ ] `format=jpg` request → 200, valid JPEG, file size consistent with actual visible content
      (not a near-empty blank-white image — check bytes, not just status code).
- [ ] `format=pdf` request → 200, valid PDF, opens without corruption warnings in a real PDF
      viewer.
- [ ] For multi-section/long-form content: PDF page breaks land between sections, not mid-image
      or mid-paragraph.
- [ ] Requesting an unknown/nonexistent content id → 404, not a Puppeteer crash.

## Flow A — background thumbnail (only if implemented)

- [ ] Scheduling call is fire-and-forget (`.catch().finally()`, not `await`ed) in the
      create/save handler — verify the HTTP response returns before the capture finishes (e.g.
      by adding a temporary delay in the capture path during testing).
- [ ] Triggering creation/save twice rapidly for the same content id results in **one** Chromium
      launch, not two (check via logs or process count).
- [ ] `GET .../thumbnail` returns 404 before the job completes, then 200 with the image after.
- [ ] `Cache-Control` header is set for long-lived caching (thumbnails are immutable per content
      id once generated).

## Flow C — export-embedded capture (only if implemented)

- [ ] `Promise.all` failure isolation: forcing one of the two captures (jpg or pdf) to throw does
      not abort the whole export — the bundle still contains whatever succeeded.
- [ ] Download mechanism (signed link / direct stream / whatever the project already uses)
      derives any file path from server-verified IDs, never from raw request input.

## Security

- [ ] No route accepts an arbitrary external URL to pass into `captureUrl()` without an explicit
      SSRF review (allowlist, network isolation). If URLs are accepted, confirm they're
      constrained to the app's own trusted domains/routes.
- [ ] Capture/export routes enforce the same tenant/ownership isolation as the rest of the app.

## Performance sanity check

- [ ] A single capture completes within an acceptable time budget for your content's typical
      size/complexity (source project baseline: 10–30s for on-demand, ~5–10s for background
      thumbnails — recalibrate for your content).
- [ ] No shared long-lived browser instance accumulating open pages (unless you deliberately
      built pooling with proper lifecycle management — most projects should not need this).
