# Artifact Lifecycle — Execution Plan

> **Authority:** `docs/specs/ARTIFACT_LIFECYCLE_SPEC.md` (`AL-NNN`). This plan closes the
> conformance gaps in that spec's section 9. It adds no rules; where plan and spec disagree, the
> spec wins.
>
> **Principle:** this behaviour used to work. The job is to restore it with more robustness, not to
> rebuild it. **No new collections, no new subsystems.** What is needed is metadata already
> half-present, relations made explicit on ids that already exist, and invariants enforced in one
> place instead of trusted to every caller.
>
> **For implementing agents:** read `docs/specs/ARTIFACT_LIFECYCLE_SPEC.md`, then only your batch.
> Each batch owns its files exclusively. If your change seems to need a file owned by the other
> batch, stop and report — do not widen scope (AL-031). Cite the `AL-NNN` rule in your commit.

---

## What this plan deliberately does NOT do

Cut after review, because each was overhead rather than restored function:

| Cut | Rule | Why |
|---|---|---|
| Integrity-check script | AL-036 | Diagnostic, not functional. The same queries run ad hoc when needed; a committed script is a thing to maintain. |
| Project-wide compacted prompt history view | AL-030 | A new view. Becomes cheap once ids exist; not needed to restore correctness. |
| Prompt tab resolving by selected version | AL-028 | Same — trivial once AL-026 lands, and not what is broken today. |
| Unsaved-editor-state hole | AL-019 | Real, but it changes what feeds the model. Higher risk than payoff right now. Left open deliberately. |
| Branching as its own wave | AL-013 | The *behaviour* already works: the seed is the active version, enforced server-side since 2026-08-26. Only the **notice** is missing — one line, folded into Batch B. |

Everything below is either a one-line change, a field already defined that nobody populates, or a
bug that currently ships to production.

---

## Two batches, disjoint file sets, run in parallel

| Batch | Scope | Files |
|---|---|---|
| **A** | Backend: metadata, relations, invariants | `apps/api/**`, `packages/contracts/**` |
| **B** | Frontend: the production bug, and making the chain visible | `apps/web/**` |

They do not share a file. `AL-037` is held back and applied by the integrator after `AL-009` is
verified live — shipping the guard before the fix would break WYSIWYG saves outright.

---

## Batch A — backend

### A1 · AL-026 — a version records the execution that produced it

The id already exists and is already returned: `llmChatPreviewResponse.promptExecutionId`
(`packages/contracts/src/llm.ts:332`, populated at `llmRoutes.ts:913` and `:1532`). Nothing
generates it, nothing needs to. It is simply never stored on the snapshot.

- add `promptExecutionId: z.string().max(100).optional()` to `previewSnapshotMetadataSchema`
  (`packages/contracts/src/preview.ts:13`), beside the existing `wysiwygSessionId`
- ensure it survives persistence into `preview_snapshots.metadata`

That is the whole change. No new field on the entity root, no new collection: it is metadata, which
is where the other execution facts (`model`, `provider`, `tokenUsage`) already live.

Batch B passes the value from the client. Until both land the field is simply absent — inert, not
broken.

**Acceptance:** a snapshot created with `metadata.promptExecutionId` stores and returns it; one
created without is unaffected.

### A2 · AL-015 — deleting a version re-links its children

`DeletePreviewSnapshot.execute()` refuses to delete the active snapshot, then deletes. Children keep
a `parentSnapshotId` that no longer resolves. 0 orphans today — latent, not live.

- add `relinkChildren(projectId, fromParentId, toParentId?): Promise<number>` to
  `PreviewSnapshotRepository` and its Mongo implementation
- call it **before** the delete, re-parenting children to the target's own `parentSnapshotId`
  (which may be undefined — children of a deleted root correctly become roots)

**Acceptance:** mid-chain delete re-parents to the grandparent; root delete leaves children as
roots; leaf delete changes nothing; the re-link is project-scoped.

### A3 · AL-025 — export resolves the active version at project scope

`ExportLayer1Zip` uses `getActive(projectId, conversationId)`. Activation is project-scoped
(`activateForProject` deactivates every snapshot in the project) and `PublishProject` already reads
`getActiveForProject`. Two readings of one concept.

