import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";

export class ListUserMediaLibrary {
    constructor(private readonly assetRepository: ProjectAssetRepository) {}

    execute(userId: string): Promise<ProjectAsset[]> {
        return this.assetRepository.listByUser(userId);
    }
}
