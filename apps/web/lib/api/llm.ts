import { call, ApiError, getSharedRefreshPromise, setSharedRefreshPromise, refreshAccessToken } from "./call";
import { getAccessToken, isAccessTokenExpired } from "../token-store";

export interface ApiErrorPayload {
    error?: string;
    code?: string;
    status?: number;
    userMessage?: string;
    details?: unknown;
}

export interface LlmHistoryMessage {
    role: "user" | "assistant";
    content: string;
}

export interface LlmCurrentArtifacts {
    html?: string;
    css?: string;
    js?: string;
}

export interface LlmFocusContext {
    mode: "project" | "preview-element" | "code-selection";
    targetType: "html" | "css" | "js" | "component" | "section";
    userIntent?: string;
    selectedElement?: {
        stableNodeId: string;
        selector: string;
        tag: string;
        classes: string[];
        textSnippet?: string;
        outerHtml?: string;
        currentSrc?: string;
        currentAlt?: string;
        backgroundImageUrl?: string;
        mediaMode?: "foreground" | "background" | "none";
        originalWidth?: number;
        originalHeight?: number;
        aspectRatio?: number;
    };
    codeSelection?: {
        language: "html" | "css" | "js";
        startLine: number;
        endLine: number;
        selectedText?: string;
    };
}

export interface LlmChatInput {
    message: string;
    assetIds?: string[];
    provider?: string;
    model?: string;
    capability?: "chat" | "vision" | "image_generation" | "video_generation" | "tools" | "embeddings";
    max_tokens?: number;
    thinking_budget?: number;
    pipelineRole?: string;
    temperature?: number;
    systemPrompt?: string;
    history?: LlmHistoryMessage[];
    currentArtifacts?: LlmCurrentArtifacts;
    focusContext?: LlmFocusContext;
    /** BCP-47 UI language from the client (e.g. "it", "en"). Fallback source for Layer L. */
    uiLanguage?: string;
}

/**
 * One entry of the structured system-prompt breakdown — mirrors the backend
 * composer (composeSystemPromptWithLayers) and the persisted promptingTrace.layers.
 * `span` indexes into the corresponding `effectiveSystemPrompt` string.
 */
export interface PromptLayerEntryDto {
    id: string;
    key: string;
    label: string;
    source: string;
    chars: number;
    span: [number, number];
}

export interface LlmChatPreviewResult {
    reply: string;
    rawResponse?: string;
    structuredParseValid?: boolean;
    promptingTrace?: {
        originalUserMessage: string;
        /** MongoDB _id of the llm_prompt_configs document used to build the pipeline wrapper */
        promptConfigId?: string;
        prePromptTemplate?: string;
        effectiveSystemPrompt: string;
        messagesSentToLlm: Array<{
            role: "system" | "user";
            content: string;
        }>;
        /** Structured system-prompt layer breakdown, in composition order. Absent for legacy traces or focused-mode edits. */
        layers?: PromptLayerEntryDto[];
    };
    structured?: {
        chat: {
            summary: string;
            bullets: string[];
            nextActions: string[];
        };
        artifacts: {
            html: string;
            css: string;
            js: string;
        };
    };
    mediaResolution?: {
        version: "media-resolution-v1";
        traceIds: string[];
        assetIds: string[];
        mediaKeys: string[];
        degraded: boolean;
    };
    provider: string;
    model: string;
    finishReason?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    costEstimate?: {
        currency: "EUR";
        amount: number;
        breakdown: {
            tokenCost: number;
            imageCost: number;
            videoCost: number;
        };
        unitRates: {
            textEurPer1kTokens: number;
            imageEurPerAsset: number;
            videoEurPerAsset: number;
        };
        providerCostUsd?: number;
    };
    durationMs: number;
    simulated: boolean;
    focusPatchApplied?: boolean;
    focusPatchParseError?: boolean;
}

export interface LlmChatDefaults {
    temperature: number;
    pipelineRole: "coding" | "coding_fast" | "dialogue" | "dialogue_fast" | "vision" | "vision_fast" | "quality_check" | "image_gen" | "image_gen_fast" | "embeddings";
    capability: "chat" | "vision" | "image_generation" | "video_generation" | "tools" | "embeddings";
    historyMaxMessages: number;
    historyMessageMaxChars: number;
    maxCompletionTokens: number;
    attachmentMaxFiles?: number;
    attachmentMaxTotalBytes?: number;
}

