import { describe, it, expect, vi } from "vitest";
import { isOleCompoundFile, isZipPackage } from "../LegacyDocParser";

vi.mock("../DocxParser", () => ({
    parseDocx: vi.fn(async () => ({
        rawText: "delegated to mammoth",
        charCount: 21,
        wordCount: 3,
        pageCount: null,
        sectionCount: null,
        parserName: "mammoth",
        parserVersion: "1.9.0",
    })),
}));

describe("LegacyDocParser magic-byte helpers", () => {
    it("identifies an OLE compound file by its magic bytes", () => {
        const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
        expect(isOleCompoundFile(ole)).toBe(true);
        expect(isZipPackage(ole)).toBe(false);
    });

    it("identifies a zip package by its magic bytes", () => {
        const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
        expect(isZipPackage(zip)).toBe(true);
        expect(isOleCompoundFile(zip)).toBe(false);
    });

    it("recognizes neither on an arbitrary buffer", () => {
        const other = Buffer.from("not a document at all");
        expect(isOleCompoundFile(other)).toBe(false);
        expect(isZipPackage(other)).toBe(false);
    });
});

describe("parseLegacyDoc", () => {
    it("delegates a mislabelled .docx (zip magic) to parseDocx", async () => {
        const { parseLegacyDoc } = await import("../LegacyDocParser");
        const zipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
        const result = await parseLegacyDoc(zipBuffer);
        expect(result.parserName).toBe("mammoth");
        expect(result.rawText).toBe("delegated to mammoth");
    });

    it("rejects a buffer that is neither OLE nor zip with an explicit message", async () => {
        const { parseLegacyDoc } = await import("../LegacyDocParser");
        const garbage = Buffer.from("this is not a word document");
        await expect(parseLegacyDoc(garbage)).rejects.toThrow(/Unsupported Word file/);
    });
});
