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
        withDatasetStructuredData?: boolean;
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
        structuredData: opts.withDatasetStructuredData
            ? {
                kind: "dataset",
                dataset: {
                    sourceFormat: "xlsx",
                    facts: {
                        rowCount: 40,
                        columnCount: 4,
                        numericColumnCount: 1,
                        categoricalColumnCount: 2,
                        booleanColumnCount: 0,
                        dateColumnCount: 1,
                        supportedAggregations: ["count", "sum", "avg", "min", "max", "distinct_count", "top_values"],
                    },
                    tables: [
                        {
                            name: "Artisti",
                            sourceFormat: "xlsx",
                            rowCount: 40,
                            columnCount: 4,
                            sampleHeaders: ["Nome", "Genere", "Ingaggio", "Data"],
                            sampleRows: [["Alice", "Jazz", "1200", "2026-04-01"]],
                            columns: [
                                {
                                    key: "nome",
                                    label: "Nome",
                                    valueType: "string",
                                    nonNullCount: 40,
                                    nullCount: 0,
                                    nullRatio: 0,
                                    distinctCount: 40,
                                    sampleValues: ["Alice"],
                                },
                                {
                                    key: "genere",
                                    label: "Genere",
                                    valueType: "string",
                                    nonNullCount: 40,
                                    nullCount: 0,
                                    nullRatio: 0,
                                    distinctCount: 2,
                                    sampleValues: ["Jazz"],
                                },
                                {
                                    key: "ingaggio",
                                    label: "Ingaggio",
                                    valueType: "number",
                                    nonNullCount: 40,
                                    nullCount: 0,
                                    nullRatio: 0,
                                    distinctCount: 10,
                                    sampleValues: ["1200"],
                                    min: 1000,
                                    max: 4000,
                                    mean: 1800,
                                    sum: 72000,
                                },
                                {
                                    key: "data",
                                    label: "Data",
                                    valueType: "date",
                                    nonNullCount: 40,
                                    nullCount: 0,
                                    nullRatio: 0,
                                    distinctCount: 10,
                                    sampleValues: ["2026-04-01"],
                                    min: "2026-04-01",
                                    max: "2026-05-01",
                                },
                            ],
                        },
                    ],
                    limitations: ["No joins", "Single-table runtime"],
                    llmAppendix: {
                        analyticalSummary: "The dataset looks like an event booking roster with pricing and schedule dimensions.",
                        keySignals: ["Ingaggio is the main KPI", "Genere and Data are likely primary filters"],
                        suggestedQuestions: ["Which genre has the highest total ingaggio?", "How does ingaggio vary over time?"],
                        cautions: ["Single-table runtime only", "No joins available for enrichment"],
                    },
                },
            }
            : opts.withStructuredData
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
        renderedFragment: null,
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

    it("includes explicitly selected uploaded assets while enrichment is still pending", () => {
        const asset = makeAsset({
            originalName: "brand-reference.png",
            mimeType: "image/png",
            enrichmentTrace: null,
        });
        const result = buildProjectKnowledgeLayer([asset], { includeUnenrichedAssets: true });
        expect(result).toContain("brand-reference.png");
        expect(result).toContain("uploaded reference");
    });

    it("includes explicitly selected assets even when they are not globally enabled", () => {
        const asset = makeAsset({
            useInProject: false,
            styleRole: undefined,
            enrichmentTrace: makeTrace("pending", { withTextLayer: true }),
        });
        const result = buildProjectKnowledgeLayer([asset], { includeUnenrichedAssets: true });
        expect(result).toContain("LAYER D");
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

    it("appends deterministic structured-data notes in calce when dataset runtime is available", () => {
        const asset = makeAsset({
            originalName: "artisti-industriali.xlsx",
            enrichmentTrace: makeTrace("ready", { withBrief: true, withDatasetStructuredData: true }),
        });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toContain("### Structured data appendix");
        expect(result).toContain("artisti-industriali.xlsx");
        expect(result).toContain("Possible measures: Ingaggio");
        expect(result).toContain("Possible dimensions or filters: Nome, Genere, Data");
    });

    it("appends the dataset-aware llm appendix after deterministic facts when available", () => {
        const asset = makeAsset({
            originalName: "artisti-industriali.xlsx",
            enrichmentTrace: makeTrace("ready", { withBrief: true, withDatasetStructuredData: true }),
        });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toContain("Analytical summary: The dataset looks like an event booking roster");
        expect(result).toContain("Key signals: Ingaggio is the main KPI");
        expect(result).toContain("Suggested analytical questions: Which genre has the highest total ingaggio?");
        expect(result).toContain("Grounding cautions: Single-table runtime only");
    });

    it("does not dump raw csv blocks when a normalized dataset runtime is available", () => {
        const asset = makeAsset({
            originalName: "artisti-industriali.xlsx",
            enrichmentTrace: makeTrace("ready", { withBrief: true, withDatasetStructuredData: true }),
        });
        const result = buildProjectKnowledgeLayer([asset]);
        expect(result).toContain("Structured dataset (xlsx):");
        expect(result).toContain("Sample rows:");
        expect(result).not.toContain("```csv");
    });

    it("can disable the structured-data appendix explicitly for backward-compatible callers", () => {
        const asset = makeAsset({
            originalName: "artisti-industriali.xlsx",
            enrichmentTrace: makeTrace("ready", { withBrief: true, withDatasetStructuredData: true }),
        });
        const result = buildProjectKnowledgeLayer([asset], { includeStructuredDataAppendix: false });
        expect(result).not.toContain("### Structured data appendix");
    });
});
