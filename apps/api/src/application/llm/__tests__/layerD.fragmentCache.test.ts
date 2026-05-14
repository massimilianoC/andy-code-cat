import { describe, it, expect, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        enrichmentInjectLayerD: true,
        ENRICHMENT_LAYER_D_MAX_CHARS: 50_000,
        ENRICHMENT_LAYER_D_MAX_ASSETS: 10,
    },
}));

import { buildProjectKnowledgeLayer, renderAssetLayerDFragment } from "../systemPromptLayers";
import { buildEnrichmentTrace } from "../../documents/enrichment/EnrichmentTraceBuilder";
import type { ProjectAsset } from "../../../domain/entities/ProjectAsset";
import type { AssetEnrichmentTrace } from "../../../domain/entities/AssetEnrichmentTrace";

function makeAsset(trace: AssetEnrichmentTrace | null): ProjectAsset {
    return {
        id: trace?.assetId ?? "asset-1",
        projectId: "proj-1",
        userId: "user-1",
        originalName: "report.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileSize: 4096,
        source: "upload",
        scope: "project",
        storedFilename: "report.xlsx",
        label: null,
        useInProject: true,
        styleRole: undefined,
        descriptionText: null,
        externalUrl: null,
        generationStatus: null,
        generationPrompt: null,
        generationMetadata: null,
        semanticMetadata: null,
        createdAt: new Date(),
        enrichmentTrace: trace,
    } as unknown as ProjectAsset;
}

