# Artifact Lifecycle — Cardinal Spec

> **Status:** binding. This document defines the intended behaviour of artifact versioning,
> activation, publication and traceability. Where the code disagrees with this document, the code
> is wrong.
>
> **Authority:** product owner, 2026-08-27. Supersedes nothing; it writes down rules that were
> previously implicit or scattered across `FOCUSED_EDIT_SPEC.md`, `EXECUTION_LOG_SPEC.md`,
> `WYSIWYG_EDIT_MODE_SPEC.md` and `PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md`.
>
> **Rule IDs** (`AL-NNN`) are stable. Cite them in commit messages and PR descriptions, the same
> way `PP-NNN` rules are cited for the prompting pipeline. Example:
> `fix(snapshots): derive version numbers from the parent chain — AL-011`.
>
> **Language policy:** English, matching `docs/agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md`.

---

## 0. Why this document exists

The artifact system is the product. Everything else — prompting, model routing, media resolution —
exists to produce and refine artifacts. Yet until now it had no cardinal spec: the single most
load-bearing rule in the whole system (*the active snapshot is the seed of every subsequent
change*) lived at line 446 of `FOCUSED_EDIT_SPEC.md`, a document no agent is instructed to read.

The consequence was measurable. On 2026-08-26 an audit of 195 stored snapshots found:

- **158 of 195 were roots** (`parentSnapshotId: null`) — the version chain was written by one code
  path and ignored by every other
- **35 projects had more than one root**, one had 19
- **0 snapshots carried a `promptExecutionId`** — no version could be traced to the prompt that
  produced it
- **30 snapshots contained inlined base64 images**, 19.6 MB in total, because one save path
  persisted the rendered preview instead of the source

None of this was a deliberate decision. It is architectural drift: successive changes each made
local sense and collectively dismantled a coherent design. Section 8 exists to stop that repeating.

---

## 1. Vocabulary — five distinct pointers

Most defects in this area come from conflating these. They are independent.

| Term | Meaning | Cardinality |
|---|---|---|
| **Artifact version** | An immutable, uniquely identified, complete snapshot of html/css/js for a project | many per project |
| **Seed** (`parentSnapshotId`) | The version a given version was derived from | one per version, nullable only for the first |
| **Active** | The working head: what edits apply to, what the LLM receives as `currentArtifacts` | exactly one per project |
| **Selected** | What the user is currently looking at | exactly one per session |
| **Published** | What visitors see at the public URL | zero or one per project |

**AL-001** — These five are independent. In particular, **the published version is not necessarily
the active one**: a user may publish v4, keep working, and reach v9 without republishing. Any code
that assumes `published === active` is wrong.

**AL-002** — Selecting a version activates it (see AL-020). Selected and active therefore converge
by design, but the code must never assume they are the same variable.

---

## 2. Entry paths

**AL-003** — There is exactly one artifact generation engine. Every entry path converges on it:

1. **Vibe mode** — prompt plus attached documents are auto-compiled into a brief
2. **Zero-effort form** — the user fills the intake manually; the same builder produces the brief
3. **Direct project mode** — the user writes a free prompt, optionally passed through an
   optimization step

**AL-004** — All three produce a **brief**, and the brief is what enters the prompting pipeline.
No entry path may reach the model by a different route, with a different composition, or through a
client-side handoff. (See `AGENTS.md` Rule Zero.)

**AL-005** — The brief enters the pipeline together with the full system-prompt layer set: style
and branding layers populated when declared on the project and empty when not, plus the mandatory
static layers. A layer being empty is a normal state, never a reason to skip composition.

**AL-006** — The first generation produces **version 1**. Version 1 has no seed.

---

## 3. Version creation

**AL-007** — Every mutation of the artifact produces exactly one new version. The mutation kinds
are:

| Mutation | Produces |
|---|---|
| Chat prompt with conversation history and full layer set | new version |
| Focused edit (element selected in the inspector + instruction) | new version |
| WYSIWYG interactive edit, saved | new version |
| Code editor (HTML/CSS/JS) edit, saved | new version |

**AL-008** — Versions are **equipollent**. A version produced by a WYSIWYG save is the same kind of
object, at the same level of completeness, as a version produced by the model. It carries the full
artifact, not a delta, not a rendered projection, not a partial document.

**AL-009** — A version persists the **source** artifact, never the rendered preview. Preview
rendering may inline assets as data URIs so that a sandboxed iframe can display them; that
transformation must be reversed before persistence. A version whose html contains `data:image/`
payloads that were not authored by the model is a defect.

