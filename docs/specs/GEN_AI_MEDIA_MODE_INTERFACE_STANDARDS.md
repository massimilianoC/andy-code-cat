# Gen AI Media Mode — Interface Standards & Engine Contract

> Status: architectural analysis + interface contract  
> Date: 2026-06-10  
> Scope: analysis of standard protocols (MCP, A2A, OpenAPI, CLI) for external media engine integration; definition of the REST contract that any podcast/video/music engine must expose to be consumed by the platform; dual-mode integration strategy (direct API vs. standard adapters)  
> Audience: maintainers, podcast engine developers, integration agents  
> Related specs: `docs/specs/GEN_AI_MEDIA_MODE_SPEC.md`, `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`, `docs/specs/PROVIDER_SPEC.md`, `docs/specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md`  
> Related codebase: `apps/api/src/application/media/generateImageWithSiliconFlow.ts`, `apps/api/src/application/use-cases/GenerateProjectImage.ts`, `apps/api/src/application/media/ResolveArtifactMedia.ts`

---

## 1. Executive Summary

This document answers two questions:

1. **Can the existing image-generation delegation pattern (SiliconFlow) be reused for podcast/video?**
   - *Short answer:* partially for the data model, but **not** for the transport and lifecycle. Image generation is synchronous (~1-10s); podcast/video generation is asynchronous (30s–10min+). The current `setTimeout` fire-and-forget pattern without recovery is insufficient.

2. **Which standard protocols should the engine support?**
   - *Short answer:* expose a **REST API with async job lifecycle** (202 Accepted + polling + webhook) as the primary interface. Wrap it optionally with **OpenAPI 3.1** for discoverability and **MCP** for LLM-native clients. **A2A** only if the engine is conceived as an autonomous agent, not a tool.

The platform will implement a **Dual Mode** integration:
- **Mode A — Direct API** (immediate): hard-coded REST client for a self-hosted podcast engine where we control the source code.
- **Mode B — Standard Adapter** (future-proof): pluggable adapter layer that can consume any engine exposing the same REST contract, whether self-hosted, commercial (ElevenLabs, Replicate, fal.ai), or wrapped via MCP/A2A.

---

## 2. Analysis of the Current SiliconFlow Pattern

### 2.1 How It Works Today

The existing image generation flow (`apps/api/src/application/use-cases/GenerateProjectImage.ts`) uses a **deferred asset + fire-and-forget** pattern:

```text
1. HTTP request arrives
2. Create ProjectAsset with generationStatus: "queued" + SVG placeholder
3. Return assetId immediately to client
4. setTimeout(..., 50) → background work:
    a. Call SiliconFlow /images/generations (synchronous HTTP, ~1-10s)
    b. Receive b64_json or url
    c. Save buffer to IFileStorage
    d. Update asset to generationStatus: "ready"
    e. Record cost via CostTransactionService
```

### 2.2 Why It Breaks for Podcast/Video

| Aspect | Image (SiliconFlow) | Podcast/Video |
|---|---|---|
| **Duration** | 1–10 seconds | 30 seconds – 10 minutes |
| **HTTP call** | Synchronous blocking `fetch` | Must be async (202 + jobId) |
| **Container recovery** | Acceptable to lose 1-2 jobs on restart | Unacceptable to lose a 5-minute generation |
| **Client UX** | No notification needed; page refresh shows image | User needs progress feedback (%, ETA) |
| **Placeholder** | SVG thumbnail is acceptable | SVG is not acceptable for audio/video |
| **File size** | ~100 KB – 2 MB | 5 MB – 500 MB |
| **Cost** | Per image, fixed | Per minute, variable |
| **Post-processing** | None | Transcript extraction, chapter detection, waveform |

**Critical finding:** `generateImageWithSiliconFlow.ts` does **not** use `AbortController` or respect `SILICONFLOW_IMAGE_TIMEOUT_MS`. A blocking call that hangs for minutes would exhaust the Node.js event loop and risk HTTP timeouts from reverse proxies or load balancers.

### 2.3 What Can Be Reused

