export type ExportSourceType = "layer1_snapshot"; // extendable: | "layer2_dist"

export type ExportStatus = "pending" | "ready" | "failed";

export interface AssetPlaceholder {
    path: string;             // e.g. 'assets/placeholder-hero.jpg'
    usedIn: string;           // e.g. '<img> in section.hero'
    recommendedSize?: string; // e.g. '1920x600px'
}

export interface ExportRecord {
    id: string;
    projectId: string;
    userId: string;
    sourceType: ExportSourceType;
    snapshotId?: string;
    status: ExportStatus;
    fileSize?: number;
    fileSha256?: string;
    filesIncluded: string[];
    assetPlaceholders: AssetPlaceholder[];
    downloadCount: number;
    /** TTL: MongoDB TTL index deletes the record after this timestamp (24h). */
    expiresAt: Date;
    errorMessage?: string;
    createdAt: Date;
    readyAt?: Date;
}
