# Document Context Layer — Implementation Spec

> Status: Approved for implementation
> Date: 2026-05-04
> Supersedes / extends: `docs/specs/ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md`
> Scope: document parsing (PDF, DOCX, TXT/MD), image semantic analysis via vision models,
>        standard `AssetEnrichmentTrace` JSON envelope, idempotent enrichment pipeline,
>        and integration with the existing system-prompt composition stack
> Audience: backend agents, maintainers, contributors

---

## 1. Purpose and scope

This spec defines how andy-code-cat transforms uploaded user files — PDFs,
DOCX documents, plain text files, and images — into rich, structured semantic
context that feeds the project generation pipeline.

The goal is to make every asset **context-ready** at upload time so that
subsequent generation calls can be enriched without extra round-trips or
user-facing latency.

### What this spec covers

- The `AssetEnrichmentTrace` JSON envelope — a single, versioned, common
  schema for all asset types
- Document parsers: PDF, DOCX, TXT/MD
- Image analyzer: vision-model pipeline for color palette, mood, objects,
  themes, and design signals
- Idempotent enrichment pipeline and versioning
- Extension of `ProjectAsset` entity and MongoDB schema
- New system prompt layer `LAYER D — DOCUMENT CONTEXT`
- Context budget management and priority ranking
- Feature flags and environment variables
- Implementation module layout

### What this spec does NOT cover

- Vector embeddings or similarity search (no vector DB is introduced)
- URL reference analysis (covered in `ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md` Wave 3)
- Full RAG retrieval pipeline (deferred to future milestone, external service)
- XLSX / spreadsheet parsing (future extension point, not MVP)

### Relation to the existing spec

`ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md` defines the strategic direction and
context-packet assembly flow. This spec is the concrete, implementable definition
of Wave 2 (document summarization) and Wave 4 (vision-informed enrichment) from
that document, with the addition of a standard trace envelope that was not
previously specified.

---

## 2. Core design principle: idempotent enrichment trace

Every uploaded asset, regardless of type, receives exactly one enrichment trace.

The trace is:

- **Deterministic by input**: re-running enrichment on the same file with the
  same model version produces a semantically equivalent trace.
- **Versioned**: a `traceVersion` field controls schema migrations. Traces with
  an older version can be re-queued for re-enrichment without touching the asset
  storage layer.
- **Non-blocking**: enrichment runs asynchronously after upload confirmation.
  The asset is immediately usable; the trace populates in the background.
- **Self-describing**: every trace carries provenance (which model, which
  provider, when, how long it took) so the prompt injection layer can decide
  how much weight to give it.
- **Uniform**: a PDF trace and an image trace have identical top-level shape.
  Type-specific fields are nested under well-known sub-objects so the consumer
  code iterates a stable interface regardless of asset type.

---

## 3. AssetEnrichmentTrace — the standard JSON envelope

### 3.1 TypeScript interface (source of truth)

