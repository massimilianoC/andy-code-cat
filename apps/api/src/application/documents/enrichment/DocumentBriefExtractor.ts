import { jsonrepair } from "jsonrepair";
import type {
    DocumentBrief,
    DatasetLlmAppendix,
    DatasetStructuredData,
    DocumentTypeHint,
    StructuredDataPayload,
} from "../../../domain/entities/AssetEnrichmentTrace";
import type { EnrichmentAssetKind } from "../../../domain/entities/AssetEnrichmentTrace";
import type { ParsedDocumentSheet, ParsedDocumentSlide } from "../parsers/PdfParser";

const TEXT_SNIPPET_MAX = 20_000;
// The structured inventory already conveys the data shape; keep the raw CSV
// excerpt small so spreadsheet prompts don't blow the provider's context cap.
const SPREADSHEET_SNIPPET_MAX = 6_000;
const SPREADSHEET_PROMPT_HARD_CAP = 28_000;
const DATASET_APPENDIX_PROMPT_HARD_CAP = 16_000;

const VALID_DOC_TYPES = new Set<DocumentTypeHint>([
    "brochure", "landing_copy", "product_sheet", "menu", "faq",
    "press_release", "case_study", "specification", "cv_resume",
    "report", "generic_document", "unknown",
]);

function safeDocType(raw: unknown): DocumentTypeHint {
    return VALID_DOC_TYPES.has(raw as DocumentTypeHint) ? (raw as DocumentTypeHint) : "unknown";
}

function strings(v: unknown, max: number): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter(x => typeof x === "string").slice(0, max) as string[];
}

export interface DocumentBriefInput {
    textSnippet: string;
    assetKind: EnrichmentAssetKind;
    datasetStructuredData?: DatasetStructuredData;
    sheets?: ParsedDocumentSheet[];
    slides?: ParsedDocumentSlide[];
    baseUrl: string;
    model: string;
    authHeader: string | undefined;
}

