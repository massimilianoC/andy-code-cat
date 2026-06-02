import type { ParsedDocument } from "./PdfParser";

const MAX_CHARS = 120_000;
const MAX_FIELD_LINES = 220;
const MAX_VALUE_PREVIEW = 180;

function sanitizeValuePreview(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") {
        const compact = value.replace(/\s+/g, " ").trim();
        return compact.length > MAX_VALUE_PREVIEW
            ? `${compact.slice(0, MAX_VALUE_PREVIEW)}...`
            : compact;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[array(${value.length})]`;
    }
    if (typeof value === "object") {
        const keys = Object.keys(value as Record<string, unknown>);
        return `{object keys: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", ..." : ""}}`;
    }
    return String(value);
}

function collectJsonFields(
    value: unknown,
    path: string,
    out: string[],
    depth: number,
): void {
    if (out.length >= MAX_FIELD_LINES || depth > 5) return;

    if (Array.isArray(value)) {
        out.push(`${path}: [array, length=${value.length}]`);
        for (let index = 0; index < Math.min(value.length, 6); index += 1) {
            collectJsonFields(value[index], `${path}[${index}]`, out, depth + 1);
            if (out.length >= MAX_FIELD_LINES) return;
        }
        return;
    }

    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        out.push(`${path}: {object, keys=${entries.length}}`);
        for (const [key, child] of entries.slice(0, 30)) {
            collectJsonFields(child, `${path}.${key}`, out, depth + 1);
            if (out.length >= MAX_FIELD_LINES) return;
        }
        return;
    }

    out.push(`${path}: ${sanitizeValuePreview(value)}`);
}

function parseJson(raw: string): ParsedDocument {
    const parsed = JSON.parse(raw) as unknown;
    const rootType = Array.isArray(parsed) ? "array" : typeof parsed;
    const topLevelKeys = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>)
        : [];

    const fieldLines: string[] = [];
    collectJsonFields(parsed, "$", fieldLines, 0);

    const summaryLines = [
        "[JSON semantic summary]",
        `Root type: ${rootType}`,
        topLevelKeys.length > 0
            ? `Top-level keys (${topLevelKeys.length}): ${topLevelKeys.slice(0, 25).join(", ")}${topLevelKeys.length > 25 ? ", ..." : ""}`
            : "Top-level keys: n/a",
        "",
        "[Flattened fields]",
        ...fieldLines,
        "",
        "[Raw excerpt]",
        raw.slice(0, 20_000),
    ];

    let rawText = summaryLines.join("\n");
    if (rawText.length > MAX_CHARS) rawText = rawText.slice(0, MAX_CHARS);

    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;
    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,
        sectionCount: 2,
        parserName: "structured-json",
        parserVersion: "1.0.0",
    };
}

function parseXml(raw: string): ParsedDocument {
    const tagMatches = raw.match(/<([A-Za-z_][\w:.-]*)\b/g) ?? [];
    const tagFrequency = new Map<string, number>();

    for (const match of tagMatches) {
        const tag = match.slice(1);
        if (tag.startsWith("?") || tag.startsWith("!")) continue;
        tagFrequency.set(tag, (tagFrequency.get(tag) ?? 0) + 1);
    }

    const topTags = [...tagFrequency.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([tag, count]) => `${tag}(${count})`);

    const textOnly = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const summaryLines = [
        "[XML semantic summary]",
        `Distinct tags: ${tagFrequency.size}`,
        `Most frequent tags: ${topTags.length > 0 ? topTags.join(", ") : "n/a"}`,
        "",
        "[Text content excerpt]",
        textOnly.slice(0, 20_000),
        "",
        "[Raw excerpt]",
        raw.slice(0, 20_000),
    ];

    let rawText = summaryLines.join("\n");
    if (rawText.length > MAX_CHARS) rawText = rawText.slice(0, MAX_CHARS);

    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;
    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,
        sectionCount: 2,
        parserName: "structured-xml",
        parserVersion: "1.0.0",
    };
}

export function parseStructuredData(buffer: Buffer, mimeType: string): ParsedDocument {
    const raw = buffer.toString("utf8");
    const mime = mimeType.toLowerCase().split(";")[0]!.trim();

    try {
        if (mime === "application/json") {
            return parseJson(raw);
        }

        if (mime === "text/xml" || mime === "application/xml") {
            return parseXml(raw);
        }
    } catch {
        // Fallback below keeps ingestion resilient for malformed payloads.
    }

    let rawText = raw;
    if (rawText.length > MAX_CHARS) rawText = rawText.slice(0, MAX_CHARS);
    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,
        sectionCount: null,
        parserName: "structured-fallback",
        parserVersion: "1.0.0",
    };
}
