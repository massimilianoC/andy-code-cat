# Porting Checklist — ZIP Export

Run through this after implementing the feature in a new project (see `AGENTS.md` for the
implementation order this assumes).

## Post-processor (pure function)

- [ ] `post-processor.ts` (or your adapted version) has **no imports** from the app's
      domain/DB/auth layers — it only takes `{ html, css, js }` and returns
      `{ html, css, js, placeholders }`.
- [ ] Unit test: inline-only artifact (CSS/JS only in `<style>`/`<script>`, no separate fields) →
      `style.css`/`script.js` populated from extracted content.
- [ ] Unit test: separate-fields-only artifact (CSS/JS fields populated, nothing inline in HTML) →
      same result, sourced from the fields.
- [ ] Unit test: **both present with identical content** (the realistic case for iframe-preview
      agents) → shipped `style.css`/`script.js` has **no duplicated rules**. This is the test that
      catches the most common porting mistake.
- [ ] Unit test: no JS at all → `script.js` is omitted from `filesIncluded`, and the HTML has no
      dangling `<script src="script.js">`.
- [ ] Unit test: HTML with an empty `<img src="">` → `placeholders` includes one entry with a
      sensible `usedIn` description.

## Blocking gate (only if the project has async-generated content)

- [ ] The gate runs **before** post-processing, not after.
- [ ] Triggering export with an unresolved placeholder returns a `409`-style, user-actionable
      error message — not a generic 500.
- [ ] Content with no unresolved placeholders (the common case) is unaffected — gate adds no
      measurable latency.

## Storage & persistence

- [ ] `exportZipPath(userId, projectId, exportId)` (or equivalent) is a pure function of IDs the
      server already verified — grep the implementation for any raw `req.query`/`req.headers`
      value flowing into a path/key construction. There should be none.
- [ ] `ExportRecord` (or equivalent) transitions `pending → ready` (with `fileSize`/`fileSha256`)
      or `pending → failed` (with `errorMessage`) — verify by forcing a build error and checking
      the record ends up `failed`, not stuck at `pending` forever.
- [ ] Expiry is wired: either a DB TTL index **and** a separate file-cleanup job, or — if using
      object storage — a bucket/prefix lifecycle rule. Confirm the file cleanup path exists;
      TTL indexes alone only delete the database record.

## API routes

- [ ] `POST /projects/:id/export` → `201` with `id`, `filesIncluded`, `assetPlaceholders`, and a
      download token/URL.
- [ ] Unzip the downloaded file → `index.html` has no inline `<style>`/`<script>` blocks, has
      `<link href="style.css">` and/or `<script src="script.js">` only when those files exist,
      `README.md` lists the correct file set and any placeholders.
- [ ] Ownership check: a second user's session token cannot read or download another user's
      export (`403`, not `200` with someone else's data).
- [ ] Unknown export id → `404`. Expired/deleted-but-existed export → `410`. Invalid/expired
      download token (if using the public token route) → `401`. None of these return a raw stack
      trace or internal file path.
- [ ] Download works via curl with only the returned token/header — no session cookie needed for
      the public token route (if implemented).
- [ ] Calling the create-export endpoint twice in a row for the same project produces two
      independent, working exports (no crash from stale/shared state).

## Frontend

- [ ] Clicking the export button end-to-end (real browser, real network) produces a file in the
      Downloads folder within a few seconds, no extra dialog.
- [ ] Button is disabled (not hidden, not re-clickable) while `exportState === "loading"`.
- [ ] Forcing a 401 mid-flow (expire the token, or mock the fetch) triggers the app's normal
      re-auth flow, not a generic export-failed message.
- [ ] Forcing a network error on the download-blob step surfaces a specific error message/toast,
      not a silent failure.
- [ ] `URL.revokeObjectURL` is called after the download is triggered (check dev tools memory
      profile isn't accumulating blob URLs after repeated exports).

## Security

- [ ] `EXPORT_JWT_SECRET` (or equivalent) is a distinct value from the session/auth signing
      secret — grep `.env`/config to confirm they're not the same variable reused twice.
- [ ] Export/download routes enforce the same tenant/ownership isolation as the rest of the app —
      no "download by id" exception that skips the ownership check other routes have.

## Optional (only if implemented)

- [ ] Preview screenshot embedding: a forced capture failure (mock `captureHtml` to throw) does
      not abort the export — the ZIP still contains `index.html`/`style.css`/`script.js`/`README.md`.
- [ ] Chat-history README section: a forced conversation-fetch failure does not abort the export —
      the README is generated without that section.
