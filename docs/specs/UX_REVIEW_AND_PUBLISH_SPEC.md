# Andy Code Cat — UX Review + Persistent Publishing (Path UUID)

> **Revision:** 2026-04-07
> **Scope:** Workspace UX review + Level-3 persistent publishing implementation (path UUID)
> **Prerequisites:** M0, M0.5, M0.8, M4a completed

---

## 1. UX Review — Current State of the Workspace

### 1.1 Current user flow

```
Login → Dashboard (project list) → Create/Open project → Workspace
```

The workspace is a 3-column layout:

| Column | Content | Status |
|---|---|---|
| **Left** (chat) | Chat with the LLM, focus indicator, prompt config | ✅ Working |
| **Center** (preview) | Preview iframe, tabs (HTML/CSS/JS/Prompt), toolbar with Inspect/Edit/Export/Capture | ✅ Working |
| **Right** (editor) | Monaco editor for source, snapshot history | ✅ Working |

### 1.2 UX pain points identified

#### P1 — No "publish and share" path

The user generates a site, refines it, but can then only download a ZIP. They can't show it to someone with a link. This breaks the validation loop: generate → test → share → iterate.

#### P2 — Inspect mode isn't the default after the first generation

Focus edit is the most powerful feature for saving tokens, but it requires manual activation. First-time users don't know it exists.

#### P3 — Toolbar too dense

Inspect, Edit, Save Edit, Export ZIP, Capture JPG/PDF — all on the same row. There's no visual hierarchy.

#### P4 — No post-generation feedback

After the LLM generates, there's no clear call-to-action: "Your site has been generated! Do you want to publish it or refine it?"

#### P5 — No "publication status" area

Once the site is published, the user needs to see the deploy status and the shareable link prominently.

### 1.3 Proposed UX improvements (incremental)

| ID | Improvement | Priority | Sprint |
|---|---|---|---|
| **UX-PUB** | "Publish" button + shareable link panel | **Critical** | This sprint |
| **UX-POST-GEN** | Post-generation banner with CTA ("Publish" / "Refine with Inspect") | High | Next sprint |
| **UX-INSPECT-AUTO** | Auto-activate Inspect after the first generation | High | Next sprint |
| **UX-TOOLBAR** | Toolbar grouping: [Mode] [Actions] [Publishing] | Medium | Future |

---

## 2. Persistent Publishing — "Level 3" Architecture (Path UUID)

### 2.1 Rationale

The original spec (`EXPORT_AND_PUBLISH_SPEC.md`) defines a subdomain-based system with a dedicated nginx instance (M4b). That's the final target, but it requires:

- An nginx service in docker-compose
- A Docker socket for reload
- Wildcard DNS/SSL
- BullMQ for the DeployWorker

**Level 3** is an intermediate approach: the API itself serves the published pages at a UUID path, with no additional infrastructure.

```
Level 1: ZIP Export (local download)             ✅ Implemented
Level 2: Path UUID publishing (API-served)        ← THIS SPRINT
Level 3: nginx subdomain (future M4b)             📐 Spec defined
```

### 2.2 URL Format

```
https://{host}/p/{publishId}
```

Examples:

- Dev: `http://localhost:4000/p/a1b2c3d4`
- Prod: `https://api.Andy Code Cat.io/p/a1b2c3d4`

The `publishId` is a short id derived from a UUID (first 8 characters) with a collision check.

### 2.3 User flow

```
1. User is satisfied with the preview
2. Clicks "🌐 Publish"
3. API copies artifacts to /data/www/{publishId}/
4. Returns a shareable URL
5. UI shows the link with a "Copy link" button
6. The visitor opens the link → sees the generated site
7. The user can update (re-publish) or remove the publication
```

### 2.4 Differences from ZIP Export

| Aspect | ZIP Export | Publish Path UUID |
|---|---|---|
| Output | Downloaded file | Shareable live URL |
| Lifetime | Until downloaded | Persistent (until removed) |
| Update | New export | Re-publish overwrites |
| Infra dependencies | None | Filesystem only (`/data/www/`) |
| Visitor auth | N/A | None (public) |

---

## 3. Technical design

### 3.1 `SiteDeployment` entity

```typescript
interface SiteDeployment {
    id: string;                    // UUID
    publishId: string;             // short id (8 chars, URL-safe)
    projectId: string;
    userId: string;
    snapshotId: string;
    status: "deploying" | "live" | "failed";
    url: string;                   // /p/{publishId}
    filesDeployed: string[];       // ['index.html', 'style.css', 'script.js']
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
    deployedAt?: Date;
}
```

### 3.2 `SiteDeploymentRepository` repository

```typescript
interface SiteDeploymentRepository {
    create(input: CreateSiteDeploymentInput): Promise<SiteDeployment>;
    findById(id: string): Promise<SiteDeployment | null>;
    findByPublishId(publishId: string): Promise<SiteDeployment | null>;
    findByProjectId(projectId: string): Promise<SiteDeployment[]>;
    findActiveByProjectId(projectId: string): Promise<SiteDeployment | null>;
    updateStatus(id: string, status: SiteDeployment["status"], data?: Partial<SiteDeployment>): Promise<SiteDeployment | null>;
    deleteById(id: string): Promise<boolean>;
    isPublishIdTaken(publishId: string): Promise<boolean>;
}
```

