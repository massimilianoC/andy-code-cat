import * as cheerio from "cheerio";
import type { ParsedDocument } from "./PdfParser";

const MAX_CHARS = 120_000;

export function parseHtml(buffer: Buffer): ParsedDocument {
    const html = buffer.toString("utf8");
    const $ = cheerio.load(html);

    $("script, style, noscript, head").remove();

    let rawText = $("body").text();
    if (!rawText.trim()) {
        rawText = $.text();
    }

    rawText = rawText.replace(/\s+/g, " ").trim();
    if (rawText.length > MAX_CHARS) {
        rawText = rawText.slice(0, MAX_CHARS);
    }

    const headings = $("h1, h2, h3, h4, h5, h6").length;
    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,
        sectionCount: headings > 0 ? headings : null,
        parserName: "html-cheerio",
        parserVersion: "1.0.0",
    };
}
