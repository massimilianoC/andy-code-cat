# Artifact Lifecycle — Execution Plan

> **Authority:** `docs/specs/ARTIFACT_LIFECYCLE_SPEC.md` (`AL-NNN`). This document sequences the
> conformance gaps in that spec's section 9 into executable waves. It does not add or change rules;
> where this plan and the spec disagree, the spec wins.
>
> **Status:** ready to execute. Waves W1 and W2 may run in parallel; W3 → W4 → W5 are ordered.
>
> **For implementing agents:** read `docs/specs/ARTIFACT_LIFECYCLE_SPEC.md` first, then only your
> wave. Each wave lists the files it owns exclusively. Do not touch files owned by another wave —
> if your change seems to require it, stop and report rather than widening scope (AL-031).
>
> Cite the `AL-NNN` rule in your commit message.

---

## Sequencing and why

| Wave | Rules | Depends on | Parallel with |
|---|---|---|---|
| **W1** Backend invariants | AL-015, AL-025, AL-036 | — | W2 |
| **W2** Source, not render | AL-009, AL-037 | — | W1 |
| **W3** Make the chain readable | AL-011, AL-023 | W2 (avoids `page.tsx` collision) | — |
| **W4** Branching | AL-013, AL-014 | W3 | — |
| **W5** Traceability | AL-026…AL-030, AL-019, AL-029 | — (but largest; schedule last) | — |

**Ordering constraint that matters:** AL-037 (reject data URIs at the boundary) must land *after*
AL-009 (stop producing them). Shipping the guard first would break WYSIWYG saves entirely. Both are
inside W2 for that reason — same wave, ordered steps.

**`page.tsx` is the contention point.** It is ~5.200 lines and W2, W3 and W5 all touch it. They are
sequenced rather than parallelised for that reason alone. W1 is backend-only and therefore safe to
run alongside anything.

---

## Decision required before W3

Numbering derived from the seed chain (AL-011) has to cope with legacy data: **158 of 195 stored
snapshots are roots**, written before the chain was enforced. Deriving numbers strictly from the
chain would render most existing projects as a row of "v1".

| Option | Effect | Cost |
|---|---|---|
| **(a) Display-time fallback — recommended** | A root that is not the earliest snapshot in its project is treated, *for display only*, as descending from the previous snapshot by `createdAt`. Nothing is written. | none |
| (b) Data backfill | Rewrite `parentSnapshotId` on legacy roots using the same heuristic. DB becomes self-consistent. | a migration against production data, writing an inferred lineage into a record that is supposed to certify truth |
| (c) No fallback | Legacy projects display as a flat list of v1. | unusable history for existing projects |

**Recommendation: (a).** The chain is a record of what actually happened; writing a guess into it
to make a UI tidy is the wrong trade. A display heuristic is reversible, ships today, and disappears
on its own as new versions accumulate real seeds. W1's integrity check (AL-036) reports legacy roots
in a separate bucket from genuine violations so the noise does not mask new breakage.

**This decision is the product owner's.** W3 assumes (a) unless told otherwise.

---

## W1 — Backend invariants

**Rules:** AL-015 (delete preserves the chain), AL-025 (export scope), AL-036 (integrity check).

**Files owned:**

- `apps/api/src/application/use-cases/DeletePreviewSnapshot.ts`
- `apps/api/src/application/use-cases/ExportLayer1Zip.ts`
- `apps/api/src/domain/repositories/PreviewSnapshotRepository.ts`
- `apps/api/src/infra/repositories/MongoPreviewSnapshotRepository.ts`
- `apps/api/src/scripts/artifactIntegrityCheck.ts` *(new)*
- corresponding files under `apps/api/src/**/__tests__/`

### W1.1 — AL-015: deleting a version re-links its children

Current: `DeletePreviewSnapshot.execute()` refuses to delete the active snapshot, then calls
`deleteById`. Children keep a `parentSnapshotId` that no longer resolves. There are 0 orphans today,
so this is latent corruption, not live damage.

Required: before deleting, re-link every snapshot whose `parentSnapshotId` is the target to the
target's own `parentSnapshotId` (which may be undefined — that is correct, they become roots only if
the deleted node was itself a root).

Add `relinkChildren(projectId, fromParentId, toParentId?): Promise<number>` to the repository port
and its Mongo implementation. Perform the re-link **before** the delete, so a failure leaves the
chain intact rather than severed.

Acceptance:

- deleting a mid-chain version re-parents its children to its grandparent
- deleting a root re-parents its children to no parent
- deleting a leaf changes nothing else
- the re-link is scoped to the project (no cross-project writes)

### W1.2 — AL-025: export resolves the active version at project scope

Current: `ExportLayer1Zip` calls `getActive(projectId, conversationId)` — conversation scope. But
activation is project-scoped (`activateForProject` deactivates every snapshot in the project), and
`PublishProject` reads `getActiveForProject`. Two readings of one concept.