| Component | Reuse | Notes |
|---|---|---|
| `ProjectAsset` entity | ✅ Full | Extend `generationMetadata` with audio/video fields |
| `IFileStorage` | ✅ Full | Already supports arbitrary binary streams |
| `CostTransactionService` | ✅ Full | Add `ResourceType.AUDIO_GENERATION` |
| `PreviewSnapshot` | ✅ Full | Media is injected via placeholder resolution |
| `publicMediaRoutes.ts` (`/p/media/:id`) | ✅ Full | Serves audio/video identically to images |
| `GenerationProjectImage` pattern | ⚠️ Partial | The "deferred asset" concept is identical; the background execution must become a proper job queue |
| `ResolveArtifactMedia` | ❌ No | Currently downgrades `image_generation` to `stock`. Must be extended with a real strategy dispatcher |

---

## 3. Standard Protocol Analysis

### 3.1 MCP — Model Context Protocol (Anthropic)

**What it is:** JSON-RPC 2.0 protocol for LLM hosts to discover and invoke tools, resources, and prompts from external servers.

**Transport:** stdio (local subprocess) or HTTP+SSE (remote).

**Tool definition:** JSON Schema 2020-12 (`tools/list` → `tools/call`).

**Async model:** ❌ **Synchronous by design**. The client blocks waiting for `tools/call` response. No native job queue, webhook, or callback.

**Assessment for Podcast Engine:**

| Pro | Contra |
|---|---|
| Emerging standard with wide adoption (Claude, Cursor, VS Code, Open WebUI) | **No native async support** — a 5-minute podcast generation would block the LLM/client |
| Automatic tool discovery (`tools/list`) | **LLM-coupled** — unusable from traditional REST clients, mobile apps, cron jobs |
| JSON Schema 2020-12 aligns with OpenAPI 3.1 | Sampling feature creates security vectors (prompt injection risks per Unit 42/Palo Alto) |
| Clean separation: tool (action), resource (data), prompt (template) | stdio is single-machine; HTTP requires CORS, auth, TLS management |

**Verdict:** MCP is **not suitable as the primary interface** for a podcast engine that serves both LLM and non-LLM clients. It is suitable as an **optional thin adapter** (Mode B) for LLM-native integrations.

---

### 3.2 A2A — Agent-to-Agent Protocol (Google / Linux Foundation)

**What it is:** JSON-RPC 2.0 over HTTPS for autonomous agents to delegate tasks to other agents.

**Transport:** HTTPS (POST), SSE streaming, or webhook push.

**Discovery:** `/.well-known/agent-card.json` (Agent Card).

**Task lifecycle:** `submitted → working → {input_required, auth_required} → {completed, failed, canceled, rejected}`

**Async model:** ✅ **Native**. Supports SSE streaming, webhook push, and polling (`tasks/get`).

**Assessment for Podcast Engine:**

| Pro | Contra |
|---|---|
| **Natively async** — handles long-running tasks (minutes/hours) | Over-engineered if the engine is a "tool", not an "agent" |
| Multi-turn with `input_required` — useful for human approval on expensive generations | Ecosystem less mature than MCP; SDKs still evolving |
| Agent Card for auto-discovery | 150+ organizations, but tooling gaps remain |
| Streaming + webhook out-of-the-box | Adds semantic overhead (messages, parts, artifacts) for a simple "generate audio" operation |

**Verdict:** A2A is **suitable only if** the podcast engine is conceived as an **autonomous agent** in a multi-agent ecosystem (e.g., an orchestrator delegates "produce episode 3" to the podcast agent, which may ask clarifications). It is **overkill** for a simple API tool. Use it in **Mode B** only for agent-to-agent scenarios.

---

### 3.3 OpenAPI 3.1 + Function Calling

**What it is:** Not a transport protocol, but the **de-facto standard for describing REST APIs** that LLMs can invoke via Function Calling.

**Transport:** Standard HTTP/REST (or SSE for streaming).

**Tool definition:** JSON Schema 2020-12 embedded in OpenAPI paths.

**Async model:** ❌ **Not defined by the standard**. The application must implement async separately.

**Assessment for Podcast Engine:**

| Pro | Contra |
|---|---|
| **Universal** — supported by OpenAI, Anthropic, Google, Mistral, vLLM | No native async, retry, or callback semantics |
| JSON Schema 2020-12 = full alignment with OpenAPI 3.1 | The "tool" is just a schema; execution is entirely application-defined |
| Constrained decoding (`strict: true`) guarantees valid parameters | No discovery mechanism beyond static documentation |
| Huge ecosystem of tooling (Swagger UI, code generators, validators) | |

