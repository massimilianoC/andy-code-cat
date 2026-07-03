import { randomUUID } from "crypto";
import { AssetEnrichmentPipeline } from "../documents/enrichment/AssetEnrichmentPipeline";
import type { AssetEnrichmentTrace } from "../../domain/entities/AssetEnrichmentTrace";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { PlatformConfig } from "../../domain/entities/PlatformConfig";
import type { GetLlmCatalog } from "./GetLlmCatalog";
import type { BrandAssetEnrichmentStatus } from "../../domain/entities/BrandAsset";

export interface EnrichBrandDocumentInput {
    fileBuffer: Buffer;
    originalName: string;
    mimeType: string;
    fileSize: number;
    storedFilename: string;
    ownerUserId: string;
    /** Real projectId when project-scope; a synthetic id is used for user/platform scope. */
    projectId?: string;
    getLlmCatalog: GetLlmCatalog;
    promptExecutionLogRepository?: PromptExecutionLogRepository;
    platformConfig?: Pick<PlatformConfig, "governanceByProduct"> | null;
}

export interface EnrichBrandDocumentResult {
    documentFragment?: string;
    enrichmentTrace: AssetEnrichmentTrace | null;
    status: BrandAssetEnrichmentStatus;
}

/**
 * In-memory capture repository.
 *
 * The enrichment pipeline persists its trace back through a `ProjectAssetRepository`.
 * For brand documents at user/platform scope there is no backing `ProjectAsset`, so we
 * pass this capture stub: it records the last trace written by the pipeline (pending →
 * ready/failed) and that captured trace becomes the cached `BrandAsset.documentFragment`.
 *
 * Only `saveEnrichmentTrace` and `update` are exercised by the document enrichment path;
 * the remaining repository methods are intentionally unsupported.
 */
class CaptureAssetRepository implements ProjectAssetRepository {
    public captured: AssetEnrichmentTrace | null = null;
    constructor(private readonly asset: ProjectAsset) {}

    async saveEnrichmentTrace(_id: string, _projectId: string, trace: AssetEnrichmentTrace): Promise<ProjectAsset | null> {
        this.captured = trace;
        return { ...this.asset, enrichmentTrace: trace };
    }

    async update(): Promise<ProjectAsset | null> {
        return this.asset;
    }

    private unsupported(): never {
        throw new Error("CaptureAssetRepository: method not supported for brand-document enrichment");
    }
    create(): never { return this.unsupported(); }
    listByProject(): never { return this.unsupported(); }
    listByUser(): never { return this.unsupported(); }
    findById(): never { return this.unsupported(); }
    findByIdPublic(): never { return this.unsupported(); }
    delete(): never { return this.unsupported(); }
    totalProjectSize(): never { return this.unsupported(); }
    countByProject(): never { return this.unsupported(); }
    summarizeGenerationByProject(): never { return this.unsupported(); }
    summarizeGenerationCostsByUser(): never { return this.unsupported(); }
    listRecentGeneratedByProject(): never { return this.unsupported(); }
    summarizeGenerationAll(): never { return this.unsupported(); }
    listRecentGeneratedAll(): never { return this.unsupported(); }
}

/**
 * Runs the document enrichment pipeline EXACTLY ONCE for a brand document and returns the
 * pre-rendered Layer D fragment to be cached on the `BrandAsset`. Subsequent project
 * generations reuse the cached fragment with zero additional LLM cost.
 */
export class EnrichBrandDocument {
    async execute(input: EnrichBrandDocumentInput): Promise<EnrichBrandDocumentResult> {
        const syntheticAsset: ProjectAsset = {
            id: randomUUID(),
            projectId: input.projectId ?? `brand-doc:${input.ownerUserId}`,
            userId: input.ownerUserId,
            originalName: input.originalName,
            storedFilename: input.storedFilename,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            source: "user_upload",
            scope: "user",
            useInProject: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        } as ProjectAsset;

        const captureRepo = new CaptureAssetRepository(syntheticAsset);
        const pipeline = new AssetEnrichmentPipeline();

        try {
            const trace = await pipeline.enrich({
                asset: syntheticAsset,
                fileBuffer: input.fileBuffer,
                getLlmCatalog: input.getLlmCatalog,
                assetRepository: captureRepo,
                promptExecutionLogRepository: input.promptExecutionLogRepository,
                platformConfig: input.platformConfig,
            });
            const effective = trace ?? captureRepo.captured;
            const status = (effective?.provenance.enrichmentStatus ?? "failed") as BrandAssetEnrichmentStatus;
            return {
                documentFragment: effective?.renderedFragment ?? undefined,
                enrichmentTrace: effective,
                status,
            };
        } catch {
            return { documentFragment: undefined, enrichmentTrace: null, status: "failed" };
        }
    }
}