**AL-010** — No version is created from a failed generation. If the structured parse fails, nothing
is saved, the active version is unchanged, and the failure is surfaced as an error (not as an
assistant reply).

**AL-011** — Version numbering is derived from the **seed chain**, never from list position or
creation order. Position-based numbering misrepresents history the moment a branch exists, and
renumbers surviving versions when one is deleted.

---

## 4. Seed and branching

**AL-012** — The seed of a new version is the **active version at the moment of creation**. This
holds for every mutation kind in AL-007, including saves initiated from an editor, and it is
enforced server-side rather than trusted to each caller.

**AL-013** — Returning to an earlier version and modifying it creates a **branch**. If the project
is at v10, the user selects v5, and then edits, the new version's seed is v5. If the user then
selects v10 and edits again, that version's seed is v10, and the branch that grew from v5 remains
in the archive, reachable, and is not deleted.

**AL-014** — Branching must be visible. The interface has to show that a new version is starting
from something other than the newest one, and that the abandoned branch is still reachable.
Silent branching loses user work in a way the user cannot diagnose.

**AL-015** — Deleting a version must preserve chain integrity: its children are re-linked to its
seed. A dangling `parentSnapshotId` is corruption, whether or not anything currently reads it.

---

## 5. Activation

**AL-016** — Exactly one version per project is active. Activation is project-scoped: activating a
version deactivates every other version of the project, across all conversations.

**AL-017** — The active version is the source of truth for:

1. `currentArtifacts` sent to the model
2. the merge base for focused edits
3. what the editors load
4. the default target for export

**AL-018** — The active version must always contain valid, non-empty html. This invariant predates
this document (`FOCUSED_EDIT_SPEC.md` §"Baseline Snapshot") and is restated here because it is a
lifecycle rule, not a focused-edit rule.

**AL-019** — Unsaved editor state must not silently become the base of a generation. Either it is
saved as a version first (AL-007), or the generation runs against the active version. Feeding the
model content that exists in no version breaks the 1:1 correspondence in section 7.

**AL-020** — Selecting a version in the history activates it. If activation fails, selection must
fail visibly rather than leaving the interface showing one version while the system uses another.

---

## 6. Publication

**AL-021** — Publication targets a **specific version**, recorded by id. It is not a project-level
"publish current state" operation.

**AL-022** — The published version is independent of the active one (AL-001). Continuing to work
after publishing never changes what is live; only an explicit republish does.

**AL-023** — Which version is published must be visible next to the version history. A user must be
able to answer "what is live right now, and how far has my working copy diverged from it?" without
leaving the workspace.

**AL-024** — Every publication, republication and unpublication is recorded as an event carrying:
the version id, the acting user, the timestamp, the action, the resulting deployment and URL, and
the reason where the user supplied one. `publish_history` and `site_deployments` already carry most
of this; the gap is the reason and the surfacing, not the storage.

**AL-025** — Export follows the same version semantics as publication: it targets an explicit
version, defaulting to the active one, resolved at **project** scope (AL-016). Resolving the active
version at conversation scope is a defect.

---

## 7. One-to-one traceability

**AL-026** — Every version carries an immutable reference to the prompt execution that produced it
(`promptExecutionId`), where one exists. Versions produced by direct user editing carry the acting
user and the edit kind instead. There is no version whose origin is unknown.

**AL-027** — A version, its assistant message, its prompt execution record and its cost record all
reference the same execution id. This requirement is already stated as P1 in
`PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md` §"Snapshot and prompt trace are not
first-class peers"; this document makes it a lifecycle rule.

**AL-028** — Selecting a version resolves the prompt view to **that version's** execution. Falling
back to the most recent execution is permitted only when no version is selected, and that state
must be labelled.

**AL-029** — Focused edits record which element they targeted on the version they produced. A
version created by a focused edit whose target is unknown cannot be explained after the fact.

**AL-030** — The prompt history shown for a project is the **whole project history**, compacted,
with the entries belonging to the selected version highlighted. Rationale: once branching exists
(AL-013), a linear reading of history is factually wrong — it implies a descent that never
happened. The seed chain is the only structure that reflects what actually occurred, so it is the
structure the view is built on.

---

## 8. Change control — no silent architecture drift

This section is the reason the rest of the document is worth writing.

