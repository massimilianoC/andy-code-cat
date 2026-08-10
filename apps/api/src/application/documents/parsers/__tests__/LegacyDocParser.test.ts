import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { isOleCompoundFile, isZipPackage, parseLegacyDoc } from "../LegacyDocParser";

/** A minimal but real OOXML .docx package — verified readable by mammoth.extractRawText(). */
function makeRealDocxBuffer(text: string): Buffer {
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const zip = new AdmZip();
    zip.addFile("[Content_Types].xml", Buffer.from(contentTypes, "utf-8"));
    zip.addFile("_rels/.rels", Buffer.from(rels, "utf-8"));
    zip.addFile("word/document.xml", Buffer.from(documentXml, "utf-8"));
    return zip.toBuffer();
}

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
    it("delegates a mislabelled .docx (zip magic) to the real mammoth parser", async () => {
        const docxBuffer = makeRealDocxBuffer("Text from a real docx mislabelled as application/msword");
        expect(isZipPackage(docxBuffer)).toBe(true);

        const result = await parseLegacyDoc(docxBuffer);

        expect(result.parserName).toBe("mammoth");
        expect(result.rawText).toContain("Text from a real docx mislabelled as application/msword");
    });

    it("rejects a buffer that is neither OLE nor zip with an explicit message", async () => {
        const garbage = Buffer.from("this is not a word document");
        await expect(parseLegacyDoc(garbage)).rejects.toThrow(/Unsupported Word file/);
    });
});
