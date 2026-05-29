import type {
    ArtifactMediaManifest,
    ArtifactMediaRequest,
    LlmStructuredArtifacts,
    MediaDirectiveSummary,
    MediaResolutionMetadata,
    MediaSourceStrategy,
} from "@andy-code-cat/contracts";
import { env } from "../../config";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { ServiceApiKeyRepository } from "../../domain/repositories/ServiceApiKeyRepository";
import type {
    CreateMediaResolutionTraceInput,
    MediaResolutionTraceRepository,
} from "../../domain/repositories/MediaResolutionTraceRepository";
import { type ExternalImageDownloader, FetchExternalImageDownloader } from "../../infra/image/ExternalImageDownloader";
import { resolveImageWithTrace } from "../../infra/image/ImageServiceOrchestrator";
import type { ImageProviderId, ImageResolutionAttempt } from "../../infra/image/types";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import { ExecutionLogger } from "../services/ExecutionLogger";
import { RegenerateStockProjectImage } from "../use-cases/RegenerateStockProjectImage";
import { ResolveAndPersistHtmlImages } from "../use-cases/ResolveAndPersistHtmlImages";
import { notifyMediaProviderFallback, notifyMediaResolutionFailure } from "./mediaNotifications";
import { extractDataMediaKeyAttributes, extractMediaPlaceholderKeys, injectMediaByDataKey, replaceMediaPlaceholders } from "./replaceMediaPlaceholders";
import { validateMediaManifest } from "./validateMediaManifest";

export interface MediaResolutionWarning {
    code:
    | "manifest_request_unreferenced"
    | "unsupported_media_strategy"
    | "strategy_downgraded_to_stock"
    | "media_resolution_failed"
    | "legacy_url_resolved";
    mediaKey?: string;
    message: string;
}

export interface MediaResolutionTrace {
    traceId?: string;
    mediaKey: string;
    request: ArtifactMediaRequest;
    strategy: MediaSourceStrategy;
    provider: ImageProviderId | "unsupported";
    providerKind: "stock" | "image_generation" | "project_asset" | "user_library";
    assetId?: string;
    assetUrl?: string;
    fallbackUsed: boolean;
    attemptedProviders: ImageResolutionAttempt[];
}

/**
 * Progress event emitted during media resolution so callers (e.g. the streaming
 * chat-preview route) can forward step-by-step feedback to the UI via SSE.
 * Deterministic phases: start -> (resolving/resolved/failed)* -> replacing -> done.
 */
export interface MediaProgressEvent {
    phase: "start" | "resolving" | "resolved" | "failed" | "replacing" | "done";
    mediaKey?: string;
    /** Completion index (1-based) for resolved/failed phases. */
    index?: number;
    /** Total number of media requests to resolve. */
    total?: number;
    provider?: string;
    fallbackUsed?: boolean;
    /** Number of successfully resolved media at the "done" phase. */
    resolvedCount?: number;
}

export interface ResolveArtifactMediaInput {
    projectId: string;
    userId: string;
    artifacts: LlmStructuredArtifacts;
    mediaManifest?: ArtifactMediaManifest;
    sourceContext: {
        route: "chat-preview" | "chat-preview-stream" | "focus-patch" | "edit-regenerate" | "manual-asset-apply";
        conversationId?: string;
        parentSnapshotId?: string;
        selectedElementSelector?: string;
        focusPatchApplied?: boolean;
    };
    mode: "initial_generation" | "focused_edit" | "manual_regeneration";
    /** Optional progress sink. Never throws into resolution; failures are swallowed. */
    onProgress?: (event: MediaProgressEvent) => void;
}

export interface ResolveArtifactMediaResult {
    artifacts: LlmStructuredArtifacts;
    resolvedAssets: ProjectAsset[];
    traces: MediaResolutionTrace[];
    warnings: MediaResolutionWarning[];
    metadata?: MediaResolutionMetadata;
}

function isStockBackedStrategy(strategy: MediaSourceStrategy): boolean {
    return strategy === "auto" || strategy === "stock";
}

function dimensionsFor(request: ArtifactMediaRequest): { width: number; height: number } {
    if (request.width && request.height) {
        return { width: request.width, height: request.height };
    }

    if (request.aspectRatio && request.aspectRatio > 0) {
        const width = request.width ?? 1200;
        return { width, height: Math.max(64, Math.round(width / request.aspectRatio)) };
    }

    if (request.kind === "background" || request.role === "hero" || request.role === "background") {
        return { width: request.width ?? 1600, height: request.height ?? 900 };
    }

    if (request.kind === "avatar" || request.role === "avatar") {
        return { width: request.width ?? 512, height: request.height ?? 512 };
    }

    return { width: request.width ?? 1200, height: request.height ?? 800 };
}

