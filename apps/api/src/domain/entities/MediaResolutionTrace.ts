export type MediaResolutionProviderKind = "stock" | "image_generation" | "project_asset" | "user_library";

export type MediaResolutionStatus = "resolved" | "failed" | "fallback_resolved";

export type MediaResolutionStrategy = "auto" | "stock" | "image_generation" | "project_asset" | "user_library";

export interface MediaProviderAttempt {
    provider: string;
    status: "success" | "failed" | "skipped";
    reason?: string;
}

export interface MediaResolutionTrace {
    id: string;
    projectId: string;
    userId: string;
    snapshotId?: string;
    conversationId?: string;
    parentSnapshotId?: string;
    mediaKey: string;
    request: Record<string, unknown>;
    resolvedAssetId?: string;
    strategy: MediaResolutionStrategy;
    providerKind: MediaResolutionProviderKind;
    requestedProvider?: string;
    finalProvider?: string;
    fallbackUsed: boolean;
    attemptedProviders: MediaProviderAttempt[];
    status: MediaResolutionStatus;
    errorCode?: string;
    errorMessage?: string;
    sourceContext: {
        route: string;
        selectedElementSelector?: string;
        focusPatchApplied?: boolean;
    };
    createdAt: Date;
}
