import { call, ApiError } from "./call";

export interface ProjectAssetDto {
    id: string;
    projectId: string;
    scope: "project" | "user" | "global";
    originalName: string;
    mimeType: string;
    fileSize: number;
    source: "user_upload" | "url_reference" | "platform_generated";
    label?: string;
    useInProject?: boolean;
    styleRole?: "inspiration" | "material" | "logo" | "background" | "icon" | "watermark" | "reference";
    descriptionText?: string;
    externalUrl?: string;
    generationStatus?: "queued" | "ready" | "failed";
    generationPrompt?: string;
    generationMetadata?: {
        provider: string;
        model?: string;
        imageSize?: string;
        numInferenceSteps?: number;
        requestedAt: string;
        completedAt?: string;
        latencyMs?: number;
        revisedPrompt?: string;
        finishReason?: string;
        providerRequestId?: string;
        sourceUrl?: string;
        outputMimeType?: string;
        width?: number;
        height?: number;
        tokenUsage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
        };
        cost?: {
            currency: "EUR";
            amount: number;
            source: "provider" | "flat-rate";
            providerCostUsd?: number;
        };
        errorMessage?: string;
        providerResponse?: Record<string, unknown>;
    };
    semanticMetadata?: {
        title: string;
        summary: string;
        description: string;
        tags: string[];
        colors: string[];
        mediaKind: "image" | "background" | "logo" | "icon" | "document" | "reference";
        classifierProvider: string;
        classifierModel: string;
        classifiedAt: string;
    };
    createdAt: string;
}

export interface GenerateProjectImageInput {
    prompt: string;
    fileNameHint?: string;
    scope?: "project" | "user";
    provider?: "siliconflow" | "system";
    model?: string;
    imageSize?: string;
    numInferenceSteps?: number;
    targetMode?: "foreground" | "background";
    selectedElement?: {
        stableNodeId: string;
        selector: string;
        tag: string;
        currentSrc?: string;
        currentAlt?: string;
        backgroundImageUrl?: string;
        mediaMode?: "foreground" | "background" | "none";
    };
    mediaConfig?: {
        fit?: "cover" | "contain" | "auto";
        repeat?: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
        opacity?: number;
        filter?: string;
    };
}

export interface GenerateProjectImageResult {
    taskId: string;
    status: "queued";
    mode: "placeholder" | "live";
    asset: ProjectAssetDto;
    storagePath: string;
    downloadUrl: string;
    cssDefaults: {
        fit: "cover" | "contain" | "auto";
        repeat: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
        position: "center center";
        opacity: number;
        filter: string;
    };
}

export interface AiUsageRecentRequestDto {
    id: string;
    kind: "llm" | "image";
    status: string;
    provider: string;
    model?: string;
    createdAt: string;
    costEur: number;
    totalTokens?: number;
    promptPreview: string;
    imageSize?: string;
}

export interface AiUsageAnalyticsDto {
    totals: {
        totalCost: number;
        llmCost: number;
        imageCost: number;
        totalTokens: number;
        llmRuns: number;
        imageRuns: number;
        queuedImages: number;
        failedImages: number;
    };
    topModels: Array<{
        kind: "llm" | "image";
        provider: string;
        model: string;
        runs: number;
        totalCost: number;
        totalTokens?: number;
    }>;
    recentRequests: AiUsageRecentRequestDto[];
}

export function listProjectAssets(token: string, projectId: string) {
    return call<{ assets: ProjectAssetDto[] }>(
        "GET",
        `/v1/projects/${projectId}/assets`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export async function uploadProjectAsset(
    token: string,
    projectId: string,
    file: File,
    meta?: { label?: string; scope?: "project" | "user"; useInProject?: boolean; styleRole?: string; descriptionText?: string }
): Promise<{ asset: ProjectAssetDto }> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const formData = new FormData();
    formData.append("file", file);
    if (meta?.label) formData.append("label", meta.label);
    if (meta?.scope) formData.append("scope", meta.scope);
    if (meta?.useInProject !== undefined) formData.append("useInProject", String(meta.useInProject));
    if (meta?.styleRole) formData.append("styleRole", meta.styleRole);
    if (meta?.descriptionText) formData.append("descriptionText", meta.descriptionText);

    const res = await fetch(`${baseUrl}/v1/projects/${projectId}/assets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-project-id": projectId },
        body: formData,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json);
    return json as { asset: ProjectAssetDto };
}

export function addUrlReference(
    token: string,
    projectId: string,
    data: { url: string; label?: string; scope?: "project" | "user"; useInProject?: boolean; styleRole?: string; descriptionText?: string }
) {
    return call<{ asset: ProjectAssetDto }>(
        "POST",
        `/v1/projects/${projectId}/assets/url`,
        data,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function updateProjectAsset(
    token: string,
    projectId: string,
    assetId: string,
    data: { label?: string; useInProject?: boolean; styleRole?: string; descriptionText?: string }
) {
    return call<{ asset: ProjectAssetDto }>(
        "PATCH",
        `/v1/projects/${projectId}/assets/${assetId}`,
        data,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function deleteProjectAsset(token: string, projectId: string, assetId: string) {
    return call<void>(
        "DELETE",
        `/v1/projects/${projectId}/assets/${assetId}`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function generateProjectImage(token: string, projectId: string, data: GenerateProjectImageInput) {
    return call<GenerateProjectImageResult>(
        "POST",
        `/v1/projects/${projectId}/assets/generate-image`,
        data,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function getProjectAiAnalytics(token: string, projectId: string) {
    return call<AiUsageAnalyticsDto>(
        "GET",
        `/v1/projects/${projectId}/assets/analytics`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export async function downloadProjectAssetDataUrl(token: string, projectId: string, assetId: string): Promise<string> {
    const res = await fetch(getAssetDownloadUrl(projectId, assetId), {
        headers: { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    });

    const json = await res.clone().json().catch(() => undefined);
    if (!res.ok) throw new ApiError(res.status, json);

    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Unable to read asset preview"));
        reader.onloadend = () => resolve(String(reader.result ?? ""));
        reader.readAsDataURL(blob);
    });
}

/** Returns the download URL for an asset (use with fetch + Authorization header). */
export function getAssetDownloadUrl(projectId: string, assetId: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    return `${baseUrl}/v1/projects/${projectId}/assets/${assetId}/download`;
}
