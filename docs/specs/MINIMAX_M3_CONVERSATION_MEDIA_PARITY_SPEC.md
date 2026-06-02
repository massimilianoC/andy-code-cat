# MiniMax M3 Conversation Media Parity Spec

Status: proposed

Date: 2026-06-01

Scope: MiniMax M3 Layer 1 chat-preview runs, structured media manifests, deterministic media resolution, conversation persistence parity, manual keyed regeneration, and criteria for automatic replay of defined semantic media requests.

Related documents:

- `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`
- `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md`
- `docs/specs/ZERO_EFFORT_MEDIA_ASYNC_EVOLUTION_SPEC.md`
- `docs/reports/ARTIFACT_MEDIA_IMPLEMENTATION_STATUS_2026-05-29.md`

---

## 1. Problem Statement

A local Docker validation with `MiniMaxAI/MiniMax-M3` produced a successful page generation, but the user-facing conversation layer appeared to have generated no images.

The investigation goal was to determine whether this is:

1. a real image-generation failure;
2. a deterministic media-resolution failure;
3. a persistence gap between snapshot/media records and conversations;
4. an observability gap that makes already-resolved media invisible from conversation-centric surfaces.

The same investigation must also answer whether a manual or automatic "FX" rerun is operationally safe when the semantic media request is already defined.

For this document, "FX rerun" means replaying the deterministic media-resolution pipeline from an already-known media key + semantic query, without asking the LLM to redesign the page.

---

## 2. Local Evidence Collected

The following evidence was collected on the current local Docker dev stack.

### 2.1 Runtime status

- `docker compose ps api web` showed both services running.
- `GET /health` on the API returned `200` with `{"status":"ok","service":"api"}`.
- SiliconFlow `/models` reported `MiniMaxAI/MiniMax-M3` as available.

### 2.2 Database evidence from the validated MiniMax M3 run

Observed on one recent MiniMax M3 generation:

- `prompt_execution_logs` contains a successful `taskKey = chat` run with `provider = siliconflow` and `model = MiniMaxAI/MiniMax-M3`.
- `media_resolution_traces` contains multiple `status = resolved` entries for the same project, each with semantic queries and persisted `assetId`s.
- `preview_snapshots` contains an active snapshot for the same project with:
  - `metadata.mediaResolution.traceIds[]`
  - `metadata.mediaResolution.assetIds[]`
  - `metadata.mediaResolution.mediaKeys[]`
  - `metadata.mediaResolution.directives[]`
  - `degraded = false`
  - no remaining `asset://media/*` placeholders
  - HTML/CSS containing internal `/p/media/:assetId` URLs
- `project_assets` contains `platform_generated` image assets created at the same timestamp window.
- `conversations` for the same project contain only text-oriented assistant content and do not contain internal `/p/media/:assetId` references.

Conclusion from the evidence:

The MiniMax M3 run did generate and resolve images successfully in the backend pipeline. The observed failure is not an image-generation failure. It is a parity and traceability gap between the media/snapshot layer and the conversation/logging layer.

---

## 3. As-Built Behavior

### 3.1 What currently works

The current backend media path is functioning for the tested MiniMax M3 case.

Working responsibilities:

1. `llmRoutes.ts` parses structured output and passes `mediaManifest` into `ResolveArtifactMedia`.
2. `ResolveArtifactMedia` validates the manifest, resolves semantic requests through the stock-provider policy, persists `ProjectAsset`s, writes `MediaResolutionTrace` rows, and replaces `asset://media/<key>` with internal `/p/media/:assetId` URLs.
3. `CreatePreviewSnapshot` attaches `traceIds` to the created snapshot.
4. The active snapshot stores a deterministic media-resolution summary in `metadata.mediaResolution`.
5. Manual keyed regeneration already exists via `POST /v1/projects/:projectId/media/:mediaKey/regenerate`.

### 3.2 What the user currently experiences

From a conversation-first point of view, the run looks incomplete because the conversation record does not carry the resolved artifact/media state.

This is an expected consequence of the current design, but it is a product gap.

The assistant message stored in the conversation is the formatted chat reply, not the resolved artifact payload.

---

## 4. Root Findings

### F1. No proven MiniMax M3 media-generation bug in the tested path

The tested MiniMax M3 run produced:

- resolved media traces;
- persisted image assets;
- active snapshot artifacts with internal media URLs;
- `degraded = false`.

Therefore the current issue is not "MiniMax M3 cannot generate images".