function targetModeFor(request: ArtifactMediaRequest): "foreground" | "background" {
    return request.kind === "background" || request.role === "background" || request.role === "hero"
        ? "background"
        : "foreground";
}

export class ResolveArtifactMedia {
    private readonly stockResolver: RegenerateStockProjectImage;
    private readonly legacyHtmlResolver: ResolveAndPersistHtmlImages;

    constructor(
        assetRepository: ProjectAssetRepository,
        storage: IFileStorage,
        keyRepo?: ServiceApiKeyRepository,
        downloader: ExternalImageDownloader = new FetchExternalImageDownloader(),
        imageResolver = resolveImageWithTrace,
        platformConfigRepository?: PlatformConfigRepository,
        private readonly traceRepository?: MediaResolutionTraceRepository,
    ) {
        this.stockResolver = new RegenerateStockProjectImage(
            assetRepository,
            storage,
            keyRepo,
            downloader,
            imageResolver,
            platformConfigRepository,
        );
        this.legacyHtmlResolver = new ResolveAndPersistHtmlImages(
            assetRepository,
            storage,
            keyRepo,
            downloader,
            imageResolver,
            platformConfigRepository,
        );
    }

    /** Safely emit a progress event — a throwing sink must never break resolution. */
    private emitProgress(input: ResolveArtifactMediaInput, event: MediaProgressEvent): void {
        if (!input.onProgress) return;
        try {
            input.onProgress(event);
        } catch {
            // Progress sink failure is non-fatal.
        }
    }

    async execute(input: ResolveArtifactMediaInput): Promise<ResolveArtifactMediaResult> {
        const manifest = validateMediaManifest(input.mediaManifest);
        let artifacts = input.artifacts;
        const resolvedAssets: ProjectAsset[] = [];
        const traces: MediaResolutionTrace[] = [];
        const warnings: MediaResolutionWarning[] = [];

        if (manifest) {
            const manifestResult = await this.resolveManifestRequests(input, manifest, artifacts);
            artifacts = manifestResult.artifacts;
            resolvedAssets.push(...manifestResult.resolvedAssets);
            traces.push(...manifestResult.traces);
            warnings.push(...manifestResult.warnings);
        } else {
            // No manifest (either absent or dropped because it was invalid).
            // If the HTML/CSS still contains asset://media/* placeholders (from a manifest
            // that failed validation), strip them so the page renders without broken image
            // references. The legacy URL resolver below will still run for any provider URLs.
            const unresolvedManifestKeys = extractMediaPlaceholderKeys(artifacts);
            if (unresolvedManifestKeys.length > 0) {
                if (env.imageStockPersistStrict) {
                    throw new Error(`Missing mediaManifest for placeholders: ${unresolvedManifestKeys.join(", ")}`);
                }
                // Non-strict: strip placeholders, add warnings, continue.
                const emptyReplacements = new Map(unresolvedManifestKeys.map((key) => [key, ""]));
                const stripped = replaceMediaPlaceholders(artifacts, emptyReplacements);
                artifacts = stripped.artifacts;
                for (const key of unresolvedManifestKeys) {
                    warnings.push({
                        code: "media_resolution_failed",
                        mediaKey: key,
                        message: `Placeholder "${key}" had no valid mediaManifest and was removed. Regenerate this image from Edit mode.`,
                    });
                }
            }
        }

        const legacyResult = await this.legacyHtmlResolver.execute({
            projectId: input.projectId,
            userId: input.userId,
            html: artifacts.html,
            sourceContext: {
                ...input.sourceContext,
                mediaOrchestratorMode: input.mode,
                legacyUrlFallback: true,
            },
            strictPersistence: env.imageStockPersistStrict,
        });

        if (legacyResult.assets.length > 0) {
            artifacts = { ...artifacts, html: legacyResult.html };
            resolvedAssets.push(...legacyResult.assets);
            warnings.push({
                code: "legacy_url_resolved",
                message: "Legacy provider URLs were resolved and persisted as project assets.",
            });
        }

        // Guard: detect data-media-key elements whose image was never resolved.
        // This catches the case where the LLM annotates an element with data-media-key
        // but uses a CSS gradient/inline style instead of an asset://media/ placeholder,
        // so the resolver never ran for that element.
        const resolvedKeys = new Set(traces.map((t) => t.mediaKey));
        const dataMediaKeys = extractDataMediaKeyAttributes(artifacts.html);
        const unresolvedAnnotated = dataMediaKeys.filter((key) => !resolvedKeys.has(key));
        if (unresolvedAnnotated.length > 0) {
            for (const key of unresolvedAnnotated) {
                warnings.push({
                    code: "media_resolution_failed",
                    mediaKey: key,
                    message: `Element with data-media-key="${key}" has no resolved stock image. Use Edit mode to regenerate it.`,
                });
                notifyMediaResolutionFailure({
                    projectId: input.projectId,
                    userId: input.userId,
                    mediaKey: key,
                    query: key,
                    error: "Element annotated with data-media-key but no asset://media/ placeholder was generated — image not fetched.",
                    sourceContext: input.sourceContext,
                });
            }
        }

        this.emitProgress(input, {
            phase: "done",
            resolvedCount: resolvedAssets.length,
            total: resolvedAssets.length + warnings.filter((w) => w.code === "media_resolution_failed").length,
        });

        return {
            artifacts,
            resolvedAssets,
            traces,
            warnings,
            metadata: buildMediaResolutionMetadata(traces, resolvedAssets, warnings, manifest?.requests),
        };
    }

