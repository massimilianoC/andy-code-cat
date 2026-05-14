import type { ParsedDocument } from "./PdfParser";
import { parsePdf } from "./PdfParser";
import { parseDocx } from "./DocxParser";
import { parsePlainText } from "./PlainTextParser";
import { parseHtml } from "./HtmlParser";
import { parseExcel } from "./ExcelParser";
import { parsePptx } from "./PptxParser";

export interface DocumentParser {
    parse(buffer: Buffer, mimeType: string): Promise<ParsedDocument>;
}

const PDF_MIMES = new Set(["application/pdf"]);
const DOCX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]);
// CSV is routed through ExcelParser so we get full spreadsheet treatment
// (column headers, type inference, structured payload) — not flat text.
const CSV_MIMES = new Set(["text/csv", "application/csv"]);
const PLAIN_MIMES = new Set([
    "text/plain", "text/markdown", "text/x-markdown",
    "text/xml", "application/xml",
    "text/css",
    "text/javascript", "application/javascript",
    "application/json",
]);
const HTML_MIMES = new Set(["text/html", "application/xhtml+xml"]);
const XLSX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
]);
const PPTX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
]);

export function getParser(mimeType: string): DocumentParser | null {
    const mime = mimeType.toLowerCase().split(";")[0]!.trim();

    if (PDF_MIMES.has(mime)) {
        return { parse: (buf) => parsePdf(buf) };
    }

    if (DOCX_MIMES.has(mime)) {
        return { parse: (buf) => parseDocx(buf) };
    }

    if (HTML_MIMES.has(mime)) {
        return { parse: (buf) => Promise.resolve(parseHtml(buf)) };
    }

    if (XLSX_MIMES.has(mime)) {
        return { parse: (buf, mt) => parseExcel(buf, mt) };
    }

    if (CSV_MIMES.has(mime)) {
        return { parse: (buf, mt) => parseExcel(buf, mt) };
    }

    if (PPTX_MIMES.has(mime)) {
        return { parse: (buf) => parsePptx(buf) };
    }

    if (PLAIN_MIMES.has(mime)) {
        return { parse: (buf, mt) => Promise.resolve(parsePlainText(buf, mt)) };
    }

    return null;
}
