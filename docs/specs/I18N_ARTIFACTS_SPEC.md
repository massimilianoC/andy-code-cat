# I18N_ARTIFACTS_SPEC — Multilingual Support for LLM-Generated Artifact Websites

## Overview

This document specifies the design and roadmap for adding **multilingual support to LLM-generated websites** (HTML/CSS/JS artifacts published via Layer 1 or Layer 2 pipelines).

This is **not** related to the Andy platform UI i18n (see `docs/guides/I18N.md`). The target is the published artifact content — the HTML pages users generate and publish.

### Design principles

- **Zero impact on the current publish flow.** All existing code paths are untouched. The i18n pipeline is a purely additive post-publication stage.
- **Opt-in per project.** Default is `i18nConfig.enabled = false`. No change in behavior unless explicitly configured.
- **No regressions.** The existing `PublishProject` and `DeployWorker` flows remain unchanged.
- **Async, non-blocking.** The i18n worker runs in the background after publication completes. The user receives the base publication immediately.
- **Token-efficient LLM strategy.** A single LLM call per HTML page returns translations for all target languages simultaneously as structured JSON.
- **Progressive implementation.** Step 0 (browser redirect only, no injected widget) ships first to validate the pipeline without any frontend surface area.

---

## Roadmap and Milestones

### Step 0 — Path-based redirect only (no widget) ✦ MVP

**Goal:** Generate language subfolders and a root `index.html` that redirects visitors to the correct subfolder based on `navigator.language`. No persistent language switcher injected into translated pages.

| Component | Description |
|---|---|
| `ProjectI18nConfig` | Optional config block on Project entity — `enabled`, `languages`, `injectSwitcher` |
| `I18nPostProcessor` | Extracts text nodes from HTML, calls LLM for translations |
| `I18nTranslationWorker` | BullMQ worker, triggered after `DeployWorker` completes |
| Nginx subfolder serving | `/en/`, `/it/`, `/de/` served from `dist/i18n/{lang}/` |
| Root redirect snippet | Minimal JS in root `index.html`, no external dependencies |
| `SiteDeployment.i18n` | Optional field added to the deployment record |

**Acceptance criteria:**

- Visiting `/{publishId}/` redirects to `/{publishId}/en/` or `/{publishId}/it/` based on browser language.
- Fallback language is the project's primary language (the original artifact language).
- The original artifact is served at its own language subfolder, unchanged.
- Disabling `i18nConfig.enabled` skips the worker entirely.

---

### Step 1 — Optional language switcher widget

**Goal:** Inject a small language switcher into translated pages so users can manually change language.

| Component | Description |
|---|---|
| Switcher snippet | Self-contained `<div>` + `<style>` + `<script>`, injected before `</body>` |
| Project config flag | `i18nConfig.injectSwitcher: boolean` (default `false`) |
| Widget customization | Position (bottom-right / bottom-left / top-right), style (flags / text / both) |

**Acceptance criteria:**

- Widget only appears when `injectSwitcher: true`.
- Widget links to language subfolders within the same publish path.
- Widget has no external dependencies (no CDN, no analytics).
- Existing published sites (Step 0) are unaffected.

---

### Step 2 — SEO and metadata hardening

**Goal:** Improve discoverability of multilingual published sites.

| Component | Description |
|---|---|
| `hreflang` tags | `<link rel="alternate" hreflang="en" href="...">` injected per page per language |
| `<html lang="">` | Set correctly per language version |
| Sitemap per language | Optional `sitemap.xml` with language URLs |
| OG metadata translation | `og:title`, `og:description` translated alongside body content |

---

## Architecture

### Trigger flow

