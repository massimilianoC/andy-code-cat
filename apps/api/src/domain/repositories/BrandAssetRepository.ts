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

    /** Remove the project-scope brand assets of a project (project deletion). */
    deleteByProject(projectId: string, userId: string): Promise<number>;
    /** Remove every brand asset an account owns, any scope (account deletion). */
    deleteByUser(userId: string): Promise<number>;
}