**Verdict:** OpenAPI 3.1 is the **best descriptive layer**. Every podcast engine should expose an OpenAPI spec. The platform can derive Function Calling schemas from it automatically (`@samchon/openapi`). This is **not a replacement for the REST API**, but its **machine-readable contract**.

---

### 3.4 CLI Anything Pattern (Unix Philosophy)

**What it is:** An emerging pattern where AI tools are CLI executables that read from stdin and write to stdout, composable via Unix pipes.

**Examples:** AIx (ProjectDiscovery), GitHub Copilot CLI piping.

**Transport:** stdio (`|`), file redirection, environment variables.

**Async model:** ❌ **Synchronous pipeline**. Each stage blocks.

**Assessment for Podcast Engine:**

| Pro | Contra |
|---|---|
| Extreme simplicity and composability | **Unsuitable for long-running tasks** — a 5-minute generation would block the pipe |
| Zero network/service overhead | No state: crash = lost job |
| Perfect for scripting, CI/CD, batch processing | No callback, notification, or retry mechanism |

**Verdict:** The CLI pattern is **excellent for local tooling** (e.g., a script that post-processes a transcript or converts formats), but **unsuitable as the primary service interface**. Recommend it for **utility scripts** around the podcast pipeline, not the engine itself.

---

### 3.5 Async Media API Pattern (Industry Standard)

**What it is:** The de-facto standard used by all major media generation providers (Replicate, fal.ai, Runway, Runware, Sync.labs, ElevenLabs).

**Pattern:**
```text
POST /v1/generate  →  202 Accepted + {jobId, status: "queued"}
                            ↓
              [Async Processing Queue]
                            ↓
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
   Polling            Webhook              SSE Stream
GET /jobs/:id     POST callback      text/event-stream
```

**Characteristics:**
- HTTP/REST transport
- `202 Accepted` on submission
- Request ID (`jobId`) as durable handle
- Presigned URLs for result download (temporary, must be consumed quickly)
- Webhook signature verification (HMAC)
- Idempotency via `jobId`

**Assessment for Podcast Engine:**

| Pro | Contra |
|---|---|
| **Universally understood** by developers | Requires public webhook endpoint |
| **Scalable** — submit is instant, processing is decoupled | Retry, idempotency, dead-letter queue add complexity |
| **Decoupled from LLM** — any HTTP client can use it | Presigned URLs require immediate download pipeline |
| **Webhook + SSE** give reactive UX | |

**Verdict:** This is the **correct primary interface** for the podcast engine. It is the standard that every commercial provider follows, and it is directly usable by the platform without protocol translation layers.

---

## 4. Comparative Matrix

| Criterion | MCP | A2A | OpenAPI+FC | CLI Pattern | Async Media API |
|---|---|---|---|---|---|
| **Transport** | stdio / HTTP+SSE | JSON-RPC/HTTP+SSE | HTTP/REST | stdio (pipe) | HTTP/REST |
| **Tool Schema** | JSON Schema 2020-12 | Skill description (loose) | JSON Schema 2020-12 | None | Body params / OpenAPI |
| **Native Async** | ❌ | ✅ (Task lifecycle) | ❌ (app-side) | ❌ | ✅ (Webhook/Poll/SSE) |
| **LLM-Coupled** | 🔴 High | 🟡 Medium | 🟢 Low (schema only) | 🟢 Low | 🟢 Low |
| **Discovery** | Runtime (`tools/list`) | Agent Card (well-known) | Static (OpenAPI doc) | None | API catalog / OpenAPI |
| **Multi-turn** | Via Sampling | ✅ `input_required` | ❌ | ❌ | ❌ |
| **Reusable Service** | ❌ No | ⚠️ Agent-to-agent only | ✅ Yes (as API) | ❌ No | ✅ Yes |
| **Best For** | LLM-native tool calling | Autonomous agent delegation | API documentation | Local scripting | Production media generation |

---

## 5. Dual-Mode Integration Strategy

### 5.1 Mode A — Direct API (Immediate)

Use when:
- The podcast engine is **self-hosted** and we control the source code.
- Speed of integration is the priority.
- No need to support third-party engines in the short term.

