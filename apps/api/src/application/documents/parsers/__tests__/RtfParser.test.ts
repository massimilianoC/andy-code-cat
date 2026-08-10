import { describe, it, expect } from "vitest";
import { parseRtf } from "../RtfParser";

describe("RtfParser", () => {
    it("extracts text from a minimal document", async () => {
        const rtf = "{\\rtf1\\ansi\\b hi there\\b0\\par second line\\par}";
        const result = await parseRtf(Buffer.from(rtf, "latin1"));
        expect(result.rawText).toContain("hi there");
        expect(result.rawText).toContain("second line");
    });

    it("decodes \\'xx codepage escapes", async () => {
        // \'e9 is "é" in cp1252 — real Word-generated RTF always declares \ansicpg explicitly.
        const rtf = "{\\rtf1\\ansi\\ansicpg1252 Caf\\'e9\\par}";
        const result = await parseRtf(Buffer.from(rtf, "latin1"));
        expect(result.rawText).toContain("Café");
    });

    it("drops fonttbl/colortbl control groups from the output", async () => {
        const rtf = "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;} Visible text\\par}";
        const result = await parseRtf(Buffer.from(rtf, "latin1"));
        expect(result.rawText).not.toContain("fonttbl");
        expect(result.rawText).not.toContain("colortbl");
        expect(result.rawText).toContain("Visible text");
    });

    it("returns a non-throwing result for a non-RTF buffer", async () => {
        const result = await parseRtf(Buffer.from("just plain text, not rtf at all", "utf-8"));
        expect(result.parserName).toBe("rtf-parser");
        expect(typeof result.rawText).toBe("string");
    });

    it("reports parserName rtf-parser", async () => {
        const rtf = "{\\rtf1\\ansi hello\\par}";
        const result = await parseRtf(Buffer.from(rtf, "latin1"));
        expect(result.parserName).toBe("rtf-parser");
    });
});
