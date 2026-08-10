import type { ParsedDocument } from "./PdfParser";
import { parsePdf } from "./PdfParser";
import { parseDocx } from "./DocxParser";
import { parsePlainText } from "./PlainTextParser";
import { parseHtml } from "./HtmlParser";
import { parseExcel } from "./ExcelParser";
import { parsePptx } from "./PptxParser";
import { parseStructuredData } from "./StructuredDataParser";
import { parseRtf } from "./RtfParser";
import { parseOdt } from "./OdtParser";
import { parseLegacyDoc, isOleCompoundFile } from "./LegacyDocParser";

export interface DocumentParser {
    parse(buffer: Buffer, mimeType: string): Promise<ParsedDocument>;
}

const PDF_MIMES = new Set(["application/pdf"]);
// .doc is the legacy OLE binary format — mammoth only reads OOXML .docx,
// so it gets its own parser (which delegates back to parseDocx on mislabelled zips).
const DOCX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const LEGACY_DOC_MIMES = new Set(["application/msword"]);
const RTF_MIMES = new Set(["application/rtf", "text/rtf", "text/richtext"]);
const ODT_MIMES = new Set(["application/vnd.oasis.opendocument.text"]);
// CSV is routed through ExcelParser so we get full spreadsheet treatment
// (column headers, type inference, structured payload) — not flat text.
const CSV_MIMES = new Set(["text/csv", "application/csv"]);
const PLAIN_MIMES = new Set([
    "text/plain", "text/markdown", "text/x-markdown",
    "text/css",
    "text/javascript", "application/javascript",
]);
const JSON_MIMES = new Set(["application/json"]);
const XML_MIMES = new Set(["text/xml", "application/xml"]);
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

    if (LEGACY_DOC_MIMES.has(mime)) {
        return { parse: (buf) => parseLegacyDoc(buf) };
    }

    // RTF_MIMES must be checked before PLAIN_MIMES — text/rtf starts with "text/"
    // and would otherwise be a candidate for the plain-text branch.
    if (RTF_MIMES.has(mime)) {
        return { parse: (buf) => parseRtf(buf) };
    }

    if (ODT_MIMES.has(mime)) {
        return { parse: (buf) => parseOdt(buf) };
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
        return {
            parse: (buf) => {
                if (isOleCompoundFile(buf)) {
                    return Promise.reject(new Error(
                        "Legacy binary .ppt (PowerPoint 97-2003) is not supported — please re-save as .pptx or PDF.",
                    ));
                }
                return parsePptx(buf);
            },
        };
    }

    if (JSON_MIMES.has(mime) || XML_MIMES.has(mime)) {
        return { parse: (buf, mt) => Promise.resolve(parseStructuredData(buf, mt)) };
    }

    if (PLAIN_MIMES.has(mime)) {
        return { parse: (buf, mt) => Promise.resolve(parsePlainText(buf, mt)) };
    }

    return null;
}
