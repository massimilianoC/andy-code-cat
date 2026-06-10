import type { BrandAssetRepository } from "../../domain/repositories/BrandAssetRepository";
import type { BrandAsset, BrandAssetScope } from "../../domain/entities/BrandAsset";

export class ListBrandAssets {
    constructor(private readonly brandAssetRepository: BrandAssetRepository) {}

    async execute(opts: {
        scope: BrandAssetScope;
        userId?: string;
        projectId?: string;
    }): Promise<BrandAsset[]> {
        if (opts.scope === "platform") return this.brandAssetRepository.listPlatform();
        if (opts.scope === "user" && opts.userId) return this.brandAssetRepository.listByUser(opts.userId);
        if (opts.scope === "project" && opts.projectId && opts.userId) {
            return this.brandAssetRepository.listByProject(opts.projectId, opts.userId);
        }
        return [];
    }
}