```typescript
// apps/api/src/domain/entities/AssetEnrichmentTrace.ts

export type EnrichmentAssetKind =
    | "pdf"
    | "docx"
    | "txt"
    | "md"
    | "image_raster"
    | "image_svg"
    | "unknown";

export type EnrichmentStatus = "pending" | "ready" | "failed" | "skipped";

// ── Provenance ─────────────────────────────────────────────────────────────

export interface EnrichmentProvenance {
    traceVersion: number;           // schema version — bump on breaking changes
    enrichmentStatus: EnrichmentStatus;
    enrichedAt: Date | null;        // null when status = pending
    processingMs: number | null;    // wall-clock time for the enrichment run
    parserName: string;             // e.g. "pdf-parse@1.1.1", "mammoth@1.9.0"
    parserVersion: string;
    llmProvider: string | null;     // e.g. "siliconflow", "openrouter", null if no LLM pass
    llmModel: string | null;        // e.g. "Qwen/Qwen2.5-VL-72B-Instruct"
    llmTokensUsed: number | null;
    llmCostEur: number | null;
    errorMessage: string | null;    // populated only when status = failed
}

// ── Document-specific fields ─────────────────────────────────────────────

export interface DocumentTextLayer {
    wordCount: number;
    charCount: number;
    languageHint: string;           // BCP-47 best guess, e.g. "it", "en", "fr"
    pageCount: number | null;       // null for DOCX/TXT
    sectionCount: number | null;    // h1/h2-level sections detected
    extractedTextSnippet: string;   // first 2000 chars of extracted text
    fullTextStored: boolean;        // true if full text saved in enrichmentRawText
}

export interface DocumentBrief {
    documentType: DocumentTypeHint;
    detectedTitle: string | null;
    detectedBrandName: string | null;
    purposeSentence: string;        // one sentence: "This is a brochure for..."
    keyMessages: string[];          // up to 6 key messages extracted
    toneLabel: string;              // e.g. "formal", "friendly", "persuasive"
    targetAudience: string | null;  // e.g. "SMB owners", "students"
    ctaText: string | null;         // primary call-to-action if present
    primaryTopics: string[];        // up to 8 keywords / topic labels
    contentLanguage: string;        // BCP-47
    suggestedStyleRole: string;     // maps to AssetStyleRole
}

export type DocumentTypeHint =
    | "brochure"
    | "landing_copy"
    | "product_sheet"
    | "menu"
    | "faq"
    | "press_release"
    | "case_study"
    | "specification"
    | "cv_resume"
    | "report"
    | "generic_document"
    | "unknown";

// ── Image-specific fields ─────────────────────────────────────────────────

export interface ImageColorPalette {
    dominantHex: string[];          // up to 5 hex colors e.g. ["#1a1a2e", "#e94560"]
    dominantNames: string[];        // human names e.g. ["dark navy", "crimson red"]
    backgroundTone: "light" | "dark" | "mixed" | "unknown";
    accentColor: string | null;     // single most visually prominent accent
    paletteLabel: string;           // e.g. "cool monochrome", "warm earthy", "neon contrast"
}

export interface ImageVisualAnalysis {
    sceneDescription: string;       // 1–3 sentence plain description
    detectedObjects: string[];      // up to 10 objects/elements detected
    detectedThemes: string[];       // up to 6 abstract themes e.g. "nature", "technology"
    moodLabel: string;              // e.g. "serene", "dynamic", "professional", "playful"
    moodScore: number | null;       // 0.0–1.0 confidence in mood label
    visualComplexity: "minimal" | "moderate" | "complex" | "unknown";
    compositionType: string | null; // e.g. "centered", "rule-of-thirds", "flat-lay"
}

export interface ImageDesignSignals {
    imageCategory: ImageCategory;
    hasText: boolean;
    detectedTextSnippet: string | null; // visible text in the image, max 300 chars
    hasLogo: boolean;
    hasPeople: boolean;
    hasProduct: boolean;
    layoutStyle: string | null;     // e.g. "hero banner", "icon", "product photo"
    aspectRatioLabel: string | null;// e.g. "landscape", "portrait", "square"
    suggestedWebUse: string[];      // e.g. ["hero background", "logo slot", "card thumbnail"]
    suggestedStyleRole: string;     // maps to AssetStyleRole
}

export type ImageCategory =
    | "photograph"
    | "illustration"
    | "logo"
    | "icon"
    | "screenshot"
    | "diagram"
    | "infographic"
    | "texture_pattern"
    | "typographic"
    | "abstract"
    | "unknown";

// ── Top-level trace ───────────────────────────────────────────────────────

export interface AssetEnrichmentTrace {
    // Identity
    assetId: string;
    projectId: string;
    userId: string;
    assetKind: EnrichmentAssetKind;

    // Provenance
    provenance: EnrichmentProvenance;

    // Document track (null for image assets)
    textLayer: DocumentTextLayer | null;
    documentBrief: DocumentBrief | null;

    // Image track (null for document assets)
    colorPalette: ImageColorPalette | null;
    visualAnalysis: ImageVisualAnalysis | null;
    designSignals: ImageDesignSignals | null;

    // Shared distilled fields — always populated regardless of asset type
    // These are the fields the prompt injection layer reads first
    distilledTitle: string;
    distilledSummary: string;       // max 300 chars — the "elevator pitch" of the asset
    distilledTags: string[];        // up to 10 normalized tags
    distilledColors: string[];      // up to 5 dominant color names
}
```

