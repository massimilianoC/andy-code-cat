import type { BrandAssetRepository } from "../../domain/repositories/BrandAssetRepository";
import type { BrandAsset, BrandAssetScope, BrandAssetRole, BrandAssetPolicy, BrandAssetValueType, BrandAssetEnrichmentStatus } from "../../domain/entities/BrandAsset";
import type { AssetEnrichmentTrace } from "../../domain/entities/AssetEnrichmentTrace";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";

export interface SetBrandAssetTextInput {
    scope: BrandAssetScope;
    ownerUserId?: string;
    projectId?: string;
    role: BrandAssetRole;
    customRoleLabel?: string;
    policy: BrandAssetPolicy;
    valueType: Extract<BrandAssetValueType, "text" | "color_list" | "url">;
    textValue: string;
    description?: string;
    isActive?: boolean;
    priority?: number;
}

export interface SetBrandAssetFileInput {
    scope: BrandAssetScope;
    ownerUserId?: string;
    projectId?: string;
    role: BrandAssetRole;
    customRoleLabel?: string;
    policy: BrandAssetPolicy;
    description?: string;
    isActive?: boolean;
    priority?: number;
    // File upload path
    storedFilename: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
}

export interface SetBrandAssetDocumentInput {
    scope: BrandAssetScope;
    ownerUserId?: string;
    projectId?: string;
    customRoleLabel?: string;
    policy: BrandAssetPolicy;
    description?: string;
    isActive?: boolean;
    priority?: number;
    storedFilename: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    // One-time enrichment result (computed by EnrichBrandDocument before this call)
    documentFragment?: string;
    enrichmentTrace?: AssetEnrichmentTrace | null;
    enrichmentStatus: BrandAssetEnrichmentStatus;
}

export interface SetBrandAssetPromoteInput {
    scope: BrandAssetScope;
    ownerUserId?: string;
    projectId?: string;
    role: BrandAssetRole;
    customRoleLabel?: string;
    policy: BrandAssetPolicy;
    description?: string;
    isActive?: boolean;
    priority?: number;
    sourceAssetId: string;
    sourceProjectId: string;
    sourceUserId: string;
}

export class SetBrandAsset {
    constructor(
        private readonly brandAssetRepository: BrandAssetRepository,
        private readonly projectAssetRepository: ProjectAssetRepository,
    ) {}

    async createText(input: SetBrandAssetTextInput): Promise<BrandAsset> {
        return this.brandAssetRepository.create({
            scope: input.scope,
            ownerUserId: input.ownerUserId,
            projectId: input.projectId,
            role: input.role,
            customRoleLabel: input.customRoleLabel,
            policy: input.policy,
            valueType: input.valueType,
            textValue: input.textValue,
            description: input.description,
            isActive: input.isActive ?? true,
            priority: input.priority ?? 0,
        });
    }

    async createFile(input: SetBrandAssetFileInput): Promise<BrandAsset> {
        return this.brandAssetRepository.create({
            scope: input.scope,
            ownerUserId: input.ownerUserId,
            projectId: input.projectId,
            role: input.role,
            customRoleLabel: input.customRoleLabel,
            policy: input.policy,
            valueType: "asset_ref",
            storedFilename: input.storedFilename,
            originalName: input.originalName,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            description: input.description,
            isActive: input.isActive ?? true,
            priority: input.priority ?? 0,
        });
    }

    /** Persist a brand document whose Layer D fragment was already computed once by EnrichBrandDocument. */
    async createDocument(input: SetBrandAssetDocumentInput): Promise<BrandAsset> {
        return this.brandAssetRepository.create({
            scope: input.scope,
            ownerUserId: input.ownerUserId,
            projectId: input.projectId,
            role: "brand_document",
            customRoleLabel: input.customRoleLabel,
            policy: input.policy,
            valueType: "document_ref",
            storedFilename: input.storedFilename,
            originalName: input.originalName,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            documentFragment: input.documentFragment,
            enrichmentTrace: input.enrichmentTrace ?? null,
            enrichmentStatus: input.enrichmentStatus,
            description: input.description,
            isActive: input.isActive ?? true,
            priority: input.priority ?? 0,
        });
    }

    async promote(input: SetBrandAssetPromoteInput): Promise<BrandAsset> {
        const source = await this.projectAssetRepository.findById(
            input.sourceAssetId,
            input.sourceProjectId,
            input.sourceUserId,
        );
        if (!source) throw new Error(`Source asset ${input.sourceAssetId} not found`);
        if (!source.storedFilename) throw new Error("Source asset has no stored file");

        // Brand document promote: reuse the source asset's already-computed enrichment trace
        // (zero new LLM cost — the extraction happened when the file was attached to its project).
        if (input.role === "brand_document") {
            const trace = source.enrichmentTrace ?? null;
            return this.brandAssetRepository.create({
                scope: input.scope,
                ownerUserId: input.ownerUserId,
                projectId: input.projectId,
                role: "brand_document",
                customRoleLabel: input.customRoleLabel,
                policy: input.policy,
                valueType: "document_ref",
                storedFilename: source.storedFilename,
                originalName: source.originalName,
                mimeType: source.mimeType,
                fileSize: source.fileSize,
                promotedFromAssetId: source.id,
                documentFragment: trace?.renderedFragment ?? undefined,
                enrichmentTrace: trace,
                enrichmentStatus: trace?.provenance.enrichmentStatus === "ready" ? "ready" : "pending",
                description: input.description,
                isActive: input.isActive ?? true,
                priority: input.priority ?? 0,
            });
        }

        return this.brandAssetRepository.create({
            scope: input.scope,
            ownerUserId: input.ownerUserId,
            projectId: input.projectId,
            role: input.role,
            customRoleLabel: input.customRoleLabel,
            policy: input.policy,
            valueType: "asset_ref",
            storedFilename: source.storedFilename,
            originalName: source.originalName,
            mimeType: source.mimeType,
            fileSize: source.fileSize,
            promotedFromAssetId: source.id,
            description: input.description,
            isActive: input.isActive ?? true,
            priority: input.priority ?? 0,
        });
    }
}
