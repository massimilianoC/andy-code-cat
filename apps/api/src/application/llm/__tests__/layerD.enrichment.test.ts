import { describe, it, expect, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        enrichmentInjectLayerD: true,
        ENRICHMENT_LAYER_D_MAX_CHARS: 50_000,
        ENRICHMENT_LAYER_D_MAX_ASSETS: 10,
    },
}));

import { buildProjectKnowledgeLayer } from "../systemPromptLayers";
import type { ProjectAsset } from "../../../domain/entities/ProjectAsset";
import type { AssetEnrichmentTrace } from "../../../domain/entities/AssetEnrichmentTrace";

// ── Minimal asset factory ────────────────────────────────────────────────

function makeAsset(
    overrides: Partial<ProjectAsset> & { enrichmentTrace?: AssetEnrichmentTrace | null }
): ProjectAsset {
    return {
        id: "asset-1",
        projectId: "proj-1",
        userId: "user-1",
        originalName: "test.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileSize: 12000,
        source: "upload",
        scope: "project",
        storedFilename: "test.xlsx",
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
        enrichmentTrace: null,
        ...overrides,
    } as ProjectAsset;
}

function makeTrace(
    status: "pending" | "ready" | "failed" | "skipped",
    opts: {
        withTextLayer?: boolean;
        withStructuredData?: boolean;
        withBrief?: boolean;
    } = {}
): AssetEnrichmentTrace {
    return {
        assetId: "asset-1",
        projectId: "proj-1",
        userId: "user-1",
        assetKind: "xlsx",
        provenance: {
            traceVersion: 1,
            enrichmentStatus: status,
            enrichedAt: status === "ready" ? new Date() : null,
            processingMs: null,
            parserName: "xlsx-sheetjs",
            parserVersion: "1.0.0",
            llmProvider: null,
            llmModel: null,
            llmTokensUsed: null,
            llmCostEur: null,
            errorMessage: null,
        },
        textLayer: opts.withTextLayer
            ? {
                wordCount: 150,
                charCount: 900,
                languageHint: "it",
                pageCount: 1,
                sectionCount: 1,
                extractedTextSnippet: "Nome,Genere,Origine\nAlice,Jazz,Milano\nBob,Rock,Roma",
                fullTextStored: false,
            }
            : null,
        documentBrief: opts.withBrief
            ? {
                documentType: "specification",
                detectedTitle: "Proposte Zoe 2026",
                detectedBrandName: "Zoe",
                purposeSentence: "A catalog of artists for the 2026 event.",
                contentSummary: "Contains 40 artists with genre, origin, and links.",
                mainArgumentOrValue: "Curated artist selection for event planning.",
                structureSummary: "Single sheet with columns: Name, Genre, Origin, Link.",
                keyMessages: ["40 artists", "Jazz and Rock dominant", "Italy-focused"],
                toneLabel: "quantitative catalog",
                targetAudience: "Event curators",
                ctaText: null,
                primaryTopics: ["artist catalog", "event planning", "music genres"],
                contentLanguage: "it",
                suggestedStyleRole: "material",
            }
            : null,
        structuredData: opts.withStructuredData
            ? {
                kind: "spreadsheet",
                sheets: [
                    {
                        name: "Artisti",
                        rowCount: 40,
                        columnHeaders: ["Nome", "Genere", "Origine", "Link"],
                        columnTypes: ["text", "text", "text", "text"],
                        sampleRows: [["Alice", "Jazz", "Milano", "https://alice.it"]],
                        csvBlock: "Nome,Genere,Origine,Link\nAlice,Jazz,Milano,https://alice.it",
                    },
                ],
            }
            : null,
        colorPalette: null,
        visualAnalysis: null,
        designSignals: null,
        distilledTitle: "Proposte Zoe 2026",
        distilledSummary: "Artist catalog for 2026 event.",
        distilledTags: ["catalog", "artists"],
        distilledColors: [],
    };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("buildProjectKnowledgeLayer — Layer D enrichment timing", () => {
    it("returns empty string when all assets have status=pending and no textLayer (pre-fix regression proof)", () => {
        // Simulates the bug: upload done, enrichment still running, no textLayer saved yet
        const asset = makeAsset({ enrichmentTrace: makeTrace("pending") });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toBe("");
    });

    it("includes asset with status=pending when textLayer is available (timing fix)", () => {
        // After fix: pipeline saves textLayer immediately after parsing
        const asset = makeAsset({ enrichmentTrace: makeTrace("pending", { withTextLayer: true }) });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toContain("LAYER D");
        expect(result).toContain("Proposte Zoe 2026");
    });

    it("emits text preview fallback for pending-with-textLayer when no brief", () => {
        const asset = makeAsset({ enrichmentTrace: makeTrace("pending", { withTextLayer: true }) });
        const result = buildProjectKnowledgeLayer([asset]);
        // Should contain the extracted text snippet as fallback
        expect(result).toContain("Nome,Genere,Origine");
    });

    it("includes asset with status=pending when structuredData is available", () => {
        // After fix: pipeline saves structuredData immediately (spreadsheet)
        const asset = makeAsset({ enrichmentTrace: makeTrace("pending", { withStructuredData: true }) });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toContain("LAYER D");
    });

    it("emits CSV block for pending asset with structuredData sheets", () => {
        const asset = makeAsset({ enrichmentTrace: makeTrace("pending", { withStructuredData: true }) });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toContain("Artisti");
        expect(result).toContain("Nome,Genere,Origine,Link");
    });

    it("emits full brief for ready assets", () => {
        const asset = makeAsset({
            enrichmentTrace: makeTrace("ready", { withTextLayer: true, withBrief: true, withStructuredData: true }),
        });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toContain("LAYER D");
        expect(result).toContain("catalog of artists");
        expect(result).toContain("40 artists");
    });

    it("emits contentSummary and targetAudience from ready brief", () => {
        const asset = makeAsset({
            enrichmentTrace: makeTrace("ready", { withTextLayer: true, withBrief: true }),
        });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toContain("Contains 40 artists");
        expect(result).toContain("Event curators");
    });

    it("excludes failed and skipped assets", () => {
        const failed = makeAsset({ enrichmentTrace: makeTrace("failed") });
        const skipped = makeAsset({ id: "asset-2", enrichmentTrace: makeTrace("skipped") } as Partial<ProjectAsset> as any);
        const result = buildProjectKnowledgeLayer([failed, skipped]);
        expect(result).toBe("");
    });

    it("excludes assets with useInProject=false and no styleRole", () => {
        const asset = makeAsset({
            useInProject: false,
            styleRole: undefined,
            enrichmentTrace: makeTrace("pending", { withTextLayer: true }),
        });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toBe("");
    });

    it("includes assets with useInProject=false but with a styleRole", () => {
        const asset = makeAsset({
            useInProject: false,
            styleRole: "reference",
            enrichmentTrace: makeTrace("pending", { withTextLayer: true }),
        });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toContain("LAYER D");
    });

    it("respects maxChars budget", () => {
        const asset = makeAsset({ enrichmentTrace: makeTrace("ready", { withBrief: true, withStructuredData: true }) });
        const result = buildProjectKnowledgeLayer([asset], { maxChars: 50 });
        expect(result).toBe("");
    });
});
