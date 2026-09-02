import { describe, it, expect } from "vitest";
import { splitPfLayers, pfLayersOnly, segmentsCoverText } from "../pfLayerSplit";

const LAYER_SEPARATOR = "\n\n---\n\n";

/** Mirrors apps/api/src/application/llm/systemPromptComposer.ts wrapWithMarker exactly. */
function wrap(id: string, key: string, content: string): string {
    return [`<!-- PF_LAYER id=${id} key=${key} -->`, content, `<!-- /PF_LAYER id=${id} -->`].join("\n");
}

describe("splitPfLayers", () => {
    it("splits a composed prompt into its layers in order", () => {
        const full = [
            wrap("A", "base-constraints", "Always follow the base rules."),
            wrap("L", "output-language", "Respond in Italian."),
            wrap("G", "brand-identity", "Brand: Acme Bakery."),
        ].join(LAYER_SEPARATOR);

        const segments = splitPfLayers(full);
        const layers = pfLayersOnly(segments);

        expect(layers.map((l) => l.id)).toEqual(["A", "L", "G"]);
        expect(layers.map((l) => l.key)).toEqual(["base-constraints", "output-language", "brand-identity"]);
        expect(layers[0]!.content).toBe("Always follow the base rules.");
        expect(layers[1]!.content).toBe("Respond in Italian.");
        expect(layers[2]!.content).toBe("Brand: Acme Bakery.");
        expect(layers[0]!.chars).toBe("Always follow the base rules.".length);
    });

    it("spans are byte-identical slices of the original text (marker-inclusive)", () => {
        const full = [wrap("A", "base-constraints", "Rule one.\nRule two."), wrap("V", "service-contract", "Contract text.")].join(
            LAYER_SEPARATOR,
        );
        const segments = splitPfLayers(full);
        for (const segment of segments) {
            const slice = full.slice(segment.span[0], segment.span[1]);
            if (segment.kind === "layer") {
                expect(slice).toBe(wrap(segment.id, segment.key, segment.content));
            } else {
                expect(slice).toBe(segment.text);
            }
        }
    });

    // SESSION_INSPECTOR_SPEC.md §6.5: "the sum of the layer spans is the whole prompt with
    // nothing dropped" — proven here by reconstructing the exact original string from the full
    // segmentation (layers + the gaps between/around them).
    it("segments (layers + gaps) reconstruct the whole prompt with nothing dropped", () => {
        const full = [
            wrap("A", "base-constraints", "Base."),
            wrap("L", "output-language", "Italian."),
            wrap("B", "preset-format", "Format rules."),
        ].join(LAYER_SEPARATOR);

        const segments = splitPfLayers(full);
        expect(segmentsCoverText(segments, full)).toBe(true);
        expect(segments.map((s) => (s.kind === "layer" ? full.slice(...s.span) : s.text)).join("")).toBe(full);
    });

    it("accounts for stray text before the first marker and after the last as gaps", () => {
        const full = `PREAMBLE\n${wrap("A", "base-constraints", "Base.")}\nTRAILER`;
        const segments = splitPfLayers(full);
        expect(segments[0]).toMatchObject({ kind: "gap", text: "PREAMBLE\n" });
        expect(segments[segments.length - 1]).toMatchObject({ kind: "gap", text: "\nTRAILER" });
        expect(segmentsCoverText(segments, full)).toBe(true);
    });

    it("a prompt with no PF_LAYER markers at all is a single gap segment covering everything", () => {
        const full = "Plain legacy system prompt, no markers.";
        const segments = splitPfLayers(full);
        expect(segments).toEqual([{ kind: "gap", span: [0, full.length], text: full }]);
        expect(segmentsCoverText(segments, full)).toBe(true);
    });

    it("empty string yields no segments and trivially covers itself", () => {
        expect(splitPfLayers("")).toEqual([]);
        expect(segmentsCoverText([], "")).toBe(true);
    });

    it("does not confuse two layers with similar keys — content stops at the matching close marker", () => {
        const full = [wrap("A", "base-constraints", "First layer body."), wrap("B", "base-constraints-extra", "Second layer body.")].join(
            LAYER_SEPARATOR,
        );
        const layers = pfLayersOnly(splitPfLayers(full));
        expect(layers).toHaveLength(2);
        expect(layers[0]!.content).toBe("First layer body.");
        expect(layers[1]!.content).toBe("Second layer body.");
    });

    it("segmentsCoverText detects a dropped character (regression guard)", () => {
        const full = wrap("A", "base-constraints", "Some content.");
        const segments = splitPfLayers(full);
        expect(segmentsCoverText(segments, full)).toBe(true);
        // Corrupt just the reference text — segments no longer reconstruct it.
        expect(segmentsCoverText(segments, `${full}EXTRA`)).toBe(false);
    });
});
