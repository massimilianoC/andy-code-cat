import mammoth from "mammoth";
import type { ParsedDocument } from "./PdfParser";

const MAX_CHARS = 120_000;
const MIN_TEXT_WARN_CHARS = 50;

export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
    const result = await mammoth.extractRawText({ buffer });

    let rawText = result.value ?? "";

    if (rawText.length < MIN_TEXT_WARN_CHARS) {
        console.warn("[DocxParser] extracted text suspiciously short");
    }

    if (rawText.length > MAX_CHARS) {
        rawText = rawText.slice(0, MAX_CHARS);
    }

    const wordCount = rawText.trim().length > 0
        ? rawText.trim().split(/\s+/).length
        : 0;

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,
        sectionCount: null,
        parserName: "mammoth",
        parserVersion: "1.9.0",
    };
}
