import { randomUUID } from "crypto";
import path from "path";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { LocalFileStorage } from "../../infra/storage/LocalFileStorage";

/**
 * SavePlatformAsset — internal use-case for storing platform-generated assets.
 *
 * Unlike UploadProjectAsset (user-facing), this:
 * - Skips user quota checks (it is called by the platform, not by the user)
 * - Accepts a Buffer directly (no multipart middleware required)
 * - Sets source = 'platform_generated' on the stored record
 * - Can attach a human-readable label (e.g. "Layer 1 HTML export")
 *
 * Callers: ExportLayer1Zip, PrepareGenerationWorkspace, or any future pipeline stage
 * that needs to materialise a file into the project's asset store.
 */
export class SavePlatformAsset {
    constructor(
        private readonly assetRepository: ProjectAssetRepository,
        private readonly storage: LocalFileStorage
    ) { }

    async execute(input: {
        projectId: string;
        userId: string;
        originalName: string;
        mimeType: string;
        buffer: Buffer;
        label?: string;
    }): Promise<ProjectAsset> {
        const assetId = randomUUID();
        const safeName = safenameFromOriginal(input.originalName);
        const storedFilename = `${assetId}-${safeName}`;

        await this.storage.saveUpload(input.userId, input.projectId, storedFilename, input.buffer);

        return this.assetRepository.create({
            projectId: input.projectId,
            userId: input.userId,
            originalName: input.originalName.slice(0, 255),
            storedFilename,
            mimeType: input.mimeType,
            fileSize: input.buffer.byteLength,
            source: "platform_generated",
            label: input.label,
        });
    }
}

function safenameFromOriginal(originalName: string): string {
    const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "");
    const base = path
        .basename(originalName, path.extname(originalName))
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_")
        .slice(0, 60);
    return `${base}${ext}`;
}
