import type { ExportRecord, ExportStatus, AssetPlaceholder, ExportSourceType } from "../entities/ExportRecord";

export interface ExportRepository {
    create(input: {
        projectId: string;
        userId: string;
        sourceType: ExportSourceType;
        snapshotId?: string;
        filesIncluded: string[];
        assetPlaceholders: AssetPlaceholder[];
        expiresAt: Date;
    }): Promise<ExportRecord>;

    findById(id: string): Promise<ExportRecord | null>;

    updateReady(id: string, data: {
        fileSize: number;
        fileSha256: string;
    }): Promise<ExportRecord | null>;

    updateFailed(id: string, errorMessage: string): Promise<ExportRecord | null>;

    incrementDownloadCount(id: string): Promise<void>;
}