### 3.3 `PublishProject` use-case

```
Input: { projectId, userId, snapshotId? }
Output: SiteDeployment with URL

Steps:
1. Verify double sandbox (user owns project)
2. Retrieve snapshot (by ID or active)
3. If a live deploy already exists for the project → update it (re-publish)
4. Generate a unique publishId (short UUID, collision check)
5. Post-process artifacts (same logic as ExportLayer1Zip: split CSS/JS)
6. Write files to /data/www/{publishId}/
7. Create/update the SiteDeployment record
8. Return the deployment with its URL
```

### 3.4 `UnpublishProject` use-case

```
Input: { projectId, userId, deploymentId }
Output: void

Steps:
1. Verify ownership
2. Delete the /data/www/{publishId}/ directory
3. Update/remove the SiteDeployment record
```

### 3.5 API Endpoints

```
POST   /v1/projects/:projectId/publish        → Publish/update
GET    /v1/projects/:projectId/publish         → Current publication status
DELETE /v1/projects/:projectId/publish/:id     → Remove publication

GET    /p/:publishId                           → Serves index.html (PUBLIC)
GET    /p/:publishId/style.css                 → Serves CSS (PUBLIC)
GET    /p/:publishId/script.js                 → Serves JS (PUBLIC)
GET    /p/:publishId/*                         → Serves any file (PUBLIC)
```

### 3.6 Zod contract

```typescript
// packages/contracts/src/publish.ts
const publishProjectSchema = z.object({
    snapshotId: z.string().uuid().optional(),
});

interface SiteDeploymentDto {
    id: string;
    publishId: string;
    projectId: string;
    status: "deploying" | "live" | "failed";
    url: string;
    filesDeployed: string[];
    createdAt: string;
    updatedAt: string;
    deployedAt?: string;
}
```

### 3.7 Security

- **Public serving**: the `/p/:publishId` path requires no authentication
- **Sanitized content**: the HTML artifacts are the ones generated by the LLM, already in the system
- **Path traversal prevention**: `publishId` is validated as `[a-z0-9]` only, no user input in the path
- **Double sandbox**: POST/DELETE require auth + project ownership
- **No directory listing**: only specific files are served, never `readdir`

### 3.8 Storage layout

```
data/
├── www/
│   ├── {publishId_1}/
│   │   ├── index.html
│   │   ├── style.css
│   │   └── script.js
│   └── {publishId_2}/
│       ├── index.html
│       ├── style.css
│       └── script.js
├── uploads/          ← existing assets
└── exports/          ← existing ZIP exports
```

---

## 4. UI Frontend — Components

### 4.1 "Publish" button in the toolbar

Placed after Export ZIP in the preview toolbar. Only visible when artifacts exist.

```
[◎ Inspect] [✎ EDIT] [💾 Save] | [⬇ ZIP] [📷 Capture] [🌐 Publish]
```

### 4.2 Publication status panel

Once the project is published, shows a banner below the toolbar:

```
┌──────────────────────────────────────────────────────┐
│ 🌐 Published: http://localhost:4000/p/a1b2c3d4       │
│ [📋 Copy link]  [🔄 Update]  [🗑 Remove]              │
│ Last updated: 5 min ago                                │
└──────────────────────────────────────────────────────┘
```

### 4.3 "Publish" flow (first time)

1. User clicks "🌐 Publish"
2. Notification panel: "Publishing in progress…"
3. API responds with the URL
4. Publication banner appears with the link
5. Notification: "Site published! Link copied."

### 4.4 "Update" flow (re-publish)

1. User modifies the site (chat, edit, etc.)
2. Clicks "🔄 Update" in the publication banner
3. API overwrites the files
4. Banner updates with a new timestamp

---

## 5. Implementation sequence

```
1. Contracts: packages/contracts/src/publish.ts
2. Entity + Repository interface: domain/entities/SiteDeployment.ts, domain/repositories/SiteDeploymentRepository.ts
3. MongoDB adapter: infra/repositories/MongoSiteDeploymentRepository.ts
4. LocalFileStorage: add publish methods (wwwDirPath, writePublishFiles, deletePublishDir)
5. Use-cases: PublishProject.ts, UnpublishProject.ts, GetSiteDeployment.ts
6. Routes: publishRoutes.ts (CRUD + static serving)
7. app.ts: mount routes
8. Frontend: api.ts functions, workspace UI (button + banner)
9. Smoke test
```

---

## 6. Compatibility with future evolution

This level 3 is compatible with evolving toward nginx subdomains (M4b):

- The `SiteDeployment` entity stays the same — it just gains `type: "path" | "subdomain"`
- The `/data/www/{publishId}/` storage is the same one used by nginx
- Moving to nginx only requires: adding a virtual host + changing the URL format

There are no breaking changes when evolving to the next level.
