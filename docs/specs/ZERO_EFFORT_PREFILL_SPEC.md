# Zero-Effort LLM Prefill — Specification

**Version:** 1.0  
**Status:** Implemented  
**Date:** 2026-05-14  
**Branch:** `feat/dashboard-lovable-chat`

---

## 1. Problem Statement

The existing Zero Effort wizard (`/launch/[projectId]`) requires the user to manually
fill in three steps (brand name, site type, objective, audience, style, contacts) before
the AI can generate anything.  Users who arrive from the VibeCore entry box have already
described their idea in free-form text — and optionally attached reference documents.  
That information is enough for an LLM to pre-populate the entire wizard automatically.

---

## 2. Goals

| Goal | Description |
|---|---|
| **Prefill** | Use one structured LLM call to extract all `ZeroEffortLaunchInput` fields from the user's prompt + attachment metadata |
| **Feedback** | Show an animated token counter + spinner during the LLM analysis so the user perceives processing |
| **Single CTA** | When arriving from prefill, the wizard opens in "AI review" mode with a single "God Mode — Genera" button |
| **Document carry-through** | Attached files are uploaded to the project; their metadata is forwarded to the prefill LLM; the workspace can access them as project assets |
| **Linked modes** | Easy, Medium and Hard modes all share the same prompt and attachment state |
| **Graceful fallback** | If the prefill LLM call fails or is skipped, the wizard opens in its normal manual mode |

---

## 3. Architecture

```
VibeCoreEntry.tsx
 │
 ├─ Phase 1: classifying  →  POST /v1/vibecore/classify      (existing)
 ├─ Phase 2: prefilling   →  POST /v1/vibecore/prefill       (NEW)
 │   └─ animated token counter shown below form
 ├─ Phase 3: creating     →  createProject()                 (existing)
 ├─ Phase 4: uploading    →  uploadProjectAsset() × N        (existing)
 └─ Phase 5: redirecting  →  /launch/[projectId]?prefilled=1
                              └─ sessionStorage: ze_prefill_${projectId}

/launch/[projectId]
 ├─ On mount: reads ze_prefill_${projectId} from sessionStorage
 ├─ Applies draft to all form fields (all 3 steps)
 ├─ Shows "AI Pre-compiled" review card
 └─ CTA: "God Mode — Genera"  →  handleSubmit() → handleGoToGodMode()
```

---

## 4. New Contract — `VibePrefillRequest` / `VibePrefillResponse`

Location: `packages/contracts/src/vibecore.ts`

```ts
export interface VibePrefillRequest {
    prompt: string;               // user's free-form prompt, max 2000 chars
    attachmentMeta?: AttachmentMeta[];
    templateId?: string | null;   // from VibeClassify
    formatHint?: FormatHint | null;
}

export interface VibePrefillResponse {
    draft: ZeroEffortLaunchInput; // validated against existing zod schema
    confidence: number;           // 0.0–1.0
    skipped: boolean;             // true when classifier/LLM is disabled
}
```

`ZeroEffortLaunchInput` is the existing schema from `packages/contracts/src/pipeline.ts`.

---

## 5. Backend — `VibePrefill` Use-Case

Location: `apps/api/src/application/use-cases/VibePrefill.ts`

### 5.1 Task key

```
vibe_intent_prefill
```

Uses the same `resolvePromptTaskSettingFromConfig` + `GetLlmCatalog` pattern as `VibeClassify`.

### 5.2 System prompt

```
You are a web project brief extractor.
Given a user's free-form description of a website project, return a
JSON object that populates a structured project brief.

Required JSON shape:
{
  "businessName": "brand or project name",
  "siteType": "landing_page|portfolio|showcase|business_site",
  "primaryGoal": "full project description and main objective (min 20 chars)",
  "audience": "target audience description (min 10 chars)",
  "tone": "communication tone (e.g. professional, playful) or null",
  "primaryCta": "main call-to-action button text or null",
  "styleHint": "visual style notes or null",
  "contactInfo": [{"key": "Email", "value": "..."}] or [],
  "styleAttributes": [] // subset of: minimal, premium, dark, bright, bold,
                        //  elegant, corporate, playful, tech, artisan, luxury, eco
}

Rules:
- Extract businessName from the prompt or use "Progetto" as fallback.
- siteType: infer from context; default to "landing_page".
- Expand primaryGoal from the prompt into a detailed description.
- contactInfo: extract any contact data mentioned (email, phone, address, social).
- styleAttributes: pick 1–3 matching attributes from the allowed list.
- Return ONLY valid JSON — no markdown fences, no extra text.
```

### 5.3 Max tokens

512 — the structured JSON is small and bounded.

### 5.4 Validation

The raw LLM output is parsed and validated against `zeroEffortLaunchSchema` (zod).
If validation fails, default fallback values are applied so the call never hard-fails.

---

## 6. Route

```
POST /v1/vibecore/prefill    (auth-protected)

Body: VibePrefillRequest
Response: VibePrefillResponse
```

---

## 7. Frontend — Token Counter

Location: `VibeCoreEntry.tsx`

During `phase === "prefilling"`, a `setInterval` increments a fake `tokenCount` state every
80 ms by a random amount (8–45), simulating active token consumption. Shown as:

```
● Analisi AI in corso…   ~1,234 token
```

Light grey text (`rgba(255,255,255,0.38)`), 11px, below the submit button, disappears
when the phase ends.

---

## 8. Frontend — Launch Page AI Review Mode

Location: `/launch/[projectId]`

When `?prefilled=1` is present in the query:

1. Read `ze_prefill_${projectId}` from `sessionStorage`.
2. Parse → apply to form state (all fields including `contactFields` and `styleAttributes`).
3. Set `isPrefilled = true`.
4. Render a compact AI review card instead of the step wizard, showing:
   - Brand name, site type badge, style attributes
   - Primary goal (truncated to 3 lines)
   - Audience
   - Contact fields (if any)
5. Two CTAs:
   - **"God Mode — Genera"** (primary): calls `handleSubmit()` then `handleGoToGodMode()`
   - **"Modifica"** (outline): sets `isPrefilled = false` to fall back to the step wizard

---

## 9. Session-Storage Key Contract

```
ze_prefill_${projectId}   →   JSON.stringify(ZeroEffortLaunchInput)
```

- Scope: `sessionStorage` (cleared on tab close; no cross-tab leakage).
- The launch page removes the key after reading it to prevent stale data.

---

## 10. Document Carry-Through

Files attached in `VibeCoreEntry`:
1. Their metadata (filename, mimeType, sizeBytes) is forwarded to the prefill LLM call.
2. The actual files are uploaded to the project via `uploadProjectAsset` (existing).
3. The workspace (`/workspace/[projectId]`) can then access them through the project's
   asset library (`listProjectAssets`).

No additional piping is needed — the LLM workspace context already includes project assets.

---

## 11. Fallback Behaviour

| Condition | Behaviour |
|---|---|
| Prefill LLM disabled in config | Skip prefill; navigate directly to `/launch` without `?prefilled=1` |
| Prefill returns `skipped: true` | Same as above |
| JSON parse / zod validation fails | Log warning; use partial defaults; proceed |
| `sessionStorage` unavailable | Navigate to `/launch` without `?prefilled=1` |
| No prefill data on launch page | Show normal manual wizard |

---

## 12. Non-Functional

- The prefill LLM call is fire-and-forget safe: if it takes > 8 s, the UI still shows
  the token counter and waits.
- No new DB collections or domain entities needed.
- The feature is additive: zero-effort manual mode is untouched.
