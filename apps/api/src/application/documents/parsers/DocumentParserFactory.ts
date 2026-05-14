import type { ParsedDocument } from "./PdfParser";
import { parsePdf } from "./PdfParser";
import { parseDocx } from "./DocxParser";
import { parsePlainText } from "./PlainTextParser";

export interface DocumentParser {
    parse(buffer: Buffer, mimeType: string): Promise<ParsedDocument>;
}

const PDF_MIMES = new Set(["application/pdf"]);
const DOCX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]);
const PLAIN_MIMES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);

export function getParser(mimeType: string): DocumentParser | null {
    const mime = mimeType.toLowerCase().split(";")[0]!.trim();

    if (PDF_MIMES.has(mime)) {
        return { parse: (buf) => parsePdf(buf) };
    }

    if (DOCX_MIMES.has(mime)) {
        return { parse: (buf) => parseDocx(buf) };
    }

    if (PLAIN_MIMES.has(mime)) {
        return { parse: (buf, mt) => Promise.resolve(parsePlainText(buf, mt)) };
    }

    return null;
}
