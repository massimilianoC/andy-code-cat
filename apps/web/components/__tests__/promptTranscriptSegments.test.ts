import { describe, expect, it } from "vitest";
import { splitIntoSegments } from "../promptTranscriptSegments";

describe("splitIntoSegments", () => {
    it("keeps a plain conversational turn as a single prose segment", () => {
        const segments = splitIntoSegments("vedo solo immagini, vorrei anche del testo con buon contrasto");

        expect(segments).toHaveLength(1);
        expect(segments[0]?.kind).toBe("prose");
    });

    it("extracts a fenced block and records its language", () => {
        const segments = splitIntoSegments("Ecco il risultato:\n```html\n<div>ciao</div>\n```\nFine.");

        expect(segments.map((segment) => segment.kind)).toEqual(["prose", "code", "prose"]);
        expect(segments[1]).toMatchObject({ kind: "code", lang: "html" });
        expect(segments[1]?.text).toContain("<div>ciao</div>");
    });

    it("folds unfenced generated markup — the case that buried the panel", () => {
        const markup = [
            "Ho aggiornato la slide.",
            "<section class=\"slide\">",
            "  <h1>Titolo</h1>",
            "  <p>Testo</p>",
            "</section>",
        ].join("\n");

        const segments = splitIntoSegments(markup);

        expect(segments.some((segment) => segment.kind === "code")).toBe(true);
        const code = segments.find((segment) => segment.kind === "code");
        expect(code?.text).toContain("<section");
        expect(code?.text).not.toContain("Ho aggiornato la slide.");
    });

    it("leaves a lone tag inside prose alone — folding it would hide more than it shows", () => {
        const segments = splitIntoSegments("Usa <strong> per enfatizzare il titolo principale.");

        expect(segments).toHaveLength(1);
        expect(segments[0]?.kind).toBe("prose");
    });

    it("drops empty segments so the UI never renders blank islands", () => {
        const segments = splitIntoSegments("\n\n```css\n.a{color:red}\n```\n\n   \n");

        expect(segments).toHaveLength(1);
        expect(segments[0]?.kind).toBe("code");
    });

    it("handles several fenced blocks in one turn", () => {
        const segments = splitIntoSegments("uno\n```js\nconst a = 1;\n```\ndue\n```css\n.b{}\n```\ntre");

        expect(segments.filter((segment) => segment.kind === "code")).toHaveLength(2);
        expect(segments.filter((segment) => segment.kind === "prose")).toHaveLength(3);
    });

    it("returns nothing for empty content", () => {
        expect(splitIntoSegments("")).toEqual([]);
        expect(splitIntoSegments("   \n  ")).toEqual([]);
    });
});
