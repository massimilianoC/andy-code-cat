# EXECUTION_LOG_SPEC.md

Structured execution log system for operational observability.  
Collection: `execution_logs` (MongoDB, TTL 90 days).

## Purpose

Provides a per-project, per-domain audit trail of key application events:
LLM generation, focus patch application, snapshot versioning, WYSIWYG edits, exports, and system events.

Unlike the `BackgroundTask` records embedded inside `Conversation.messages`, this collection is:

- **Standalone** — not tied to any conversation document
- **Fire-and-forget** — never blocks the critical request path
- **Queryable** — supports filtering by domain, level, conversation, snapshot, and time cursor

---

## Collection Schema

### Document fields

| Field            | Type                    | Required | Description                                           |
|-----------------|-------------------------|----------|-------------------------------------------------------|
| `_id`            | UUID string             | yes      | `randomUUID()` assigned at insert                     |
| `projectId`      | UUID string             | yes      | Owning project (tenant boundary)                      |
| `conversationId` | UUID string             | no       | Associated conversation, when relevant                |
| `snapshotId`     | UUID string             | no       | Associated snapshot, when relevant                    |
| `messageId`      | UUID string             | no       | Associated message, when relevant                     |
| `domain`         | `LogDomain`             | yes      | See domains table below                               |
| `eventType`      | string                  | yes      | See event types per domain below                      |
| `level`          | `LogLevel`              | yes      | `debug` \| `info` \| `warn` \| `error`               |
| `status`         | `LogStatus`             | yes      | `success` \| `failure` \| `partial`                  |
| `durationMs`     | number                  | no       | Wall-clock duration of the operation, when measurable |
| `metadata`       | `Record<string, unknown>` | yes    | Domain-specific payload (see below)                   |
| `createdAt`      | Date                    | yes      | UTC insert time; TTL index expires after 90 days      |

### Indexes

- `{ createdAt: 1 }` — TTL, `expireAfterSeconds: 7_776_000` (90 days)
- `{ projectId: 1, createdAt: -1 }` — primary query index
- Additional compound indexes can be added as query needs grow

---

## Domain Taxonomy

| `domain`      | Description                                    |
|--------------|------------------------------------------------|
| `llm`        | LLM inference calls (chat-preview endpoint)    |
| `focus_patch`| Focused element patch application/failure      |
| `snapshot`   | PreviewSnapshot create / activate operations   |
| `wysiwyg`    | WYSIWYG edit session commit                    |
| `export`     | Site export / publish operations               |
| `system`     | Infrastructure/background system events        |

---

## Event Types per Domain

### `llm`

#### `llm_generation_complete`

Emitted after every successful LLM call (stream or non-stream).

```json
{
  "domain": "llm",
  "eventType": "llm_generation_complete",
  "level": "info",
  "status": "success",
  "durationMs": 3200,
  "metadata": {
    "provider": "openrouter",
    "model": "anthropic/claude-3-5-sonnet",
    "finishReason": "stop",
    "promptTokens": 4100,
    "completionTokens": 820,
    "costEur": 0.0042,
    "structuredParseValid": true,
    "simulated": false,
    "isFocusedMode": false,
    "focusPatchPresent": false
  }
}
```

Key metadata fields:

| Field                | Type    | Description                                    |
|---------------------|---------|------------------------------------------------|
| `provider`           | string  | LLM provider identifier                        |
| `model`              | string  | Model slug                                     |
| `finishReason`       | string  | Provider finish reason (`stop`, `length`, …)   |
| `promptTokens`       | number  | Input token count                              |
| `completionTokens`   | number  | Output token count                             |
| `costEur`            | number  | Computed cost in EUR (may be 0 if unknown)     |
| `structuredParseValid` | bool  | Whether structured JSON was parsed successfully |
| `simulated`          | bool    | True when using a local/simulated provider     |
| `isFocusedMode`      | bool    | True when a focus context was attached         |
| `focusPatchPresent`  | bool    | True when structured response contained a patch |

---

### `focus_patch`

#### `focus_patch_applied`

Emitted when a focused patch was successfully merged into the DOM.

#### `focus_patch_failed`

Emitted when the anchor element for a focused patch was not found.

```json
{
  "domain": "focus_patch",
  "eventType": "focus_patch_applied",
  "level": "info",
  "status": "success",
  "metadata": {
    "anchorTag": "section",
    "anchorPfIdPresent": true
  }
}
```

| Field              | Type   | Description                                              |
|-------------------|--------|----------------------------------------------------------|
| `anchorTag`        | string | HTML tag name of the targeted element                    |
| `anchorPfIdPresent`| bool   | Whether the element had a `data-pf-id` attribute         |

---

### `snapshot`

#### `snapshot_created`

Emitted when a new PreviewSnapshot is saved (via LLM generation endpoint).

