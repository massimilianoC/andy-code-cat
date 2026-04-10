import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";

export class DeleteProjectAsset {
    constructor(
        private readonly assetRepository: ProjectAssetRepository,
        private readonly storage: IFileStorage
    ) { }

    async execute(input: { assetId: string; projectId: string; userId: string }): Promise<void> {
        const asset = await this.assetRepository.findById(input.assetId, input.projectId, input.userId);
        if (!asset) {
            throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
        }

        // Delete from filesystem first; if DB delete fails the file is already gone —
        // orphaned records are harmless since storedFilename is system-generated.
        await this.storage.deleteUpload(input.userId, input.projectId, asset.storedFilename);
        await this.assetRepository.delete(input.assetId, input.projectId, input.userId);
    }
}