    private async resolveManifestRequests(
        input: ResolveArtifactMediaInput,
        manifest: ArtifactMediaManifest,
        artifacts: LlmStructuredArtifacts,
    ): Promise<ResolveArtifactMediaResult> {
        const placeholderKeys = extractMediaPlaceholderKeys(artifacts);
        const placeholderKeySet = new Set(placeholderKeys);
        // data-media-key is a first-class deterministic anchor: a manifest request is resolved
        // if it is referenced by an asset://media placeholder OR by a data-media-key attribute.
        const dataMediaKeys = extractDataMediaKeyAttributes(artifacts.html);
        const requestsByKey = new Map(manifest.requests.map((request) => [request.key, request]));
        const replacements = new Map<string, string>();
        const warnings: MediaResolutionWarning[] = [];

        const missingRequests = placeholderKeys.filter((key) => !requestsByKey.has(key));
        if (missingRequests.length > 0) {
            throw new Error(`Missing mediaManifest request for placeholders: ${missingRequests.join(", ")}`);
        }

        // Keys to resolve: union of placeholder keys and data-media-key attributes that have a
        // matching manifest request. Preserve order: placeholders first, then data-key-only.
        const referencedKeys: string[] = [];
        const seenKeys = new Set<string>();
        for (const key of [...placeholderKeys, ...dataMediaKeys]) {
            if (seenKeys.has(key) || !requestsByKey.has(key)) continue;
            seenKeys.add(key);
            referencedKeys.push(key);
        }

        for (const request of manifest.requests) {
            if (!seenKeys.has(request.key)) {
                warnings.push({
                    code: "manifest_request_unreferenced",
                    mediaKey: request.key,
                    message: `mediaManifest request "${request.key}" is not referenced by an asset://media placeholder or a data-media-key attribute.`,
                });
            }
        }

        const referencedRequests = referencedKeys
            .map((key) => requestsByKey.get(key))
            .filter((request): request is ArtifactMediaRequest => Boolean(request));

        const total = referencedRequests.length;
        this.emitProgress(input, { phase: "start", total });
        let completed = 0;

        // Resolve every image independently: a single failure must not abort the others.
        const resolved = await Promise.all(referencedRequests.map(async (request) => {
            // Only stock/auto is implemented. Degrade any other strategy to stock so the
            // placeholder still resolves instead of leaving the whole artifact broken.
            const strategyDowngraded = !isStockBackedStrategy(request.sourceStrategy);
            const effectiveRequest = strategyDowngraded
                ? { ...request, sourceStrategy: "stock" as MediaSourceStrategy }
                : request;

            this.emitProgress(input, { phase: "resolving", mediaKey: effectiveRequest.key, total });

            const dimensions = dimensionsFor(effectiveRequest);
            try {
                const result = await this.stockResolver.execute({
                    projectId: input.projectId,
                    userId: input.userId,
                    query: effectiveRequest.semanticQuery,
                    width: dimensions.width,
                    height: dimensions.height,
                    targetMode: targetModeFor(effectiveRequest),
                    targetSelector: `[data-media-key="${effectiveRequest.key}"]`,
                    scope: "project",
                    suppressNotifications: true,
                });

                completed += 1;
                this.emitProgress(input, {
                    phase: "resolved",
                    mediaKey: effectiveRequest.key,
                    index: completed,
                    total,
                    provider: result.provider,
                    fallbackUsed: result.fallbackUsed,
                });

                return {
                    ok: true as const,
                    request: effectiveRequest,
                    asset: result.asset,
                    assetUrl: result.assetUrl,
                    strategyDowngraded,
                    originalStrategy: request.sourceStrategy,
                    trace: {
                        mediaKey: effectiveRequest.key,
                        request: effectiveRequest,
                        strategy: effectiveRequest.sourceStrategy,
                        provider: result.provider,
                        providerKind: "stock",
                        assetId: result.asset.id,
                        assetUrl: result.assetUrl,
                        fallbackUsed: result.fallbackUsed,
                        attemptedProviders: result.attemptedProviders,
                    } satisfies MediaResolutionTrace,
                };
            } catch (error) {
                // Notify but continue — the placeholder stays unresolved and the user can
                // fix it from Edit mode using the media-key regeneration flow.
                completed += 1;
                this.emitProgress(input, {
                    phase: "failed",
                    mediaKey: effectiveRequest.key,
                    index: completed,
                    total,
                });
                notifyMediaResolutionFailure({
                    projectId: input.projectId,
                    userId: input.userId,
                    mediaKey: effectiveRequest.key,
                    query: effectiveRequest.semanticQuery,
                    error: error instanceof Error ? error.message : "Media resolution failed",
                    sourceContext: input.sourceContext,
                });
                return {
                    ok: false as const,
                    request: effectiveRequest,
                    error: error instanceof Error ? error.message : "Media resolution failed",
                    strategyDowngraded,
                    originalStrategy: request.sourceStrategy,
                };
            }
        }));

        const resolvedAssets: ProjectAsset[] = [];
        const traces: MediaResolutionTrace[] = [];
        // Keys resolved WITHOUT an asset://media placeholder → injected via data-media-key.
        const dataKeyInjections = new Map<string, string>();
        for (const item of resolved) {
            if (item.strategyDowngraded) {
                warnings.push({
                    code: "strategy_downgraded_to_stock",
                    mediaKey: item.request.key,
                    message: `Media strategy "${item.originalStrategy}" is not yet implemented; resolved via stock instead.`,
                });
            }

            if (!item.ok) {
                warnings.push({
                    code: "media_resolution_failed",
                    mediaKey: item.request.key,
                    message: `Could not resolve media "${item.request.key}": ${item.error}`,
                });
                // Strict mode: abort the whole artifact on any single failure.
                if (env.imageStockPersistStrict) {
                    throw new Error(`Media resolution failed for "${item.request.key}": ${item.error}`);
                }
                continue;
            }

            if (placeholderKeySet.has(item.request.key)) {
                replacements.set(item.request.key, item.assetUrl);
            } else {
                // data-media-key anchor without placeholder → inject into the element.
                dataKeyInjections.set(item.request.key, item.assetUrl);
            }
            resolvedAssets.push(item.asset);
            traces.push(item.trace);
        }

        const persistedTraces = await this.persistTraces(input, traces);

        for (const trace of persistedTraces) {
            if (!trace.fallbackUsed) continue;
            notifyMediaProviderFallback({
                projectId: input.projectId,
                userId: input.userId,
                mediaKey: trace.mediaKey,
                query: trace.request.semanticQuery,
                assetId: trace.assetId,
                finalProvider: trace.provider,
                attemptedProviders: trace.attemptedProviders,
                sourceContext: input.sourceContext,
            });
        }

        this.emitProgress(input, { phase: "replacing", total });

        const replaced = replaceMediaPlaceholders(artifacts, replacements);
        // Inject resolved media for data-media-key anchors that had no placeholder.
        replaced.artifacts = injectMediaByDataKey(replaced.artifacts, dataKeyInjections);
        if (replaced.unresolvedKeys.length > 0) {
            // In strict mode throw so the caller knows the artifact is incomplete.
            // In non-strict mode the unresolved asset://media/* placeholders remain in the
            // artifact HTML/CSS; the publish/export guardrail will block publication until
            // the user fixes them via Edit-mode media-key regeneration.
            if (env.imageStockPersistStrict) {
                throw new Error(`Unresolved media placeholders: ${replaced.unresolvedKeys.join(", ")}`);
            }
            for (const key of replaced.unresolvedKeys) {
                warnings.push({
                    code: "media_resolution_failed",
                    mediaKey: key,
                    message: `Placeholder "${key}" could not be resolved. Use Edit mode to regenerate this image before publishing.`,
                });
            }
        }

        if (traces.length > 0 || warnings.length > 0) {
            ExecutionLogger.instance.emit({
                projectId: input.projectId,
                domain: "system",
                eventType: "artifact_media_resolved",
                level: warnings.some((warning) => warning.code === "unsupported_media_strategy") ? "warn" : "info",
                status: "success",
                metadata: {
                    mode: input.mode,
                    sourceContext: input.sourceContext,
                    resolvedCount: persistedTraces.length,
                    warnings,
                    traces: persistedTraces,
                },
            });
        }

        return { artifacts: replaced.artifacts, resolvedAssets, traces: persistedTraces, warnings };
    }

