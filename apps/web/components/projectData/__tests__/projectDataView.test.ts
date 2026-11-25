import { describe, it, expect } from "vitest";
import { pageCount, previewOfData, prettyJson, visibleRange } from "../projectDataView";

describe("project data panel view helpers", () => {
    it("previews a record on one line, nested values as JSON, cut to the limit", () => {
        expect(previewOfData({ player: "ANA", score: 10 })).toBe("player: ANA · score: 10");
        expect(previewOfData({ message: "two\nlines   here", meta: { a: 1 }, empty: null })).toBe("message: two lines here · meta: {\"a\":1} · empty: —");
        const long = previewOfData({ text: "x".repeat(500) }, 20);
        expect(long).toHaveLength(20);
        expect(long.endsWith("…")).toBe(true);
        expect(previewOfData({})).toBe("");
    });

    it("counts pages and the visible range", () => {
        expect(pageCount(0, 25)).toBe(1);
        expect(pageCount(25, 25)).toBe(1);
        expect(pageCount(26, 25)).toBe(2);
        expect(visibleRange(1, 25, 0)).toEqual({ from: 0, to: 0 });
        expect(visibleRange(1, 25, 7)).toEqual({ from: 1, to: 7 });
        expect(visibleRange(2, 25, 60)).toEqual({ from: 26, to: 50 });
        expect(visibleRange(3, 25, 60)).toEqual({ from: 51, to: 60 });
    });

    it("pretty-prints JSON with two spaces", () => {
        expect(prettyJson({ a: [1] })).toBe("{\n  \"a\": [\n    1\n  ]\n}");
    });
});