### 3.2 Current trace schema version

`traceVersion: 1`

Bump to `2` only when a field is removed or renamed. Adding optional fields is
backward-compatible and does not require a version bump.

### 3.3 Raw text storage

For text-bearing assets (PDF, DOCX, TXT, MD) the extracted full text may exceed
what fits in MongoDB's inline BSON efficiently. The strategy is:

- Store the first 8000 chars inline in the trace's `textLayer.extractedTextSnippet`.
- If full text is needed for the enrichment LLM pass, load it from the same file
  buffer that was already written to disk/MinIO. Do not store a second copy.
- `textLayer.fullTextStored` is always `false` (no secondary collection in MVP).

---

## 4. ProjectAsset entity extension

### 4.1 New field on ProjectAsset

Add `enrichmentTrace` as an optional field on the existing `ProjectAsset` entity:

```typescript
// apps/api/src/domain/entities/ProjectAsset.ts — additions

import type { AssetEnrichmentTrace } from "./AssetEnrichmentTrace";

export interface ProjectAsset {
    // ... all existing fields unchanged ...

    /**
     * Full enrichment trace produced by the Document Context Layer.
     * Null until the async enrichment pipeline has run at least once.
     * The trace is self-versioned via traceVersion and can be re-computed
     * idempotently by re-running the enrichment pipeline on the stored file.
     */
    enrichmentTrace?: AssetEnrichmentTrace | null;
}
```

### 4.2 Backward compatibility

- Existing assets without `enrichmentTrace` behave identically to today.
- The field is optional everywhere in the domain layer.
- Consumers always null-check before reading.

### 4.3 MongoDB schema addition

In `MongoProjectAssetRepository`, add `enrichmentTrace` to the Mongoose schema
as a `Mixed` type (Schema.Types.Mixed) with `default: null`. No migration
required for existing documents.

### 4.4 Repository interface extension

Add to `ProjectAssetRepository`:

```typescript
/** Persists an enrichment trace produced by the Document Context Layer pipeline. */
saveEnrichmentTrace(
    id: string,
    projectId: string,
    trace: AssetEnrichmentTrace
): Promise<ProjectAsset | null>;
```

---

## 5. Document parsers

All parsers run in the API process (no separate worker in MVP). They receive
the file buffer already held in memory (Multer in-memory strategy, 20 MB limit).

### 5.1 PDF parser

**npm dependency**: `pdf-parse` (pure JS, no native bindings)

```typescript
// apps/api/src/application/documents/parsers/PdfParser.ts

export interface ParsedDocument {
    rawText: string;
    charCount: number;
    wordCount: number;
    pageCount: number | null;
    parserName: string;
    parserVersion: string;
}

export async function parsePdf(buffer: Buffer): Promise<ParsedDocument>
```

Behavior:
- Call `pdfParse(buffer)` — returns `{ text, numpages }`.
- Strip null bytes and control characters from the raw text.
- Cap `rawText` at 120 000 chars before returning (prevents memory spikes on
  scanned multi-hundred-page PDFs).
- Log a warning if the extracted text is fewer than 50 chars (likely a scanned
  image-only PDF; the image analysis path will carry the enrichment instead).

### 5.2 DOCX parser

**npm dependency**: `mammoth` (pure JS)

```typescript
// apps/api/src/application/documents/parsers/DocxParser.ts

export async function parseDocx(buffer: Buffer): Promise<ParsedDocument>
```

Behavior:
- Call `mammoth.extractRawText({ buffer })`.
- Same character cap (120 000) and warning logic as the PDF parser.
- `pageCount` is always `null` (DOCX has no inherent page count).

### 5.3 Plain text / Markdown parser

No npm dependency — native Node.js.

```typescript
// apps/api/src/application/documents/parsers/PlainTextParser.ts

export function parsePlainText(buffer: Buffer, mimeType: string): ParsedDocument
```

Behavior:
- Decode as UTF-8.
- Cap at 120 000 chars.
- Count words by splitting on whitespace.
- `pageCount: null`, `sectionCount`: count lines that match `/^#+\s/` (Markdown
  headings).

