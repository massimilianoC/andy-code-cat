import { describe, expect, it } from "vitest";
import { reversePreviewAssetReplacements } from "../resolvePreviewAssetUrls";

describe("reversePreviewAssetReplacements — AL-009", () => {
    it("round-trips an exact single replacement back to the original URL", () => {
        const original = "/v1/projects/p1/assets/a1/download";
        const dataUrl = "data:image/png;base64,AAAA";
        const replacements = new Map([[original, dataUrl]]);
        const html = `<img src="${dataUrl}">`;

        expect(reversePreviewAssetReplacements(html, replacements)).toBe(`<img src="${original}">`);
    });

    it("reverses longest data URI first so a shorter one cannot partially match inside a longer one", () => {
        // Two data URIs where the shorter is a byte-for-byte prefix of the longer — the exact
        // shape that would corrupt the longer image if replacement order were not enforced.
        const shortDataUrl = "data:image/png;base64,AAAA";
        const longDataUrl = "data:image/png;base64,AAAABBBB";
        const replacements = new Map([
            ["/v1/projects/p1/assets/short/download", shortDataUrl],
            ["/v1/projects/p1/assets/long/download", longDataUrl],
        ]);
        const html = `<img id="short" src="${shortDataUrl}"><img id="long" src="${longDataUrl}">`;

        const result = reversePreviewAssetReplacements(html, replacements);

        expect(result).toBe(
            '<img id="short" src="/v1/projects/p1/assets/short/download">'
            + '<img id="long" src="/v1/projects/p1/assets/long/download">'
        );
    });

    it("leaves a data URI untouched when it is not in the replacements map", () => {
        // The model may legitimately author its own data URI (e.g. an inline SVG or a
        // generated placeholder). AL-009 only forbids the ones the preview pipeline injected.
        const modelAuthoredDataUrl = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
        const replacements = new Map([
            ["/v1/projects/p1/assets/a1/download", "data:image/png;base64,ZZZZ"],
        ]);
        const html = `<img src="${modelAuthoredDataUrl}">`;

        expect(reversePreviewAssetReplacements(html, replacements)).toBe(html);
    });

    it("reverses multiple distinct replacements independently", () => {
        const replacements = new Map([
            ["/v1/projects/p1/assets/a1/download", "data:image/png;base64,ONE"],
            ["/v1/projects/p1/assets/a2/download", "data:image/png;base64,TWO"],
        ]);
        const html = '<img src="data:image/png;base64,ONE"><img src="data:image/png;base64,TWO">';

        expect(reversePreviewAssetReplacements(html, replacements)).toBe(
            '<img src="/v1/projects/p1/assets/a1/download"><img src="/v1/projects/p1/assets/a2/download">'
        );
    });

    it("is a no-op on empty html or an empty replacements map", () => {
        expect(reversePreviewAssetReplacements("", new Map([["a", "b"]]))).toBe("");
        expect(reversePreviewAssetReplacements("<p>hi</p>", new Map())).toBe("<p>hi</p>");
    });
});
