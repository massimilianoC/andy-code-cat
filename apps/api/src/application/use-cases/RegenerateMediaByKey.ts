import type { ArtifactMediaRequest } from "@andy-code-cat/contracts";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { MediaResolutionTraceRepository } from "../../domain/repositories/MediaResolutionTraceRepository";
import type { CreateMediaResolutionTraceInput } from "../../domain/repositories/MediaResolutionTraceRepository";

type StockRegenerator = {
    execute(input: {
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
    }): Promise<{
        asset: ProjectAsset;
        assetUrl: string;
        provider: string;
        fallbackUsed: boolean;
        attribution: string;
        attemptedProviders: Array<{ provider: string; status: "success" | "failed" | "skipped"; reason?: string }>;
    }>;
};

function isArtifactMediaRequest(value: Record<string, unknown>): value is ArtifactMediaRequest {
    return typeof value.key === "string"
        && typeof value.semanticQuery === "string"
        && typeof value.sourceStrategy === "string";
}

export class RegenerateMediaByKey {
    constructor(
        private readonly traceRepository: MediaResolutionTraceRepository,
        private readonly stockRegenerator: StockRegenerator,
    ) { }

    async execute(input: {
        projectId: string;
        userId: string;
        mediaKey: string;
        snapshotId?: string;
        offset?: number;
        width?: number;
        height?: number;
        targetSelector?: string;
        targetMode?: "foreground" | "background";
        scope?: "project" | "user";
    }) {
        const previousTrace = await this.traceRepository.findLatestByMediaKey({
            projectId: input.projectId,
            userId: input.userId,
            mediaKey: input.mediaKey,
            snapshotId: input.snapshotId,
        });

        if (!previousTrace) {
            throw Object.assign(new Error(`No media resolution trace found for media key "${input.mediaKey}"`), { statusCode: 404 });
        }

        if (!isArtifactMediaRequest(previousTrace.request)) {
            throw Object.assign(new Error(`Stored media request for "${input.mediaKey}" cannot be regenerated`), { statusCode: 409 });
        }

        if (previousTrace.strategy !== "auto" && previousTrace.strategy !== "stock") {
            throw Object.assign(new Error(`Media strategy "${previousTrace.strategy}" is not supported by stock regeneration`), { statusCode: 409 });
        }

        const request = previousTrace.request;
        const result = await this.stockRegenerator.execute({
            projectId: input.projectId,
            userId: input.userId,
            query: request.semanticQuery,
            width: input.width ?? request.width,
            height: input.height ?? request.height,
            offset: input.offset,
            targetSelector: input.targetSelector ?? previousTrace.sourceContext.selectedElementSelector,
            targetMode: input.targetMode,
            scope: input.scope,
            suppressNotifications: true,
            allowFallback: false,
        });

        const traceInput: CreateMediaResolutionTraceInput = {
            projectId: input.projectId,
            userId: input.userId,
            parentSnapshotId: input.snapshotId ?? previousTrace.snapshotId,
            conversationId: previousTrace.conversationId,
            mediaKey: input.mediaKey,
            request,
            resolvedAssetId: result.asset.id,
            strategy: previousTrace.strategy,
            providerKind: previousTrace.providerKind,
            requestedProvider: result.attemptedProviders[0]?.provider,
            finalProvider: result.provider,
            fallbackUsed: result.fallbackUsed,
            attemptedProviders: result.attemptedProviders,
            status: result.fallbackUsed ? "fallback_resolved" : "resolved",
            sourceContext: {
                route: "edit-regenerate-media-key",
                selectedElementSelector: input.targetSelector ?? previousTrace.sourceContext.selectedElementSelector,
            },
        };

        const [trace] = await this.traceRepository.createMany([traceInput]);

        return {
            ...result,
            mediaKey: input.mediaKey,
            traceId: trace?.id,
        };
    }
}