**AL-031** — Any change that introduces a new save path, a new precedence between existing paths,
or a new way of persisting or activating an artifact is an **architectural change**. It may not be
made as an incidental part of another task.

**AL-032** — An architectural change under AL-031 must be proposed and argued before being made.
The proposal states: which rule of this document it alters, what the current behaviour is, what the
proposed behaviour is, and what concrete value the change delivers that the current design does
not. "It was simpler", "it was faster to implement", or "the existing path was in the way" are not
values.

**AL-033** — Adding a second path while keeping the first is not a compromise, it is the failure
mode. See `AGENTS.md` Rule Zero.

**AL-034** — When an agent finds behaviour that contradicts this document, the default action is to
**restore the documented behaviour**, not to codify what the code happens to do. If the documented
behaviour is genuinely wrong, that is an AL-032 proposal.

---

## 9. Conformance as of 2026-08-27

Assessed against the code and against 195 stored snapshots on the local stack.

| Rule | State | Evidence |
|---|---|---|
| AL-003/004 one engine, all entries | ✅ implemented 2026-08-26 | the guided wizard was a second legacy path until commit `227609f` |
| AL-007 every mutation versions | ⚠️ partial | AL-019 hole: `currentArtifactsSource` prefers `editorHtml` over the active version |
| AL-008/009 equipollent, source not render | ❌ violated | WYSIWYG save persists the rendered DOM: one artifact went 10.703 → 131.884 chars, 107.725 of base64; 30 snapshots affected, 19.6 MB |
| AL-010 no version from failure | ✅ implemented | frontend guard plus `generationParseError` |
| AL-011 numbering from the chain | ❌ not implemented | `SnapshotHistoryPanel` uses `snapshots.length - i` |
| AL-012 seed is the active version | ✅ implemented 2026-08-26 | server-side default in `CreatePreviewSnapshot`; previously 158/195 roots |
| AL-013/014 branching | ❌ not implemented, not surfaced | no branch concept in code or UI |
| AL-015 delete preserves the chain | ❌ not implemented | `DeletePreviewSnapshot` deletes without re-linking; currently 0 orphans, latent |
| AL-016/017/018 activation | ✅ implemented | `activateForProject`, `activeBaselineSnapshot` |
| AL-021/022/024 publication records the version | ✅ storage present | `site_deployments` and `publish_history` carry `snapshotId`, `userId`, `action`, timestamps |
| AL-023 published version visible | ❌ not implemented | history panel has origin badges, none for published |
| AL-025 export scope | ❌ inconsistent | `ExportLayer1Zip` resolves active at conversation scope; `PublishProject` at project scope |
| AL-026/027/028 prompt linkage | ❌ not implemented | `promptExecutionId` absent from all 195 snapshots |
| AL-029 focused edit target recorded | ❌ not implemented | `focusContext` populated on 0 of 195 snapshots |
| AL-030 project-wide compacted history | ❌ not implemented | — |

---

## 10. Robustness measures

Beyond conformance, these make the invariants hard to break rather than merely documented.

**AL-035** — Chain and activation invariants are enforced in the application layer, not in each
caller. A client that forgets a field gets correct behaviour, not a silent second root.

**AL-036** — A startup or on-demand integrity check reports: versions with a missing seed, projects
with more than one root, active-version count per project other than one, published versions that
no longer exist, and versions whose html is empty.

**AL-037** — Persisting a version whose html contains data URIs that did not come from the model is
rejected at the application boundary, so AL-009 cannot regress silently.

**AL-038** — The conformance table in section 9 is updated whenever a rule's state changes. A rule
that moves to ✅ without a test that pins it has not moved.

---

## 11. Related documents

- `AGENTS.md` — Rule Zero, one execution path per user action
- `docs/agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md` — the `PP-NNN` model this document follows
- `docs/specs/FOCUSED_EDIT_SPEC.md` — focused-edit mechanics; its `isActive` invariant is restated here as AL-018
- `docs/specs/WYSIWYG_EDIT_MODE_SPEC.md` — WYSIWYG mechanics; its single-exit-point rule is AL-007
- `docs/specs/EXECUTION_LOG_SPEC.md` — event record shapes; `parentSnapshotId` is defined there as "the previous active snapshot"
- `docs/specs/PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md` — P1 execution-id linkage, formalised here as AL-026/027/028
- `docs/specs/EXPORT_AND_PUBLISH_SPEC.md` — export and publish mechanics
