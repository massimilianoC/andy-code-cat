import type { ProjectAsset, AssetSource } from "../entities/ProjectAsset";

export interface ProjectAssetRepository {
    create(input: {
        projectId: string;
        userId: string;
        originalName: string;
        storedFilename: string;
        mimeType: string;
        fileSize: number;
        source: AssetSource;
        label?: string;
        useInProject?: boolean;
        styleRole?: "inspiration" | "material";
        descriptionText?: string;
        externalUrl?: string;
    }): Promise<ProjectAsset>;

    listByProject(projectId: string, userId: string, source?: AssetSource): Promise<ProjectAsset[]>;

    findById(id: string, projectId: string, userId: string): Promise<ProjectAsset | null>;

    delete(id: string, projectId: string, userId: string): Promise<boolean>;

    /** Total size in bytes for all assets in the project (user uploads only, for quota). */
    totalProjectSize(projectId: string, userId: string): Promise<number>;

    countByProject(projectId: string, userId: string): Promise<number>;

    /** Partial update of user-editable metadata fields. Enforces ownership via projectId/userId. */
    update(
        id: string,
        projectId: string,
        userId: string,
        data: Partial<{ label: string; useInProject: boolean; styleRole: "inspiration" | "material"; descriptionText: string }>
    ): Promise<ProjectAsset | null>;
}