**Implementation:**
- Hard-coded REST client in `apps/api/src/infra/media/providers/PodcastEngineDirectClient.ts`.
- Config via env: `PODCAST_ENGINE_BASE_URL`, `PODCAST_ENGINE_API_KEY`.
- Direct `fetch()` calls to `POST /v1/generate`, `GET /v1/jobs/:id`, etc.
- This is what `GEN_AI_MEDIA_MODE_SPEC.md` Phase 1 describes.

**Pros:** Fastest to implement; no abstraction overhead.  
**Cons:** Tight coupling; swapping engines requires code changes.

### 5.2 Mode B — Standard Adapter (Future-Proof)

Use when:
- We want to support **multiple engines** (self-hosted + ElevenLabs + Replicate + fal.ai).
- We want **LLM-native discovery** (MCP) or **agent delegation** (A2A).
- We want to **resell** the podcast engine as a standalone service to other projects.

**Implementation:**
1. Define a **domain interface** `MediaEngineAdapter` in `apps/api/src/domain/media/MediaEngineAdapter.ts`:
   ```typescript
   interface MediaEngineAdapter {
     submitJob(input: MediaGenerationInput): Promise<JobReference>;
     getJobStatus(jobId: string): Promise<JobStatus>;
     cancelJob?(jobId: string): Promise<void>;
     downloadResult(jobId: string): Promise<MediaResult>;
   }
   ```
2. Implement adapters:
   - `DirectRestPodcastAdapter` → Mode A
   - `ReplicateAdapter` → Replicate Predictions API
   - `FalAiAdapter` → fal.ai queue + webhook
   - `ElevenLabsAdapter` → ElevenLabs TTS / Projects API
3. Optionally, expose the self-hosted engine via:
   - **OpenAPI 3.1** spec at `/openapi.json`
   - **MCP Server** thin wrapper at `mcp-server/podcast-engine-mcp.ts`
   - **A2A Agent Card** at `/.well-known/agent-card.json` (only if agent semantics are desired)

**Pros:** Pluggable, interoperable, resale-ready.  
**Cons:** More upfront design; adapter maintenance.

### 5.3 Recommended Path

```text
Phase 1: Implement Mode A (Direct API)
    ↓
Phase 2: Extract MediaEngineAdapter interface from Mode A
    ↓
Phase 3: Add Mode B adapters for commercial providers (ElevenLabs, Replicate)
    ↓
Phase 4: Wrap self-hosted engine with OpenAPI 3.1 + optional MCP server
```

The platform codebase should be written so that `GeneratePodcastViaApi` depends on `MediaEngineAdapter`, not on a concrete `fetch()` block. This allows Mode B to be introduced later without rewriting the use-case.

---

## 6. Podcast Engine REST Contract (What the Engine Must Expose)

This section defines the **minimum viable contract** that any podcast engine must implement to be consumed by the platform, whether self-hosted or third-party.

### 6.1 Base URL & Authentication

```text
Base URL:   {ENGINE_BASE_URL}/v1
Auth:       Authorization: Bearer {ENGINE_API_KEY}
            or
            X-API-Key: {ENGINE_API_KEY}

Content-Type: application/json on all request bodies.
Accept:       application/json on all responses.
```

### 6.2 Endpoint: Submit Job

```text
POST /v1/podcast/generate
```

**Request body:**

```json
{
  "jobId": "uuid-v4-generated-by-consumer",      // Idempotency key
  "prompt": "string",                            // Natural language brief
  "script": "string",                            // Optional: pre-written script
  "scriptHints": ["string"],                     // Optional: bullet points to cover
  "voiceProfile": {
    "speakerCount": 2,
    "language": "it-IT",
    "gender": "mixed",                           // "male" | "female" | "mixed"
    "style": "journalistic",                     // "conversational" | "journalistic" | "educational" | "dramatic"
    "voiceIds": ["voice-1", "voice-2"]           // Optional: specific voice IDs
  },
  "attachments": [
    {
      "url": "https://consumer.com/p/media/...", // Presigned URL to source material
      "mimeType": "application/pdf",
      "description": "Research paper"
    }
  ],
  "outputFormat": "mp3",                         // "mp3" | "wav" | "m4a" | "ogg"
  "targetDurationMinutes": 15,
  "quality": "standard",                         // "draft" | "standard" | "premium"
  "webhookUrl": "https://consumer.com/v1/webhooks/podcast-engine",
  "webhookSecret": "shared-secret-for-hmac",     // Optional: if provided, engine signs payload
  "metadata": {                                  // Opaque object forwarded back in webhook
    "consumerProjectId": "...",
    "consumerAssetId": "..."
  }
}
```

