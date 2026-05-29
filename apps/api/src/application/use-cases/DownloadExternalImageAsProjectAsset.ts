import path from "path";
import type { AssetGenerationMetadata, ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import type { ExternalImageDownloader } from "../../infra/image/ExternalImageDownloader";
import type { ResolvedImageSearchResult } from "../../infra/image/types";
import { SavePlatformAsset } from "./SavePlatformAsset";

function extensionFromMimeType(mimeType: string): string {
    if (mimeType === "image/jpeg") return ".jpg";
    if (mimeType === "image/png") return ".png";
    if (mimeType === "image/webp") return ".webp";
    if (mimeType === "image/gif") return ".gif";
    return path.extname(mimeType).replace(/[^a-z0-9.]/gi, "") || ".img";
}

function safeLabel(query: string): string {
    return query
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "stock-image";
}

export class DownloadExternalImageAsProjectAsset {
    constructor(
        private readonly assetRepository: ProjectAssetRepository,
        private readonly storage: IFileStorage,
        private readonly downloader: ExternalImageDownloader,
    ) { }

    async execute(input: {
        projectId: string;
        userId: string;
        query: string;
        resolved: ResolvedImageSearchResult;
        targetMode?: "foreground" | "background";
        scope?: "project" | "user";
        sourceContext?: Record<string, unknown>;
    }): Promise<ProjectAsset> {
        const startedAt = new Date();
        const downloaded = await this.downloader.download(input.resolved.url);
        const completedAt = new Date();
        const label = safeLabel(input.query);
        const originalName = `${label}${extensionFromMimeType(downloaded.mimeType)}`;

        const saver = new SavePlatformAsset(this.assetRepository, this.storage);
        const created = await saver.execute({
            projectId: input.projectId,
            userId: input.userId,
            originalName,
            mimeType: downloaded.mimeType,
            buffer: downloaded.buffer,
            label,
            scope: input.scope ?? "project",
        });

        const metadata: AssetGenerationMetadata = {
            provider: input.resolved.provider,
            model: "stock-search",
            requestedAt: startedAt,
            completedAt,
            latencyMs: completedAt.getTime() - startedAt.getTime(),
            revisedPrompt: input.query,
            finishReason: "stock-image-persisted",
            sourceUrl: downloaded.finalUrl,
            outputMimeType: downloaded.mimeType,
            width: input.resolved.width,
            height: input.resolved.height,
            providerResponse: {
                query: input.query,
                attribution: input.resolved.attribution,
                fallbackUsed: input.resolved.fallbackUsed,
                attemptedProviders: input.resolved.attemptedProviders,
                sourceContext: input.sourceContext,
            },
        };

        return (await this.assetRepository.update(created.id, input.projectId, input.userId, {
            label,
            useInProject: true,
            styleRole: input.targetMode === "background" ? "background" : "material",
            descriptionText: `Stock image for "${input.query}" via ${input.resolved.provider}`.slice(0, 500),
            generationStatus: "ready",
            generationPrompt: input.query,
            generationMetadata: metadata,
        })) ?? created;
    }
}
