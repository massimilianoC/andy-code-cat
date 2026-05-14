import { describe, it, expect } from "vitest";
import { parseHtml } from "../HtmlParser";

describe("HtmlParser", () => {
    it("extracts body text and strips tags", () => {
        const html = `<html><head><title>T</title><style>body{color:red}</style></head>
<body><h1>Hello World</h1><p>Some paragraph text.</p></body></html>`;
        const result = parseHtml(Buffer.from(html));

        expect(result.rawText).toContain("Hello World");
        expect(result.rawText).toContain("Some paragraph text.");
        expect(result.rawText).not.toContain("color:red");
        expect(result.parserName).toBe("html-cheerio");
        expect(result.parserVersion).toBe("1.0.0");
    });

    it("counts headings as sectionCount", () => {
        const html = "<body><h1>A</h1><h2>B</h2><h3>C</h3><p>text</p></body>";
        const result = parseHtml(Buffer.from(html));
        expect(result.sectionCount).toBe(3);
    });

    it("returns null sectionCount when no headings", () => {
        const html = "<body><p>No headings here</p></body>";
        const result = parseHtml(Buffer.from(html));
        expect(result.sectionCount).toBeNull();
    });

    it("strips script tags", () => {
        const html = "<body><script>alert('xss')</script><p>Clean</p></body>";
        const result = parseHtml(Buffer.from(html));
        expect(result.rawText).not.toContain("alert");
        expect(result.rawText).toContain("Clean");
    });

    it("returns empty text for empty body", () => {
        const html = "<html><body></body></html>";
        const result = parseHtml(Buffer.from(html));
        expect(result.wordCount).toBe(0);
    });

    it("normalises whitespace", () => {
        const html = "<body><p>Word1   Word2\n\n  Word3</p></body>";
        const result = parseHtml(Buffer.from(html));
        expect(result.rawText).not.toMatch(/\s{2,}/);
    });
});
