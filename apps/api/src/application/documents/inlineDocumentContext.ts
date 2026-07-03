import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import { getParser } from "./parsers/DocumentParserFactory";

export interface InlineDocumentLayerD {
    /** Renderable Layer D block, or "" when nothing could be extracted. */
    block: string;
    /** Names of documents whose content was inlined (for UI / trace echo). */
    documentNames: string[];
}

/**
 * Live, synchronous Layer D extraction for document assets that do NOT yet have a ready
 * enrichment trace.
 *
 * Enrichment is asynchronous: a freshly-uploaded attachment may not be analysed by the time
 * a generation fires. Without this, Layer D in the *actual sent* prompt would be empty while
 * the prompt-preview panel (recomposed later) shows the now-enriched content — a transparency
 * gap. This closes it by parsing raw text on the spot so the document's content is in the
 * prompt that is really sent.
 *
 * Bounded: only parseable document assets without a ready trace, capped by maxAssets and
 * maxCharsPerDoc. Returns "" when there is nothing pending (cheap fast-path).
 */
export async function extractInlineDocumentLayerD(
    assets: ProjectAsset[],
    storage: IFileStorage,
    opts?: { maxAssets?: number; maxCharsPerDoc?: number },
): Promise<InlineDocumentLayerD> {
    const maxAssets = opts?.maxAssets ?? 3;
    const maxCharsPerDoc = opts?.maxCharsPerDoc ?? 2500;

    const pending = assets
        .filter((a) => {
            const ready = a.enrichmentTrace?.provenance.enrichmentStatus === "ready" && a.enrichmentTrace.renderedFragment;
            return !ready && a.storedFilename && getParser(a.mimeType) !== null;
        })
        .slice(0, maxAssets);

    if (pending.length === 0) return { block: "", documentNames: [] };

    const names: string[] = [];
    const results = await Promise.allSettled(
        pending.map(async (asset) => {
            const parser = getParser(asset.mimeType)!;
            const filePath = storage.uploadFilePath(asset.userId, asset.projectId, asset.storedFilename!);
            const stream = await storage.createReadStream(filePath);
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
                stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)));
                stream.on("end", resolve);
                stream.on("error", reject);
            });
            const parsed = await parser.parse(Buffer.concat(chunks), asset.mimeType);
            const snippet = parsed.rawText.slice(0, maxCharsPerDoc).trim();
            if (!snippet) return null;
            names.push(asset.originalName);
            return `--- ${asset.originalName} ---\n${snippet}`;
        }),
    );

    const blocks = results
        .filter((r): r is PromiseFulfilledResult<string | null> => r.status === "fulfilled")
        .map((r) => r.value)
        .filter((s): s is string => s !== null && s.length > 0);

    if (blocks.length === 0) return { block: "", documentNames: [] };

    const block =
        "## LAYER D — DOCUMENT CONTEXT (live extract)\n\n" +
        "These materials were attached but their full analysis is still in progress. " +
        "Raw extracts are provided so you can use their content now. " +
        "Synthesize them into the output; do not reproduce verbatim.\n\n" +
        blocks.join("\n\n");

    return { block, documentNames: names };
}
