# AGENTS.md — Operating Contract for Porting ZIP Export

This file is a self-contained checklist for a coding agent asked to add "export the agent's
generated output as a ZIP" to a **different** project. It assumes no memory of the source project
(Andy Code Cat) — read `docs/ARCHITECTURE.md` first for the "why", then follow this file for the
"how".

## 0. Confirm the target environment before writing code

Ask/verify (don't assume):

1. Where does "the current agent output" actually live in this project — a snapshot/document
   record, the last assistant message's structured content, a live editor buffer? This is the
   single input the post-processor needs (`{ html, css, js }`).
2. Does CSS/JS ever arrive as **separate fields** from the HTML, or is it always inline in
   `<style>`/`<script>` tags? If always inline, you can drop the "dedicated field wins" logic
   entirely and simplify the post-processor — don't port unused complexity.
3. Is there an existing file storage abstraction (local disk, S3/MinIO, etc.)? Reuse it — do not
   invent a new storage layer. The ZIP builder only needs to write bytes somewhere and later read
   them back; storage is the caller's concern, same as the screenshot/PDF capture skill.
4. Is there an existing signed-token pattern in the project (e.g. for other download links,
   password reset, email verification)? Reuse the JWT/HMAC library already in use — don't add a
   second token library for this one feature.
5. Does the project have a concept of "content still being generated" (e.g. an image the agent
   kicked off generation for but hasn't finished)? If yes, the export must have a blocking gate
   that refuses to ship a bundle with unresolved placeholders (see `docs/ARCHITECTURE.md` §
   Blocking gate). If no such concept exists, skip this entirely.

## 1. Implementation order

1. **Copy `post-processor.ts`** (from `docs/CODE_TEMPLATES/`) into the backend. Keep it
   dependency-free from the rest of the app (no imports from your domain/DB/auth layers) — it
   should only take `{ html, css, js }` and return `{ html, css, js, placeholders }`. This is what
   makes it unit-testable without mocking infrastructure, and portable across projects in the
   first place.
2. **Unit-test the post-processor first**, before wiring any routes, with 3-4 fixture HTML
   strings: inline-only, separate-fields-only, both-present (must not duplicate), no-JS. This is
   the highest-value test in the whole feature and the cheapest to write (pure function, no I/O).
3. **Wire the export use case**: build the ZIP, compute sha256, persist an `ExportRecord`
   (`pending` → `ready`/`failed`), sign the download token. Reuse the project's existing
   `ExportRecord`-equivalent persistence pattern if one exists (e.g. how the project already
   tracks other async/generated artifacts); otherwise a minimal DB collection or even an in-memory
   `Map` with a TTL cleanup is an acceptable MVP.
4. **Wire the HTTP routes** behind the same auth/ownership middleware as every other route
   touching this content — do not add a separate, weaker auth path just because it "just returns a
   file."
5. **Add the frontend button** last, once the backend round-trip works via curl/Postman. Verify
   the create → download flow manually before wiring UI state.
6. **Screenshot embedding (optional)**: only add if explicitly requested. It requires the
   companion `screenshot-pdf-export` skill; treat it as best-effort (`.catch(() => null)`) so a
   capture failure never blocks the export itself.

## 2. Non-negotiables (carried over from the source project's incident history)

- **"Dedicated CSS/JS field wins over HTML-extracted content" is load-bearing, not a stylistic
  choice.** Do not "simplify" it away by always merging both sources — that reintroduces
  duplicated `<style>`/`<script>` rules in the shipped bundle whenever the agent returns both an
  inline preview copy and a separate editable-field copy of the same content.
- **Never build a file/object-storage path or key from raw request input.** Always derive it from
  IDs the server already verified (authenticated user, ownership-checked project, server-generated
  export ID) — never from a query param, header, or body field taken verbatim. This is the same
  path-traversal discipline as any file-serving feature.
- **The download-token signing secret must be distinct from the main session/auth JWT secret**,
  even if both live in the same `.env` file. A leaked download token (short TTL, narrow scope)
  must not be replayable as a session token, and vice versa.
- **404 vs 410, not 500**: a missing export file because it expired/was cleaned up is `410 Gone`;
  an unknown/invalid export id or token is `404`/`401`. Don't leak stack traces or internal paths
  in either case.
- **Optional enrichments (screenshot capture, chat-history README section) must be best-effort and
  non-blocking.** Wrap in try/catch; a failure there must never fail the export itself.
- **Ownership check on every read path** — even the authenticated status/download-by-id endpoints
  must verify `record.userId === session.userId` before returning anything, exactly like any other
  per-user resource in the app.

## 3. Decisions the agent must make explicit (don't silently default)

- **Synchronous vs. async export**: for typical HTML/CSS/JS-only bundles (no screenshot capture),
  synchronous (build within the request, < 2s) is simpler and sufficient. Only introduce a
  `pending` status + polling if you add expensive steps that can push latency past a few seconds.
- **Download transport**: authenticated `GET .../download` with a Bearer header (simpler, keeps
  credentials out of URLs) vs. a public signed-token URL (`GET /download/:token`, needed for bare
  links/emails/curl). Implement the one your frontend flow actually needs — see
  `docs/ARCHITECTURE.md` § API surface for the trade-off.
- **TTL for the export file and record**: 24h is the source project's default; adjust to the
  target project's storage constraints and how long a user is realistically expected to wait
  before re-downloading.
- **Placeholder detection regexes**: the source project's patterns (empty `<img src>`, empty CSS
  `url()`, `/* replace: */` comments) match *its* agent's system-prompt conventions. Tune these to
  whatever placeholder markers the target project's own agent actually produces — don't assume the
  same regexes apply verbatim.

## 4. Explicit non-goals / do not do

- Do not build web publishing / live-hosting of the exported site as part of this feature — that
  is a separate concern (subdomain allocation, NGINX/reverse-proxy config, TLS). If the user also
  wants that, treat it as a distinct follow-up task.
- Do not build a "select which files to include" step, an export-history UI, or a fake progress
  bar for a sub-2-second synchronous export — see `SKILL.md`'s scope notes. Zero-friction, one
  click, immediate download is the entire value proposition.
- Do not add billing/quota enforcement on export frequency as part of this skill — if the host
  project has a cost/usage-ledger system, wiring that in is a separate, explicit task.
- Do not skip the pure-function unit tests for the post-processor (§1.2) and debug duplication
  bugs later inside a fully wired feature — isolate that risk first, it's the cheapest test in the
  whole feature to write.

## 5. Testable steps after porting

See `docs/PORTING_CHECKLIST.md` for the full list. Minimum smoke test:

1. Export agent output with inline `<style>`/`<script>` → unzip → `index.html` has no inline
   blocks, `style.css`/`script.js` exist, `<link>`/`<script src>` tags reference them.
2. Export output where CSS/JS also arrive as separate fields identical to what's inline in HTML →
   confirm the shipped `style.css`/`script.js` has **no duplicated rules**.
3. Export output with an empty `<img src="">` → README lists a placeholder with a sensible "used
   in" description.
4. Let a download token expire (or craft an already-expired one in a test) → download route
   returns `401`, not a stack trace.
5. Delete the underlying ZIP file but keep the record → download route returns `410`, not `500`.
