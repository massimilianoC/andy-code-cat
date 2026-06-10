import type { BrandAssetRepository } from "../../domain/repositories/BrandAssetRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";

export class DeleteBrandAsset {
    constructor(
        private readonly brandAssetRepository: BrandAssetRepository,
        private readonly storage: IFileStorage,
    ) {}

    async execute(id: string, opts: { ownerUserId?: string; scopeFolder: string }): Promise<boolean> {
        const asset = await this.brandAssetRepository.findById(id);
        if (!asset) return false;

        const deleted = await this.brandAssetRepository.delete(id);

        // Only delete the file if it was a direct upload (not promoted from an existing ProjectAsset)
        if (deleted && asset.valueType === "asset_ref" && asset.storedFilename && !asset.promotedFromAssetId) {
            const userId = asset.ownerUserId ?? "platform";
            await this.storage.deleteUpload(userId, opts.scopeFolder, asset.storedFilename).catch(() => {});
        }

        return deleted;
    }
}
