# Andy Code Cat — Pipeline Layers Architecture

## Overview

The Andy Code Cat platform uses **two distinct generation layers**.
Each layer is independent, testable, and explicitly connected to the next one through a trigger mechanism.

---

## Layer 1 — Chat Preview

**Goal:** rapid iteration, immediate feedback, and text-based refinement.

```
User message
    │
    ├─ + history (latest N user/assistant turns, 6000-token budget)
    ├─ + currentArtifacts (previously generated HTML/CSS/JS)
    ├─ + focusContext (project | preview-element | code-selection)
    │
    ▼
LLM (SiliconFlow · dialogue model · streaming SSE)
    │
    ├─── event: thinking  → UI: flowing text preview (last 600 chars)
    ├─── event: answer    → UI: fixed draft box (max 80px)
    └─── event: done      → result: LlmChatPreviewResult
                                │
                                ├─ structured.chat.summary  → chat bubble
                                ├─ structured.artifacts.html
                                ├─ structured.artifacts.css  → iframe preview
                                └─ structured.artifacts.js
                                │
                                └─ contextStats {
                                       estimatedTokens: number
                                       historyTurns: number
                                       atCapacity: boolean   ← trigger
                                   }
```

**Characteristics:**

- Synchronous from the UX point of view (response in ~5-30s)
- No disk writes, everything stays in memory
- Persists in `Conversation.messages` (MongoDB)
- Artifacts are rendered through iframe `srcdoc` (no hosting required)
- Context can be focused on a specific target (preview element or code selection)

### Layer 1.5 — Focused Asset Control

This extension stays in Layer 1 and adds precise control over the asset being edited.

```
Preview iframe
    │
    ├─ toggle Inspect ON/OFF
    ├─ hover highlight
    └─ click select element
             │
             ├─ copy node HTML
             ├─ copy metadata JSON
             └─ use in prompt
                    │
Code tabs (HTML/CSS/JS)
    │
    └─ line/range selection
             │
             ▼
focusContext injected into prompt wrapper
```

Recommended minimum `focusContext`:

```typescript
interface FocusContext {
    mode: 'project' | 'preview-element' | 'code-selection';
    targetType: 'html' | 'css' | 'js' | 'component' | 'section';
    selectedElement?: {
        stableNodeId: string;
        selector: string;
        tag: string;
        classes: string[];
        textSnippet?: string;
    };
    codeSelection?: {
        language: 'html' | 'css' | 'js';
        startLine: number;
        endLine: number;
        selectedText?: string;
    };
}
```

**Limits:**

- Max context: ~6000 tokens (~24,000 chars)
- Output is not directly deployable (inline JSON rather than structured files)
- Not suitable for complex multi-file websites

---

## Transition Mechanism — Token Limit Trigger

The trigger is **automatic** when `contextStats.atCapacity === true`, or **manual** when the user clicks “Start Professional Pipeline”.

```
Frontend receives contextStats.atCapacity === true
    │
    ▼
Banner in chat:
"The context is almost full (N tokens / 6000).
Do you want to start the professional pipeline to generate
the final files for your site?"
    │
    ├── [Continue in chat]   → Layer 1 continues (automatic context trimming)
    └── [Start Pipeline]     → POST /v1/projects/:id/generate
                                  body: {
                                      conversationId,
                                      profileId,      // optional
                                      fromChat: true  // carries current artifacts forward
                                  }
                                  → { jobId }
                                  → redirect /jobs/:jobId
```

**Data transferred from Layer 1 to Layer 2:**

- `conversationId` — used to extract the history and latest request
- `currentArtifacts` — HTML/CSS/JS as the “iteration-0” reference
- `conversationSummary` — condensed summary for preprompting
- `focusContext` — when present, preserves or optimizes the selected asset scope

---

## Layer 2 — OpenCode Pipeline

**Goal:** professional generation, real files on disk, deployment through nginx.

