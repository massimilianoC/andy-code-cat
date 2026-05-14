import type {
    AssetEnrichmentTrace,
    EnrichmentAssetKind,
    EnrichmentProvenance,
    DocumentTextLayer,
    DocumentBrief,
    StructuredDataPayload,
    ImageColorPalette,
    ImageVisualAnalysis,
    ImageDesignSignals,
} from "../../../domain/entities/AssetEnrichmentTrace";
import { CURRENT_TRACE_VERSION } from "../../../domain/entities/AssetEnrichmentTrace";
import type { ProjectAsset } from "../../../domain/entities/ProjectAsset";
import { renderAssetLayerDFragment } from "../../llm/systemPromptLayers";

export interface TraceBuilderInput {
    asset: ProjectAsset;
    assetKind: EnrichmentAssetKind;
    provenance: EnrichmentProvenance;
    textLayer: DocumentTextLayer | null;
    documentBrief: DocumentBrief | null;
    structuredData?: StructuredDataPayload | null;
    colorPalette: ImageColorPalette | null;
    visualAnalysis: ImageVisualAnalysis | null;
    designSignals: ImageDesignSignals | null;
}

export function buildEnrichmentTrace(input: TraceBuilderInput): AssetEnrichmentTrace {
    const { asset, assetKind, provenance, textLayer, documentBrief, structuredData, colorPalette, visualAnalysis, designSignals } = input;

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

    const traceWithoutFragment: AssetEnrichmentTrace = {
        assetId: asset.id,
        projectId: asset.projectId,
        userId: asset.userId,
        assetKind,
        provenance: { ...provenance, traceVersion: CURRENT_TRACE_VERSION },
        textLayer,
        documentBrief,
        structuredData: structuredData ?? null,
        colorPalette,
        visualAnalysis,
        designSignals,
        distilledTitle,
        distilledSummary,
        distilledTags,
        distilledColors,
        renderedFragment: null,
    };

    // Pre-render the Layer D fragment once at build time. This is what every downstream
    // injection point (VibePrefill, OptimizePrompt, God Mode generation) will read,
    // guaranteeing deterministic single-pass analysis of the asset.
    traceWithoutFragment.renderedFragment = renderAssetLayerDFragment(traceWithoutFragment);

    return traceWithoutFragment;
}