**Response: 202 Accepted**

```json
{
  "jobId": "uuid-v4-generated-by-consumer",
  "engineJobId": "engine-internal-id",           // Optional: engine's own tracking ID
  "status": "queued",                            // "queued" | "processing" | "completed" | "failed" | "canceled"
  "estimatedDurationSeconds": 180,
  "pollUrl": "/v1/podcast/jobs/engine-internal-id",
  "submittedAt": "2026-06-10T12:00:00Z"
}
```

**Response: 409 Conflict** (if `jobId` already exists and is not `failed`/`canceled`)

```json
{
  "error": "job_already_exists",
  "jobId": "uuid-v4-generated-by-consumer",
  "status": "processing"
}
```

**Response: 422 Unprocessable Entity** (validation errors)

```json
{
  "error": "validation_failed",
  "details": [
    { "field": "targetDurationMinutes", "message": "must be <= 60" }
  ]
}
```

### 6.3 Endpoint: Get Job Status

```text
GET /v1/podcast/jobs/{engineJobId}
```

**Response: 200 OK**

```json
{
  "jobId": "uuid-v4-generated-by-consumer",
  "engineJobId": "engine-internal-id",
  "status": "processing",
  "progressPercent": 45,
  "estimatedSecondsRemaining": 120,
  "startedAt": "2026-06-10T12:00:05Z",
  "completedAt": null,
  "result": null,
  "error": null
}
```

**Response when completed:**

```json
{
  "jobId": "uuid-v4-generated-by-consumer",
  "engineJobId": "engine-internal-id",
  "status": "completed",
  "progressPercent": 100,
  "startedAt": "2026-06-10T12:00:05Z",
  "completedAt": "2026-06-10T12:03:00Z",
  "result": {
    "audioUrl": "https://engine.com/download/...?expires=...",  // Presigned, temporary
    "audioDurationSeconds": 847,
    "audioFormat": "mp3",
    "audioBitrateKbps": 128,
    "audioFileSizeBytes": 13552000,
    "transcript": [
      { "start": 0.0, "end": 4.2, "text": "Benvenuti...", "speaker": "Speaker 1" }
    ],
    "chapters": [
      { "start": 0, "title": "Introduzione" },
      { "start": 120, "title": "Stato dell'arte" }
    ],
    "wordCount": 2150,
    "metadata": {
      "voiceIdsUsed": ["voice-1", "voice-2"],
      "languageDetected": "it-IT"
    }
  },
  "error": null
}
```

**Response when failed:**

```json
{
  "jobId": "uuid-v4-generated-by-consumer",
  "engineJobId": "engine-internal-id",
  "status": "failed",
  "progressPercent": 67,
  "startedAt": "2026-06-10T12:00:05Z",
  "completedAt": "2026-06-10T12:02:30Z",
  "result": null,
  "error": {
    "code": "generation_error",
    "message": "TTS provider returned 503 after 3 retries",
    "retryable": true
  }
}
```

### 6.4 Endpoint: Cancel Job

```text
POST /v1/podcast/jobs/{engineJobId}/cancel
```

**Response: 200 OK**

```json
{
  "jobId": "uuid-v4-generated-by-consumer",
  "status": "canceled"
}
```

### 6.5 Webhook: Job Completion

The engine **must** support webhook notification if `webhookUrl` is provided in the submit request.

```text
POST {webhookUrl}
Headers:
  Content-Type: application/json
  X-Engine-Name: podcast-engine
  X-Signature: sha256={hmac-sha256-of-payload}

Body:
{
  "event": "job.completed",                      // "job.completed" | "job.failed" | "job.canceled"
  "jobId": "uuid-v4-generated-by-consumer",
  "engineJobId": "engine-internal-id",
  "status": "completed",
  "result": { /* same schema as GET /jobs/{id} result */ },
  "error": null,
  "metadata": { /* echoed from submit request */ }
}
```