### 5.4 Parser factory

```typescript
// apps/api/src/application/documents/parsers/DocumentParserFactory.ts

export function getParser(mimeType: string): DocumentParser | null
```

Supported MIME types:

| MIME type | Parser |
|---|---|
| `application/pdf` | `PdfParser` |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `DocxParser` |
| `application/msword` | `DocxParser` (mammoth handles legacy .doc too) |
| `text/plain` | `PlainTextParser` |
| `text/markdown` | `PlainTextParser` |
| `text/x-markdown` | `PlainTextParser` |

For any other MIME type, the factory returns `null` and the enrichment pipeline
skips the text extraction phase.

---

## 6. Image analyzer

The image analysis path uses vision-capable models already available in the
LLM catalog. No new providers are introduced.

### 6.1 Vision model selection

Model selection follows the existing catalog routing. The enrichment pipeline
requests a model with role `vision` from the active catalog. Configuration:

```env
ENRICHMENT_VISION_PROVIDER=siliconflow       # or openrouter, lmstudio
ENRICHMENT_VISION_MODEL=Qwen/Qwen2.5-VL-72B-Instruct
```

If no vision model is configured or available, the image analysis phase is
skipped and the trace is built from filename, MIME type, and user-provided
`descriptionText` only.

### 6.2 Image analysis prompt

The vision model receives the image as a base64 data URL together with the
following structured extraction prompt:

```
You are an asset classification specialist for a web design platform.
Analyze this image and return a JSON object with exactly the following fields.
Do not include any text before or after the JSON object.

{
  "sceneDescription": "<1–3 sentence plain description of what the image shows>",
  "detectedObjects": ["<object 1>", "<object 2>", ...],       // max 10
  "detectedThemes": ["<theme 1>", ...],                        // max 6
  "moodLabel": "<single word or short phrase>",
  "visualComplexity": "minimal|moderate|complex",
  "compositionType": "<null or composition style>",
  "imageCategory": "photograph|illustration|logo|icon|screenshot|diagram|infographic|texture_pattern|typographic|abstract|unknown",
  "hasText": true|false,
  "detectedTextSnippet": "<null or up to 300 chars of visible text>",
  "hasLogo": true|false,
  "hasPeople": true|false,
  "hasProduct": true|false,
  "layoutStyle": "<null or layout label>",
  "suggestedWebUse": ["<use 1>", ...],                         // max 3
  "dominantHex": ["#rrggbb", ...],                             // max 5
  "dominantNames": ["<color name>", ...],                      // parallel to dominantHex
  "backgroundTone": "light|dark|mixed",
  "accentColor": "<null or #rrggbb>",
  "paletteLabel": "<short palette description>",
  "moodScore": <0.0–1.0>
}
```

### 6.3 Response parsing

The vision model response is parsed with the existing JSON repair utilities
already present in the codebase (see `docs/guides/LLM_JSON_PARSING_GUIDELINES.md`).

If parsing fails after repair:
- Log the failure with asset ID and raw response snippet.
- Set `enrichmentStatus: "failed"` with a descriptive `errorMessage`.
- Do not retry automatically; leave the trace in `failed` state for operator
  inspection or manual re-queue.

### 6.4 Color palette post-processing

After the vision model returns `dominantHex`, run a lightweight post-processor:

```typescript
// apps/api/src/application/documents/image/ColorPaletteNormalizer.ts

export function normalizeHexList(rawHex: string[]): string[]
```

Behavior:
- Validate each entry against `/^#[0-9a-fA-F]{6}$/`. Discard malformed entries.
- Deduplicate by proximity (if two colors differ by less than 15 in each RGB
  channel, keep only the one with higher saturation).
- Return up to 5 normalized hex values.

### 6.5 Image size guard

Before sending to the vision model, resize if the buffer exceeds 4 MB or the
image dimensions exceed 2048px on either side, using the `sharp` package if
available, or skip resizing and proceed with the original buffer if `sharp` is
not installed (the vision model handles reasonable sizes natively).

