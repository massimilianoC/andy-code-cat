import type { CostEstimate } from "../../domain/entities/Conversation";
import { resolvePromptTaskSettingFromConfig } from "../../domain/entities/PlatformConfig";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import { env } from "../../config";
import { estimateCost } from "../llm/costPolicy";
import { getSiliconFlowPrice } from "../llm/siliconflowPricing";
import { buildChatCompletionRequestBody } from "../llm/chatRequestAdapter";
import type { GetLlmCatalog } from "../use-cases/GetLlmCatalog";
import { buildContextAwareImagePrompt, type ImagePromptContextPacket } from "./buildImagePromptContext";
import { buildSuggestImageIdeaRequest } from "./buildSuggestImageIdeaInstruction";

const TASK_KEY = "suggest_image_direction";
const FALLBACK_PROVIDER = "siliconflow";
const FALLBACK_MODEL = "MiniMaxAI/MiniMax-M2.5";

type SuggestionUsage = {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
};

export interface SuggestProjectImageIdeaResult {
    suggestion: string;
    suggestedPrompt: string;
    provider: string;
    model: string;
    durationMs: number;
    skipped: boolean;
    usage?: SuggestionUsage;
    costEstimate?: CostEstimate;
}

function resolveAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none") {
    if (authType === "none") return undefined;
    const key = env.providerApiKeys[providerKey];
    if (!key) return undefined;
    return (authType ?? "bearer") === "api-key" ? key : `Bearer ${key}`;
}

function estimateTokens(input: { messages: Array<{ content: string }>; outputText: string }): SuggestionUsage {
    const promptChars = input.messages.reduce((acc, msg) => acc + msg.content.length, 0);
    const promptTokens = Math.max(1, Math.round(promptChars / 4));
    const completionTokens = Math.max(1, Math.round(input.outputText.length / 4));
    return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
    };
}

function buildFallbackSuggestion(packet: ImagePromptContextPacket, rawPrompt?: string): { suggestion: string; suggestedPrompt: string } {
    const style = packet.styleHints[0] ?? "clean";
    const palette = packet.paletteHints.slice(0, 2).join(", ");
    const readable = rawPrompt?.trim()
        ? `A ${style} ${packet.sectionRole} visual that supports ${rawPrompt.trim()}${palette ? ` with ${palette} tones` : ""}.`
        : `A ${style} ${packet.sectionRole} visual that fits the page tone${palette ? ` with ${palette} tones` : ""}.`;

    const suggestedPrompt = buildContextAwareImagePrompt({
        rawPrompt: rawPrompt?.trim() || readable,
        packet,
    });

    return {
        suggestion: readable.slice(0, 180),
        suggestedPrompt,
    };
}

function parseSuggestionPayload(rawContent: string): { suggestion?: string; prompt?: string } {
    try {
        const parsed = JSON.parse(rawContent) as Record<string, unknown>;
        return {
            suggestion: typeof parsed.suggestion === "string" ? parsed.suggestion.trim() : undefined,
            prompt: typeof parsed.prompt === "string" ? parsed.prompt.trim() : undefined,
        };
    } catch {
        return {};
    }
}

export class SuggestProjectImageIdea {
    constructor(
        private readonly platformConfigRepository: PlatformConfigRepository,
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly getLlmCatalog: GetLlmCatalog,
    ) { }

