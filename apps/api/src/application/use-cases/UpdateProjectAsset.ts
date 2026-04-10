import { updateProjectAssetSchema } from "@andy-code-cat/contracts";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";

export class UpdateProjectAsset {
    constructor(private readonly assetRepository: ProjectAssetRepository) { }

    async execute(input: {
        assetId: string;
        projectId: string;
        userId: string;
        rawData: unknown;
    }): Promise<ProjectAsset> {
        const data = updateProjectAssetSchema.parse(input.rawData);

        const updated = await this.assetRepository.update(
            input.assetId,
            input.projectId,
            input.userId,
            data
        );

        if (!updated) {
            throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
        }

        return updated;
    }
}