- when no explicit `snapshotId` is supplied, use `getActiveForProject(projectId)`
- leave the explicit-`snapshotId` path alone; fix the error message, which still tells the caller to
  supply a `conversationId`

**Acceptance:** export with no `snapshotId` returns the project's active version even when it
belongs to another conversation; existing export tests pass.

---

## Batch B — frontend

### B1 · AL-009 — persist the source, not the rendered preview

**This is the one that currently ships to production.** The preview iframe is sandboxed and cannot
send an auth header, so `resolvePreviewAssetUrls` rewrites project-asset URLs into base64 data URIs
before the html reaches `srcdoc`. WYSIWYG EDIT reads that DOM back and persists it.

Measured: one artifact 10.703 → 131.884 characters, 107.725 of base64 across 3 images. 30 of 195
stored snapshots contaminated, 19,6 MB. `PublishProject` reads the active version, so the published
site ships it too.

`resolvePreviewAssetUrls` (`apps/web/app/workspace/features/preview/resolvePreviewAssetUrls.ts:39`)
already builds the `replacements` map and discards it.

- return the map from `resolvePreviewAssetUrls`
- keep it alongside the existing `previewAssetResolved` state (`page.tsx` ~line 1827), which already
  tracks `sourceHtml`/`sourceCss`
- in `handleCommitEditVersion` (`page.tsx:1685`), apply the map **in reverse** (dataUrl →
  original URL) to the incoming html before it reaches `saveWysiwygEditState` or
  `createPreviewSnapshot`. **Both branches** need it — the session commit and the degraded direct
  create

Details that matter: reverse longest-key-first so one data URI cannot partially match another; leave
unknown data URIs untouched (they may be genuinely authored by the model — AL-009 forbids only the
ones the pipeline introduced); do not change what the preview renders, only what is persisted.

**Acceptance:** a WYSIWYG save on a project with 3 resolved images persists html within a few
hundred characters of the pre-edit source, not 12×; the text edit survives; the preview still shows
images afterwards; unit test on the reverse function covering exact round trip, longest-match-first,
and unknown-URI preservation.

### B2 · AL-011 — version numbers derive from the seed chain

`SnapshotHistoryPanel` computes `const vn = snapshots.length - i` — list position. That
misrepresents history as soon as a branch exists and renumbers survivors when one is deleted.

`PreviewSnapshot.parentSnapshotId` is **already in the client DTO**. No backend work.

- add `apps/web/app/workspace/features/versions/versionNumbering.ts`, one pure function
  `buildVersionIndex(snapshots): Map<string, number>` — number = depth along the chain
- **legacy fallback (decided):** a root that is not the earliest snapshot in its project is treated,
  *for display only*, as descending from the previous snapshot by `createdAt`. 158 of 195 stored
  snapshots are pre-enforcement roots; without this they would all render as "v1". Nothing is
  written to the database — the chain records what happened, and an inferred lineage does not
  belong in it
- replace the positional computation in the panel with a lookup

**Acceptance:** a linear project numbers v1…vN exactly as today; a branched project numbers each
path by its own depth; a legacy all-roots project numbers sequentially by time; unit tests for
linear, branched, legacy-flat, single-version and empty.

### B3 · AL-023 — show which version is live

`SiteDeploymentDto.snapshotId` exists and `usePublish` already holds `publishDeployment`. Nothing to
fetch.

- pass `publishDeployment` into `SnapshotHistoryPanel`
- badge the version whose id matches `publishDeployment.snapshotId`, in the visual language of the
  existing badges (`✏ manuale`, `✎ EDIT`, `⊕ GJS`)
- add one line to the panel header — "live: v4 · stai lavorando su v9" — so "what is live, and how
  far have I moved?" is answerable without leaving the workspace

**Acceptance:** the published version is badged; with nothing published there is no badge and no
divergence line.

### B4 · AL-014 — say so when the next change will branch

The behaviour is already correct (seed = active version). Only the notice is missing: when the
active version is not the newest, state near the composer that the next change branches from it, and
that the newer versions stay reachable.

One line of copy plus a condition. No data model change.

### B5 · AL-026 / AL-029 — pass the ids that already exist

