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

function isPendingLayerDAsset(asset: ProjectAsset): boolean {
    if (!isPotentiallyEnrichable(asset)) return false;
    const status = asset.enrichmentTrace?.provenance.enrichmentStatus;
    return !status || status === "pending";
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
        const pending = assets.filter(isPendingLayerDAsset);
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