describe("Layer D fragment cache — deterministic single-pass analysis", () => {
    it("buildEnrichmentTrace populates renderedFragment", () => {
        const trace = buildEnrichmentTrace({
            asset: {
                id: "a1",
                projectId: "p1",
                userId: "u1",
                originalName: "test.pdf",
                label: null,
                styleRole: undefined,
                descriptionText: null,
            } as unknown as ProjectAsset,
            assetKind: "pdf",
            provenance: {
                traceVersion: 2,
                enrichmentStatus: "ready",
                enrichedAt: new Date(),
                processingMs: 100,
                parserName: "pdf-parse",
                parserVersion: "1.0.0",
                llmProvider: "siliconflow",
                llmModel: "test-model",
                llmTokensUsed: 200,
                llmCostEur: 0.001,
                errorMessage: null,
            },
            textLayer: {
                wordCount: 50,
                charCount: 300,
                languageHint: "en",
                pageCount: 1,
                sectionCount: 1,
                extractedTextSnippet: "Sample content here.",
                fullTextStored: false,
            },
            documentBrief: {
                documentType: "specification",
                detectedTitle: "Sample Spec",
                detectedBrandName: "Acme",
                purposeSentence: "Defines the product spec.",
                contentSummary: "Describes the product and its features.",
                mainArgumentOrValue: "Quality matters.",
                structureSummary: null,
                keyMessages: ["msg1", "msg2"],
                toneLabel: "professional",
                targetAudience: "engineers",
                ctaText: null,
                primaryTopics: ["spec", "product"],
                contentLanguage: "en",
                suggestedStyleRole: "material",
            },
            colorPalette: null,
            visualAnalysis: null,
            designSignals: null,
        });

        expect(trace.renderedFragment).toBeTruthy();
        expect(trace.renderedFragment).toContain("Asset: Sample Spec");
        expect(trace.renderedFragment).toContain("Brand: Acme");
        expect(trace.renderedFragment).toContain("Purpose: Defines the product spec.");
    });

    it("rendered fragment is deterministic — same trace → same output", () => {
        const baseTrace: AssetEnrichmentTrace = {
            assetId: "a1",
            projectId: "p1",
            userId: "u1",
            assetKind: "xlsx",
            provenance: {
                traceVersion: 2,
                enrichmentStatus: "ready",
                enrichedAt: new Date(0),
                processingMs: 100,
                parserName: "xlsx-sheetjs",
                parserVersion: "1.1.0",
                llmProvider: null,
                llmModel: null,
                llmTokensUsed: null,
                llmCostEur: null,
                errorMessage: null,
            },
            textLayer: null,
            documentBrief: null,
            structuredData: null,
            colorPalette: null,
            visualAnalysis: null,
            designSignals: null,
            distilledTitle: "T",
            distilledSummary: "S",
            distilledTags: ["x"],
            distilledColors: [],
            renderedFragment: null,
        };

        const first = renderAssetLayerDFragment(baseTrace);
        const second = renderAssetLayerDFragment(baseTrace);
        const third = renderAssetLayerDFragment(baseTrace);
        expect(first).toBe(second);
        expect(second).toBe(third);
    });

    it("buildProjectKnowledgeLayer uses cached fragment when present (single-pass)", () => {
        const cachedFragment = "---\nAsset: CACHED VERSION\nType: xlsx\n---";
        const trace: AssetEnrichmentTrace = {
            assetId: "a1",
            projectId: "p1",
            userId: "u1",
            assetKind: "xlsx",
            provenance: {
                traceVersion: 2,
                enrichmentStatus: "ready",
                enrichedAt: new Date(),
                processingMs: 100,
                parserName: "xlsx-sheetjs",
                parserVersion: "1.1.0",
                llmProvider: null,
                llmModel: null,
                llmTokensUsed: null,
                llmCostEur: null,
                errorMessage: null,
            },
            textLayer: null,
            documentBrief: null,
            structuredData: null,
            colorPalette: null,
            visualAnalysis: null,
            designSignals: null,
            distilledTitle: "Live render title",
            distilledSummary: "",
            distilledTags: [],
            distilledColors: [],
            renderedFragment: cachedFragment,
        };

        const layerD = buildProjectKnowledgeLayer([makeAsset(trace)]);
        expect(layerD).toContain("CACHED VERSION");
        expect(layerD).not.toContain("Live render title");
    });

    it("buildProjectKnowledgeLayer falls back to on-the-fly render for legacy traces (no cache)", () => {
        const trace: AssetEnrichmentTrace = {
            assetId: "a1",
            projectId: "p1",
            userId: "u1",
            assetKind: "pdf",
            provenance: {
                traceVersion: 1,
                enrichmentStatus: "ready",
                enrichedAt: new Date(),
                processingMs: 100,
                parserName: "pdf-parse",
                parserVersion: "1.0.0",
                llmProvider: null,
                llmModel: null,
                llmTokensUsed: null,
                llmCostEur: null,
                errorMessage: null,
            },
            textLayer: null,
            documentBrief: null,
            structuredData: null,
            colorPalette: null,
            visualAnalysis: null,
            designSignals: null,
            distilledTitle: "Legacy Asset",
            distilledSummary: "summary",
            distilledTags: [],
            distilledColors: [],
            renderedFragment: null,
        };

        const layerD = buildProjectKnowledgeLayer([makeAsset(trace)]);
        expect(layerD).toContain("Legacy Asset");
        expect(layerD).toContain("LAYER D");
    });

    it("fragment respects per-asset maxChars budget", () => {
        const longCsv = "a,b,c\n" + "1,2,3\n".repeat(5000);
        const trace: AssetEnrichmentTrace = {
            assetId: "a1",
            projectId: "p1",
            userId: "u1",
            assetKind: "xlsx",
            provenance: {
                traceVersion: 2,
                enrichmentStatus: "ready",
                enrichedAt: new Date(),
                processingMs: 100,
                parserName: "xlsx-sheetjs",
                parserVersion: "1.1.0",
                llmProvider: null,
                llmModel: null,
                llmTokensUsed: null,
                llmCostEur: null,
                errorMessage: null,
            },
            textLayer: null,
            documentBrief: null,
            structuredData: {
                kind: "spreadsheet",
                sheets: [
                    {
                        name: "Data",
                        rowCount: 5000,
                        columnHeaders: ["a", "b", "c"],
                        columnTypes: ["number", "number", "number"],
                        sampleRows: [["1", "2", "3"]],
                        csvBlock: longCsv,
                    },
                ],
            },
            colorPalette: null,
            visualAnalysis: null,
            designSignals: null,
            distilledTitle: "Big Data",
            distilledSummary: "",
            distilledTags: [],
            distilledColors: [],
            renderedFragment: null,
        };

        const fragment = renderAssetLayerDFragment(trace, { maxChars: 2000 });
        expect(fragment.length).toBeLessThanOrEqual(2200); // some slack for closing fences
    });
});
