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
import { buildOptimizeImagePromptRequest } from "./optimizeImagePromptInstruction";
import { CostTransactionService } from "../cost/CostTransactionService";
import { ResourceType } from "../../domain/entities/CostTransaction";

const TASK_KEY = "optimize_image_prompt";
const FALLBACK_PROVIDER = "siliconflow";
const FALLBACK_MODEL = "MiniMaxAI/MiniMax-M2.5";

type OptimizerUsage = {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
};

export interface OptimizeImagePromptResult {
    optimizedPrompt: string;
    provider: string;
    model: string;
    durationMs: number;
    skipped: boolean;
    usage?: OptimizerUsage;
    costEstimate?: CostEstimate;
    rawResponse?: string;
    promptingTrace: {
        systemPrompt: string;
        userPrompt: string;
        fallbackPrompt: string;
        contextSummary: string;
        selectedAssetIds: string[];
    };
}

function resolveAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none") {
    if (authType === "none") return undefined;
    const key = env.providerApiKeys[providerKey];
    if (!key) return undefined;
    return (authType ?? "bearer") === "api-key" ? key : `Bearer ${key}`;
}

function estimateTokens(input: { messages: Array<{ content: string }>; outputText: string }): OptimizerUsage {
    const promptChars = input.messages.reduce((acc, msg) => acc + msg.content.length, 0);
    const promptTokens = Math.max(1, Math.round(promptChars / 4));
    const completionTokens = Math.max(1, Math.round(input.outputText.length / 4));
    return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
    };
}

export class OptimizeImagePrompt {
    constructor(
        private readonly platformConfigRepository: PlatformConfigRepository,
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly getLlmCatalog: GetLlmCatalog,
    ) { }

    async execute(input: {
        projectId: string;
        userId: string;
        productKey: string;
        rawPrompt: string;
        packet: ImagePromptContextPacket;
        projectPresetId?: string;
        usedMoodboard: boolean;
        usedUserProfile: boolean;
        provider?: string;
        model?: string;
    }): Promise<OptimizeImagePromptResult> {
        const startedAt = Date.now();
        const fallbackPrompt = buildContextAwareImagePrompt({
            rawPrompt: input.rawPrompt,
            packet: input.packet,
        });

        const platformConfig = await this.platformConfigRepository.get().catch(() => null);
        const taskSettings = resolvePromptTaskSettingFromConfig(platformConfig, input.productKey, TASK_KEY);
        const { systemPrompt, userPrompt } = buildOptimizeImagePromptRequest({
            rawPrompt: input.rawPrompt,
            packet: input.packet,
            systemTemplate: taskSettings.systemTemplate,
        });

        const baseTrace = {
            systemPrompt,
            userPrompt,
            fallbackPrompt,
            contextSummary: input.packet.contextSummary,
            selectedAssetIds: input.packet.selectedAssetIds,
        };

        const persistFailure = async (errorMessage: string) => {
            await this.promptExecutionLogRepository.create({
                taskKey: TASK_KEY,
                projectId: input.projectId,
                userId: input.userId,
                provider: input.provider ?? taskSettings.provider ?? FALLBACK_PROVIDER,
                model: input.model ?? taskSettings.model ?? FALLBACK_MODEL,
                inputPrompt: input.rawPrompt,
                optimizedPrompt: fallbackPrompt,
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
                status: "failed",
                errorMessage,
                durationMs: Date.now() - startedAt,
            }).catch(() => { });
        };

        if (!taskSettings.enabled) {
            return {
                optimizedPrompt: fallbackPrompt,
                provider: input.provider ?? taskSettings.provider ?? FALLBACK_PROVIDER,
                model: input.model ?? taskSettings.model ?? FALLBACK_MODEL,
                durationMs: Date.now() - startedAt,
                skipped: true,
                rawResponse: fallbackPrompt,
                promptingTrace: baseTrace,
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
                await persistFailure("No active provider configured for image prompt optimization");
                return {
                    optimizedPrompt: fallbackPrompt,
                    provider: FALLBACK_PROVIDER,
                    model: FALLBACK_MODEL,
                    durationMs: Date.now() - startedAt,
                    skipped: true,
                    rawResponse: fallbackPrompt,
                    promptingTrace: baseTrace,
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
                await persistFailure(`Missing API key for provider ${providerCatalog.provider}`);
                return {
                    optimizedPrompt: fallbackPrompt,
                    provider: providerCatalog.provider,
                    model: modelId,
                    durationMs: Date.now() - startedAt,
                    skipped: true,
                    rawResponse: fallbackPrompt,
                    promptingTrace: baseTrace,
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
                throw new Error(`Image prompt optimizer provider error ${response.status}`);
            }

            const optimizedPrompt = String(payload?.choices?.[0]?.message?.content ?? "").trim() || fallbackPrompt;
            const usage = payload?.usage
                ? {
                    promptTokens: Number(payload.usage.prompt_tokens ?? 0),
                    completionTokens: Number(payload.usage.completion_tokens ?? 0),
                    totalTokens: Number(payload.usage.total_tokens ?? 0),
                }
                : estimateTokens({ messages: [...messages], outputText: optimizedPrompt });

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

            await this.promptExecutionLogRepository.create({
                taskKey: TASK_KEY,
                projectId: input.projectId,
                userId: input.userId,
                provider: providerCatalog.provider,
                model: modelId,
                inputPrompt: input.rawPrompt,
                optimizedPrompt,
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
                status: "succeeded",
                durationMs: Date.now() - startedAt,
            }).catch(() => { });

            // ── Cost ledger: image prompt optimization LLM call (fire-and-forget) ──
            if (costEstimate) {
                CostTransactionService.instance.record({
                    userId: input.userId,
                    projectId: input.projectId,
                    resourceType: ResourceType.IMAGE_PROMPT_OPT,
                    resourceSubtype: modelId,
                    providerCostUsd: providerCostUsd,
                    precomputedTotalEur: costEstimate.amount,
                    units: {
                        promptTokens: usage.promptTokens,
                        completionTokens: usage.completionTokens,
                        totalTokens: usage.totalTokens,
                    },
                    meta: {
                        provider: providerCatalog.provider,
                        model: modelId,
                    },
                });
            }
            // ── end cost ledger ───────────────────────────────────────────────

            return {
                optimizedPrompt,
                provider: providerCatalog.provider,
                model: modelId,
                durationMs: Date.now() - startedAt,
                skipped: false,
                usage,
                costEstimate,
                rawResponse: String(payload?.choices?.[0]?.message?.content ?? optimizedPrompt),
                promptingTrace: baseTrace,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Image prompt optimization failed";
            await persistFailure(message);
            return {
                optimizedPrompt: fallbackPrompt,
                provider: input.provider ?? taskSettings.provider ?? FALLBACK_PROVIDER,
                model: input.model ?? taskSettings.model ?? FALLBACK_MODEL,
                durationMs: Date.now() - startedAt,
                skipped: true,
                rawResponse: fallbackPrompt,
                promptingTrace: baseTrace,
            };
        }
    }
}