**Webhook security:**
- If `webhookSecret` was provided, the engine must sign the payload with HMAC-SHA256.
- The consumer must verify the signature before acting.
- The engine should retry delivery on non-2xx responses (exponential backoff, max 10 attempts).
- The consumer must respond with `200 OK` immediately and process asynchronously.

### 6.6 Endpoint: List Voices (Optional but Recommended)

```text
GET /v1/voices?language=it-IT&gender=female
```

**Response: 200 OK**

```json
{
  "voices": [
    {
      "id": "voice-1",
      "name": "Giulia",
      "language": "it-IT",
      "gender": "female",
      "style": "journalistic",
      "previewUrl": "https://engine.com/voices/voice-1/preview.mp3"
    }
  ]
}
```

---

## 7. OpenAPI 3.1 Specification (Contract as Code)

Every podcast engine should expose an OpenAPI 3.1 document at `{BASE_URL}/openapi.json`. This enables:
- Automatic client generation (`openapi-generator`, `orval`)
- LLM Function Calling schema derivation (`@samchon/openapi`)
- Swagger UI documentation
- Type-safe validation via `zod-openapi`

**Key paths that must be documented:**

```yaml
openapi: 3.1.0
info:
  title: Podcast Generation Engine API
  version: 1.0.0
paths:
  /v1/podcast/generate:
    post:
      operationId: submitPodcastJob
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PodcastGenerationRequest'
      responses:
        '202':
          description: Job accepted
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/JobReference'
        '409':
          description: Job already exists
  /v1/podcast/jobs/{engineJobId}:
    get:
      operationId: getPodcastJobStatus
      parameters:
        - name: engineJobId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Job status
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/JobStatus'
  /v1/podcast/jobs/{engineJobId}/cancel:
    post:
      operationId: cancelPodcastJob
      responses:
        '200':
          description: Job canceled
```

**Why OpenAPI 3.1 specifically:**
- Uses JSON Schema 2020-12, which is the same dialect used by MCP tools and LLM Function Calling.
- Enables **bidirectional translation**: OpenAPI → MCP tool schema → Function Calling schema.
- The platform can ingest the engine's OpenAPI spec and auto-generate the client TypeScript types and Zod validators.

---

## 8. MCP Server Adapter (Optional)

If the podcast engine needs to be callable from Claude Desktop, Cursor, or other MCP hosts, wrap the REST API with a thin MCP server.

**File (separate repo or monorepo package):** `packages/mcp-podcast-engine/src/server.ts`

**Capabilities exposed:**

```json
{
  "tools": [
    {
      "name": "generate_podcast",
      "description": "Generate a podcast episode from a brief. Returns a job ID. Use get_podcast_status to poll for completion.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "prompt": { "type": "string" },
          "targetDurationMinutes": { "type": "number", "minimum": 1, "maximum": 60 },
          "language": { "type": "string", "default": "it-IT" },
          "speakerCount": { "type": "number", "default": 1, "minimum": 1, "maximum": 4 }
        },
        "required": ["prompt"]
      }
    },
    {
      "name": "get_podcast_status",
      "description": "Check the status of a podcast generation job.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "jobId": { "type": "string" }
        },
        "required": ["jobId"]
      }
    }
  ]
}
```

**Important:** Because MCP `tools/call` is synchronous, the `generate_podcast` tool should **return immediately** with `{ jobId, status: "queued", pollInstructions: "Call get_podcast_status every 10 seconds." }`. The actual generation happens asynchronously on the server.

**Transport:** Streamable HTTP (SSE) or stdio for local use.

---

## 9. A2A Agent Card (Optional)

If the podcast engine is positioned as an **autonomous agent** in a multi-agent content production pipeline, expose an A2A Agent Card.

**File:** `/.well-known/agent-card.json`

```json
{
  "name": "Podcast Generation Agent",
  "url": "https://podcast-engine.example.com",
  "version": "1.0.0",
  "skills": [
    {
      "id": "generate-podcast",
      "name": "Generate Podcast Episode",
      "description": "Produces a complete podcast episode from a text brief, including narration, transcript, and chapter markers."
    },
    {
      "id": "list-voices",
      "name": "List Available Voices",
      "description": "Returns the catalog of TTS voices available for podcast narration."
    }
  ],
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "authentication": {
    "schemes": ["Bearer"]
  }
}
```

**When to use:** Only if there is a genuine need for multi-agent delegation (e.g., a "Content Director" agent delegates episode production to the "Podcast Agent", which may request clarifications via `input_required`).