export interface LlmPromptConfig {
    id: string;
    projectId: string;
    enabled: boolean;
    responseFormatVersion: string;
    prePromptTemplate: string;
    /** Backend-driven call defaults. Always read these instead of hardcoding in the client. */
    chatDefaults?: LlmChatDefaults;
    createdAt: string;
    updatedAt: string;
}

export interface OptimizePromptInput {
    rawPrompt: string;
    assetIds?: string[];
    conversationId?: string;
    sessionId?: string;
    provider?: string;
    model?: string;
    /** Task key to resolve platform task settings (e.g. "zero_effort_optimize"). Defaults to "optimize_user_prompt". */
    taskKey?: string;
}

export interface OptimizePromptResult {
    taskKey: string;
    optimizedPrompt: string;
    provider: string;
    model: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    costEstimate?: {
        currency: "EUR";
        amount: number;
        breakdown: {
            tokenCost: number;
            imageCost: number;
            videoCost: number;
        };
        unitRates: {
            textEurPer1kTokens: number;
            imageEurPerAsset: number;
            videoEurPerAsset: number;
        };
        providerCostUsd?: number;
    };
    durationMs: number;
    skipped?: boolean;
    rawResponse?: string;
    finishReason?: string;
    promptingTrace?: {
        originalUserMessage: string;
        effectiveSystemPrompt: string;
        messagesSentToLlm: Array<{
            role: "system" | "user";
            content: string;
        }>;
    };
}

export interface PromptUsageSummaryResult {
    totalCost: number;
    totalTokens: number;
    runs: number;
}

export type MediaProgressPhase = "start" | "resolving" | "resolved" | "failed" | "replacing" | "done";

export type LlmChatStreamEvent =
    | { type: "thinking"; content: string }
    | { type: "answer"; content: string }
    | {
        type: "media_progress";
        phase: MediaProgressPhase;
        mediaKey?: string;
        index?: number;
        total?: number;
        provider?: string;
        fallbackUsed?: boolean;
        resolvedCount?: number;
    }
    | { type: "done"; result: LlmChatPreviewResult }
    | { type: "error"; message: string; durationMs?: number; error?: ApiErrorPayload }
    | {
        type: "interrupted";
        provider: string;
        model: string;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
        costEstimate?: { currency: "EUR"; amount: number; breakdown: { tokenCost: number; imageCost: number; videoCost: number }; unitRates: { textEurPer1kTokens: number; imageEurPerAsset: number; videoEurPerAsset: number } };
        durationMs: number;
        partialReply?: string;
    };

export type OptimizePromptStreamEvent =
    | { type: "thinking"; content: string }
    | { type: "answer"; content: string }
    | { type: "done"; result: OptimizePromptResult }
    | { type: "error"; message: string; durationMs?: number; error?: ApiErrorPayload };

export interface LlmProviderCatalogDto {
    provider: string;
    baseUrl: string;
    apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
    authType?: "api-key" | "bearer" | "none";
    isActive: boolean;
    requiresKey: boolean;
    hasApiKeyConfigured: boolean;
    keyEnvironmentVariable?: string;
    models: Array<{
        id: string;
        provider: string;
        role: string;
        capabilities: string[];
        isDefault: boolean;
        isFallback: boolean;
        isActive: boolean;
        displayName?: string;
        description?: string;
        promptTemplate?: string;
        focusPromptTemplate?: string;
        priceTier?: "free" | "€" | "€€" | "€€€" | "€€€€";
    }>;
}

export interface LlmProvidersResponse {
    source: "env" | "mongo";
    providers: LlmProviderCatalogDto[];
    byokEnabled: boolean;
    activeProvider: string;
    hasProviderApiKeyConfigured: boolean;
}

export interface PromptPreviewResponse {
    dryRun: true;
    provider: string;
    model: string;
    effectiveSystemPrompt: string;
    layers: PromptLayerEntryDto[];
    tokenEstimate: number;
}