### F2. Conversation persistence is not media-parity persistence

The conversation layer stores text messages, not the resolved artifact/snapshot state.

Effect:

- the user can read the conversation and conclude that no images were generated;
- the actual source of truth is the preview snapshot, not the conversation record.

This is a product consistency problem, not a resolver failure.

### F3. Prompt execution logs do not model media-resolution results

`PromptExecutionLog` currently has no field for media-resolution outcomes.

Effect:

- chat runs can be marked `succeeded` without any first-class indication of how many media directives were resolved;
- admin/user analytics cannot answer "this MiniMax M3 run produced 11 resolved images" from the log alone;
- root-cause analysis must join multiple collections manually.

### F4. Traceability is incomplete at asset/trace level for conversation-centric workflows

In the observed local data, `media_resolution_traces` and `project_assets` did not carry enough first-class conversation linkage for fast operator debugging.

Observed gaps:

- `conversationId` was absent from the trace rows of the tested run;
- `project_assets.generationMetadata` did not provide first-class `mediaKey` / `conversationId` fields suitable for stable analytics or replay filtering.

Even when equivalent context exists indirectly, it is not stored in the most useful queryable shape.

### F5. Manual keyed replay is already viable for stock/auto requests

The codebase already supports deterministic manual replay from persisted semantics:

- route: `POST /v1/projects/:projectId/media/:mediaKey/regenerate`
- source of truth: latest `MediaResolutionTrace` for that `mediaKey`
- query source: persisted `request.semanticQuery`
- policy: `allowFallback: false` for edit-mode/keyed replay

This means a manual operator or user-triggered rerun is already operationally justified when a valid trace exists.

### F6. Automatic replay is possible, but only under explicit safety rules

Automatic replay is technically possible because the semantic request already exists in the stored trace/snapshot metadata.

It must not run blindly.

The platform can safely auto-replay only when all of the following are true:

1. the strategy is `stock` or `auto`;
2. `semanticQuery` is present;
3. `mediaKey` is present;
4. width/height or a deterministic fallback dimension can be resolved;
5. the current snapshot is degraded or has unresolved media directives;
6. replay does not require the LLM to reinterpret page meaning.

---

## 5. Why The User Saw "No Images"

The user-facing interpretation can be wrong even when the backend is correct.

In the tested MiniMax M3 run:

- snapshot layer: success
- asset layer: success
- trace layer: success
- conversation layer: text only

So the user experience problem is:

```text
conversation says success in words
but does not expose the media-bearing snapshot state
therefore the run looks image-less from the chat log alone
```

This is the main operational conclusion of this investigation.

---

## 6. Operational Decision

### 6.1 Short answer

Yes, manual FX rerun is justified today when the semantic request is already defined.

Yes, automatic FX rerun is also technically feasible, but only for deterministic stock/auto media requests and only under guarded conditions.

### 6.2 Recommended rule

Use this policy:

1. Manual keyed rerun is the default for user-facing repair.
2. Automatic rerun is allowed only for degraded or unresolved snapshot directives where no further semantic interpretation is needed.
3. Automatic rerun must never rewrite page structure or re-call the LLM for layout/content.

---

## 7. Proposed Solution Set

### P0. Observability parity between chat runs and media resolution

Add a first-class media-resolution summary to chat execution logs.

Required additions:

1. extend `PromptExecutionLog` with a `mediaResolutionSummary` block:
   - `resolvedCount`
   - `failedCount`
   - `degraded`
   - `mediaKeys[]`
   - `traceIds[]`
   - `snapshotId?`
2. persist that summary for `taskKey = chat` after `ResolveArtifactMedia` completes;
3. include `conversationId` whenever available.

Outcome:

- a MiniMax M3 chat run becomes auditable from one collection;
- analytics can answer whether a chat run produced images.

### P1. Conversation-to-snapshot parity

Add explicit linkage from assistant conversation messages to the resolved snapshot/media state.

Required additions:

1. when the assistant message is persisted, attach metadata such as:
   - `snapshotId`
   - `provider`
   - `model`
   - `mediaResolution: { resolvedCount, degraded, mediaKeys[] }`
2. in the web conversation UI, show a compact "media generated" status sourced from snapshot metadata;
3. optionally expose the active snapshot thumbnail/media summary inline in the conversation thread.

Outcome:

- the user no longer interprets a successful media-bearing run as image-less.

### P2. First-class lineage in traces and assets

Persist queryable lineage fields directly, not only inside nested ad hoc payloads.

