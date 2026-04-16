import type { AssetScope, AssetSource, AssetStyleRole, ProjectAsset, AssetSemanticMetadata, AssetGenerationStatus, AssetGenerationMetadata, AssetGenerationUsageSummary } from "../entities/ProjectAsset";

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

    findById(id: string, projectId: string, userId: string): Promise<ProjectAsset | null>;

    delete(id: string, projectId: string, userId: string): Promise<boolean>;

    /** Total size in bytes for all assets in the project (user uploads only, for quota). */
    totalProjectSize(projectId: string, userId: string): Promise<number>;

    countByProject(projectId: string, userId: string): Promise<number>;

    summarizeGenerationByProject(projectId: string, userId: string): Promise<AssetGenerationUsageSummary>;

    listRecentGeneratedByProject(projectId: string, userId: string, limit?: number): Promise<ProjectAsset[]>;

    summarizeGenerationAll(): Promise<AssetGenerationUsageSummary>;

    listRecentGeneratedAll(limit?: number): Promise<ProjectAsset[]>;

    /** Partial update of user-editable metadata fields. Enforces ownership via projectId/userId. */
    update(
        id: string,
        projectId: string,
        userId: string,
        data: Partial<{
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