Required: when no explicit `snapshotId` is supplied, resolve via `getActiveForProject(projectId)`.
Keep the explicit-`snapshotId` path unchanged. Update the error message, which currently tells the
caller to supply a `conversationId`.

Acceptance:

- export with no `snapshotId` returns the project's active version even when the active version
  belongs to a different conversation than the one passed
- export with an explicit `snapshotId` is unaffected
- the existing export tests still pass

### W1.3 — AL-036: integrity check

New script, runnable on demand, reporting per project:

1. versions whose `parentSnapshotId` does not resolve (orphans)
2. projects with more than one root, **split into**: roots created before 2026-08-26 (legacy,
   informational) and after (genuine violations)
3. projects whose active-version count is not exactly 1
4. published versions (`site_deployments.snapshotId`, status `live`) that no longer exist
5. versions with empty `html`
6. versions whose `html` contains `data:image/` payloads (AL-009 contamination — 30 today)

Output: a readable summary plus a non-zero exit code when category 1, 3 or 4 is non-empty. Follow
the conventions of the existing scripts in `apps/api/src/scripts/`. Add an npm script entry.

Acceptance: run against the local database, report matches the counts in the spec's section 9
(158 legacy roots, 0 orphans, 30 contaminated).

---

## W2 — Source, not render

**Rules:** AL-009 (a version persists the source artifact), AL-037 (reject at the boundary).

**Files owned:**

- `apps/web/app/workspace/features/preview/resolvePreviewAssetUrls.ts`
- `apps/web/app/workspace/[projectId]/page.tsx` — **only** `handleCommitEditVersion` and the
  `resolvePreviewAssetUrls` effect (~line 1820)
- `apps/api/src/application/use-cases/CreatePreviewSnapshot.ts`
- corresponding tests

### Why it happens

The preview iframe is sandboxed and cannot send an auth header, so `resolvePreviewAssetUrls`
rewrites every project-asset URL in html/css into a base64 data URI before the html goes into
`srcdoc`. WYSIWYG EDIT mode then reads the iframe's DOM back (`pf-edit-save`) and persists it, data
URIs included.

Measured: one artifact went 10.703 → 131.884 characters, 107.725 of them base64 across 3 images.
30 of 195 stored snapshots are contaminated, 19,6 MB in total. Everything downstream inherits it —
subsequent requests carry it as `currentArtifacts`, and `PublishProject` reads the active version,
so the published site ships it too.

### W2.1 — AL-009: reverse the substitution before saving

`resolvePreviewAssetUrls` already builds a `replacements` map (originalUrl → dataUrl) internally and
throws it away. Return it.

Keep it beside the existing `previewAssetResolved` state, which already tracks `sourceHtml` /
`sourceCss`. In `handleCommitEditVersion`, apply the map **in reverse** (dataUrl → originalUrl) to
the incoming html before it reaches `saveWysiwygEditState` / `createPreviewSnapshot`.

Notes for the implementer:

- reverse by longest key first, so one data URI cannot partially match another
- a data URI the map does not know is left as-is: it may be genuinely authored by the model
  (AL-009 forbids only URIs *the pipeline introduced*)
- both branches of `handleCommitEditVersion` need this — the session commit and the degraded direct
  create
- do not change what the preview renders; only what is persisted

Acceptance:

- a WYSIWYG save on a project with 3 resolved images persists html within a few hundred characters
  of the pre-edit source, not 12× it
- the user's text edit survives the round trip
- the preview still renders images after saving
- a unit test on the reverse function: exact round trip, longest-match-first, unknown URI preserved

### W2.2 — AL-037: reject at the application boundary (**after W2.1 is verified**)

In `CreatePreviewSnapshot.execute()`, reject a snapshot whose html contains data URIs that were not
present in its parent — a 400 with a message naming the rule. This is what stops AL-009 regressing
silently the next time someone adds a save path.

Deliberate scope limit: compare against the parent, do not attempt to decide whether the model
"really" authored a data URI. A version that inherits data URIs from its parent is contamination
already recorded, not new contamination, and blocking it would make existing projects unusable.

Acceptance:

- a snapshot introducing new data URIs is rejected
- a snapshot inheriting them from its parent is accepted
- the WYSIWYG path from W2.1 is accepted

---

## W3 — Make the chain readable

**Rules:** AL-011 (numbering from the chain), AL-023 (published version visible).
**Depends on:** the decision above; run after W2 to avoid a `page.tsx` collision.

**Files owned:**

- `apps/web/app/workspace/features/versions/versionNumbering.ts` *(new)*
- `apps/web/components/workspace/SnapshotHistoryPanel.tsx`
- `apps/web/app/workspace/[projectId]/page.tsx` — **only** the props passed to
  `SnapshotHistoryPanel`
- `apps/web/app/workspace/features/versions/__tests__/versionNumbering.test.ts` *(new)*

