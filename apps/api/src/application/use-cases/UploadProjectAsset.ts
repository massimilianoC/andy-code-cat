import { randomUUID } from "crypto";
import path from "path";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import { env } from "../../config";
import { buildAssetSemanticMetadata, guessStyleRole } from "../media/projectAssetSemantics";

const ALLOWED_MIME_PREFIXES = ["image/", "text/"];
const ALLOWED_MIME_EXACT = new Set([
    "application/pdf",
    "application/json",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    // Excel
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    // PowerPoint
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    // XML
    "application/xml",
    // JavaScript
    "application/javascript",
    // CSV
    "application/csv",
    // XHTML
    "application/xhtml+xml",
]);
const QUOTA_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB
const QUOTA_MAX_FILES = 50;

function isAllowedMime(mimeType: string): boolean {
    const mime = mimeType.toLowerCase().split(";")[0]!.trim();
    return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p)) || ALLOWED_MIME_EXACT.has(mime);
}

function safenameFromOriginal(originalName: string): string {
    const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "");
    const base = path.basename(originalName, path.extname(originalName))
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_")
        .slice(0, 60);
    return `${base}${ext}`;
}

export class UploadProjectAsset {
    constructor(
        private readonly assetRepository: ProjectAssetRepository,
        private readonly storage: IFileStorage
    ) { }

    async execute(input: {
        projectId: string;
        userId: string;
        originalName: string;
        mimeType: string;
        fileSize: number;
        buffer: Buffer;
        label?: string;
        scope?: "project" | "user";
        useInProject?: boolean;
        styleRole?: "inspiration" | "material" | "logo" | "background" | "icon" | "watermark" | "reference";
        descriptionText?: string;
        maxTotalBytes?: number;
    }): Promise<ProjectAsset> {
        if (!isAllowedMime(input.mimeType)) {
            throw Object.assign(new Error("File type not allowed"), { statusCode: 415 });
        }

        if (input.fileSize > env.UPLOAD_MAX_SIZE_BYTES) {
            throw Object.assign(new Error("File size exceeds limit"), { statusCode: 413 });
        }

        const currentCount = await this.assetRepository.countByProject(input.projectId, input.userId);
        if (currentCount >= QUOTA_MAX_FILES) {
            throw Object.assign(new Error("Project asset quota exceeded (max 50 files)"), { statusCode: 422 });
        }

        const currentSize = await this.assetRepository.totalProjectSize(input.projectId, input.userId);
        const maxTotalBytes = input.maxTotalBytes ?? QUOTA_TOTAL_BYTES;
        if (currentSize + input.fileSize > maxTotalBytes) {
            const maxMb = Math.round((maxTotalBytes / (1024 * 1024)) * 10) / 10;
            throw Object.assign(new Error(`Project storage quota exceeded (max ${maxMb} MB)`), { statusCode: 422 });
        }

        const assetId = randomUUID();
        const safeFilename = safenameFromOriginal(input.originalName);
        const storedFilename = `${assetId}-${safeFilename}`;

        await this.storage.saveUpload(input.userId, input.projectId, storedFilename, input.buffer, input.mimeType);

        const semanticMetadata = env.MEDIA_AUTO_CLASSIFY_UPLOADS === true
            ? buildAssetSemanticMetadata({
                promptOrName: input.descriptionText || input.label || input.originalName,
                mimeType: input.mimeType,
                mediaKind: input.mimeType.startsWith("image/") ? "image" : "document",
            })
            : undefined;

        return this.assetRepository.create({
            projectId: input.projectId,
            userId: input.userId,
            originalName: input.originalName.slice(0, 255),
            storedFilename,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            source: "user_upload",
            scope: input.scope ?? "project",
            label: input.label,
            useInProject: input.useInProject,
            styleRole: input.styleRole ?? (semanticMetadata ? guessStyleRole(semanticMetadata.mediaKind) : undefined),
            descriptionText: input.descriptionText,
            generationStatus: "ready",
            semanticMetadata,
        });
    }
}
