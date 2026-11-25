import * as cheerio from "cheerio";
import type { ParsedDocument } from "./PdfParser";

const MAX_CHARS = 120_000;

function emptyResult(): ParsedDocument {
    return {
        rawText: "",
        charCount: 0,
        wordCount: 0,
        pageCount: null,
        sectionCount: null,
        parserName: "odt-parser",
        parserVersion: "1.0.0",
    };
}

export async function parseOdt(buffer: Buffer): Promise<ParsedDocument> {
    // Dynamic import so the module is optional — fails gracefully if adm-zip is not installed
    const AdmZipModule = await import("adm-zip").catch(() => {
        throw new Error("adm-zip package is required for ODT parsing — run npm install adm-zip");
    });
    const AdmZip = (AdmZipModule.default ?? AdmZipModule) as unknown as new (input: Buffer) => {
        getEntries(): Array<{ entryName: string; getData(): Buffer }>;
    };

    const zip = new AdmZip(buffer);
    const contentEntry = zip.getEntries().find(e => e.entryName.toLowerCase() === "content.xml");
    if (!contentEntry) {
        return emptyResult();
    }

    const $ = cheerio.load(contentEntry.getData().toString("utf-8"), { xmlMode: true });

    const paragraphs: string[] = [];
    let headingCount = 0;
    // Document order is preserved by cheerio's multi-selector traversal.
    $("text\\:h, text\\:p").each((_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (!text) return;
        if ((el as { tagName?: string }).tagName?.toLowerCase() === "text:h") headingCount++;
        paragraphs.push(text);
    });

    let rawText = paragraphs.join("\n").trim();
    if (rawText.length > MAX_CHARS) {
        rawText = rawText.slice(0, MAX_CHARS);
    }
    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,
        sectionCount: headingCount > 0 ? headingCount : (paragraphs.length || null),
        parserName: "odt-parser",
        parserVersion: "1.0.0",
    };
}