export function llmChatPreview(
    token: string,
    projectId: string,
    input: LlmChatInput
) {
    return call<LlmChatPreviewResult>("POST", `/v1/projects/${projectId}/llm/chat-preview`, input, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}

export function getLlmProviders(token: string) {
    return call<LlmProvidersResponse>("GET", "/v1/llm/providers", undefined, {
        Authorization: `Bearer ${token}`,
    });
}

export async function streamLlmChatPreview(
    token: string,
    projectId: string,
    input: LlmChatInput,
    onEvent: (event: LlmChatStreamEvent) => void,
    signal?: AbortSignal
) {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

    // Proactive token refresh — mirrors the logic in call() so streaming
    // requests don't bypass the auth-refresh mechanism.
    let effectiveToken = getAccessToken() ?? token;
    if (isAccessTokenExpired()) {
        try {
            if (!getSharedRefreshPromise()) {
                setSharedRefreshPromise(refreshAccessToken());
            }
            effectiveToken = await getSharedRefreshPromise()!;
            setSharedRefreshPromise(null);
        } catch {
            setSharedRefreshPromise(null);
            throw new ApiError(401, { error: "Sessione scaduta" });
        }
    }

    const res = await fetch(`${baseUrl}/v1/projects/${projectId}/llm/chat-preview/stream`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${effectiveToken}`,
            "x-project-id": projectId,
        },
        body: JSON.stringify(input),
        signal,
    });

    if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new ApiError(res.status, text || { error: "Stream unavailable" });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
            const line = chunk
                .split("\n")
                .find((l) => l.startsWith("data:"));
            if (!line) continue;

            const payload = line.slice(5).trim();
            if (!payload) continue;

            let event: LlmChatStreamEvent;
            try {
                event = JSON.parse(payload) as LlmChatStreamEvent;
            } catch {
                // Ignore malformed JSON lines.
                continue;
            }
            onEvent(event);
        }
    }
}

export function getLlmPromptConfig(token: string, projectId: string) {
    return call<{ config: LlmPromptConfig }>("GET", `/v1/projects/${projectId}/llm/prompt-config`, undefined, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}

export function getLlmPromptPreview(
    token: string,
    projectId: string,
    params?: { uiLanguage?: string; provider?: string; model?: string; pipelineRole?: string; capability?: string }
) {
    const query = new URLSearchParams();
    if (params?.uiLanguage) query.set("uiLanguage", params.uiLanguage);
    if (params?.provider) query.set("provider", params.provider);
    if (params?.model) query.set("model", params.model);
    if (params?.pipelineRole) query.set("pipelineRole", params.pipelineRole);
    if (params?.capability) query.set("capability", params.capability);
    const qs = query.toString();
    return call<PromptPreviewResponse>("GET", `/v1/projects/${projectId}/llm/prompt-preview${qs ? `?${qs}` : ""}`, undefined, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}

export function setLlmPromptConfig(
    token: string,
    projectId: string,
    input: { enabled: boolean; responseFormatVersion: string; prePromptTemplate: string }
) {
    return call<{ config: LlmPromptConfig }>("PUT", `/v1/projects/${projectId}/llm/prompt-config`, input, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}

export function optimizePrompt(token: string, projectId: string, input: OptimizePromptInput) {
    return call<OptimizePromptResult>("POST", `/v1/projects/${projectId}/llm/optimize-prompt`, input, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}

export async function streamOptimizePrompt(
    token: string,
    projectId: string,
    input: OptimizePromptInput,
    onEvent: (event: OptimizePromptStreamEvent) => void,
    signal?: AbortSignal
) {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

    let effectiveToken = getAccessToken() ?? token;
    if (isAccessTokenExpired()) {
        try {
            if (!getSharedRefreshPromise()) {
                setSharedRefreshPromise(refreshAccessToken());
            }
            effectiveToken = await getSharedRefreshPromise()!;
            setSharedRefreshPromise(null);
        } catch {
            setSharedRefreshPromise(null);
            throw new ApiError(401, { error: "Sessione scaduta" });
        }
    }

    const res = await fetch(`${baseUrl}/v1/projects/${projectId}/llm/optimize-prompt/stream`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${effectiveToken}`,
            "x-project-id": projectId,
        },
        body: JSON.stringify(input),
        signal,
    });

    if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new ApiError(res.status, text || { error: "Optimizer stream unavailable" });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
            const line = chunk
                .split("\n")
                .find((l) => l.startsWith("data:"));
            if (!line) continue;

            const payload = line.slice(5).trim();
            if (!payload) continue;

            try {
                const event = JSON.parse(payload) as OptimizePromptStreamEvent;
                onEvent(event);
            } catch {
                continue;
            }
        }
    }
}

export function getPromptUsageSummary(token: string, projectId: string) {
    return call<PromptUsageSummaryResult>("GET", `/v1/projects/${projectId}/llm/prompt-usage-summary`, undefined, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}