Required additions:

1. ensure `conversationId` is persisted into `MediaResolutionTrace` whenever the originating request knows it;
2. enrich `ProjectAsset.generationMetadata` or add sibling fields for:
   - `mediaKey`
   - `conversationId`
   - `snapshotId?`
   - `semanticQuery`
   - `resolutionRoute`
3. add indexes where needed for:
   - `projectId + conversationId + createdAt`
   - `projectId + mediaKey + createdAt`

Outcome:

- deterministic replay and operator forensics become cheap and reliable.

### P3. Manual FX flow hardening

Formalize the existing keyed regeneration route as the canonical manual repair path.

Required additions:

1. expose a UI action for each unresolved or degraded directive;
2. surface the stored `semanticQuery`, provider attempts, and current asset id;
3. keep `allowFallback: false` for keyed edit regeneration;
4. return the new `traceId` and updated asset metadata to the UI.

Outcome:

- the operator can repair a broken image without another full chat generation.

### P4. Automatic FX replay for deterministic cases

Introduce a guarded automatic replay path for degraded snapshot directives.

Trigger candidates:

1. snapshot created with `metadata.mediaResolution.degraded = true`;
2. one or more directives have `status != resolved`;
3. the request strategy is `stock` or `auto`;
4. there is no unresolved ambiguity in the semantic request.

Execution options:

1. synchronous retry in-request only for one small retry window;
2. preferred: background repair job referencing `snapshotId + mediaKey[]`.

Guardrails:

1. no LLM recall;
2. no layout mutation;
3. no auto-replay for `project_asset`, `user_library`, or future generative strategies without dedicated policy;
4. max retry budget per media key.

Outcome:

- transient provider failures can self-heal when semantics are already known.

---

## 8. Decision Matrix: Manual vs Automatic FX Rerun

| Case | Semantic query defined | Media key defined | Current status | Recommended action |
| --- | --- | --- | --- | --- |
| Snapshot resolved, user just does not see images in conversation | yes | yes | not degraded | no replay; fix parity/UX |
| Snapshot degraded, one or more stock directives failed | yes | yes | degraded | automatic replay allowed |
| Snapshot degraded, but request strategy is non-stock future mode | yes | yes | degraded | manual only until resolver exists |
| No trace exists, but snapshot directives are present | yes | yes | degraded/unknown | automatic replay possible only after replay-from-directive is implemented |
| Semantic query missing or malformed | no | maybe | degraded | manual intervention or full re-generation |
| User wants a different visual result, not a repair | yes | yes | resolved | manual keyed rerun with offset/provider policy |

---

## 9. Implementation Order

### Wave 1 — visibility and evidence

1. add `mediaResolutionSummary` to `PromptExecutionLog`;
2. add conversation-message metadata pointing to the created snapshot;
3. persist `conversationId` more consistently into trace rows.

### Wave 2 — manual repair UX

1. expose keyed media regeneration in the web UI;
2. show directive status and semantic query per media key;
3. show degraded snapshot warnings in the conversation/workspace shell.

### Wave 3 — automatic deterministic replay

1. create a background repair job for unresolved stock/auto directives;
2. add retry counters and notifications;
3. patch the active snapshot only when the rerun succeeds.

---

## 10. Acceptance Criteria

This work is complete when all of the following are true:

1. a successful MiniMax M3 chat run with resolved images can be recognized from:
   - the active snapshot;
   - the prompt execution log;
   - the conversation UI.
2. a degraded stock-media run exposes a keyed repair action without requiring a fresh LLM generation.
3. the platform can optionally auto-replay failed stock/auto directives from saved semantics.
4. operators can query MongoDB and answer, for a single conversation, which media keys were requested, which assets were produced, and whether fallback or replay occurred.

---

## 11. Explicit Non-Goals

This spec does not propose:

1. changing the semantic media contract away from `mediaManifest`;
2. making the conversation document the canonical artifact store;
3. auto-replaying arbitrary future image-generation strategies without dedicated policy;
4. using the LLM again just to fix a stock-media fetch failure when semantic intent is already known.

---

## 12. Final Recommendation

The current MiniMax M3 branch should be treated as functionally correct for deterministic media generation in the tested local case.

The priority is not a generator fix. The priority is parity and observability:

1. make successful media generation visible from conversation-centric surfaces;
2. persist stronger lineage in logs, traces, and assets;
3. operationalize keyed manual replay now;
4. add guarded automatic FX replay for degraded stock/auto directives next.