```
PublishProject use-case
    │
    ▼
DeployWorker (Stage D) — existing, unchanged
    │
    ├─ copies dist/ → nginx webroot
    ├─ writes nginx vhost config
    └─ signals "deploy complete"
             │
             ▼ (only when project.i18nConfig.enabled === true)
I18nTranslationWorker (new BullMQ job)
    │
    ├─ reads dist/index.html (and other pages if multi-page)
    ├─ for each HTML page:
    │     └─ single LLM call → JSON with all target languages
    ├─ writes dist/i18n/{lang}/*.html for each language
    ├─ writes dist/index.html (browser redirect stub)
    ├─ writes dist/i18n/{lang}/assets/ symlinks (no file duplication)
    ├─ updates SiteDeployment.i18n record
    └─ triggers nginx reload
```

### Position in the pipeline

```
[existing]  POST /projects/:id/publish
[existing]  PublishProject use-case
[existing]  DeployWorker (Stage D)
                │
                ▼ [NEW — only when enabled]
            I18nTranslationJob { projectId, deploymentId, pages[], languages[] }
                │
                ▼
            I18nTranslationWorker
```

No changes to `PublishProject`, `DeployWorker`, or any existing use-case.

---

## Data Model

### `ProjectI18nConfig` (new, optional)

Added as an optional field on the `Project` entity. Non-breaking: absence is equivalent to `{ enabled: false }`.

```typescript
interface ProjectI18nConfig {
    enabled: boolean;                       // default: false
    languages: string[];                    // ISO 639-1 codes, e.g. ["en", "it", "de"]
    primaryLanguage: string;                // language of the original artifact, e.g. "it"
    injectSwitcher: boolean;                // Step 1+, default: false
    switcherPosition?: 'bottom-right' | 'bottom-left' | 'top-right'; // default: 'bottom-right'
    switcherStyle?: 'flags' | 'text' | 'both'; // default: 'flags'
}
```

**MongoDB projection:** stored as `project.i18nConfig` (optional embedded document). No migration required for existing projects.

---

### `SiteDeployment` additions (optional field)

```typescript
interface SiteDeploymentI18nStatus {
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    languages: string[];                    // languages processed
    completedAt?: Date;
    errorMessage?: string;
    translationJobId?: string;              // BullMQ job ID for tracking
}

// Added to SiteDeployment:
i18n?: SiteDeploymentI18nStatus;
```

---

### `I18nTranslationJob` payload (BullMQ)

```typescript
interface I18nTranslationJobPayload {
    projectId: string;
    deploymentId: string;
    publishId: string;
    userId: string;
    sourceLanguage: string;                 // primary language of artifacts
    targetLanguages: string[];              // languages to translate into
    pages: I18nPageTarget[];               // list of HTML pages to translate
    injectSwitcher: boolean;
}

interface I18nPageTarget {
    relativePath: string;                   // e.g. "index.html", "about.html"
    absolutePath: string;                   // full disk path to the HTML file
}
```

---

## LLM Translation Strategy — Token-Efficient Single-Call Approach

### Strategy

For each HTML page, the worker issues **one single LLM call** requesting translations for all target languages simultaneously. The response is a structured JSON object.

This approach is more token-efficient than `N_languages × N_pages` calls because:

- The source HTML is sent once per page, regardless of how many target languages are requested.
- The LLM processes all language targets in a single forward pass.
- Round-trip latency is `N_pages` calls instead of `N_pages × N_languages`.

### Pre-processing: text extraction

Before calling the LLM, the worker extracts only translatable text content from the HTML:

```typescript
interface ExtractedContent {
    textNodes: Array<{
        nodeId: string;          // stable identifier, e.g. "t-001"
        context: string;         // surrounding HTML tag for semantic context, e.g. "h1"
        text: string;            // visible text to translate
    }>;
    attributes: Array<{
        nodeId: string;          // e.g. "a-001"
        attribute: string;       // e.g. "alt", "title", "placeholder"
        value: string;
    }>;
    metaTags: Array<{
        name: string;            // e.g. "description", "og:title"
        content: string;
    }>;
}
```

Only visible text and semantic attributes (`alt`, `title`, `aria-label`, `placeholder`) are extracted. Structural HTML, class names, inline CSS, and JavaScript are excluded.