```json
{
  "domain": "snapshot",
  "eventType": "snapshot_created",
  "level": "info",
  "status": "success",
  "metadata": {
    "snapshotId": "<uuid>",
    "parentSnapshotId": "<uuid>",
    "sourceMessageId": "<uuid>",
    "activated": true,
    "htmlBytes": 18432,
    "finishReason": "stop",
    "model": "anthropic/claude-3-5-sonnet",
    "provider": "openrouter",
    "structuredParseValid": true,
    "hasFocusContext": false
  }
}
```

| Field               | Type    | Description                                |
|--------------------|---------|---------------------------------------------|
| `snapshotId`        | string  | ID of the newly created snapshot            |
| `parentSnapshotId`  | string  | ID of the previous active snapshot          |
| `sourceMessageId`   | string  | Message that triggered the snapshot         |
| `activated`         | bool    | Whether the snapshot was activated on create|
| `htmlBytes`         | number  | Byte size of the generated HTML             |
| `finishReason`      | string  | LLM finish reason passed through            |
| `model`             | string  | Model used for this snapshot                |
| `provider`          | string  | Provider used for this snapshot             |
| `structuredParseValid` | bool | Structured parse status                   |
| `hasFocusContext`   | bool    | Whether a focus context was in the request  |

#### `snapshot_activated`

Emitted when a snapshot is manually activated (user switches version or endpoint called directly).

```json
{
  "domain": "snapshot",
  "eventType": "snapshot_activated",
  "level": "info",
  "status": "success",
  "metadata": {
    "snapshotId": "<uuid>",
    "conversationId": "<uuid>"
  }
}
```

---

## Query API

### Endpoint

```
GET /v1/projects/:projectId/execution-logs
```

Requires: `Authorization: Bearer <token>` + `x-project-id` header (sandbox middleware).

### Query parameters

| Param            | Type             | Default | Description                                 |
|-----------------|------------------|---------|---------------------------------------------|
| `domain`         | `LogDomain`      | —       | Filter to a single domain                   |
| `level`          | `LogLevel`       | —       | Filter to a single level                    |
| `conversationId` | UUID string      | —       | Filter to logs for a specific conversation  |
| `snapshotId`     | UUID string      | —       | Filter to logs for a specific snapshot      |
| `before`         | ISO datetime     | —       | Cursor: return logs older than this instant |
| `limit`          | integer (1–200)  | 50      | Page size                                   |

### Response shape

```json
{
  "logs": [
    {
      "id": "<uuid>",
      "projectId": "<uuid>",
      "conversationId": "<uuid>",
      "snapshotId": "<uuid>",
      "messageId": "<uuid>",
      "domain": "llm",
      "eventType": "llm_generation_complete",
      "level": "info",
      "status": "success",
      "durationMs": 3200,
      "metadata": { "...": "..." },
      "createdAt": "2025-01-01T12:00:00.000Z"
    }
  ]
}
```

Results are sorted newest-first. Paginate by passing the `createdAt` of the last result as the `before` cursor.

---

## Frontend integration

### Notifications

The workspace page (`apps/web/app/workspace/[projectId]/page.tsx`) emits UI notifications via `useNotifications()` for user-visible events:

| Trigger                              | Notification label             |
|-------------------------------------|-------------------------------|
| LLM generation + focus patch applied | "Focus patch applicata"       |
| LLM generation + no focus patch     | "Nuova versione salvata"       |
| Editor save (WYSIWYG snapshot)       | "Versione salvata dall'editor" |
| EDIT Light commit                    | "Versione EDIT salvata"        |
| Manual snapshot activation           | "Versione attivata"            |

### Client helper

```typescript
import { listExecutionLogs } from "@/lib/api";

const { logs } = await listExecutionLogs(token, projectId, {
  domain: "focus_patch",
  limit: 20,
});
```

---

## Source files

| File                                                                 | Role                           |
|--------------------------------------------------------------------|-------------------------------|
| `apps/api/src/domain/entities/ExecutionLog.ts`                      | Domain entity + types          |
| `apps/api/src/domain/repositories/IExecutionLogRepository.ts`       | Repository interface           |
| `apps/api/src/infra/repositories/MongoExecutionLogRepository.ts`    | MongoDB implementation + TTL   |
| `apps/api/src/application/services/ExecutionLogger.ts`              | Fire-and-forget singleton       |
| `apps/api/src/presentation/http/routes/executionLogRoutes.ts`       | Query REST endpoint            |
| `packages/contracts/src/executionLog.ts`                            | Zod schemas + TS types         |
| `apps/web/lib/api.ts`                                               | `listExecutionLogs()` client   |

---

## Adding new log points

1. Pick the right `domain` (or add a new one to `LogDomain` in the entity + contract).
2. Define a clear `eventType` string (snake_case verb + noun, e.g. `export_published`).
3. Call `ExecutionLogger.instance.emit({ projectId, domain, eventType, level, status, metadata })`.
4. Document the new event type and metadata shape in this file.
5. If a user-visible notification is appropriate, add it via `addNotification()` in the relevant frontend handler.
