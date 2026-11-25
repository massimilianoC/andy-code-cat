import type { ParsedDocument } from "./PdfParser";

const MAX_CHARS = 120_000;
const MIN_TEXT_WARN_CHARS = 50;

interface RtfSpan { value?: string }
interface RtfParagraph { content?: RtfSpan[] }
interface RtfDocument { content?: RtfParagraph[] }

/** Last-resort de-markup used when rtf-parser fails or yields nothing. */
function stripRtfMarkup(src: string): string {
    return src
        .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\u(-?\d+)\s?\??/g, (_, n) => String.fromCharCode((Number(n) + 65536) % 65536))
        .replace(/\{\\\*?\\(fonttbl|colortbl|stylesheet|info|pict|object)[\s\S]*?\}/gi, " ")
        .replace(/\\par[d]?\b/gi, "\n")
        .replace(/\\[a-z]+-?\d*\s?/gi, "")
        .replace(/[{}]/g, "")
        .replace(/[ \t]+/g, " ");
}

export async function parseRtf(buffer: Buffer): Promise<ParsedDocument> {
    // rtf-parser has no type declarations — same dynamic-import cast PptxParser uses for adm-zip.
    const mod = await import("rtf-parser").catch(() => {
        throw new Error("rtf-parser package is required for RTF parsing — run npm install rtf-parser");
    });
    const parseString = ((mod as { default?: unknown }).default ?? mod) as {
        string(input: string, cb: (err: Error | null, doc?: RtfDocument) => void): void;
    };

    // latin1 keeps every byte 1:1 so \'xx codepage escapes survive to the parser.
    const source = buffer.toString("latin1");

    let paragraphs: string[] = [];
    try {
        const doc = await new Promise<RtfDocument>((resolve, reject) => {
            parseString.string(source, (err, d) =>
                err || !d ? reject(err ?? new Error("rtf-parser returned no document")) : resolve(d));
        });
        paragraphs = (doc.content ?? [])
            .map(p => (p.content ?? []).map(s => s.value ?? "").join(""))
            .map(t => t.replace(/\s+/g, " ").trim())
            .filter(Boolean);
    } catch (err) {
        console.warn("[RtfParser] rtf-parser failed, falling back to regex de-markup:", err);
    }

    if (paragraphs.length === 0) {
        paragraphs = stripRtfMarkup(source).split(/\n+/).map(t => t.trim()).filter(Boolean);
    }

    let rawText = paragraphs.join("\n").trim();
    if (rawText.length < MIN_TEXT_WARN_CHARS) {
        console.warn("[RtfParser] extracted text suspiciously short");
    }
    if (rawText.length > MAX_CHARS) {
        rawText = rawText.slice(0, MAX_CHARS);
    }

    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,
        sectionCount: paragraphs.length > 0 ? paragraphs.length : null,
        parserName: "rtf-parser",
        parserVersion: "1.3.3",
    };
}
