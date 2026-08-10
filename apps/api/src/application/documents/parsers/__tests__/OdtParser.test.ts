import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { parseOdt } from "../OdtParser";

function makeOdtBuffer(headings: string[], paragraphs: string[]): Buffer {
    const zip = new AdmZip();
    zip.addFile("mimetype", Buffer.from("application/vnd.oasis.opendocument.text"));
    zip.addFile("content.xml", Buffer.from(`<?xml version="1.0"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
                         xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:text>
    ${headings.map(h => `<text:h>${h}</text:h>`).join("")}
    ${paragraphs.map(p => `<text:p>${p}</text:p>`).join("")}
  </office:text></office:body>
</office:document-content>`, "utf-8"));
    return zip.toBuffer();
}

describe("OdtParser", () => {
    it("extracts heading and paragraph text in document order", async () => {
        const buf = makeOdtBuffer(["Title Here"], ["First paragraph.", "Second paragraph."]);
        const result = await parseOdt(buf);
        expect(result.rawText).toContain("Title Here");
        expect(result.rawText).toContain("First paragraph.");
        expect(result.rawText).toContain("Second paragraph.");
        expect(result.rawText.indexOf("Title Here")).toBeLessThan(result.rawText.indexOf("First paragraph."));
    });

    it("counts text:h elements as sectionCount", async () => {
        const buf = makeOdtBuffer(["H1", "H2"], ["Body text."]);
        const result = await parseOdt(buf);
        expect(result.sectionCount).toBe(2);
    });

    it("falls back to paragraph count when there are no headings", async () => {
        const buf = makeOdtBuffer([], ["Para A", "Para B", "Para C"]);
        const result = await parseOdt(buf);
        expect(result.sectionCount).toBe(3);
    });

    it("returns empty result for an empty zip / missing content.xml", async () => {
        const zip = new AdmZip();
        const result = await parseOdt(zip.toBuffer());
        expect(result.rawText).toBe("");
        expect(result.wordCount).toBe(0);
        expect(result.sectionCount).toBeNull();
    });

    it("reports parserName odt-parser", async () => {
        const buf = makeOdtBuffer(["Title"], ["Body"]);
        const result = await parseOdt(buf);
        expect(result.parserName).toBe("odt-parser");
    });
});
