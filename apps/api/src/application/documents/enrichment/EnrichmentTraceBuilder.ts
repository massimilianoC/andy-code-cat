import type {
    AssetEnrichmentTrace,
    EnrichmentAssetKind,
    EnrichmentProvenance,
    DocumentTextLayer,
    DocumentBrief,
    ImageColorPalette,
    ImageVisualAnalysis,
    ImageDesignSignals,
} from "../../../domain/entities/AssetEnrichmentTrace";
import { CURRENT_TRACE_VERSION } from "../../../domain/entities/AssetEnrichmentTrace";
import type { ProjectAsset } from "../../../domain/entities/ProjectAsset";

export interface TraceBuilderInput {
    asset: ProjectAsset;
    assetKind: EnrichmentAssetKind;
    provenance: EnrichmentProvenance;
    textLayer: DocumentTextLayer | null;
    documentBrief: DocumentBrief | null;
    colorPalette: ImageColorPalette | null;
    visualAnalysis: ImageVisualAnalysis | null;
    designSignals: ImageDesignSignals | null;
}

export function buildEnrichmentTrace(input: TraceBuilderInput): AssetEnrichmentTrace {
    const { asset, assetKind, provenance, textLayer, documentBrief, colorPalette, visualAnalysis, designSignals } = input;

    // Distilled title: prefer detected title, then label, then originalName
    const distilledTitle =
        documentBrief?.detectedTitle
        ?? asset.label
        ?? asset.originalName;

    // Distilled summary: brief purpose or visual scene
    const distilledSummary = (
        documentBrief?.purposeSentence
        ?? visualAnalysis?.sceneDescription
        ?? asset.descriptionText
        ?? ""
    ).slice(0, 300);

    // Tags: merge brief topics + visual themes + style role
    const rawTags = [
        ...(documentBrief?.primaryTopics ?? []),
        ...(visualAnalysis?.detectedThemes ?? []),
        ...(asset.styleRole ? [asset.styleRole] : []),
        ...(documentBrief?.toneLabel ? [documentBrief.toneLabel] : []),
    ];
    const distilledTags = [...new Set(rawTags)].slice(0, 10);

    // Colors: prefer normalized palette color names
    const distilledColors = (colorPalette?.dominantNames ?? []).slice(0, 5);

    return {
        assetId: asset.id,
        projectId: asset.projectId,
        userId: asset.userId,
        assetKind,
        provenance: { ...provenance, traceVersion: CURRENT_TRACE_VERSION },
        textLayer,
        documentBrief,
        colorPalette,
        visualAnalysis,
        designSignals,
        distilledTitle,
        distilledSummary,
        distilledTags,
        distilledColors,
    };
}