Both inputs are already on the client: `PreviewSnapshot.parentSnapshotId` is in the DTO, and
`SiteDeploymentDto.snapshotId` is already held in `publishDeployment` by `usePublish`. **No backend
change is required in this wave.**

### W3.1 — AL-011: numbering derived from the seed chain

Extract a pure module rather than computing inline, so the rule is testable:

```ts
export function buildVersionIndex(snapshots: PreviewSnapshot[]): Map<string, VersionLabel>
```

Rules:

- walk each root's descendants; depth along the chain gives the number
- a root that is not the earliest snapshot in the project is attached, **for display only**, to the
  previous snapshot by `createdAt` (the legacy fallback from the decision above)
- deleting a version must not renumber its siblings: numbers come from chain depth, not position

Replace `const vn = snapshots.length - i` in the panel with a lookup into this index.

### W3.2 — AL-023: show which version is live

Pass `publishDeployment` into `SnapshotHistoryPanel` and badge the version whose id matches
`publishDeployment.snapshotId`, in the visual language of the existing badges (`✏ manuale`,
`✎ EDIT`, `⊕ GJS`). Add a line to the panel header stating how far the working copy has diverged —
"live: v4 · stai lavorando su v9" — so the question "what is live right now?" is answerable without
leaving the workspace.

Acceptance:

- a linear project numbers v1…vN exactly as today (no visible regression)
- a project with a branch numbers each path by its own depth
- a legacy all-roots project numbers sequentially by time rather than showing a row of v1
- the published version is badged; when nothing is published, no badge and no divergence line
- unit tests for `buildVersionIndex`: linear, branched, legacy-flat, single-version, empty

---

## W4 — Branching

**Rules:** AL-013 (returning to an earlier version branches), AL-014 (branching must be visible).
**Depends on:** W3.

The behaviour is already half-present: selecting a version activates it (AL-020), and the seed is
the active version (AL-012, enforced server-side since 2026-08-26). What is missing is that **the
user is never told a branch is being created**, and the abandoned branch is indistinguishable from
the mainline in the history.

Scope:

- when the active version is not the newest, the composer states that the next change will branch
  from the selected version
- the history distinguishes the path leading to the active version from abandoned branches, without
  hiding either — AL-013 requires abandoned branches to stay reachable
- no data model change: the chain already carries this

Acceptance: from v10, select v5, generate; the new version's seed is v5, the interface said so
before sending, and the v6…v10 branch is still listed and selectable.

---

## W5 — Traceability

**Rules:** AL-026, AL-027, AL-028 (execution-id linkage), AL-029 (focused-edit target), AL-019
(unsaved editor state), AL-030 (project-wide compacted history).

This is the largest wave and overlaps `PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md` P1,
which already specifies the linkage. Read that document as well as the lifecycle spec.

Current state, measured: **0 of 195 snapshots carry a `promptExecutionId`**, and **0 carry a
`focusContext`** — the field exists in the entity, the contract and the use case, but no client call
site populates it. `prompt_execution_logs` rows have `conversationId` empty in practice.

Ordered steps:

1. **AL-026/027** — add `promptExecutionId` to the snapshot entity, contract and persistence; thread
   the execution id from dispatch through to snapshot creation, and to the assistant message and the
   cost record, so all four reference one id
2. **AL-029** — populate `focusContext` on snapshots produced by a focused edit (the client already
   holds it; the create call simply never sends it)
3. **AL-019** — close the hole where `currentArtifactsSource` prefers `editorHtml` over the active
   version, so unsaved editor content can become a generation base without ever becoming a version.
   Either save first or generate from the active version; do not send the model content that exists
   in no version
4. **AL-028/030** — the prompt view resolves the selected version's execution; the project history is
   shown compacted with that version's entries highlighted

Acceptance for step 1: for one generation, the snapshot, the assistant message, the prompt execution
log and the cost transaction all carry the same execution id, and selecting that version in the
history shows that execution in the Prompt tab.

---

## Verification, every wave

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
npx vitest run --root apps/api --no-file-parallelism
```

`--no-file-parallelism` is required: MongoMemoryServer spawn contention on Windows produces
`spawn UNKNOWN` failures in different tests on each run, which are environmental, not code.

Live verification runs against the **deploy** stack (`docker-compose.deploy.yml`). Confirm which
stack is running before any Docker command, and use `--no-deps` when restarting a single service.
Never restart MongoDB to propagate a change.

Any live LLM call must use a model from `tests/config/authorized-test-models.json`. Set the pipeline
model override *before* launching a wizard flow — the default cascade selects a model that is not on
the list.

---

## Definition of done

A wave is done when its rows in section 9 of `ARTIFACT_LIFECYCLE_SPEC.md` are updated to ✅ **and**
each has a test pinning it. Per AL-038, a rule that moves to ✅ without a test has not moved.