    private async persistTraces(
        input: ResolveArtifactMediaInput,
        traces: MediaResolutionTrace[],
    ): Promise<MediaResolutionTrace[]> {
        if (!this.traceRepository || traces.length === 0) {
            return traces;
        }

        const rows: CreateMediaResolutionTraceInput[] = traces.map((trace) => ({
            projectId: input.projectId,
            userId: input.userId,
            conversationId: input.sourceContext.conversationId,
            parentSnapshotId: input.sourceContext.parentSnapshotId,
            mediaKey: trace.mediaKey,
            request: trace.request as unknown as Record<string, unknown>,
            resolvedAssetId: trace.assetId,
            strategy: trace.strategy,
            providerKind: trace.providerKind,
            requestedProvider: trace.attemptedProviders[0]?.provider,
            finalProvider: trace.provider === "unsupported" ? undefined : trace.provider,
            fallbackUsed: trace.fallbackUsed,
            attemptedProviders: trace.attemptedProviders,
            status: trace.fallbackUsed ? "fallback_resolved" : "resolved",
            sourceContext: {
                route: input.sourceContext.route,
                selectedElementSelector: input.sourceContext.selectedElementSelector,
                focusPatchApplied: input.sourceContext.focusPatchApplied,
            },
        }));

        const persisted = await this.traceRepository.createMany(rows);
        const idsByMediaKey = new Map(persisted.map((trace) => [trace.mediaKey, trace.id]));

        return traces.map((trace) => ({
            ...trace,
            traceId: idsByMediaKey.get(trace.mediaKey),
        }));
    }
}

