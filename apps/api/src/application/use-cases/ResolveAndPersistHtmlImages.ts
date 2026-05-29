import { env } from "../../config";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { ServiceApiKeyRepository } from "../../domain/repositories/ServiceApiKeyRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import { FetchExternalImageDownloader, type ExternalImageDownloader } from "../../infra/image/ExternalImageDownloader";
import { resolveImageWithTrace, type ImageKeyOverrides } from "../../infra/image/ImageServiceOrchestrator";
import type { ImageProviderId, ResolvedImageSearchResult } from "../../infra/image/types";
import { ExecutionLogger } from "../services/ExecutionLogger";
import { buildStockProviderOrder, resolveMediaProviderPolicy } from "../media/mediaProviderPolicy";
import { DownloadExternalImageAsProjectAsset } from "./DownloadExternalImageAsProjectAsset";
import { notifyMediaPersistenceFailure, notifyMediaProviderFallback } from "../media/mediaNotifications";

const LOREMFLICKR_RE = /https:\/\/loremflickr\.com\/(\d+)\/(\d+)\/([^/"'\s&?]+)(?:\?[^"'\s]*)?/g;
const PICSUM_SEED_RE = /https:\/\/picsum\.photos\/seed\/([^/"'\s]+)\/(\d+)\/(\d+)(?:\?[^"'\s]*)?/g;

interface ResolveTuple {
    placeholderUrl: string;
    query: string;
    width: number;
    height: number;
}

export interface PersistedImageResolutionEvent {
    query: string;
    originalUrl: string;
    finalUrl?: string;
    assetId?: string;
    provider?: ImageProviderId;
    fallbackUsed?: boolean;
    error?: string;
}

function assetPublicUrl(assetId: string): string {
    return `${env.PUBLIC_API_BASE_URL.replace(/\/$/, "")}/p/media/${assetId}`;
}

function extractPlaceholders(html: string): ResolveTuple[] {
    const tuples: ResolveTuple[] = [];

    for (const match of html.matchAll(LOREMFLICKR_RE)) {
        tuples.push({
            placeholderUrl: match[0],
            query: decodeURIComponent(match[3]!),
            width: Number(match[1]!),
            height: Number(match[2]!),
        });
    }

    for (const match of html.matchAll(PICSUM_SEED_RE)) {
        tuples.push({
            placeholderUrl: match[0],
            query: decodeURIComponent(match[1]!),
            width: Number(match[2]!),
            height: Number(match[3]!),
        });
    }

    return tuples;
}

async function resolveDbKeys(keyRepo?: ServiceApiKeyRepository): Promise<ImageKeyOverrides> {
    if (!keyRepo) return {};

    const overrides: ImageKeyOverrides = {};
    const services = ["pexels", "pixabay", "unsplash"] as const;
    await Promise.all(services.map(async (service) => {
        try {
            const key = await keyRepo.findActiveByService(service);
            if (key) {
                overrides[service] = await keyRepo.resolvePlaintext(key);
            }
        } catch {
            // Env fallback remains available in the image orchestrator.
        }
    }));
    return overrides;
}

export class ResolveAndPersistHtmlImages {
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
        html: string;
        sourceContext?: Record<string, unknown>;
        strictPersistence?: boolean;
    }): Promise<{
        html: string;
        assets: ProjectAsset[];
        events: PersistedImageResolutionEvent[];
    }> {
        const placeholders = extractPlaceholders(input.html);
        if (placeholders.length === 0) {
            return { html: input.html, assets: [], events: [] };
        }

        const [keyOverrides, platformConfig] = await Promise.all([
            resolveDbKeys(this.keyRepo),
            this.platformConfigRepository?.get().catch(() => null) ?? Promise.resolve(null),
        ]);
        const policy = resolveMediaProviderPolicy(platformConfig);
        const providerOrder = buildStockProviderOrder(policy);
        const strictPersistence = input.strictPersistence ?? policy.stockImage.strictPersistence ?? env.imageStockPersistStrict;
        const downloader = new DownloadExternalImageAsProjectAsset(this.assetRepository, this.storage, this.downloader);
        const replacements = new Map<string, string>();
        const assets: ProjectAsset[] = [];
        const events: PersistedImageResolutionEvent[] = [];

        for (const tuple of placeholders) {
            try {
                const resolved = await this.resolveImage(
                    { query: tuple.query, width: tuple.width, height: tuple.height },
                    keyOverrides,
                    providerOrder,
                ) as ResolvedImageSearchResult;

                const asset = await downloader.execute({
                    projectId: input.projectId,
                    userId: input.userId,
                    query: tuple.query,
                    resolved,
                    targetMode: "foreground",
                    sourceContext: input.sourceContext,
                });

                const finalUrl = assetPublicUrl(asset.id);
                replacements.set(tuple.placeholderUrl, finalUrl);
                assets.push(asset);
                events.push({
                    query: tuple.query,
                    originalUrl: tuple.placeholderUrl,
                    finalUrl,
                    assetId: asset.id,
                    provider: resolved.provider,
                    fallbackUsed: resolved.fallbackUsed,
                });

                if (resolved.fallbackUsed) {
                    notifyMediaProviderFallback({
                        projectId: input.projectId,
                        userId: input.userId,
                        query: tuple.query,
                        assetId: asset.id,
                        finalProvider: resolved.provider,
                        attemptedProviders: resolved.attemptedProviders,
                        sourceContext: input.sourceContext,
                    });

                    ExecutionLogger.instance.emit({
                        projectId: input.projectId,
                        domain: "system",
                        eventType: "image_provider_fallback_used",
                        level: "warn",
                        status: "success",
                        metadata: {
                            assetId: asset.id,
                            query: tuple.query,
                            finalProvider: resolved.provider,
                            attemptedProviders: resolved.attemptedProviders,
                            sourceContext: input.sourceContext,
                        },
                    });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : "Image persistence failed";
                events.push({
                    query: tuple.query,
                    originalUrl: tuple.placeholderUrl,
                    error: message,
                });

                ExecutionLogger.instance.emit({
                    projectId: input.projectId,
                    domain: "system",
                    eventType: "image_provider_persistence_failed",
                    level: "error",
                    status: "failure",
                    metadata: {
                        query: tuple.query,
                        originalUrl: tuple.placeholderUrl,
                        error: message,
                        sourceContext: input.sourceContext,
                    },
                });

                notifyMediaPersistenceFailure({
                    projectId: input.projectId,
                    userId: input.userId,
                    query: tuple.query,
                    error: message,
                    sourceContext: input.sourceContext,
                });

                if (strictPersistence) {
                    throw error;
                }
            }
        }

        let html = input.html;
        for (const [from, to] of replacements.entries()) {
            html = html.split(from).join(to);
        }

        return { html, assets, events };
    }
}