The `sharp` dependency is declared as **optional** in `package.json`:

```json
"optionalDependencies": {
    "sharp": "^0.33.0"
}
```

---

## 7. LLM extraction pass for documents

After raw text extraction, a short LLM pass produces the `DocumentBrief`.

### 7.1 Model selection

```env
ENRICHMENT_TEXT_PROVIDER=siliconflow
ENRICHMENT_TEXT_MODEL=Qwen/Qwen2.5-72B-Instruct
```

A text-only (non-vision) model is sufficient. Uses the existing multi-provider
LLM routing layer.

### 7.2 Document brief extraction prompt

```
You are a content analyst for a web design platform.
Read the following document excerpt and return a JSON object with exactly
these fields. Return only the JSON — no prose before or after.

Document excerpt (first 8000 chars):
---
{EXTRACTED_TEXT_SNIPPET}
---

{
  "documentType": "brochure|landing_copy|product_sheet|menu|faq|press_release|case_study|specification|cv_resume|report|generic_document|unknown",
  "detectedTitle": "<null or document title>",
  "detectedBrandName": "<null or brand/company name>",
  "purposeSentence": "<one sentence describing what this document is>",
  "keyMessages": ["<message 1>", ...],         // max 6
  "toneLabel": "<tone description>",
  "targetAudience": "<null or audience description>",
  "ctaText": "<null or primary call-to-action wording>",
  "primaryTopics": ["<topic 1>", ...],          // max 8
  "contentLanguage": "<BCP-47 language code>",
  "suggestedStyleRole": "inspiration|material|reference"
}
```

### 7.3 Minimum text threshold

If extracted text is fewer than 50 chars, skip the LLM pass entirely. The trace
is marked `enrichmentStatus: "ready"` but `documentBrief: null` with the
explanation recorded in `provenance.errorMessage`.

### 7.4 Text budget

The enrichment prompt sends at most the first 8000 chars of extracted text
to keep token costs low. For typical brochures and landing copies this is more
than sufficient. Longer documents (reports, specs) are handled by the snippet
alone — the brief captures the introduction and first section which carry the
most signal.

---

## 8. Enrichment pipeline orchestrator

### 8.1 Module layout

```
apps/api/src/application/documents/
  parsers/
    PdfParser.ts
    DocxParser.ts
    PlainTextParser.ts
    DocumentParserFactory.ts
  image/
    ImageAnalyzer.ts
    ColorPaletteNormalizer.ts
    ImageResizeGuard.ts
  enrichment/
    AssetEnrichmentPipeline.ts       ← main orchestrator
    DocumentBriefExtractor.ts        ← calls LLM for DocumentBrief
    EnrichmentTraceBuilder.ts        ← assembles AssetEnrichmentTrace from parts
    EnrichmentKindDetector.ts        ← maps mimeType → EnrichmentAssetKind
```

### 8.2 AssetEnrichmentPipeline

```typescript
// apps/api/src/application/documents/enrichment/AssetEnrichmentPipeline.ts

export interface EnrichmentInput {
    asset: ProjectAsset;
    fileBuffer: Buffer;
    llmCatalog: LlmCatalog;
}

export interface EnrichmentResult {
    trace: AssetEnrichmentTrace;
    updatedAsset: ProjectAsset;
}

export class AssetEnrichmentPipeline {
    async enrich(input: EnrichmentInput): Promise<EnrichmentResult>
    async reEnrich(assetId: string, projectId: string, userId: string): Promise<EnrichmentResult>
}
```

### 8.3 Pipeline execution flow