- pass `llm.promptExecutionId` into `createPreviewSnapshot` as `metadata.promptExecutionId` at both
  snapshot-creating call sites in `page.tsx` (~1145 and ~2326)
- pass `focusContext` when the generation was a focused edit. The field is already in
  `createPreviewSnapshotSchema`, in the entity and in the use case — **0 of 195 snapshots have it
  populated** because no client call site ever sends it

**Acceptance:** after one generation the snapshot carries the execution id; after one focused edit
the snapshot records the element that was targeted.

---

## Batch C — version certification (after A and B)

**Rules:** AL-039…AL-045, spec section 11. Runs after A and B because it touches the same write
path both of them modify.

This is the structural guarantee, and it supersedes AL-037 in importance: rejecting a version for
containing data URIs cures one symptom, while certifying the base of every write catches the class.

**The primitive already exists in this codebase.** `CanonicalBriefEnvelope.contentHash`
(`buildCanonicalGenerationBrief.ts:37`) certifies that the text a `PipelineRun` froze is the text
that reaches the model. Batch C applies the same sha256-over-content pattern to the artifact. No new
collection, no new subsystem — a hash in metadata and two fields on a request.

### C1 · AL-039 — every version carries a content hash

Computed server-side in `CreatePreviewSnapshot.execute()` from the persisted artifacts, stored in
`metadata.contentHash` beside `promptExecutionId` (added by A1). Server-side because a hash the
client supplies certifies nothing.

### C2 · AL-040 / AL-041 — writes declare their base and the server verifies it

The write already carries `parentSnapshotId`; what is missing is the hash and the check.

- add `baseContentHash` to `createPreviewSnapshotSchema`
- in `CreatePreviewSnapshot.execute()`: when a base is declared, verify it exists, that it is the
  currently active version (AL-016) or the one explicitly selected, and that its stored
  `metadata.contentHash` equals the declared one
- on mismatch reject with a distinct code (e.g. `ARTIFACT_BASE_STALE`) and a message that says which
  version the server believes is current

Backwards compatibility: versions stored before C1 have no `contentHash`. Treat a missing stored
hash as "cannot verify" and accept, logging it — do not lock users out of their own history.

### C3 · AL-042 / AL-043 — the client declares what it loaded

When an editor loads an artifact it records the snapshot id and hash it loaded and carries them into
the write. All four editing modes — chat, focused edit, WYSIWYG, code editor — declare the **same**
base: switching mode does not re-base.

On `ARTIFACT_BASE_STALE` the client re-synchronises and tells the user which version is current. It
does not retry blindly and it does not overwrite.

### C4 · AL-045 — a no-op creates no version

If the computed hash equals the base hash, return the base instead of creating a version. Four
snapshots recorded on 2026-08-26 carry byte-identical html of 10.702 characters; they are noise that
makes the real changes harder to find.

### AL-037, demoted

Optional, and only where it stays cheap: reject a version introducing data URIs its base did not
have. The parent is already fetched in `CreatePreviewSnapshot`, so the comparison costs nothing —
but it is a content check on one known failure, not a substitute for C1–C4, and it must land after
B1 or WYSIWYG saves break outright.

**Acceptance for Batch C:** a write declaring a stale base is refused with the distinct code and the
client recovers by re-syncing; a write declaring the current base succeeds; a write against a
pre-C1 version without a stored hash succeeds and is logged; an edit that changes nothing creates no
version; switching editing mode does not change the declared base.

---

## Verification, both batches

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
npx vitest run --root apps/api --no-file-parallelism
```

`--no-file-parallelism` is required: MongoMemoryServer spawn contention on Windows fails different
tests on each run, environmentally, not because of code.

Live verification runs against the **deploy** stack (`docker-compose.deploy.yml`). Confirm which
stack is running before any Docker command and use `--no-deps` for a single service. Never restart
MongoDB to propagate a change.

Any live LLM call must use a model from `tests/config/authorized-test-models.json`, and the pipeline
model override must be set **before** launching a wizard flow — the default cascade picks a model
that is not on the list.

---

## Definition of done

The corresponding rows in section 9 of `ARTIFACT_LIFECYCLE_SPEC.md` move to ✅, each with a test
pinning it. Per AL-038, a rule that moves to ✅ without a test has not moved.