### LLM prompt structure

```
System:
You are a professional web content translator. You receive extracted text nodes from an HTML webpage
and return a structured JSON object with translations for each requested language.

Preserve HTML entities and special characters exactly. Do not translate brand names, proper nouns,
code snippets, URLs, or technical identifiers. Match the tone and register of the source text.

Rules:
- Return ONLY valid JSON, no markdown, no explanation.
- Preserve the nodeId values exactly as given.
- Translate every text field in every language. Never omit a node.
- If a text is untranslatable (e.g. a proper noun), copy it verbatim.

User:
Source language: {{sourceLanguage}}
Target languages: {{targetLanguages | join(", ")}}

Content to translate:
{{extractedContent | json}}

Response format:
{
  "{{lang1}}": {
    "textNodes": [{ "nodeId": "t-001", "text": "translated text" }, ...],
    "attributes": [{ "nodeId": "a-001", "attribute": "alt", "value": "translated" }, ...],
    "metaTags": [{ "name": "description", "content": "translated" }, ...]
  },
  "{{lang2}}": { ... }
}
```

### Post-processing: reconstruction

After receiving the JSON response, the worker reconstructs one complete HTML file per language by:

1. Parsing the source HTML with a DOM parser (e.g. `node-html-parser` or `cheerio`).
2. Replacing text nodes and attributes using the translation map.
3. Setting `<html lang="{{lang}}">`.
4. Injecting `<link rel="alternate" hreflang="...">` tags (Step 2).
5. Optionally injecting the language switcher widget (Step 1).
6. Writing the output to `dist/i18n/{lang}/index.html`.

### Token budget estimates (typical landing page)

| Scenario | Source tokens | Output tokens | Total |
|---|---|---|---|
| 1 page, 2 languages | ~800 | ~600 | ~1,400 |
| 1 page, 4 languages | ~800 | ~1,200 | ~2,000 |
| 3 pages, 4 languages | ~2,400 | ~3,600 | ~6,000 |

Comparison (naive approach, one call per language per page):

- 1 page, 4 languages: ~800 × 4 = ~3,200 source tokens (sent 4 times) + ~1,200 output = ~4,400

The single-call approach saves approximately 30–50% on input tokens for multi-language projects.

---

## Filesystem Structure

After the i18n worker completes, the nginx webroot for the deployment has this structure:

```
/var/www/andy/{publishId}/
├── index.html              ← browser-language redirect stub (Step 0)
├── {primaryLang}/          ← original artifact, unchanged
│   ├── index.html
│   └── assets/
│       ├── style.css
│       └── main.js
├── i18n/
│   ├── en/
│   │   ├── index.html      ← translated HTML (reconstructed)
│   │   └── assets/ → symlink to /{primaryLang}/assets/  (no duplication)
│   ├── it/
│   │   ├── index.html
│   │   └── assets/ → symlink to /{primaryLang}/assets/
│   └── de/
│       ├── index.html
│       └── assets/ → symlink to /{primaryLang}/assets/
```

Assets (CSS, JS, images) are served from the primary language folder. Language versions only differ in HTML content.

---

## Root Redirect Stub (Step 0)

The root `index.html` is replaced by a minimal redirect page. It has no external dependencies and degrades gracefully (meta refresh fallback):

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=./{{primaryLang}}/">
  <title>Redirecting...</title>
