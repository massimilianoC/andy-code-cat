import { z } from "zod";

export const uploadProjectAssetSchema = z.object({
    // file is handled by multer, this schema validates any extra body fields if needed
});

export const exportLayer1Schema = z.object({
    snapshotId: z.string().uuid().optional(),
    conversationId: z.string().min(1).optional(),
});

export type ExportLayer1Input = z.infer<typeof exportLayer1Schema>;

export const prepareWorkspaceSchema = z.object({
    jobId: z.string().uuid(),
    conversationId: z.string().min(1).optional(),
    snapshotId: z.string().uuid().optional(),
});

export type PrepareWorkspaceInput = z.infer<typeof prepareWorkspaceSchema>;

// ---- Asset DTOs ----

export type AssetSourceDto = "user_upload" | "platform_generated";
export type AssetStyleRole = "inspiration" | "material";

export interface ProjectAssetDto {
    id: string;
    projectId: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    source: AssetSourceDto;
    label?: string;
    /** Whether this asset is actively used in style context injection. */
    useInProject?: boolean;
    /** How the asset is intended to be used. */
    styleRole?: AssetStyleRole;
    /** Optional free-text description for the asset. */
    descriptionText?: string;
    /** External URL (for URL-reference assets, no file on disk). */
    externalUrl?: string;
    createdAt: string;
}

export const updateProjectAssetSchema = z.object({
    label: z.string().max(100).optional(),
    useInProject: z.boolean().optional(),
    styleRole: z.enum(["inspiration", "material"]).optional(),
    descriptionText: z.string().max(500).optional(),
});

export type UpdateProjectAssetInput = z.infer<typeof updateProjectAssetSchema>;

export const addUrlReferenceSchema = z.object({
    url: z.string().url().max(2000),
    label: z.string().max(100).optional(),
    styleRole: z.enum(["inspiration", "material"]).optional(),
    descriptionText: z.string().max(500).optional(),
});

export type AddUrlReferenceInput = z.infer<typeof addUrlReferenceSchema>;

export interface AssetPlaceholderDto {
    path: string;
    usedIn: string;
    recommendedSize?: string;
}

export interface ExportRecordDto {
    id: string;
    projectId: string;
    sourceType: "layer1_snapshot";
    snapshotId?: string;
    status: "pending" | "ready" | "failed";
    fileSize?: number;
    fileSha256?: string;
    filesIncluded: string[];
    assetPlaceholders: AssetPlaceholderDto[];
    downloadCount: number;
    expiresAt: string;
    errorMessage?: string;
    createdAt: string;
    readyAt?: string;
}

export interface ExportLayer1ResponseDto extends ExportRecordDto {
    downloadToken: string;
    downloadUrl: string;
}

// ---- Workspace DTOs ----

export type WorkspaceFileSourceDto =
    | "user_asset"
    | "platform_asset"
    | "layer1_artifact"
    | "generated";

export interface WorkspaceFileDto {
    relativePath: string;
    source: WorkspaceFileSourceDto;
    mimeType?: string;
    assetId?: string;
}

export interface GenerationWorkspaceDto {
    jobId: string;
    projectId: string;
    /** Absolute path on the server — exposed for internal / admin use. */
    rootPath: string;
    outputPath: string;
    files: WorkspaceFileDto[];
    layer1Included: boolean;
    snapshotId?: string;
    createdAt: string;
}