export interface DocumentBriefResult {
    brief: DocumentBrief;
    tokensUsed: number | null;
    structuredData?: StructuredDataPayload;
    /** Structured token breakdown when the provider exposes it. Optional for backward compat. */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

// ── Generic document prompt ───────────────────────────────────────────────

function buildGenericPrompt(snippet: string): string {
    const truncated = snippet.slice(0, TEXT_SNIPPET_MAX);
    return `You are a senior content strategist and analyst for a web design platform.
Read the following document excerpt and return a thorough JSON analysis.
Return only the JSON — no prose before or after.

Document excerpt:
---
${truncated}
---

{
  "documentType": "brochure|landing_copy|product_sheet|menu|faq|press_release|case_study|specification|cv_resume|report|generic_document|unknown",
  "detectedTitle": "<null or document title>",
  "detectedBrandName": "<null or brand/company name>",
  "purposeSentence": "<2-3 sentences: what this document is, its main goal, and who produced it>",
  "contentSummary": "<4-6 sentences: analytical summary of the document content, arguments, and key information — be specific and detailed, cite concrete facts or figures where present>",
  "mainArgumentOrValue": "<null or the central thesis, value proposition, or main argument being made>",
  "structureSummary": "<null or description of the document structure: sections, flow, how information is organized>",
  "keyMessages": ["<up to 10 distinct key messages, takeaways, or data points>"],
  "toneLabel": "<detailed tone description, e.g. 'formal and authoritative', 'conversational and friendly', 'technical and precise'>",
  "targetAudience": "<null or detailed audience description including role, industry, knowledge level>",
  "ctaText": "<null or primary call-to-action wording>",
  "primaryTopics": ["<up to 12 specific topics covered>"],
  "contentLanguage": "<BCP-47 language code>",
  "suggestedStyleRole": "inspiration|material|reference"
}`;
}

// ── Spreadsheet-aware prompt ──────────────────────────────────────────────

function buildSpreadsheetPrompt(sheets: ParsedDocumentSheet[], snippet: string): string {
    const inventoryLines: string[] = [];

    for (const sheet of sheets) {
        inventoryLines.push(`Sheet: "${sheet.name}"`);
        inventoryLines.push(`  Total rows: ${sheet.rowCount}`);
        if (sheet.columnHeaders.length > 0) {
            const colDesc = sheet.columnHeaders
                .map((h, i) => `${h} [${sheet.columnTypes[i] ?? "text"}]`)
                .join(", ");
            inventoryLines.push(`  Columns (${sheet.columnHeaders.length}): ${colDesc}`);
        }
        if (sheet.sampleRows.length > 0) {
            const headerRow = sheet.columnHeaders.join(" | ");
            const dataRows = sheet.sampleRows.slice(0, 12).map(r => r.join(" | ")).join("\n    ");
            inventoryLines.push(`  Sample rows:\n    ${headerRow}\n    ${dataRows}`);
        }
        inventoryLines.push("");
    }

    const snippetTruncated = snippet.slice(0, SPREADSHEET_SNIPPET_MAX);

    return `You are a senior data analyst and content strategist for a web design platform.
Analyze the following spreadsheet structure and extract a rich, detailed analytical brief.
Focus on what kind of data this represents, its business purpose, key patterns and insights.
Return only the JSON — no prose before or after.

Spreadsheet structure inventory:
---
${inventoryLines.join("\n")}
---

Raw text sample (for additional context):
---
${snippetTruncated}
---

{
  "documentType": "specification|report|product_sheet|case_study|generic_document|unknown",
  "detectedTitle": "<null or inferred dataset or document title>",
  "detectedBrandName": "<null or brand/company name found in headers or data>",
  "purposeSentence": "<2-3 sentences: what this spreadsheet is, what business domain it covers, and who would use it>",
  "contentSummary": "<5-7 sentences: analytical summary — what entity types appear in rows, what metrics are tracked, key data patterns, numerical ranges where notable, data relationships across sheets if multiple, any anomalies or highlights>",
  "mainArgumentOrValue": "<null or the core value this data provides — what decision, process, or workflow it supports>",
  "structureSummary": "<detailed description: number of sheets, what each sheet covers, column groupings by theme, key column relationships, data density>",
  "keyMessages": ["<up to 12 data insights — MUST include at least 4 entries that cite concrete numbers, ranges, rates, or averages directly from the data (e.g. 'Platinum tier avg AOV is $X', 'churn rate among Bronze customers is X%', 'top income bracket spends $X–$Y more than median')>"],
  "toneLabel": "<data character, e.g. 'quantitative product catalog', 'financial budget summary', 'operational event schedule', 'inventory tracking sheet'>",
  "targetAudience": "<null or who would use this data — role, department, or use case>",
  "ctaText": "<null or primary action this data supports>",
  "primaryTopics": ["<up to 14 specific topics, data dimensions, entity categories, or column groups covered>"],
  "contentLanguage": "<BCP-47 language code>",
  "suggestedStyleRole": "inspiration|material|reference"
}`;
}

// ── Presentation-aware prompt ────────────────────────────────────────────

function buildPresentationPrompt(slides: ParsedDocumentSlide[], snippet: string): string {
    const slideInventory = slides.slice(0, 20).map(s => {
        const title = s.title ? `"${s.title}"` : "(no title)";
        const bodyPreview = s.body.slice(0, 200);
        return `Slide ${s.index}: ${title}${bodyPreview ? ` — ${bodyPreview}` : ""}`;
    }).join("\n");

    const snippetTruncated = snippet.slice(0, TEXT_SNIPPET_MAX);

    return `You are a senior content strategist for a web design platform.
Analyze the following presentation slide inventory and return a thorough JSON analysis.
Return only the JSON — no prose before or after.

Slide inventory (${slides.length} slides total):
---
${slideInventory}
---

Full text content:
---
${snippetTruncated}
---

{
  "documentType": "brochure|landing_copy|product_sheet|press_release|case_study|specification|report|generic_document|unknown",
  "detectedTitle": "<null or presentation title, usually from slide 1>",
  "detectedBrandName": "<null or brand/company name>",
  "purposeSentence": "<2-3 sentences: what this presentation covers, its goal, and who it is aimed at>",
  "contentSummary": "<4-6 sentences: analytical summary of the narrative arc — opening argument, supporting points, evidence or examples, conclusion or call to action>",
  "mainArgumentOrValue": "<null or the central thesis or value proposition>",
  "structureSummary": "<description of slide flow: intro, main sections and their themes, conclusion — how the argument progresses>",
  "keyMessages": ["<up to 10 key messages, one per major slide or section>"],
  "toneLabel": "<detailed tone description>",
  "targetAudience": "<null or detailed audience description>",
  "ctaText": "<null or primary call-to-action from the last slides>",
  "primaryTopics": ["<up to 12 specific topics covered>"],
  "contentLanguage": "<BCP-47 language code>",
  "suggestedStyleRole": "inspiration|material|reference"
}`;
}

export function buildDatasetAppendixPrompt(dataset: DatasetStructuredData): string {
    const lines: string[] = [
        "You are a senior data analyst producing a compact prompt-enrichment appendix for a web generation pipeline.",
        "Analyze ONLY the deterministic dataset envelope below.",
        "Do not invent facts not present in the envelope.",
        "Return only JSON.",
        "",
        "Dataset envelope:",
        `Source format: ${dataset.sourceFormat}`,
        `Global facts: rows=${dataset.facts.rowCount}, columns=${dataset.facts.columnCount}, numeric=${dataset.facts.numericColumnCount}, categorical=${dataset.facts.categoricalColumnCount}, boolean=${dataset.facts.booleanColumnCount}, date=${dataset.facts.dateColumnCount}`,
        `Supported aggregations: ${dataset.facts.supportedAggregations.join(", ")}`,
        "",
        "Tables:",
    ];

    for (const table of dataset.tables.slice(0, 3)) {
        lines.push(`- Table "${table.name}": ${table.rowCount} rows, ${table.columnCount} columns`);
        if (table.sampleHeaders.length > 0) {
            lines.push(`  Headers: ${table.sampleHeaders.slice(0, 12).join(", ")}`);
        }
        const interestingColumns = table.columns.slice(0, 12).map((column) => {
            const stats: string[] = [`type=${column.valueType}`];
            if (typeof column.distinctCount === "number") stats.push(`distinct=${column.distinctCount}`);
            if (typeof column.nullRatio === "number") stats.push(`nullRatio=${column.nullRatio}`);
            if (column.valueType === "number") {
                if (column.min != null) stats.push(`min=${column.min}`);
                if (column.max != null) stats.push(`max=${column.max}`);
                if (column.mean != null) stats.push(`mean=${column.mean}`);
            }
            return `${column.label || column.key} [${stats.join(", ")}]`;
        });
        if (interestingColumns.length > 0) {
            lines.push(`  Columns: ${interestingColumns.join("; ")}`);
        }
        if (table.sampleRows.length > 0) {
            const sampleRows = table.sampleRows.slice(0, 3).map((row) => row.slice(0, 10).join(" | "));
            lines.push("  Sample rows:");
            sampleRows.forEach((row) => lines.push(`    ${row}`));
        }
        if (table.notes && table.notes.length > 0) {
            lines.push(`  Notes: ${table.notes.slice(0, 3).join(" | ")}`);
        }
    }

    if (dataset.limitations && dataset.limitations.length > 0) {
        lines.push("");
        lines.push(`Known limitations: ${dataset.limitations.slice(0, 6).join(" | ")}`);
    }

    lines.push("");
    lines.push("{");
    lines.push('  "analyticalSummary": "<3-5 sentences: what the dataset seems to represent, what analytical value it has, and which patterns or uses are most relevant for prompt enrichment>",');
    lines.push('  "keySignals": ["<up to 8 grounded analytical signals inferred from the envelope only>"],');
    lines.push('  "suggestedQuestions": ["<up to 6 grounded questions this data could help answer>"],');
    lines.push('  "cautions": ["<up to 5 cautions, ambiguities, or data-quality constraints to keep the prompt grounded>"]');
    lines.push("}");

    const prompt = lines.join("\n");
    return prompt.length > DATASET_APPENDIX_PROMPT_HARD_CAP
        ? `${prompt.slice(0, DATASET_APPENDIX_PROMPT_HARD_CAP)}\n...(truncated to fit context window)`
        : prompt;
}

export function buildDocumentBriefPrompt(input: Pick<DocumentBriefInput, "textSnippet" | "assetKind" | "sheets" | "slides">): {
    prompt: string;
    maxTokens: number;
} {
    const isSpreadsheet = input.assetKind === "xlsx" || input.assetKind === "csv";
    const isPresentation = input.assetKind === "pptx";
    const hasSheets = input.sheets && input.sheets.length > 0;
    const hasSlides = input.slides && input.slides.length > 0;

    let prompt: string;
    if (isSpreadsheet && hasSheets) {
        prompt = buildSpreadsheetPrompt(input.sheets!, input.textSnippet);
    } else if (isPresentation && hasSlides) {
        prompt = buildPresentationPrompt(input.slides!, input.textSnippet);
    } else {
        prompt = buildGenericPrompt(input.textSnippet);
    }

    const safePrompt = isSpreadsheet && hasSheets && prompt.length > SPREADSHEET_PROMPT_HARD_CAP
        ? `${prompt.slice(0, SPREADSHEET_PROMPT_HARD_CAP)}\n...(truncated to fit context window)`
        : prompt;

    return {
        prompt: safePrompt,
        maxTokens: isSpreadsheet ? 2800 : isPresentation ? 2400 : 2000,
    };
}

export async function extractDatasetAppendix(input: {
    datasetStructuredData: DatasetStructuredData;
    baseUrl: string;
    model: string;
    authHeader: string | undefined;
}): Promise<{
    appendix: DatasetLlmAppendix;
    tokensUsed: number | null;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}> {
    const body = {
        model: input.model,
        messages: [{ role: "user", content: buildDatasetAppendixPrompt(input.datasetStructuredData) }],
        max_tokens: 1200,
        temperature: 0,
    };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (input.authHeader) headers["Authorization"] = input.authHeader;

    const res = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const responseSnippet = await res.text().catch(() => "(unable to read body)");
        throw new Error(`LLM returned HTTP ${res.status} for dataset appendix extraction: ${responseSnippet.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const promptTokens = Number(json.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(json.usage?.completion_tokens ?? 0);
    const totalTokens = Number(json.usage?.total_tokens ?? (promptTokens + completionTokens));

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(jsonrepair(raw));
    } catch {
        throw new Error(`Dataset appendix LLM response could not be parsed. Raw: ${raw.slice(0, 200)}`);
    }

    return {
        appendix: {
            analyticalSummary: typeof parsed.analyticalSummary === "string" ? parsed.analyticalSummary.trim().slice(0, 1200) : "",
            keySignals: strings(parsed.keySignals, 8).map((value) => value.slice(0, 240)),
            suggestedQuestions: strings(parsed.suggestedQuestions, 6).map((value) => value.slice(0, 240)),
            cautions: strings(parsed.cautions, 5).map((value) => value.slice(0, 240)),
        },
        tokensUsed: json.usage?.total_tokens ?? null,
        usage: { promptTokens, completionTokens, totalTokens },
    };
}

// ── Main extractor ────────────────────────────────────────────────────────

export async function extractDocumentBrief(input: DocumentBriefInput): Promise<DocumentBriefResult> {
    const isSpreadsheet = input.assetKind === "xlsx" || input.assetKind === "csv";
    const isPresentation = input.assetKind === "pptx";
    const hasSheets = input.sheets && input.sheets.length > 0;
    const hasSlides = input.slides && input.slides.length > 0;
    const { prompt: safePrompt, maxTokens } = buildDocumentBriefPrompt({
        textSnippet: input.textSnippet,
        assetKind: input.assetKind,
        sheets: input.sheets,
        slides: input.slides,
    });

    const body = {
        model: input.model,
        messages: [{ role: "user", content: safePrompt }],
        max_tokens: maxTokens,
        temperature: 0,
    };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (input.authHeader) headers["Authorization"] = input.authHeader;

    const res = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        // Surface the provider's error body so the trace explains what went wrong.
        const responseSnippet = await res.text().catch(() => "(unable to read body)");
        throw new Error(
            `LLM returned HTTP ${res.status} for document brief extraction (assetKind=${input.assetKind}, model=${input.model}, promptLen=${safePrompt.length}): ${responseSnippet.slice(0, 400)}`,
        );
    }

    const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const raw = json.choices?.[0]?.message?.content ?? "";
    const promptTokens = Number(json.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(json.usage?.completion_tokens ?? 0);
    const totalTokens = Number(json.usage?.total_tokens ?? (promptTokens + completionTokens));
    const tokensUsed = json.usage?.total_tokens ?? null;

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(jsonrepair(raw));
    } catch {
        throw new Error(`Document brief LLM response could not be parsed. Raw: ${raw.slice(0, 200)}`);
    }

    const brief: DocumentBrief = {
        documentType: safeDocType(parsed["documentType"]),
        detectedTitle: typeof parsed["detectedTitle"] === "string" ? parsed["detectedTitle"] : null,
        detectedBrandName: typeof parsed["detectedBrandName"] === "string" ? parsed["detectedBrandName"] : null,
        purposeSentence: typeof parsed["purposeSentence"] === "string" ? parsed["purposeSentence"] : "",
        contentSummary: typeof parsed["contentSummary"] === "string" ? parsed["contentSummary"] : "",
        mainArgumentOrValue: typeof parsed["mainArgumentOrValue"] === "string" ? parsed["mainArgumentOrValue"] : null,
        structureSummary: typeof parsed["structureSummary"] === "string" ? parsed["structureSummary"] : null,
        keyMessages: strings(parsed["keyMessages"], 12),
        toneLabel: typeof parsed["toneLabel"] === "string" ? parsed["toneLabel"] : "neutral",
        targetAudience: typeof parsed["targetAudience"] === "string" ? parsed["targetAudience"] : null,
        ctaText: typeof parsed["ctaText"] === "string" ? parsed["ctaText"] : null,
        primaryTopics: strings(parsed["primaryTopics"], 14),
        contentLanguage: typeof parsed["contentLanguage"] === "string" ? parsed["contentLanguage"] : "unknown",
        suggestedStyleRole: typeof parsed["suggestedStyleRole"] === "string" ? parsed["suggestedStyleRole"] : "reference",
    };

    // Build structured payload for LayerD injection
    let structuredData: StructuredDataPayload | undefined;
    if (isSpreadsheet && hasSheets) {
        structuredData = { kind: "spreadsheet", sheets: input.sheets! };
    } else if (isPresentation && hasSlides) {
        structuredData = { kind: "presentation", slides: input.slides! };
    }

    return {
        brief,
        tokensUsed,
        structuredData,
        usage: { promptTokens, completionTokens, totalTokens },
    };
}
