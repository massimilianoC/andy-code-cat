# Architecture — ZIP Export (source: Andy Code Cat)

This document describes **how the source project actually implements** LLM-artifact-to-ZIP
export, as a reference for adapting the pattern elsewhere. Paths below are the *original*
locations in Andy Code Cat (`apps/api/...`, `apps/web/...`) — use them to go read the real code if
you need more detail than this document provides; do not assume these paths exist in the target
project.

## 1. Technology choice

| Library | Version (source project) | Role |
|---|---|---|
| `archiver` | `^7.0.1` | Streaming ZIP assembly |
| `jsonwebtoken` | `^9.0.2` | Signed, short-TTL download tokens |
| `puppeteer` | `^24.40.0` | Optional embedded preview screenshot/PDF (see the companion `screenshot-pdf-export` skill) |

No client-side zipping library (`jszip` in the browser) — the ZIP is always built server-side,
because the post-processing (extracting inline CSS/JS, placeholder detection) needs to run
against the authoritative stored artifact, not whatever the browser currently has rendered.

## 2. End-to-end flow

```
Agent output in memory/DB (HTML + inline or separate CSS/JS)
        │
        ▼
[1] Blocking gate — refuse if unresolved async-generation placeholders exist
        │
        ▼
[2] Post-processor (pure function, no I/O)
        - strip preview-only artifacts (e.g. a CSP meta tag scoped to iframe preview)
        - extract inline <style>/<script> blocks
        - pick canonical CSS/JS source (dedicated field wins over HTML-extracted)
        - rewrite HTML to reference style.css / script.js
        - detect asset placeholders (empty <img src>, empty CSS url(), "replace:" comments)
        │
        ▼
[3] README generation (project name, file list, placeholder table, optional chat-history section)
        │
        ▼
[4] ZIP assembly (index.html, style.css, script.js, README.md, optional screenshots)
        │
        ▼
[5] Persist ExportRecord (pending → ready, fileSize, sha256) + sign short-TTL download token
        │
        ▼
[6] Client fetches the ZIP as a Blob (Bearer auth) and triggers a browser download
```

### Step 1 — Blocking gate

