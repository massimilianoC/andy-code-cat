import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { parsePptx } from "../PptxParser";

function makeSlideXml(texts: string[]): string {
    const paragraphs = texts.map(t =>
        `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`
    ).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
}

function makePptxBuffer(slides: string[][]): Buffer {
    const zip = new AdmZip();
    slides.forEach((texts, i) => {
        zip.addFile(`ppt/slides/slide${i + 1}.xml`, Buffer.from(makeSlideXml(texts), "utf-8"));
    });
    return zip.toBuffer();
}

describe("PptxParser", () => {
    it("extracts text from a single slide", async () => {
        const buf = makePptxBuffer([["Hello World", "Subtitle text"]]);
        const result = await parsePptx(buf);

        expect(result.rawText).toContain("Hello World");
        expect(result.rawText).toContain("Subtitle text");
        expect(result.parserName).toBe("pptx-parser");
        expect(result.parserVersion).toBe("1.0.0");
    });

    it("counts slides as pageCount", async () => {
        const buf = makePptxBuffer([
            ["Slide one"],
            ["Slide two"],
            ["Slide three"],
        ]);
        const result = await parsePptx(buf);
        expect(result.pageCount).toBe(3);
    });

    it("counts paragraphs as sectionCount", async () => {
        const buf = makePptxBuffer([["Para A", "Para B"], ["Para C"]]);
        const result = await parsePptx(buf);
        expect(result.sectionCount).toBe(3);
    });

    it("returns null pageCount for empty zip", async () => {
        const zip = new AdmZip();
        const buf = zip.toBuffer();
        const result = await parsePptx(buf);
        expect(result.pageCount).toBeNull();
        expect(result.rawText).toBe("");
        expect(result.wordCount).toBe(0);
    });

    it("handles slides with empty paragraphs gracefully", async () => {
        const buf = makePptxBuffer([["", "   "]]);
        const result = await parsePptx(buf);
        expect(result.rawText).toBe("");
    });

    it("separates multiple slides with blank lines", async () => {
        const buf = makePptxBuffer([["First slide text"], ["Second slide text"]]);
        const result = await parsePptx(buf);
        expect(result.rawText).toContain("First slide text");
        expect(result.rawText).toContain("Second slide text");
    });

    // ── New: structured slides payload ───────────────────────────────────

    it("emits slides array with correct index and title", async () => {
        const buf = makePptxBuffer([["Intro Title", "Subtitle here"], ["Main Topic"]]);
        const result = await parsePptx(buf);
        expect(result.slides).toBeDefined();
        expect(result.slides!.length).toBe(2);
        expect(result.slides![0]!.index).toBe(1);
        expect(result.slides![0]!.title).toBe("Intro Title");
        expect(result.slides![1]!.title).toBe("Main Topic");
    });

    it("emits slide body containing remaining paragraphs", async () => {
        const buf = makePptxBuffer([["Title", "Point one", "Point two"]]);
        const result = await parsePptx(buf);
        expect(result.slides![0]!.body).toContain("Point one");
        expect(result.slides![0]!.body).toContain("Point two");
    });

    it("returns null title for slide with no text", async () => {
        const zip = new AdmZip();
        zip.addFile("ppt/slides/slide1.xml", Buffer.from(makeSlideXml([""]), "utf-8"));
        const buf = zip.toBuffer();
        const result = await parsePptx(buf);
        expect(result.slides![0]!.title).toBeNull();
    });
});
