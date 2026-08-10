import type { ParsedDocument } from "./PdfParser";
import { parseDocx } from "./DocxParser";

const MAX_CHARS = 120_000;
const MIN_TEXT_WARN_CHARS = 50;

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function isOleCompoundFile(buffer: Buffer): boolean {
    return buffer.subarray(0, 4).equals(OLE_MAGIC);
}
export function isZipPackage(buffer: Buffer): boolean {
    return buffer.subarray(0, 4).equals(ZIP_MAGIC);
}

/**
 * application/msword covers BOTH the legacy OLE binary .doc and files that
 * browsers/OSes mislabel (a real .docx sent as application/msword). Sniff the
 * magic bytes and route accordingly — mammoth cannot read OLE, word-extractor
 * is the pure-JS reader for it.
 */
export async function parseLegacyDoc(buffer: Buffer): Promise<ParsedDocument> {
    if (isZipPackage(buffer)) return parseDocx(buffer); // mislabelled .docx

    if (!isOleCompoundFile(buffer)) {
        throw new Error(
            "Unsupported Word file: the attachment is neither an OLE (.doc) nor an OOXML (.docx) document.",
        );
    }

    const mod = await import("word-extractor").catch(() => {
        throw new Error("word-extractor package is required for legacy .doc parsing — run npm install word-extractor");
    });
    const WordExtractor = ((mod as { default?: unknown }).default ?? mod) as new () => {
        extract(input: Buffer): Promise<{ getBody(): string; getFootnotes(): string; getEndnotes(): string }>;
    };

    const doc = await new WordExtractor().extract(buffer);
    let rawText = [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()]
        .filter(part => part && part.trim().length > 0)
        .join("\n\n")
        .replace(/\x00/g, "")
        .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "") // same sanitation as PdfParser
        .trim();

    if (rawText.length < MIN_TEXT_WARN_CHARS) {
        console.warn("[LegacyDocParser] extracted text suspiciously short");
    }
    if (rawText.length > MAX_CHARS) {
        rawText = rawText.slice(0, MAX_CHARS);
    }

    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;
    const sectionCount = (rawText.match(/\n{2,}/g) ?? []).length + (rawText ? 1 : 0);

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,
        sectionCount: sectionCount > 0 ? sectionCount : null,
        parserName: "word-extractor",
        parserVersion: "1.0.4",
    };
}