Before any post-processing runs, the source project asserts there are no unresolved
"AI-generated-media-still-pending" placeholders in the artifacts (`assertNoUnresolvedMediaPlaceholders`
in `apps/api/src/application/media/assertResolvedMediaPlaceholders.ts`). If any are found, it
throws a typed error (`UnresolvedMediaPlaceholderError`, HTTP 409) with the list of unresolved
keys, and emits a user-facing notification explaining what to do. This only applies to projects
that have an async-generation concept at all (e.g. an image the agent kicked off generation for
but hasn't completed yet) — skip this step entirely if the target project has no such state.

### Step 2 — Post-processor

Source: `apps/api/src/application/use-cases/ExportLayer1Zip.ts`, functions `stripMetaCsp`,
`extractInlineCss`, `extractInlineJs`, `joinUniqueBlocks`, `ensureLinkTag`, `ensureScriptTag`,
`detectPlaceholders`, composed in `postProcess()`. Full portable version:
`docs/CODE_TEMPLATES/post-processor.ts`.

The one non-obvious rule worth internalizing: **the dedicated CSS/JS field (when non-empty) is
always canonical; content extracted from `<style>`/`<script>` tags in the HTML is only the
fallback for when no dedicated field exists.** LLM agents that support live iframe preview embed
CSS/JS inline in the HTML *in addition to* returning it as separate fields (so a single
`srcdoc`/`setContent` render works without a second fetch). Treating both sources as additive
produces duplicated rules in the shipped bundle — this bit the source project during initial
implementation and was fixed by making the dedicated-field-wins rule explicit.

### Step 3 — README generation

Source: `generateReadme()` in `ExportLayer1Zip.ts`. Always includes: project name, export
timestamp/id, a "quick deploy" section (open `index.html` directly, or `npx serve .`, or point any
static host at the folder), the file list, and a placeholder table (path / used-in / recommended
size) so the user knows exactly what to swap before deploying.

Optional, project-specific: a rendered chat-history section (`renderChatHistorySection()`) showing
user prompts and assistant summaries — **never** raw artifact JSON — fetched **best-effort**
(wrapped in try/catch; the export must succeed even if this fetch fails). Only relevant if the
source of the artifact is a chat/conversation; skip for non-chat agents.

### Step 4 — ZIP assembly

`buildZip()` in `ExportLayer1Zip.ts` streams a `Record<string, string | Buffer>` map of filenames
to content into an `archiver` ZIP stream. Accepting both string and binary content in the same map
is what lets optional binary assets (the preview screenshot JPG/PDF) slot in without a separate
code path.

In the source project, the ZIP also **optionally embeds a preview screenshot** (`preview-screenshot.jpg` /
`.pdf`) captured via the companion `screenshot-pdf-export` skill's "Flow C — export-embedded
capture": both formats requested in parallel with `Promise.all`, each wrapped in
`.catch(() => null)` so a capture failure never aborts the whole export.

### Step 5 — Persistence + download token

`ExportRecord` (see `apps/api/src/domain/entities/ExportRecord.ts`) tracks:

```typescript
type ExportSourceType = "layer1_snapshot"; // extendable: what kind of output was exported
type ExportStatus = "pending" | "ready" | "failed";

interface AssetPlaceholder {
    path: string;              // e.g. "assets/placeholder-hero.jpg"
    usedIn: string;            // e.g. "<img> in HTML"
    recommendedSize?: string;  // e.g. "1200x800px"
}

interface ExportRecord {
    id: string;
    projectId: string;
    userId: string;
    sourceType: ExportSourceType;
    snapshotId?: string;
    status: ExportStatus;
    fileSize?: number;
    fileSha256?: string;
    filesIncluded: string[];
    assetPlaceholders: AssetPlaceholder[];
    downloadCount: number;
    expiresAt: Date;            // MongoDB TTL index deletes the record after this timestamp
    errorMessage?: string;
    createdAt: Date;
    readyAt?: Date;
}
```

Created as `pending` before the ZIP is built, updated to `ready` (with `fileSize`/`fileSha256`) or
`failed` (with `errorMessage`) afterward — so a mid-build crash leaves a diagnosable record instead
of silently vanishing.

The download token is a JWT signed with a secret **dedicated to exports**
(`EXPORT_JWT_SECRET`, separate from the app's session-auth JWT secret):

```typescript
const downloadToken = jwt.sign(
    { sub: record.id, userId, projectId },
    env.EXPORT_JWT_SECRET,
    { expiresIn: "1h" }
);
```

### Step 6 — Download

Two endpoint styles coexist in the source project (see `apps/api/src/presentation/http/routes/exportRoutes.ts`):

- `GET /exports/:exportId/download` — requires `Authorization: Bearer <session token>`. The
  frontend calls this with `fetch(url, { headers: { Authorization } })` and turns the response into
  a Blob, avoiding ever putting a bearer credential in a URL.
- `GET /download/:token` — public (no session auth), verifies the signed JWT and builds the
  storage path **only from the verified payload** (`userId`, `projectId`, `sub` = exportId). Useful
  for bare `<a href>` links, emails, or curl.

Both increment `ExportRecord.downloadCount` fire-and-forget and stream the file with
`Content-Disposition: attachment`.

## 3. Storage layout (source project)

```
/data/exports/{userId}/{projectId}/{exportId}.zip
```

Every path segment is a **server-verified ID** — `userId` from the authenticated session,
`projectId` from an ownership/sandbox check, `exportId` from the record the server just created.
None of these ever come from raw request input (query params, headers, body fields) taken
verbatim. If the target project has no multi-tenant/project concept, this collapses to
`/data/exports/{exportId}.zip` — the invariant that matters is "built from server-verified IDs,"
not the specific directory depth.

Behind a storage abstraction (`LocalFileStorage`, disk-backed) exposing `exportZipPath(...)`,
`ensureDir(...)`, `fileExists(...)`, `fileSize(...)`. The ZIP builder itself has zero knowledge of
*where* the file ends up — same separation-of-concerns as the screenshot/PDF capture skill's
`captureHtml`.

## 4. Security model

- **Auth**: every export route sits behind the same auth + tenant-ownership middleware as every
  other mutating/reading route in the app (JWT auth + a project-ownership check in the source
  project). Export is not treated as a special "just returns a file" exception.
- **Two-secret token design**: `EXPORT_JWT_SECRET` is distinct from the session-auth JWT secret, so
  a leaked short-TTL download token can't be replayed as a full session token and vice versa.
- **No path traversal surface**: storage paths are pure functions of verified IDs (see §3), never
  of client-supplied strings.
- **410 vs 404 vs 401 discretion**: expired-but-existed → `410 Gone`; unknown export id → `404`;
  invalid/expired token → `401`. This lets the frontend give the user an accurate message ("your
  link expired" vs "invalid link") instead of a generic failure.
- **Blocking gate for unresolved content** (§ Step 1): export must not be usable as a way to ship
  content that the platform itself considers incomplete.

## 5. Lifecycle / TTL

`expiresAt = now + 24h` is the source project's default for both the `ExportRecord` and the
underlying file. Cleanup: a MongoDB TTL index (`expireAfterSeconds: 0` on `expiresAt`) removes the
DB document automatically, but **TTL indexes only delete the database record, not the file on
disk** — a separate cleanup job (cron/interval scanning for expired records or old files in the
exports directory) is required to actually free disk space. If using object storage (S3/GCS)
instead, a lifecycle rule on the bucket/prefix can replace the custom cleanup job entirely.

## 6. Frontend integration

See `apps/web/lib/api/exports.ts` (`requestLayer1Export`, `downloadExportBlob`) and the button
wiring in `apps/web/app/workspace/[projectId]/page.tsx` (`handleExportLayer1`). Full portable
version: `docs/CODE_TEMPLATES/frontend-export-button.tsx`.

The key UX decision: **create-export and fetch-blob are two network calls, but the user only sees
one click and one spinner.** The blob is fetched with the same `Authorization` header used for
every other authenticated API call, then turned into a downloadable file via
`URL.createObjectURL` + a throwaway `<a download>` element — the standard dependency-free way to
force a browser download from an in-memory Blob without navigating the page away or exposing the
auth token in a URL.
