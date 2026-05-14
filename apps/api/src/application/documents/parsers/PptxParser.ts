import * as cheerio from "cheerio";
import type { ParsedDocument, ParsedDocumentSlide } from "./PdfParser";

const MAX_CHARS = 120_000;

export async function parsePptx(buffer: Buffer): Promise<ParsedDocument> {
    // Dynamic import so the module is optional — fails gracefully if adm-zip is not installed
    const AdmZipModule = await import("adm-zip").catch(() => {
        throw new Error("adm-zip package is required for PPTX parsing — run npm install adm-zip");
    });
    const AdmZip = (AdmZipModule.default ?? AdmZipModule) as unknown as new (input: Buffer) => {
        getEntries(): Array<{ entryName: string; getData(): Buffer }>;
    };

    const zip = new AdmZip(buffer);
    const slideEntries = zip.getEntries()
        .filter(e => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
        .sort((a, b) => a.entryName.localeCompare(b.entryName));

    const textParts: string[] = [];
    const slides: ParsedDocumentSlide[] = [];
    let sectionCount = 0;

    for (let idx = 0; idx < slideEntries.length; idx++) {
        const entry = slideEntries[idx]!;
        const xml = entry.getData().toString("utf-8");
        const $ = cheerio.load(xml, { xmlMode: true });

        const paragraphs: string[] = [];
        $("a\\:p").each((_, el) => {
            const texts: string[] = [];
            $(el).find("a\\:t").each((__, t) => {
                const text = $(t).text().trim();
                if (text) texts.push(text);
            });
            const paraText = texts.join(" ").trim();
            if (paraText) {
                paragraphs.push(paraText);
                sectionCount++;
            }
        });

        if (paragraphs.length > 0) {
            textParts.push(paragraphs.join("\n"));
        }

        // Treat the first non-empty paragraph as the slide title heuristic
        const title = paragraphs[0] ?? null;
        const body = paragraphs.slice(1).join("\n");
        slides.push({ index: idx + 1, title, body });
    }

    let rawText = textParts.join("\n\n").trim();
    if (rawText.length > MAX_CHARS) {
        rawText = rawText.slice(0, MAX_CHARS);
    }

    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: slideEntries.length > 0 ? slideEntries.length : null,
        sectionCount: sectionCount > 0 ? sectionCount : null,
        parserName: "pptx-parser",
        parserVersion: "1.0.0",
        slides,
    };
}
