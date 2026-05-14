import { jsonrepair } from "jsonrepair";
import type { DocumentBrief, DocumentTypeHint } from "../../../domain/entities/AssetEnrichmentTrace";

const TEXT_SNIPPET_MAX = 8000;

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
    baseUrl: string;
    model: string;
    authHeader: string | undefined;
}

export interface DocumentBriefResult {
    brief: DocumentBrief;
    tokensUsed: number | null;
}

function buildPrompt(snippet: string): string {
    const truncated = snippet.slice(0, TEXT_SNIPPET_MAX);
    return `You are a content analyst for a web design platform.
Read the following document excerpt and return a JSON object with exactly these fields.
Return only the JSON — no prose before or after.

Document excerpt:
---
${truncated}
---

{
  "documentType": "brochure|landing_copy|product_sheet|menu|faq|press_release|case_study|specification|cv_resume|report|generic_document|unknown",
  "detectedTitle": "<null or document title>",
  "detectedBrandName": "<null or brand/company name>",
  "purposeSentence": "<one sentence describing what this document is>",
  "keyMessages": ["<message>"],
  "toneLabel": "<tone description>",
  "targetAudience": "<null or audience description>",
  "ctaText": "<null or primary call-to-action wording>",
  "primaryTopics": ["<topic>"],
  "contentLanguage": "<BCP-47 language code>",
  "suggestedStyleRole": "inspiration|material|reference"
}`;
}

export async function extractDocumentBrief(input: DocumentBriefInput): Promise<DocumentBriefResult> {
    const body = {
        model: input.model,
        messages: [{ role: "user", content: buildPrompt(input.textSnippet) }],
        max_tokens: 512,
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
        throw new Error(`LLM returned HTTP ${res.status} for document brief extraction`);
    }

    const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
    };

    const raw = json.choices?.[0]?.message?.content ?? "";
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
        keyMessages: strings(parsed["keyMessages"], 6),
        toneLabel: typeof parsed["toneLabel"] === "string" ? parsed["toneLabel"] : "neutral",
        targetAudience: typeof parsed["targetAudience"] === "string" ? parsed["targetAudience"] : null,
        ctaText: typeof parsed["ctaText"] === "string" ? parsed["ctaText"] : null,
        primaryTopics: strings(parsed["primaryTopics"], 8),
        contentLanguage: typeof parsed["contentLanguage"] === "string" ? parsed["contentLanguage"] : "unknown",
        suggestedStyleRole: typeof parsed["suggestedStyleRole"] === "string" ? parsed["suggestedStyleRole"] : "reference",
    };

    return { brief, tokensUsed };
}