</head>
<body>
<script>
(function() {
  var supported = {{supportedLangs | json}};
  var fallback = '{{primaryLang}}';
  var lang = (navigator.language || navigator.userLanguage || fallback)
    .toLowerCase().split('-')[0];
  var target = supported.indexOf(lang) !== -1 ? lang : fallback;
  location.replace('./' + target + '/');
})();
</script>
</body>
</html>
```

Values `{{supportedLangs}}` and `{{primaryLang}}` are substituted at build time by the worker. The `<meta http-equiv="refresh">` provides a fallback for browsers with JavaScript disabled, pointing to the primary language.

---

## Nginx Configuration

No changes to the existing vhost template for the base deployment. The i18n worker handles subfolder routing at the filesystem level. Nginx serves the files statically — no additional location blocks are required unless the project uses a custom domain (Step 2+).

For path-based publish (`/p/{publishId}`), the existing nginx config for the base path already serves static files recursively. The `i18n/` subfolder is served automatically.

---

## Project Configuration UI

### Multi-select language combo (ProjectConfigPopup)

A new optional section in the project configuration popup:

```
[ ] Enable multilingual translation
    Languages: [Italian ×] [English ×] [German ×]  ← multi-select combo
    Primary language: Italian ← auto-detected or user-selectable
    [ ] Inject language switcher (Step 1+)
```

**Behavior:**

- The combo is disabled when `enabled = false`.
- Available languages: ISO 639-1 subset (start with: `it`, `en`, `fr`, `de`, `es`, `pt`, `nl`, `pl`).
- Primary language is auto-detected from the artifact HTML `<html lang="">` attribute or defaults to the platform UI language.
- Changing the language list does NOT retranslate automatically. A new publish triggers retranslation.

**API contract (packages/contracts):**

```typescript
// packages/contracts/src/i18n.ts
import { z } from 'zod';

export const projectI18nConfigSchema = z.object({
    enabled: z.boolean(),
    languages: z.array(z.string().min(2).max(5)),  // ISO 639-1
    primaryLanguage: z.string().min(2).max(5),
    injectSwitcher: z.boolean().optional().default(false),
    switcherPosition: z.enum(['bottom-right', 'bottom-left', 'top-right']).optional(),
    switcherStyle: z.enum(['flags', 'text', 'both']).optional(),
});

export type ProjectI18nConfig = z.infer<typeof projectI18nConfigSchema>;

// PATCH /v1/projects/:id/i18n  (new endpoint)
export const updateProjectI18nConfigSchema = projectI18nConfigSchema.partial();
```

---

## API Endpoints

All new endpoints follow existing patterns (authMiddleware + sandboxMiddleware).

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/projects/:id/i18n` | Get current i18n config for the project |
| `PATCH` | `/v1/projects/:id/i18n` | Update i18n config (creates if not present) |
| `GET` | `/v1/projects/:id/i18n/status` | Get translation worker status for the last deployment |

No new publish endpoint is needed. The i18n worker is triggered automatically by the existing publish flow when `i18nConfig.enabled === true`.

---

## Worker Implementation Notes

The `I18nTranslationWorker` follows the existing BullMQ worker pattern (`DeployWorker`, `SubdomainCleanupWorker`).

**Queue name:** `i18n-translation`

**Lifecycle:**

```
queued
  → running (update SiteDeployment.i18n.status = 'running')
  → for each page: extract → LLM call → reconstruct → write files
  → write root redirect stub
  → (Step 1+) inject switcher widgets
  → nginx reload
  → completed (update SiteDeployment.i18n.status = 'completed')
  → failed on unrecoverable error (update SiteDeployment.i18n.status = 'failed', store error)
```

**Error handling:**

- LLM call timeout: retry once with exponential backoff, then mark failed.
- Malformed JSON response: attempt partial repair with existing `LlmJsonParser` pattern (see `docs/guides/LLM_JSON_PARSING_GUIDELINES.md`), fall back to skipping that language.
- Nginx reload failure: log, mark warning, do not fail the job (base site is still available).

**Idempotency:** Running the worker twice for the same `deploymentId` overwrites the previous i18n output. This is safe because translated files are stateless.

---

## Integration with Existing Publish Flow

The trigger hook is placed in the `DeployWorker` completion handler, not inside `DeployWorker` itself. This preserves the existing worker's contract:

