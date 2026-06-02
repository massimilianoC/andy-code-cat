# MiniMax M3 Parity Implementation 2026-06-02

Status: implemented wave 1

Scope: conversation-to-snapshot parity, first-class media lineage on generated assets, stronger MongoDB query paths for runtime and audit surfaces.

Related documents:

- `docs/specs/MINIMAX_M3_CONVERSATION_MEDIA_PARITY_SPEC.md`
- `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`
- `docs/reports/ARTIFACT_MEDIA_IMPLEMENTATION_STATUS_2026-05-29.md`

---

## 1. Implemented Changes

### 1.1 Conversation message parity

Assistant conversation messages now persist explicit linkage to the persisted preview snapshot generated from that message.

Persisted fields:

- `conversations.messages[].metadata.snapshotId`
- `conversations.messages[].metadata.mediaResolution`

Behavior:

- the assistant message is still created first;
- when `POST /v1/projects/:projectId/preview-snapshots` succeeds with `sourceMessageId`, the backend patches the source conversation message metadata automatically;
- the frontend remains a consumer only and does not own the parity rule.

Result:

- a conversation-centric view can determine whether a message produced a persisted artifact version;
- the same message can expose whether media was resolved, degraded, or left unresolved.

### 1.2 First-class asset lineage

`platform_generated` assets now persist conversation-centric lineage directly in `project_assets.generationMetadata`, reusing the existing metadata envelope instead of introducing a new collection or sibling structure.

Persisted fields:

- `generationMetadata.conversationId`
- `generationMetadata.sourceMessageId`
- `generationMetadata.parentSnapshotId`
- `generationMetadata.mediaKey`
- `generationMetadata.semanticQuery`
- `generationMetadata.resolutionRoute`
- `generationMetadata.fallbackUsed`

Result:

- runtime and analytics flows no longer need to parse provider-specific blobs just to answer which conversation or media key produced an asset;
- deterministic replay and UI media inspectors can filter assets by message, conversation, media key, or resolution route.

### 1.3 Stronger trace query paths

`media_resolution_traces` already persisted `conversationId`, `snapshotId`, `mediaKey`, `resolvedAssetId`, and provider resolution data.

This wave adds indexes for the most useful conversation-centric paths:

- `projectId + conversationId + createdAt`
- `projectId + conversationId + mediaKey + createdAt`

`project_assets` also gains sparse indexes for:

- `projectId + generationMetadata.conversationId + createdAt`
- `projectId + generationMetadata.mediaKey + createdAt`

### 1.4 Extended operational logging

Existing execution-log events now carry stronger lineage context when snapshots or media regeneration succeed.

Useful correlation fields now emitted by runtime logs include:

- `conversationId`
- `snapshotId`
- `sourceMessageId`
- `mediaResolutionTraceIds`
- `mediaResolutionAssetIds`
- `mediaResolutionMediaKeys`
- `mediaResolutionResolvedCount`
- `mediaResolutionFailedCount`
- `mediaKey`
- `parentSnapshotId`
- `resolutionRoute`

---

## 2. Runtime Query Patterns

### 2.1 Starting from a conversation message

Use:

- `conversations.messages[].metadata.snapshotId`
- `conversations.messages[].metadata.mediaResolution`

Then:

- resolve the snapshot from `preview_snapshots._id`
- resolve traces from `metadata.mediaResolution.traceIds[]`
- resolve assets from `metadata.mediaResolution.assetIds[]`

### 2.2 Starting from a generated asset

Use:

- `project_assets.generationMetadata.conversationId`
- `project_assets.generationMetadata.mediaKey`
- `project_assets.generationMetadata.parentSnapshotId`

Then:

- find matching traces by `projectId + mediaKey`
- inspect the latest trace to know replay/fallback/provider outcome

### 2.3 Starting from a snapshot

Use:

- `preview_snapshots.sourceMessageId`
- `preview_snapshots.metadata.mediaResolution.traceIds[]`

Then:

- resolve the originating conversation message
- reconstruct all media directives and assets created for that artifact version

---

## 3. Non-Goals Of This Wave

This implementation does not yet:

- auto-replay degraded stock directives in background;
- add a dedicated media-repair dashboard;
- backfill historical rows created before 2026-06-02;
- make `PromptExecutionLog` the canonical link to `snapshotId`.

Those remain follow-up work after parity and lineage hardening.

---

## 4. Verification Summary

Validated in this wave:

- API tests:
  - `PreviewSnapshotMediaResolution`
  - `ResolveArtifactMedia`
- Type/build checks:
  - `packages/contracts`
  - `apps/api`
  - `apps/web`

---

## 5. Operational Outcome

The backend now preserves enough normalized linkage to answer, with stable IDs:

- which assistant message produced a persisted artifact;
- which snapshot belongs to that message;
- which media keys were requested;
- which traces resolved or degraded;
- which generated assets were created;
- which route and context produced those assets.
