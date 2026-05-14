import type { AssetScope, AssetSource, AssetStyleRole, ProjectAsset, AssetSemanticMetadata, AssetGenerationStatus, AssetGenerationMetadata, AssetGenerationUsageSummary } from "../entities/ProjectAsset";
import type { AssetEnrichmentTrace } from "../entities/AssetEnrichmentTrace";

export interface ProjectAssetRepository {
    create(input: {
        projectId: string;
        userId: string;
        originalName: string;
        storedFilename: string;
        mimeType: string;
        fileSize: number;
        source: AssetSource;
        scope?: AssetScope;
        label?: string;
        useInProject?: boolean;
        styleRole?: AssetStyleRole;
        descriptionText?: string;
        externalUrl?: string;
        generationStatus?: AssetGenerationStatus;
        generationPrompt?: string;
        generationMetadata?: AssetGenerationMetadata;
        semanticMetadata?: AssetSemanticMetadata;
    }): Promise<ProjectAsset>;

    listByProject(projectId: string, userId: string, source?: AssetSource): Promise<ProjectAsset[]>;

    /** All assets owned by the user across all projects (for the user media library). */
    listByUser(userId: string): Promise<ProjectAsset[]>;

    findById(id: string, projectId: string, userId: string): Promise<ProjectAsset | null>;

    /** Lookup by ID only — no ownership check. Used exclusively by the public media serve route. */
    findByIdPublic(id: string): Promise<ProjectAsset | null>;

    delete(id: string, projectId: string, userId: string): Promise<boolean>;

    /** Total size in bytes for all assets in the project (user uploads only, for quota). */
    totalProjectSize(projectId: string, userId: string): Promise<number>;

    countByProject(projectId: string, userId: string): Promise<number>;

    summarizeGenerationByProject(projectId: string, userId: string): Promise<AssetGenerationUsageSummary>;

    /** Returns a map of projectId -> total image generation cost (EUR) for all assets of a user. */
    summarizeGenerationCostsByUser(userId: string): Promise<Record<string, number>>;

    listRecentGeneratedByProject(projectId: string, userId: string, limit?: number): Promise<ProjectAsset[]>;

    summarizeGenerationAll(): Promise<AssetGenerationUsageSummary>;

    listRecentGeneratedAll(limit?: number): Promise<ProjectAsset[]>;

    /** Persists an enrichment trace produced by the Document Context Layer pipeline. Ownership enforced via projectId. */
    saveEnrichmentTrace(
        id: string,
        projectId: string,
        trace: AssetEnrichmentTrace,
    ): Promise<ProjectAsset | null>;

    /** Partial update of user-editable metadata fields. Enforces ownership via projectId/userId. */
    update(
        id: string,
        projectId: string,
        userId: string,
        data: Partial<{
            originalName: string;
            storedFilename: string;
            label: string;
            useInProject: boolean;
            styleRole: AssetStyleRole;
            descriptionText: string;
            mimeType: string;
            fileSize: number;
            generationStatus: AssetGenerationStatus;
            generationPrompt: string;
            generationMetadata: AssetGenerationMetadata;
            semanticMetadata: AssetSemanticMetadata;
        }>
    ): Promise<ProjectAsset | null>;
}
