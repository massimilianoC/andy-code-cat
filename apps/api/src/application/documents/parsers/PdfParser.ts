import pdfParse from "pdf-parse";

export interface ParsedDocumentSheet {
    name: string;
    rowCount: number;
    columnHeaders: string[];
    columnTypes: string[];
    sampleRows: string[][];
    csvBlock: string;
}

export interface ParsedDocumentSlide {
    index: number;
    title: string | null;
    body: string;
}

export interface ParsedDocument {
    rawText: string;
    charCount: number;
    wordCount: number;
    pageCount: number | null;
    sectionCount: number | null;
    parserName: string;
    parserVersion: string;
    /** Populated by tabular parsers (xlsx, csv). */
    sheets?: ParsedDocumentSheet[];
    /** Populated by presentation parsers (pptx). */
    slides?: ParsedDocumentSlide[];
}

const MAX_CHARS = 120_000;
const MIN_TEXT_WARN_CHARS = 50;

export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
    const result = await pdfParse(buffer);

    let rawText = (result.text ?? "")
        .replace(/\x00/g, "")
        .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

    if (rawText.length < MIN_TEXT_WARN_CHARS) {
        console.warn("[PdfParser] extracted text suspiciously short — may be a scanned image-only PDF");
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
        pageCount: result.numpages ?? null,
        sectionCount: null,
        parserName: "pdf-parse",
        parserVersion: "1.1.1",
    };
}
