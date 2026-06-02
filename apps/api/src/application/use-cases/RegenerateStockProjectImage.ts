import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { ServiceApiKeyRepository } from "../../domain/repositories/ServiceApiKeyRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import { FetchExternalImageDownloader, type ExternalImageDownloader } from "../../infra/image/ExternalImageDownloader";
import { resolveImageWithTrace, type ImageKeyOverrides } from "../../infra/image/ImageServiceOrchestrator";
import type { ImageProviderId, ResolvedImageSearchResult } from "../../infra/image/types";
import { env } from "../../config";
import { ExecutionLogger } from "../services/ExecutionLogger";
import { buildStockProviderOrder, resolveMediaProviderPolicy } from "../media/mediaProviderPolicy";
import { DownloadExternalImageAsProjectAsset } from "./DownloadExternalImageAsProjectAsset";
import { notifyMediaPersistenceFailure, notifyMediaProviderFallback, notifyMediaResolutionFailure } from "../media/mediaNotifications";

async function resolveDbKeys(keyRepo?: ServiceApiKeyRepository): Promise<ImageKeyOverrides> {
    if (!keyRepo) return {};

    const overrides: ImageKeyOverrides = {};
    const services = ["pexels", "pixabay", "unsplash"] as const;
    await Promise.all(services.map(async (service) => {
        try {
            const key = await keyRepo.findActiveByService(service);
            if (key) overrides[service] = await keyRepo.resolvePlaintext(key);
        } catch {
            // Env fallback remains available.
        }
    }));
    return overrides;
}

function publicAssetUrl(assetId: string): string {
    return `${env.PUBLIC_API_BASE_URL.replace(/\/$/, "")}/p/media/${assetId}`;
}

export class RegenerateStockProjectImage {
    constructor(
        private readonly assetRepository: ProjectAssetRepository,
        private readonly storage: IFileStorage,
        private readonly keyRepo?: ServiceApiKeyRepository,
        private readonly downloader: ExternalImageDownloader = new FetchExternalImageDownloader(),
        private readonly resolveImage = resolveImageWithTrace,
        private readonly platformConfigRepository?: PlatformConfigRepository,
    ) { }

    async execute(input: {
        projectId: string;
        userId: string;
        query: string;
        width?: number;
        height?: number;
        offset?: number;
        targetSelector?: string;
        targetMode?: "foreground" | "background";
        scope?: "project" | "user";
        suppressNotifications?: boolean;
        allowFallback?: boolean;
        lineage?: {
            conversationId?: string;
            sourceMessageId?: string;
            parentSnapshotId?: string;
            mediaKey?: string;
            semanticQuery?: string;
            resolutionRoute?: string;
        };
    }): Promise<{
        asset: ProjectAsset;
        assetUrl: string;
        provider: ImageProviderId;
        fallbackUsed: boolean;
        attribution: string;
        attemptedProviders: ResolvedImageSearchResult["attemptedProviders"];
    }> {
        const [keyOverrides, platformConfig] = await Promise.all([
            resolveDbKeys(this.keyRepo),
            this.platformConfigRepository?.get().catch(() => null) ?? Promise.resolve(null),
        ]);
        const policy = resolveMediaProviderPolicy(platformConfig);
        const providerOrder = input.allowFallback === false
            ? [policy.stockImage.primaryProvider]
            : buildStockProviderOrder(policy);
        const offset = Math.max(0, input.offset ?? 0);
        let resolved: ResolvedImageSearchResult;
        try {
            resolved = await this.resolveImage({
                query: input.query,
                width: input.width,
                height: input.height,
                perPage: Math.max(1, offset + 1),
                resultIndex: offset,
            }, keyOverrides, providerOrder) as ResolvedImageSearchResult;
        } catch (error) {
            if (!input.suppressNotifications) notifyMediaResolutionFailure({
                projectId: input.projectId,
                userId: input.userId,
                query: input.query,
                error: error instanceof Error ? error.message : "Image resolution failed",
                sourceContext: { route: "edit-regenerate-stock", targetSelector: input.targetSelector, offset },
            });
            throw error;
        }

        const saver = new DownloadExternalImageAsProjectAsset(this.assetRepository, this.storage, this.downloader);
        let asset: ProjectAsset;
        try {
            asset = await saver.execute({
                projectId: input.projectId,
                userId: input.userId,
                query: input.query,
                resolved,
                targetMode: input.targetMode,
                scope: input.scope,
                sourceContext: {
                    route: input.lineage?.resolutionRoute ?? "edit-regenerate-stock",
                    targetSelector: input.targetSelector,
                    offset,
                    conversationId: input.lineage?.conversationId,
                    sourceMessageId: input.lineage?.sourceMessageId,
                    parentSnapshotId: input.lineage?.parentSnapshotId,
                    mediaKey: input.lineage?.mediaKey,
                    semanticQuery: input.lineage?.semanticQuery ?? input.query,
                },
            });
        } catch (error) {
            if (!input.suppressNotifications) notifyMediaPersistenceFailure({
                projectId: input.projectId,
                userId: input.userId,
                query: input.query,
                finalProvider: resolved.provider,
                attemptedProviders: resolved.attemptedProviders,
                error: error instanceof Error ? error.message : "Image persistence failed",
                sourceContext: { route: "edit-regenerate-stock", targetSelector: input.targetSelector, offset },
            });
            throw error;
        }

        if (resolved.fallbackUsed && !input.suppressNotifications) {
            notifyMediaProviderFallback({
                projectId: input.projectId,
                userId: input.userId,
                query: input.query,
                assetId: asset.id,
                finalProvider: resolved.provider,
                attemptedProviders: resolved.attemptedProviders,
                sourceContext: { route: "edit-regenerate-stock", targetSelector: input.targetSelector, offset },
            });
        }

        ExecutionLogger.instance.emit({
            projectId: input.projectId,
            domain: "system",
            eventType: resolved.fallbackUsed ? "image_provider_fallback_used" : "stock_image_regenerated",
            level: resolved.fallbackUsed ? "warn" : "info",
            status: "success",
            metadata: {
                assetId: asset.id,
                query: input.query,
                targetSelector: input.targetSelector,
                finalProvider: resolved.provider,
                fallbackUsed: resolved.fallbackUsed,
                attemptedProviders: resolved.attemptedProviders,
                conversationId: input.lineage?.conversationId,
                sourceMessageId: input.lineage?.sourceMessageId,
                parentSnapshotId: input.lineage?.parentSnapshotId,
                mediaKey: input.lineage?.mediaKey,
                semanticQuery: input.lineage?.semanticQuery ?? input.query,
                resolutionRoute: input.lineage?.resolutionRoute ?? "edit-regenerate-stock",
            },
        });

        return {
            asset,
            assetUrl: publicAssetUrl(asset.id),
            provider: resolved.provider,
            fallbackUsed: resolved.fallbackUsed,
            attribution: resolved.attribution,
            attemptedProviders: resolved.attemptedProviders,
        };
    }
}
