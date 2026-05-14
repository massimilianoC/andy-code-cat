import { describe, it, expect } from "vitest";
import { parsePlainText } from "../PlainTextParser";

describe("PlainTextParser", () => {
    it("parses plain text", () => {
        const text = "Hello world. This is a test.";
        const result = parsePlainText(Buffer.from(text), "text/plain");

        expect(result.rawText).toBe(text);
        expect(result.wordCount).toBe(6);
        expect(result.parserName).toBe("plain-text");
        expect(result.parserVersion).toBe("1.0.0");
        expect(result.pageCount).toBeNull();
        expect(result.sectionCount).toBeNull();
    });

    it("counts markdown headings as sectionCount", () => {
        const md = "# Title\n\nSome text.\n\n## Section\n\nMore text.\n\n### Sub\n\nEnd.";
        const result = parsePlainText(Buffer.from(md), "text/markdown");

        expect(result.sectionCount).toBe(3);
    });

    it("returns null sectionCount for markdown without headings", () => {
        const md = "Just a paragraph.\n\nAnother paragraph.";
        const result = parsePlainText(Buffer.from(md), "text/markdown");
        expect(result.sectionCount).toBe(0);
    });

    it("returns null sectionCount for plain text", () => {
        const result = parsePlainText(Buffer.from("some text"), "text/plain");
        expect(result.sectionCount).toBeNull();
    });

    it("handles empty buffer", () => {
        const result = parsePlainText(Buffer.from(""), "text/plain");
        expect(result.wordCount).toBe(0);
        expect(result.rawText).toBe("");
    });

    it("handles text/x-markdown mime type", () => {
        const md = "# Heading\ncontent";
        const result = parsePlainText(Buffer.from(md), "text/x-markdown");
        expect(result.sectionCount).toBe(1);
    });
});
