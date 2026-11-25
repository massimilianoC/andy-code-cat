# Project Data Panel

**Status:** implemented (leaderboards). Other capabilities (form submissions, …) plug in through
the same registry.

The owner of a project sees, in one place, every record a platform capability stored for that
project — what an arcade game saved as scores, what a published site saved as form submissions —
and can look at it, download it, or delete it. It is meant for non-technical owners: no query
language, no database vocabulary, plain words and confirmations.

## 1. Where it lives

| Concern | Path |
| --- | --- |
| Contract (DTOs, query/body schemas, export cap) | `packages/contracts/src/projectData.ts` |
| Capability interface | `apps/api/src/domain/projectData/ProjectDataCapability.ts` |
| Registry | `apps/api/src/application/projectData/ProjectDataRegistry.ts` |
| Use cases (summary, list, delete, clear, export) | `apps/api/src/application/projectData/ManageProjectData.ts` |
| CSV encoder | `apps/api/src/application/projectData/projectDataCsv.ts` |
| Leaderboard capability | `apps/api/src/application/projectData/LeaderboardProjectData.ts` |
| The one composition | `apps/api/src/composition/composeProjectData.ts` |
| HTTP routes | `apps/api/src/presentation/http/routes/projectDataRoutes.ts` |
| Web client | `apps/web/lib/api/projectData.ts` |
| Web modal | `apps/web/components/projectData/ProjectDataDialog.tsx`, opened by the **Data** button on the left of the project configuration footer (`ProjectConfigPopup.tsx`) |

## 2. What the owner can do

- **See every capability**, even one with no records yet: a tab per capability with its record
  count and the time of the last write.
- **Filter by group** (a leaderboard board, a form), **search** with plain text, **page** through
  records newest first. The table shows when the record was saved, its group, and a one-line
  preview of its data.
- **Open a record** as read-only, pretty-printed JSON, and copy it.
- **Delete one record** after a confirmation.
- **Clear a group or a whole capability.** The owner must type the capability id (for example
  `leaderboard`); the API refuses any other value.
- **Export** the current selection (all groups or one group) as JSON or CSV.

When there is nothing to show, the panel says so in plain words: *"No data yet — data appears here
when your published site or arcade game stores something."*

## 3. HTTP API

All routes are mounted under `/v1`, behind `authMiddleware`, the project sandbox
(`x-project-id` must name a project the caller owns), and a check that the path `:projectId`
equals the sandboxed project. All are rate-limited (reads 120/min, writes 60/min, exports 20/min).

| Method and path | Result |
| --- | --- |
| `GET /projects/:projectId/data` | `ProjectDataSummaryDto` — every registered capability, with groups |
| `GET /projects/:projectId/data/:capabilityId/records?groupId&page&limit&search` | `ProjectDataRecordPageDto` |
| `DELETE /projects/:projectId/data/:capabilityId/records/:recordId` | `204`, or `404` when the record is not in this project |
| `POST /projects/:projectId/data/:capabilityId/clear` body `{ groupId?, confirm }` | `{ removed }`; `400 PROJECT_DATA_CONFIRMATION_MISMATCH` unless `confirm` equals the capability id |
| `GET /projects/:projectId/data/:capabilityId/export?format=json\|csv&groupId` | attachment |

An unregistered `capabilityId` answers `404 PROJECT_DATA_CAPABILITY_NOT_FOUND`. Queries and bodies
are validated with the contract schemas (`listProjectDataRecordsQuerySchema`,
`clearProjectDataSchema` — strict, unknown fields refused — and `exportProjectDataQuerySchema`).

## 4. Export format

Both formats contain the newest records of the selection, at most
`PROJECT_DATA_EXPORT_MAX_RECORDS` (10 000). The response carries
`Content-Disposition: attachment; filename="project-data-<capability>[-<group>]-<YYYYMMDD-HHMMSS>.<ext>"`
(built server-side from `[A-Za-z0-9._-]` only), `Cache-Control: no-store`, and `X-Export-Records` /
`X-Export-Total`.

