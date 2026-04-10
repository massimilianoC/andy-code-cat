import { call, ApiError, getSharedRefreshPromise, setSharedRefreshPromise, refreshAccessToken } from "./call";
import { getAccessToken, isAccessTokenExpired } from "../token-store";

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
}

export interface LlmChatDefaults {
    temperature: number;
    pipelineRole: "coding" | "coding_fast" | "dialogue" | "dialogue_fast" | "vision" | "vision_fast" | "quality_check" | "image_gen" | "image_gen_fast" | "embeddings";
    capability: "chat" | "vision" | "image_generation" | "video_generation" | "tools" | "embeddings";
    historyMaxMessages: number;
    historyMessageMaxChars: number;
    maxCompletionTokens: number;
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

export type LlmChatStreamEvent =
    | { type: "thinking"; content: string }
    | { type: "answer"; content: string }
    | { type: "done"; result: LlmChatPreviewResult }
    | { type: "error"; message: string; durationMs?: number }
    | {
        type: "interrupted";
        provider: string;
        model: string;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
        costEstimate?: { currency: "EUR"; amount: number; breakdown: { tokenCost: number; imageCost: number; videoCost: number }; unitRates: { textEurPer1kTokens: number; imageEurPerAsset: number; videoEurPerAsset: number } };
        durationMs: number;
        partialReply?: string;
    };

export interface LlmProviderCatalogDto {
    provider: string;
    baseUrl: string;
    apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
    authType?: "api-key" | "bearer" | "none";
    isActive: boolean;
    models: Array<{
        id: string;
        provider: string;
        role: string;
        capabilities: string[];
        isDefault: boolean;
        isFallback: boolean;
        isActive: boolean;
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

export interface LlmPromptPreviewDto {
    presetId: string | null;
    layers: {
        a_baseConstraints: string;
        b_presetModule: string;
        c_styleContext: string;
        d_prePromptTemplate: string;
        budgetPolicy: string;
    };
    composed: string;
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

export function getLlmPromptPreview(token: string, projectId: string) {
    return call<LlmPromptPreviewDto>("GET", `/v1/projects/${projectId}/llm/prompt-preview`, undefined, {
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