```
POST /generate
    │
    ▼
Job { status: "queued" }
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    STAGE A — PrepromptEngine               │
│                                                             │
│  Input: conversationId · userPrompt · profileId · attachments
│                                                             │
│  LayerComposer (Nunjucks + JSONata)                         │
│    └─ layers: system · context · constraint · format · persona
│                                                             │
│  Output: resolvedPrompt · CLAUDE.md · opencode.json         │
│  Cost: 0.5 credits                                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   STAGE B — GenerationWorker               │
│                                                             │
│  Workspace: /data/workspaces/{jobId}/                       │
│    ├── opencode.json                                        │
│    ├── CLAUDE.md                                            │
│    └── skills/                                              │
│                                                             │
│  spawn: opencode run --dangerously-skip-permissions         │
│    stdout → Job.logs[] + SSE stream                         │
│                                                             │
│  Post-processor: verify dist/index.html                     │
│  Git: commit branch "iteration-N" in Gitea                 │
│  Cost: 5 credits per iteration                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │ (optional, Phase 2)     │
              ▼                         │
┌─────────────────────────┐             │
│  STAGE C — QualityCheck │             │
│                         │             │
│  Playwright screenshot  │  score≥75 → │
│  LLM vision score       │             │
│  if score<75: re-run B  │             │
│  Cost: 1.5 credits/cycle│             │
└───────────┬─────────────┘             │
            └───────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    STAGE D — DeployWorker                  │
│                                                             │
│  Copy: dist/ → /var/www/Andy Code Cat/{slug}/               │
│  nginx.conf: Nunjucks template → sites-available/           │
│  nginx -t → rollback if invalid                             │
│  nginx reload (graceful)                                    │
│  Certbot SSL (prod) / HTTP only (dev)                       │
│  Cost: 1 credit                                             │
│                                                             │
│  Output: https://{slug}.Andy Code Cat.io                    │
└─────────────────────────────────────────────────────────────┘
```

**Job status lifecycle:**

```
queued → running → completed
                └→ failed (with automatic retry up to 2 times)
```

**SSE events from the job:**

```typescript
type JobEvent =
    | { type: "stage_started";   stage: string; }
    | { type: "log";             stage: string; line: string; }
    | { type: "stage_completed"; stage: string; durationMs: number; }
    | { type: "stage_failed";    stage: string; error: string; }
    | { type: "credits_charged"; amount: number; balance: number; }
    | { type: "job_completed";   output: JobOutput; }
    | { type: "job_failed";      error: string; }
```

---

## Comparing the two layers

| Aspect | Layer 1 Chat Preview | Layer 2 OpenCode Pipeline |
|---|---|---|
| Latency | 5-30s | 1-10 min |
| Output | Inline JSON (HTML/CSS/JS strings) | Real files on disk |
| Deploy | No (`iframe srcdoc`) | Yes (served by nginx) |
| Iterations | Through chat | Git branch `iteration-N` |
| Rollback | Conversation history | `POST /iterations/:n/restore` |
| Cost | ~0 (LLM tokens only) | 5-8 credits per run |
| Best for | Exploration, briefing, mockups | Final production site |
| Limit | 6000 context tokens | No practical limit |

---

## Pipeline configuration per `PrepromptProfile`

Each profile defines which stages are active and which parameters each stage uses:

```typescript
interface PipelineConfig {
    stages: ('preprompt' | 'generation' | 'qualityCheck' | 'imageGen' | 'deploy')[];
    qualityCheck?: {
        enabled: boolean;
        minScore: number;       // default: 75
        maxRetries: number;     // default: 2
    };
    imageGen?: {
        enabled: boolean;
        mode: 'placeholder' | 'flux' | 'dalle';
    };
    deploy?: {
        autoPublish: boolean;   // if false, explicit user confirmation is required
        domain?: string;        // optional custom domain
    };
}

// MVP default:
const defaultPipeline: PipelineConfig = {
    stages: ['preprompt', 'generation', 'deploy'],
    qualityCheck: { enabled: false },
    imageGen: { enabled: false, mode: 'placeholder' },
    deploy: { autoPublish: false },
};
```

---

## Double Sandboxing (Layer 2)

Each workspace is isolated at two levels:

```
Level 1 — Tenant sandbox (user)
    /data/workspaces/{jobId}/          ← workspace for a single job
    /var/www/Andy Code Cat/{slug}/     ← project webroot

    Isolation: each job has a dedicated directory
    Cleanup: workspace is removed after N days (configurable)

Level 2 — Project sandbox (project)
    nginx: each subdomain serves only its own webroot
    credits: charged per userId + projectId
    git: each project has its own private Gitea repository
```

This model mirrors the `Tenant Isolation Model` defined in `AGENTS.md`.