    async execute(input: {
        projectId: string;
        userId: string;
        productKey: string;
        rawPrompt?: string;
        packet: ImagePromptContextPacket;
        projectPresetId?: string;
        usedMoodboard: boolean;
        usedUserProfile: boolean;
        provider?: string;
        model?: string;
    }): Promise<SuggestProjectImageIdeaResult> {
        const startedAt = Date.now();
        const fallback = buildFallbackSuggestion(input.packet, input.rawPrompt);
        const platformConfig = await this.platformConfigRepository.get().catch(() => null);
        const taskSettings = resolvePromptTaskSettingFromConfig(platformConfig, input.productKey, TASK_KEY);
        const { systemPrompt, userPrompt } = buildSuggestImageIdeaRequest({
            rawPrompt: input.rawPrompt,
            packet: input.packet,
            systemTemplate: taskSettings.systemTemplate,
        });

        const persistLog = async (status: "succeeded" | "failed", suggestion: string, usage?: SuggestionUsage, costEstimate?: CostEstimate, errorMessage?: string, provider?: string, model?: string) => {
            await this.promptExecutionLogRepository.create({
                taskKey: TASK_KEY,
                projectId: input.projectId,
                userId: input.userId,
                provider: provider ?? input.provider ?? taskSettings.provider ?? FALLBACK_PROVIDER,
                model: model ?? input.model ?? taskSettings.model ?? FALLBACK_MODEL,
                inputPrompt: input.rawPrompt ?? "",
                optimizedPrompt: suggestion,
                renderedSystemPrompt: systemPrompt,
                renderedUserPrompt: userPrompt,
                contextMeta: {
                    projectPresetId: input.projectPresetId,
                    projectType: input.packet.projectType,
                    detectedDomain: [input.packet.projectName],
                    assetIds: input.packet.selectedAssetIds,
                    usedMoodboard: input.usedMoodboard,
                    usedUserProfile: input.usedUserProfile,
                },
                usage,
                costEstimate,
                status,
                errorMessage,
                durationMs: Date.now() - startedAt,
            }).catch(() => { });
        };

        if (!taskSettings.enabled) {
            return {
                suggestion: fallback.suggestion,
                suggestedPrompt: fallback.suggestedPrompt,
                provider: input.provider ?? taskSettings.provider ?? FALLBACK_PROVIDER,
                model: input.model ?? taskSettings.model ?? FALLBACK_MODEL,
                durationMs: Date.now() - startedAt,
                skipped: true,
            };
        }

        try {
            const catalog = await this.getLlmCatalog.execute();
            const activeProviders = catalog.providers.filter((provider) => provider.isActive);
            const requestedModel = input.model?.trim();

            const selectedProviderCatalog =
                activeProviders.find((provider) => provider.provider === input.provider)
                ?? (requestedModel
                    ? activeProviders.find((provider) => provider.models.some((model) => model.isActive && model.id === requestedModel))
                    : undefined)
                ?? activeProviders.find((provider) => provider.provider === taskSettings.provider)
                ?? activeProviders.find((provider) => provider.provider === env.LLM_DEFAULT_PROVIDER)
                ?? activeProviders.find((provider) => provider.provider === FALLBACK_PROVIDER)
                ?? activeProviders[0];

            if (!selectedProviderCatalog) {
                await persistLog("failed", fallback.suggestion, undefined, undefined, "No active provider configured for suggestion");
                return {
                    suggestion: fallback.suggestion,
                    suggestedPrompt: fallback.suggestedPrompt,
                    provider: FALLBACK_PROVIDER,
                    model: FALLBACK_MODEL,
                    durationMs: Date.now() - startedAt,
                    skipped: true,
                };
            }

            const providerCatalog = selectedProviderCatalog;

            const activeModels = providerCatalog.models.filter((model) => model.isActive);
            const modelId =
                (requestedModel && providerCatalog.apiType === "openai-compatible" ? requestedModel : undefined)
                || (taskSettings.model && activeModels.some((model) => model.id === taskSettings.model) ? taskSettings.model : undefined)
                || activeModels.find((model) => model.role === "dialogue" && model.isDefault)?.id
                || activeModels.find((model) => model.isDefault)?.id
                || activeModels[0]?.id
                || FALLBACK_MODEL;

            const authHeader = resolveAuthHeader(providerCatalog.provider, providerCatalog.authType);
            if (!authHeader && providerCatalog.authType !== "none") {
                await persistLog("failed", fallback.suggestion, undefined, undefined, `Missing API key for provider ${providerCatalog.provider}`, providerCatalog.provider, modelId);
                return {
                    suggestion: fallback.suggestion,
                    suggestedPrompt: fallback.suggestedPrompt,
                    provider: providerCatalog.provider,
                    model: modelId,
                    durationMs: Date.now() - startedAt,
                    skipped: true,
                };
            }

            const messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ] as const;

            const response = await fetch(`${providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(authHeader ? { Authorization: authHeader } : {}),
                },
                body: JSON.stringify(buildChatCompletionRequestBody({
                    provider: providerCatalog.provider,
                    model: modelId,
                    maxTokens: Math.min(taskSettings.maxCompletionTokens, env.LLM_MAX_COMPLETION_TOKENS),
                    temperature: taskSettings.temperature,
                    messages: [...messages],
                })),
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(`Suggest image provider error ${response.status}`);
            }

            const rawContent = String(payload?.choices?.[0]?.message?.content ?? "").trim();
            const parsed = parseSuggestionPayload(rawContent);
            const suggestion = parsed.suggestion || fallback.suggestion;
            const suggestedPrompt = parsed.prompt || fallback.suggestedPrompt;
            const usage = payload?.usage
                ? {
                    promptTokens: Number(payload.usage.prompt_tokens ?? 0),
                    completionTokens: Number(payload.usage.completion_tokens ?? 0),
                    totalTokens: Number(payload.usage.total_tokens ?? 0),
                }
                : estimateTokens({ messages: [...messages], outputText: rawContent || suggestion });

            let providerCostUsd: number | undefined = undefined;
            if (typeof payload?.usage?.cost === "number") {
                providerCostUsd = payload.usage.cost;
            } else if (providerCatalog.provider === "siliconflow") {
                const sfPrice = getSiliconFlowPrice(modelId);
                if (sfPrice && sfPrice.priceUnit === "per_m_tokens") {
                    providerCostUsd =
                        (usage.promptTokens / 1_000_000) * sfPrice.input +
                        (usage.completionTokens / 1_000_000) * sfPrice.output;
                }
            }

            const costEstimate = estimateCost(
                { capability: "chat", tokenUsage: usage, providerCostUsd },
                {
                    textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                    imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                    videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                    usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
                    providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
                },
            );

            await persistLog("succeeded", suggestion, usage, costEstimate, undefined, providerCatalog.provider, modelId);

            return {
                suggestion,
                suggestedPrompt,
                provider: providerCatalog.provider,
                model: modelId,
                durationMs: Date.now() - startedAt,
                skipped: false,
                usage,
                costEstimate,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Image suggestion failed";
            await persistLog("failed", fallback.suggestion, undefined, undefined, message);
            return {
                suggestion: fallback.suggestion,
                suggestedPrompt: fallback.suggestedPrompt,
                provider: input.provider ?? taskSettings.provider ?? FALLBACK_PROVIDER,
                model: input.model ?? taskSettings.model ?? FALLBACK_MODEL,
                durationMs: Date.now() - startedAt,
                skipped: true,
            };
        }
    }
}
