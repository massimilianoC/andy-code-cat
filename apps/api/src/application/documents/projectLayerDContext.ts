import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import { buildProjectKnowledgeLayer } from "../llm/systemPromptLayers";
import { extractInlineDocumentLayerD } from "./inlineDocumentContext";
import { getParser } from "./parsers/DocumentParserFactory";

const PENDING_POLL_INTERVAL_MS = 1_500;

export const PROJECT_LAYER_D_WAIT_FOR_PENDING_MS = 120_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPotentiallyEnrichable(asset: ProjectAsset): boolean {
    if (!asset.storedFilename) return false;
    if (getParser(asset.mimeType) !== null) return true;
    return asset.mimeType.toLowerCase().startsWith("image/");
}

/**
 * Whether enrichment for this asset is genuinely in flight, i.e. worth blocking a request for.
 *
 * Only `AssetEnrichmentPipeline` writes "pending", and only once it has actually started work, so
 * a trace-less asset is either (a) uploaded moments ago, with the pipeline about to stamp it, or
 * (b) never scheduled at all and never will be. Case (b) is the common one — every image the media
 * pipeline generates during a run lands with no trace — and treating it as pending burned the
 * entire PROJECT_LAYER_D_WAIT_FOR_PENDING_MS budget on EVERY subsequent request, which is why a
 * project with generated images sat on "CONNESSIONE AL PROVIDER…" for two minutes before the
 * provider was contacted at all.
 *
 * The grace window separates the two: long enough to cover the upload -> pipeline handoff, short
 * enough that a permanently trace-less asset costs nothing.
 */
const ENRICHMENT_SCHEDULING_GRACE_MS = 15_000;

function isPendingLayerDAsset(asset: ProjectAsset, now: number): boolean {
    if (!isPotentiallyEnrichable(asset)) return false;
    const status = asset.enrichmentTrace?.provenance.enrichmentStatus;
    if (status) return status === "pending";
    return now - asset.createdAt.getTime() < ENRICHMENT_SCHEDULING_GRACE_MS;
}

async function waitForLayerDAssets(input: {
    assetRepository: ProjectAssetRepository;
    projectId: string;
    userId: string;
    assets: ProjectAsset[];
    waitForPendingMs: number;
}): Promise<ProjectAsset[]> {
    const deadline = Date.now() + Math.max(0, input.waitForPendingMs);
    let assets = input.assets;

    for (;;) {
        const pending = assets.filter((asset) => isPendingLayerDAsset(asset, Date.now()));
        if (pending.length === 0 || Date.now() >= deadline) return assets;

        await sleep(Math.min(PENDING_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
        const latest = await input.assetRepository.listByProject(input.projectId, input.userId).catch(() => []);
        const latestById = new Map(latest.map((asset) => [asset.id, asset]));
        assets = assets.map((asset) => latestById.get(asset.id) ?? asset);
    }
}

export async function buildProjectLayerDContext(input: {
    assetRepository: ProjectAssetRepository;
    storage: IFileStorage;
    projectId: string;
    userId: string;
    assets: ProjectAsset[];
    maxChars: number;
    maxAssets: number;
    fallbackInlineExtractionMaxAssets: number;
    waitForPendingMs?: number;
    includeUnenrichedAssets?: boolean;
    includeStructuredDataAppendix?: boolean;
}): Promise<{ layer: string; assets: ProjectAsset[]; documentNames: string[] }> {
    const assets = await waitForLayerDAssets({
        assetRepository: input.assetRepository,
        projectId: input.projectId,
        userId: input.userId,
        assets: input.assets,
        waitForPendingMs: input.waitForPendingMs ?? PROJECT_LAYER_D_WAIT_FOR_PENDING_MS,
    });

    const enrichedLayer = buildProjectKnowledgeLayer(assets, {
        includeUnenrichedAssets: input.includeUnenrichedAssets,
        includeStructuredDataAppendix: input.includeStructuredDataAppendix,
        maxChars: input.maxChars,
        maxAssets: input.maxAssets,
    });
    const inlineDocBudget = Math.max(0, input.maxChars - enrichedLayer.length);
    const inlineDoc = inlineDocBudget > 500
        ? await extractInlineDocumentLayerD(assets, input.storage, {
            maxAssets: input.fallbackInlineExtractionMaxAssets,
            maxCharsPerDoc: Math.min(2500, inlineDocBudget),
        }).catch(() => ({ block: "", documentNames: [] }))
        : { block: "", documentNames: [] };

    const enrichedNames = assets
        .filter((asset) => asset.enrichmentTrace?.provenance.enrichmentStatus === "ready" && asset.originalName)
        .slice(0, input.maxAssets)
        .map((asset) => asset.originalName);
    const documentNames = [...new Set([...enrichedNames, ...inlineDoc.documentNames])];

    return {
        layer: [enrichedLayer, inlineDoc.block].filter(Boolean).join("\n\n"),
        assets,
        documentNames,
    };
}