```typescript
// Pseudocode — in the job completion event handler, NOT inside DeployWorker

onDeployComplete(deploymentId: string) {
    const deployment = await deploymentRepo.findById(deploymentId);
    const project = await projectRepo.findById(deployment.projectId);

    if (project.i18nConfig?.enabled && project.i18nConfig.languages.length > 0) {
        await i18nQueue.add('translate', {
            projectId: project._id,
            deploymentId,
            publishId: deployment.publishId,
            userId: deployment.userId,
            sourceLanguage: project.i18nConfig.primaryLanguage,
            targetLanguages: project.i18nConfig.languages.filter(
                l => l !== project.i18nConfig.primaryLanguage
            ),
            pages: [{ relativePath: 'index.html', absolutePath: deployment.webrootPath + '/index.html' }],
            injectSwitcher: project.i18nConfig.injectSwitcher ?? false,
        });
    }
}
```

`DeployWorker` is not modified. The hook is in the queue completion listener of `QueueService` or an equivalent orchestration layer.

---

## Supported Languages (initial set)

| Code | Language |
|---|---|
| `it` | Italiano |
| `en` | English |
| `fr` | Français |
| `de` | Deutsch |
| `es` | Español |
| `pt` | Português |
| `nl` | Nederlands |
| `pl` | Polski |

The list is extensible. Any ISO 639-1 code can be added to the config without code changes.

---

## Implementation Checklist (for future agent)

### Step 0 deliverables

- [ ] `domain/entities/ProjectI18nConfig.ts` — TypeScript interface
- [ ] `domain/repositories/I18nConfigRepository.ts` — optional, or embed in ProjectRepository
- [ ] `packages/contracts/src/i18n.ts` — Zod schemas
- [ ] `application/use-cases/UpdateProjectI18nConfig.ts`
- [ ] `application/use-cases/GetProjectI18nStatus.ts`
- [ ] `application/workers/I18nTranslationWorker.ts` — BullMQ worker
- [ ] `application/services/I18nPostProcessor.ts` — HTML extraction + LLM call + reconstruction
- [ ] Update `SiteDeployment` entity to add optional `i18n` field
- [ ] Update `MongoSiteDeploymentRepository` to persist i18n status
- [ ] `presentation/http/routes/i18nRoutes.ts` — GET/PATCH config + GET status
- [ ] Register `i18nRoutes` in `app.ts` (after auth setup, before project routes)
- [ ] Update nginx vhost template to ensure static subfolder serving works
- [ ] Add `I18N_LLM_MODEL` env var to `.env.example` (may use a cheaper model than generation)

### Step 1 additional deliverables

- [ ] `application/services/I18nSwitcherInjector.ts` — widget HTML/CSS/JS snippet generator
- [ ] Update `I18nTranslationWorker` to call `I18nSwitcherInjector` when `injectSwitcher: true`
- [ ] Add switcher config fields to `projectI18nConfigSchema`
- [ ] Add switcher config fields to `ProjectConfigPopup` UI

### Step 2 additional deliverables

- [ ] `hreflang` injection in `I18nPostProcessor`
- [ ] `<html lang="">` attribute update per language
- [ ] Optional `sitemap.xml` generation

---

## What This Spec Does NOT Cover

- **Platform UI i18n** — handled by `docs/guides/I18N.md` and `react-i18next`.
- **Layer 2 (OpenCode Pipeline) multi-page sites** — Step 0 handles single-page artifacts only. Multi-page support (e.g. `about.html`, `contact.html`) is an extension of the same worker; the `pages[]` array in the job payload already supports it, but page discovery logic is not specified here.
- **Real-time translation** during generation (pre-publication) — out of scope.
- **Custom domain i18n routing** — out of scope for Step 0–1; requires additional nginx location blocks.
- **Translation memory / caching** — not specified, but the worker could cache LLM responses keyed by `{contentHash}_{sourceLanguage}_{targetLanguages}` to avoid re-translating unchanged content.

---

*Document status: specification only — no implementation. Follow `docs/guides/AGENT_RELEASE_CHECKLIST.md` before starting implementation.*