---

## 10. Async Pattern Requirements Summary

Any engine integrated with the platform must support **at least one** of the following async completion patterns:

| Pattern | Minimum Requirement | Recommended |
|---|---|---|
| **Webhook** | `POST` to configurable URL on completion/failure | Signed payload (HMAC), retries with backoff, idempotency via `jobId` |
| **Polling** | `GET /jobs/:id` returns `{ status, progressPercent, result, error }` | `progressPercent` and `estimatedSecondsRemaining` for UX |
| **SSE Stream** | `GET /jobs/:id/stream` emits `text/event-stream` | Emit `status`, `progress`, `artifact` events |

**Platform-side implementation:**
- **Primary:** Webhook (lowest latency, lowest resource usage).
- **Fallback:** Polling every 5 seconds with exponential backoff.
- **UI:** Workspace polling track (already spec'd in `GEN_AI_MEDIA_MODE_SPEC.md` Section 7.3).

---

## 11. File Map

### New files (platform side)

```text
apps/api/src/
  domain/media/
    MediaEngineAdapter.ts              # Interface: submitJob, getJobStatus, downloadResult
  infra/media/providers/
    DirectRestPodcastAdapter.ts        # Mode A: direct fetch() to self-hosted engine
    ReplicateAdapter.ts                # Mode B: Replicate Predictions API
    FalAiAdapter.ts                    # Mode B: fal.ai queue + webhook
    ElevenLabsAdapter.ts               # Mode B: ElevenLabs TTS API
  infra/media/
    MediaEngineFactory.ts              # Selects adapter from config (env ENGINE_ADAPTER)

packages/mcp-podcast-engine/         # Optional: separate package or repo
  src/server.ts                        # MCP server wrapping the REST API
  src/agent-card.json                  # A2A Agent Card (optional)
  openapi.json                         # OpenAPI 3.1 spec
```

### Modified files (platform side)

```text
apps/api/src/
  application/use-cases/GeneratePodcastViaApi.ts
    # Replace direct fetch() with injection of MediaEngineAdapter
  application/media/ResolveArtifactMedia.ts
    # Dispatch to MediaEngineFactory instead of hardcoded stock resolver
  config.ts
    # Add ENGINE_ADAPTER, ENGINE_BASE_URL, ENGINE_API_KEY
```

---

## 12. Decision Log

| Decision | Rationale |
|---|---|
| **Primary interface is REST async, not MCP** | MCP has no native async; LLM-coupled; unsuitable for non-LLM clients (dashboard, cron, mobile) |
| **OpenAPI 3.1 as the contract description layer** | JSON Schema 2020-12 aligns with MCP tools and Function Calling; enables auto-client generation |
| **MCP as optional thin adapter, not primary interface** | Adds value for Claude/Cursor users without constraining the core service |
| **A2A only for agent-to-agent scenarios** | Overkill for a simple tool; useful only if we build a multi-agent content pipeline |
| **MediaEngineAdapter interface extracted from Mode A** | Allows Mode B (pluggable adapters) to be introduced later without rewriting use-cases |
| **Webhook preferred over polling** | Lower latency, lower server load, better UX |
| **Job ID is consumer-generated UUID** | Idempotency out-of-the-box; consumer controls identity without waiting for engine response |

---

## 13. Open Questions

1. **Self-hosted engine stack:** Will the podcast engine be Node.js/Express, Python/FastAPI, or Go? This affects the shared OpenAPI code generation and MCP SDK choice.
2. **Script generation responsibility:** Should the engine accept a raw brief and generate the script internally (end-to-end), or should the platform generate the script via LLM and send it to the engine as `script`? The REST contract supports both (`prompt` vs `script`).
3. **Storage delegation:** Should the engine upload the final MP3 directly to the platform's MinIO/S3 bucket (via presigned PUT), or should the platform download from the engine's temporary URL? The latter is simpler; the former avoids double transfer.
4. **Multi-engine orchestration:** If a podcast requires script LLM → TTS → mixing → mastering, should the engine expose this as a single job, or should the platform orchestrate multiple engine calls? Recommend: engine exposes single job; internal pipeline is engine's concern.

---

*End of specification. If you add, move, or retire this document, update `docs/INDEX.md` in the same change.*