**JSON** — one document:

```json
{
  "capability": "leaderboard",
  "label": "Leaderboards",
  "groupId": null,
  "exportedAt": "2026-11-25T10:00:00.000Z",
  "total": 2,
  "truncated": false,
  "records": [{ "id": "…", "groupId": "default", "createdAt": "…", "data": { "player": "ANA", "score": 120 } }]
}
```

**CSV** — UTF-8 with a byte order mark (so spreadsheet apps read accents correctly), RFC 4180:

- columns `id`, `group`, `createdAt`, then every top-level key of `data` in first-seen order; a data
  key that collides with a base column is written as `data.<key>`;
- nested values (objects, arrays) are JSON-encoded into their cell; null and missing values are
  empty;
- CRLF line endings; a cell containing `"`, `,`, CR or LF is quoted and its quotes doubled;
- **formula-injection protection:** a text cell (headers included) starting with `=`, `+`, `-`,
  `@`, TAB or CR is prefixed with `'`, so a spreadsheet shows it as text. Numbers and booleans are
  written as they are.

## 5. The capability contract

A capability implements `ProjectDataCapability`:

| Member | Meaning |
| --- | --- |
| `id` | Stable, `^[a-z][a-z0-9-]{1,31}$`; also the typed confirmation of `clear()` |
| `label` | Shown as the tab title |
| `groups(scope)` | Every group holding records, with count and last write |
| `list(scope, { groupId?, page, limit, search? })` | Newest first, plus the total for the same filter |
| `exportRecords(scope, groupId?, max)` | Newest first, at most `max` |
| `deleteRecord(scope, recordId)` | `true` only if a record of this scope was removed |
| `clear(scope, groupId?)` | One group, or every group when `groupId` is undefined; returns records removed |

`scope` is `{ ownerUserId, projectId }`, built by the route from the JWT subject and the sandboxed
project. A record's `data` is what the owner may see of it — never another project's data, and
never internal fields (owner id, project id).

### Adding a capability

1. Implement `ProjectDataCapability` in `apps/api/src/application/projectData/`, over a domain
   repository whose every method takes the scope first and spreads it into every filter.
2. Append an instance to the list in `composeProjectDataCapabilities()`
   (`apps/api/src/composition/composeProjectData.ts`).

That is all. The capability then appears in the panel (even with zero records), can be listed,
exported, cleared, and is **purged with its project**: `DeleteProject` calls
`registry.purgeProject(scope)` on the same registry. The web panel needs no change; add a label
translation only if the capability label should be localised later.

## 6. Safety rules

- **Scope only.** Every capability method takes `{ ownerUserId, projectId }` whole; neither the
  owner nor the project ever comes from the request body or query. The path project must equal
  the sandboxed project.
- **No free-form queries.** The only filters are the contract's closed set: `groupId` (validated
  pattern), `page`, `limit` (≤ 200), and `search` — plain text, at most 100 characters, matched as
  a literal case-insensitive substring (the leaderboard escapes every regex metacharacter). There is
  no query language, sort parameter or field selector.
- **Typed confirmation.** Clearing requires `confirm` to equal the capability id, checked by the
  API, not just the interface.
- **Bounded export.** At most `PROJECT_DATA_EXPORT_MAX_RECORDS` records per export; CSV cells are
  protected against formula injection.
- **Deletion is complete.** Project deletion purges every registered capability. A purge failure is
  logged as an error and does not stop the deletion — the same rule every other collection follows
  in `DeleteProject`.

## 7. Leaderboard capability

- id `leaderboard`, label "Leaderboards"; one group per board (`boardId`); one record per stored
  score, `data = { player, score }`.
- Backed by `leaderboard_scores` (see [ARCADE_MODE_MVP.md](ARCADE_MODE_MVP.md) §5). Repository
  methods for the panel: `boards`, `listNewest` (index `leaderboard_project_newest`),
  `deleteInProject`, `clear` — all scoped by `{ ownerUserId, projectId }`.
- Search matches the player name.
