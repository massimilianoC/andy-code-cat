import type { ParsedDocument } from "./PdfParser";

const MAX_CHARS = 120_000;

export function parsePlainText(buffer: Buffer, mimeType: string): ParsedDocument {
    let rawText = buffer.toString("utf8");

    if (rawText.length > MAX_CHARS) {
        rawText = rawText.slice(0, MAX_CHARS);
    }

    const wordCount = rawText.trim().length > 0
        ? rawText.trim().split(/\s+/).length
        : 0;

    const isMarkdown = mimeType === "text/markdown" || mimeType === "text/x-markdown";
    const sectionCount = isMarkdown
        ? (rawText.match(/^#+\s/gm) ?? []).length
        : null;

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,
        sectionCount: sectionCount ?? null,
        parserName: "plain-text",
        parserVersion: "1.0.0",
    };
}