function buildMediaResolutionMetadata(
    traces: MediaResolutionTrace[],
    assets: ProjectAsset[],
    warnings: MediaResolutionWarning[],
    manifestRequests?: ArtifactMediaRequest[],
): MediaResolutionMetadata | undefined {
    const traceIds = traces.map((trace) => trace.traceId).filter((id): id is string => Boolean(id));
    const assetIds = assets.map((asset) => asset.id);
    // Media keys come from successful traces AND from degradation warnings (e.g. an
    // unresolved data-media-key, a dropped manifest, or a failed fetch) so the snapshot
    // carries structured proof of WHICH media degraded even when nothing was resolved.
    const traceKeys = traces.map((trace) => trace.mediaKey);
    const warningKeys = warnings
        .map((warning) => warning.mediaKey)
        .filter((key): key is string => Boolean(key));
    const mediaKeys = [...new Set([...traceKeys, ...warningKeys])];
    const degraded = traces.some((trace) => trace.fallbackUsed) || warnings.length > 0;

    // Build the per-media directive summary (audit): manifest baseline -> trace outcome -> warnings.
    const directiveByKey = new Map<string, MediaDirectiveSummary>();
    for (const request of manifestRequests ?? []) {
        directiveByKey.set(request.key, {
            key: request.key,
            role: request.role,
            semanticQuery: request.semanticQuery,
            status: "unresolved",
        });
    }
    for (const trace of traces) {
        directiveByKey.set(trace.mediaKey, {
            key: trace.mediaKey,
            role: trace.request?.role ?? directiveByKey.get(trace.mediaKey)?.role,
            semanticQuery: trace.request?.semanticQuery ?? directiveByKey.get(trace.mediaKey)?.semanticQuery,
            status: trace.fallbackUsed ? "fallback_resolved" : "resolved",
            provider: trace.provider === "unsupported" ? undefined : trace.provider,
            assetId: trace.assetId,
            fallbackUsed: trace.fallbackUsed,
        });
    }
    for (const key of warningKeys) {
        if (!directiveByKey.has(key)) {
            directiveByKey.set(key, { key, status: "unresolved" });
        }
    }
    const directives = [...directiveByKey.values()].slice(0, 50);

    // Only omit metadata when there is genuinely nothing to report (clean, no-media artifact).
    if (traceIds.length === 0 && assetIds.length === 0 && mediaKeys.length === 0 && !degraded && directives.length === 0) {
        return undefined;
    }

    return {
        version: "media-resolution-v1",
        traceIds,
        assetIds: [...new Set(assetIds)].slice(0, 50),
        mediaKeys: mediaKeys.slice(0, 50),
        degraded,
        directives: directives.length > 0 ? directives : undefined,
    };
}
