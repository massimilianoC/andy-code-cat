import { describe, expect, it } from "vitest";
import { parseStructuredData } from "../StructuredDataParser";

function parseXml(xml: string) {
    return parseStructuredData(Buffer.from(xml, "utf8"), "application/xml");
}

function textExcerpt(rawText: string): string {
    const start = rawText.indexOf("[Text content excerpt]");
    const end = rawText.indexOf("[Raw excerpt]");
    return rawText.slice(start, end);
}

describe("parseStructuredData XML script/style stripping", () => {
    it("strips a plain <script>...</script> block", () => {
        const result = parseXml("<root><script>alert(1)</script><name>ok</name></root>");
        expect(textExcerpt(result.rawText)).not.toContain("alert(1)");
        expect(textExcerpt(result.rawText)).toContain("ok");
    });

    it("strips <style>...</style> blocks", () => {
        const result = parseXml("<root><style>body{color:red}</style><name>ok</name></root>");
        expect(textExcerpt(result.rawText)).not.toContain("color:red");
    });

    it("strips script blocks with a closing tag that has trailing junk before '>'", () => {
        const result = parseXml('<root><script>alert(1)</script foo="bar">ok</root>');
        expect(textExcerpt(result.rawText)).not.toContain("alert(1)");
    });

    it("leaves an unterminated <script> block's text untouched (no closing tag anywhere)", () => {
        const result = parseXml("<root><script>alert(1)<name>ok</name></root>");
        expect(textExcerpt(result.rawText)).toContain("alert(1)");
        expect(textExcerpt(result.rawText)).toContain("ok");
    });

    it("terminates quickly on the CodeQL adversarial pattern", () => {
        const payload = `<root>${"<script</script".repeat(200_000)}</root>`;
        const start = Date.now();
        const result = parseXml(payload);
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result.rawText.length).toBeGreaterThan(0);
    });
});
