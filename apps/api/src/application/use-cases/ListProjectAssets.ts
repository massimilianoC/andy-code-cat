import type { ProjectAsset, AssetSource } from "../../domain/entities/ProjectAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";

export class ListProjectAssets {
    constructor(private readonly assetRepository: ProjectAssetRepository) { }

    async execute(projectId: string, userId: string, source?: AssetSource): Promise<ProjectAsset[]> {
        return this.assetRepository.listByProject(projectId, userId, source);
    }
}
