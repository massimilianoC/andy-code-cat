import type { BrandAsset, CreateBrandAssetInput, UpdateBrandAssetInput } from "../entities/BrandAsset";

export interface BrandAssetRepository {
    findById(id: string): Promise<BrandAsset | null>;
    listPlatform(): Promise<BrandAsset[]>;
    listByUser(userId: string): Promise<BrandAsset[]>;
    listByProject(projectId: string, userId: string): Promise<BrandAsset[]>;
    resolveForContext(opts: { userId?: string; projectId?: string }): Promise<BrandAsset[]>;
    create(input: CreateBrandAssetInput): Promise<BrandAsset>;
    update(id: string, patch: UpdateBrandAssetInput): Promise<BrandAsset>;
    delete(id: string): Promise<boolean>;
}
