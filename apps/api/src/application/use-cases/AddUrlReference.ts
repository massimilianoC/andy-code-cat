import { addUrlReferenceSchema } from "@andy-code-cat/contracts";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";

/**
 * Adds a URL-only reference asset. No file is stored on disk.
 * The external URL is persisted in externalUrl; storedFilename is empty.
 * mimeType is set to "text/uri-list" to identify these records.
 */
export class AddUrlReference {
    constructor(private readonly assetRepository: ProjectAssetRepository) { }

    async execute(input: {
        projectId: string;
        userId: string;
        rawData: unknown;
    }): Promise<ProjectAsset> {
        const data = addUrlReferenceSchema.parse(input.rawData);

        // Derive a display name from the URL hostname
        let originalName: string;
        try {
            originalName = new URL(data.url).hostname;
        } catch {
            originalName = data.url.slice(0, 100);
        }

        return this.assetRepository.create({
            projectId: input.projectId,
            userId: input.userId,
            originalName,
            storedFilename: "",
            mimeType: "text/uri-list",
            fileSize: 0,
            source: "user_upload",
            label: data.label,
            styleRole: data.styleRole,
            descriptionText: data.descriptionText,
            externalUrl: data.url,
        });
    }
}
