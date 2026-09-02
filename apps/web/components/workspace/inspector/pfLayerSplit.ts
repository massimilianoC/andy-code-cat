/**
 * Splits a rendered system prompt into the layers it is made of, using the PF_LAYER markers the
 * server already wraps every layer in (see apps/api/src/application/llm/systemPromptComposer.ts,
 * `wrapWithMarker` / `composeSystemPromptWithLayers`):
 *
 *   <!-- PF_LAYER id=X key=Y -->
 *   ...content...
 *   <!-- /PF_LAYER id=X -->
 *
 * This is NOT a new prompt format — it is a reader for the one the server already writes and
 * verifies byte-for-byte via `assertPromptTraceParity` before dispatch (SESSION_INSPECTOR_SPEC.md
 * §3, §5.3). The spans this module returns are marker-inclusive, exactly like the server's own
 * `PromptLayerTraceEntry.span`.
 *
 * Layers are joined by a fixed separator ("\n\n---\n\n" server-side) that belongs to no layer.
 * `splitPfLayers` accounts for that text too — and for any stray text before the first marker or
 * after the last — as "gap" segments, so the full segmentation always reconstructs the original
 * string exactly. That is what SESSION_INSPECTOR_SPEC.md §6.5 asks a test to prove: the layer
 * spans (plus the gaps between them) sum to the whole prompt with nothing dropped.
 */

export interface PfLayerSegment {
    kind: "layer";
    id: string;
    key: string;
    /** Human-readable label derived from `key` — cosmetic only, the server's exact descriptor
     * labels are not exposed to the client and are not needed to prove byte-parity. */
    label: string;
    /** [start, end) into the full text, marker-inclusive. */
    span: [number, number];
    /** Length of the content between the markers (excludes the markers themselves). */
    chars: number;
    /** The layer's inner content, excluding the open/close markers. */
    content: string;
}

export interface PfGapSegment {
    kind: "gap";
    span: [number, number];
    text: string;
}

export type PfSegment = PfLayerSegment | PfGapSegment;

const PF_LAYER_PATTERN = /<!-- PF_LAYER id=(\S+) key=(\S+) -->\n([\s\S]*?)\n<!-- \/PF_LAYER id=\1 -->/g;

function humanizeKey(key: string): string {
    return key
        .split("-")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

/** Splits `fullText` into layer and gap segments, in order, covering the entire string. */
export function splitPfLayers(fullText: string): PfSegment[] {
    if (!fullText) return [];

    const segments: PfSegment[] = [];
    let cursor = 0;
    const pattern = new RegExp(PF_LAYER_PATTERN.source, "g");

    for (let match = pattern.exec(fullText); match; match = pattern.exec(fullText)) {
        if (match.index > cursor) {
            segments.push({ kind: "gap", span: [cursor, match.index], text: fullText.slice(cursor, match.index) });
        }
        const id = match[1] ?? "";
        const key = match[2] ?? "";
        const content = match[3] ?? "";
        const end = match.index + match[0].length;
        segments.push({
            kind: "layer",
            id,
            key,
            label: humanizeKey(key) || id,
            span: [match.index, end],
            chars: content.length,
            content,
        });
        cursor = end;
    }

    if (cursor < fullText.length) {
        segments.push({ kind: "gap", span: [cursor, fullText.length], text: fullText.slice(cursor) });
    }

    return segments;
}

/** The layer segments only, in composition order — what the UI renders as accordion rows. */
export function pfLayersOnly(segments: PfSegment[]): PfLayerSegment[] {
    return segments.filter((segment): segment is PfLayerSegment => segment.kind === "layer");
}

/**
 * True when `segments` reconstruct `fullText` exactly: spans are contiguous from 0 to
 * fullText.length with no gaps or overlaps, and concatenating every segment's text reproduces
 * the original string byte-for-byte. This is the acceptance §6.5 assertion.
 */
export function segmentsCoverText(segments: PfSegment[], fullText: string): boolean {
    let cursor = 0;
    for (const segment of segments) {
        if (segment.span[0] !== cursor || segment.span[1] < segment.span[0]) return false;
        cursor = segment.span[1];
    }
    if (cursor !== fullText.length) return false;

    const reconstructed = segments
        .map((segment) => (segment.kind === "layer" ? fullText.slice(segment.span[0], segment.span[1]) : segment.text))
        .join("");
    return reconstructed === fullText;
}