```
1. EnrichmentKindDetector maps asset.mimeType → EnrichmentAssetKind
2. Initialize a pending trace with provenance.enrichmentStatus = "pending"
3. Save pending trace immediately (allows the UI to show "analyzing...")
4. Branch on kind:

   DOCUMENT branch (pdf | docx | txt | md):
     a. DocumentParserFactory.getParser() → parse buffer → ParsedDocument
     b. Build textLayer from ParsedDocument
     c. if rawText.length >= 50:
          DocumentBriefExtractor.extract(rawText) → DocumentBrief
        else:
          documentBrief = null
     d. colorPalette = null, visualAnalysis = null, designSignals = null

   IMAGE branch (image_raster | image_svg):
     a. ImageResizeGuard.prepare(buffer) → safe buffer
     b. ImageAnalyzer.analyze(safeBuffer, visionModel) → raw analysis JSON
     c. ColorPaletteNormalizer.normalize(rawHex) → normalized palette
     d. Map raw analysis to ImageColorPalette, ImageVisualAnalysis, ImageDesignSignals
     e. textLayer = null, documentBrief = null

   UNKNOWN branch:
     a. All content-specific fields = null
     b. enrichmentStatus = "skipped"

5. EnrichmentTraceBuilder.build() → distilled fields from all available data
6. Set provenance.enrichmentStatus = "ready", record timing
7. AssetEnrichmentRepository.saveEnrichmentTrace()
8. Update asset.semanticMetadata to mirror distilled fields (backward compatibility)
```

### 8.4 Idempotency guarantee

`reEnrich` loads the file buffer from the storage adapter (LocalFileStorage or
MinioFileStorage), then runs the full pipeline again, replacing the existing
trace. The asset's `enrichmentTrace` field is always overwritten atomically.

The `traceVersion` must match `CURRENT_TRACE_VERSION` constant. If the existing
trace has a lower version, a background re-enrichment is automatically queued
when the asset is loaded for prompt injection.

### 8.5 Async trigger point

The enrichment pipeline is triggered asynchronously immediately after a
successful asset upload in the upload route handler:

```typescript
// apps/api/src/presentation/http/routes/projectAssetRoutes.ts
// After the asset is persisted to MongoDB:

setImmediate(async () => {
    try {
        await assetEnrichmentPipeline.enrich({
            asset: createdAsset,
            fileBuffer: req.file.buffer,
            llmCatalog,
        });
    } catch (err) {
        logger.error({ assetId: createdAsset.id, err }, "enrichment pipeline failed");
    }
});
```

`setImmediate` is used to avoid blocking the HTTP response. In a future
milestone this becomes a BullMQ job.

---

## 9. System prompt Layer D — Document Context

### 9.1 New layer function

```typescript
// apps/api/src/application/llm/systemPromptLayers.ts — addition

/**
 * Layer D — Document context from project assets.
 * Injected when the project has at least one enriched asset relevant to
 * the current generation task. Absent when no enriched assets exist.
 */
export function buildDocumentContextLayer(assets: ProjectAsset[]): string
```

### 9.2 Layer composition rules

Layer D is injected between Layer B (preset) and the existing moodboard/style
layer (which becomes Layer E). The full layer order becomes:

| Layer | Key | Condition |
|---|---|---|
| A | Base architectural constraints | Always |
| B | Preset-specific output format | When project has a presetId |
| C | User style profile + moodboard | When moodboard exists |
| **D** | **Document context from assets** | **When enriched assets exist** |
| E | Section context (focused edit) | When in focused-edit mode |

### 9.3 Layer D content format

```
## LAYER D — DOCUMENT CONTEXT

The following materials were provided by the user as reference for this project.
Use them to inform the content, copy, brand voice, and visual direction of the output.
Do not reproduce raw extracted text verbatim — synthesize it into the design.

### Reference materials

{for each asset, ordered by priority — see section 9.4}
---
Asset: {distilledTitle}
Type: {assetKind}
Summary: {distilledSummary}
{if documentBrief}
Purpose: {documentBrief.purposeSentence}
Brand: {documentBrief.detectedBrandName}
Tone: {documentBrief.toneLabel}
Key messages:
{documentBrief.keyMessages.map(m => "- " + m).join("\n")}
Call to action: {documentBrief.ctaText}
{/if}
{if colorPalette}
Color palette: {colorPalette.dominantNames.join(", ")}
Mood: {visualAnalysis.moodLabel}
Design signals: {designSignals.suggestedWebUse.join(", ")}
{/if}
Tags: {distilledTags.join(", ")}
---
{/for}
```

### 9.4 Asset selection and priority

`buildDocumentContextLayer` receives the full list of project assets. It
applies the following filter and ranking:

1. Only include assets where `enrichmentTrace.provenance.enrichmentStatus === "ready"`.
2. Exclude assets where `useInProject === false` and `styleRole` is undefined
   (un-tagged uploads that the user hasn't opted in to use).
3. Rank by:
   - Explicit `useInProject: true` — first
   - `styleRole` === `"inspiration"` — second
   - `styleRole` === `"material"` — third
   - Everything else — last, sorted by `createdAt` descending
4. Cap at 5 assets per generation call to stay within context budget.

### 9.5 Context budget guard

The total character length of Layer D must not exceed `LLM_CONTEXT_MAX_CHARS / 3`
(default: 64 000 / 3 ≈ 21 000 chars). If ranked assets would exceed this,
truncate from the lowest-priority end, never from within a single asset block
(prefer dropping an entire asset over a partial one).

---

## 10. Backward compatibility with AssetSemanticMetadata

The existing `AssetSemanticMetadata` fields on `ProjectAsset` are preserved
unchanged. After enrichment, the pipeline also writes distilled values back
into `semanticMetadata` so existing code that reads those fields continues to
work:

| `semanticMetadata` field | Source in trace |
|---|---|
| `title` | `distilledTitle` |
| `summary` | `distilledSummary` |
| `description` | `documentBrief.purposeSentence` or `visualAnalysis.sceneDescription` |
| `tags` | `distilledTags` |
| `colors` | `distilledColors` |
| `mediaKind` | mapped from `assetKind` |
| `classifierProvider` | `provenance.llmProvider ?? "system"` |
| `classifierModel` | `provenance.llmModel ?? "heuristic-media-classifier-v1"` |
| `classifiedAt` | `provenance.enrichedAt` |

No existing reads of `semanticMetadata` need to change.

---

## 11. Feature flags and environment variables

All enrichment features are opt-in via env vars with safe defaults.

```env
# Master switch — set false to disable all enrichment (upload still works normally)
ENRICHMENT_ENABLED=true

# Document text extraction
ENRICHMENT_DOCUMENT_PARSING=true

# LLM pass for DocumentBrief (requires text extraction to be enabled)
ENRICHMENT_DOCUMENT_LLM_PASS=true
ENRICHMENT_TEXT_PROVIDER=siliconflow
ENRICHMENT_TEXT_MODEL=Qwen/Qwen2.5-72B-Instruct

# Image vision analysis
ENRICHMENT_IMAGE_ANALYSIS=true
ENRICHMENT_VISION_PROVIDER=siliconflow
ENRICHMENT_VISION_MODEL=Qwen/Qwen2.5-VL-72B-Instruct

# Context injection into generation prompts
ENRICHMENT_INJECT_LAYER_D=true

# Character budget for Layer D (default: LLM_CONTEXT_MAX_CHARS / 3)
ENRICHMENT_LAYER_D_MAX_CHARS=21000

# Max assets included in Layer D per generation call
ENRICHMENT_LAYER_D_MAX_ASSETS=5
```

All flags default to `true` except in test environments where the enrichment
pipeline is disabled by default to avoid LLM calls during unit tests.

---

## 12. Observability and cost tracking

Enrichment runs are logged in the existing `prompt_execution_logs` collection
with a dedicated `taskType: "asset_enrichment"` to keep them separate from
generation and optimizer logs.

Log fields to include:

```typescript
{
    taskType: "asset_enrichment",
    assetId: string,
    projectId: string,
    userId: string,
    assetKind: EnrichmentAssetKind,
    traceVersion: number,
    enrichmentStatus: EnrichmentStatus,
    llmProvider: string | null,
    llmModel: string | null,
    llmTokensUsed: number | null,
    llmCostEur: number | null,
    processingMs: number,
    errorMessage: string | null,
}
```

This integrates with the existing superadmin cost dashboard and per-project
cost attribution.

---

## 13. npm dependencies to add

| Package | Version | Purpose | Already in repo? |
|---|---|---|---|
| `pdf-parse` | `^1.1.1` | PDF text extraction | No — add to `apps/api` |
| `mammoth` | `^1.9.0` | DOCX text extraction | No — add to `apps/api` |
| `sharp` | `^0.33.0` | Image resize guard (optional) | No — add as optional dep |

No vector DB, no LangChain, no Weaviate — the dependency footprint is minimal.

---

## 14. Implementation checklist for agents

### Phase 1 — Data layer

- [ ] Create `apps/api/src/domain/entities/AssetEnrichmentTrace.ts` with all types from section 3.1
- [ ] Add `enrichmentTrace?: AssetEnrichmentTrace | null` to `ProjectAsset` interface
- [ ] Add `saveEnrichmentTrace()` to `ProjectAssetRepository` interface
- [ ] Implement `saveEnrichmentTrace()` in `MongoProjectAssetRepository`
- [ ] Add `enrichmentTrace: Schema.Types.Mixed` field to MongoDB schema with `default: null`

### Phase 2 — Parsers

- [ ] Add `pdf-parse` and `mammoth` to `apps/api/package.json`
- [ ] Implement `PdfParser.ts`, `DocxParser.ts`, `PlainTextParser.ts`
- [ ] Implement `DocumentParserFactory.ts`
- [ ] Unit-test each parser with a small fixture file

### Phase 3 — Image analyzer

- [ ] Implement `ImageAnalyzer.ts` with vision model call and JSON repair
- [ ] Implement `ColorPaletteNormalizer.ts`
- [ ] Implement `ImageResizeGuard.ts` (graceful no-op if `sharp` not installed)
- [ ] Unit-test with a mock vision response

### Phase 4 — LLM extraction pass

- [ ] Implement `DocumentBriefExtractor.ts` with prompt template from section 7.2
- [ ] Wire to existing multi-provider LLM routing (reuse `callLlm` utility)
- [ ] Validate JSON response and fallback gracefully on parse failure

### Phase 5 — Pipeline orchestrator

- [ ] Implement `EnrichmentKindDetector.ts`
- [ ] Implement `EnrichmentTraceBuilder.ts` (distilled fields assembly)
- [ ] Implement `AssetEnrichmentPipeline.ts` following the flow in section 8.3
- [ ] Add `setImmediate` trigger in `projectAssetRoutes.ts` after successful upload
- [ ] Integration-test the full pipeline with a PDF fixture and an image fixture

### Phase 6 — Prompt injection

- [ ] Implement `buildDocumentContextLayer()` in `systemPromptLayers.ts`
- [ ] Wire Layer D into the system prompt composer
- [ ] Add asset selection and ranking logic per section 9.4
- [ ] Add context budget guard per section 9.5
- [ ] Update `systemPromptComposer.ts` to accept project assets as input

### Phase 7 — Observability

- [ ] Add enrichment log writes to `prompt_execution_logs`
- [ ] Add `ENRICHMENT_*` env vars to `apps/api/src/config.ts`
- [ ] Document new env vars in `.env.example`

---

## 15. Non-goals and deferred work

The following are explicitly out of scope for this implementation and should
not be added during the implementation of this spec:

- Vector embeddings or similarity search
- Chunking strategies for large corpora
- URL reference analysis (Wave 3 in `ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md`)
- XLSX / spreadsheet parsing
- BullMQ async job queue (use `setImmediate` for now)
- Re-enrichment UI in the asset manager
- Per-asset enrichment cost exposure in the user-facing UI

These are natural next steps but must not bloat the current implementation.

---

## 16. Relation to the llmServer RAG service

The `llmServer/apps/rag-service` project is a production-grade standalone
RAG microservice (Weaviate + chunking + hybrid search). It is explicitly **not**
wired into andy-code-cat in this implementation.

The Document Context Layer described here is the right tool for the andy-code-cat
use cases (brochures → websites, DOCX copy → landing pages) because:

- The documents are typically short (under 50 pages)
- The full content should inform the output, not retrieved fragments
- No vector DB infrastructure is required
- Enrichment results are cached permanently in `ProjectAsset.enrichmentTrace`

The path to adopting `llmServer/rag-service` remains open. If a future use case
requires per-project knowledge bases with dozens of documents, an `IRagContextProvider`
interface can be added alongside the inline pipeline without breaking any existing
code.
