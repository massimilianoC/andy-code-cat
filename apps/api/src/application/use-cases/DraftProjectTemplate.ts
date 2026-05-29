import type { ProjectPreset } from "../../domain/entities/ProjectPreset";
import { resolvePromptTaskSettingFromConfig } from "../../domain/entities/PlatformConfig";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import type { GetLlmCatalog } from "./GetLlmCatalog";
import { buildDraftProjectTemplateRequest } from "../prompting/draftProjectTemplateInstruction";
import { estimateCost, type CostEstimate } from "../llm/costPolicy";
import { getSiliconFlowPrice } from "../llm/siliconflowPricing";
import { buildChatCompletionRequestBody } from "../llm/chatRequestAdapter";
import { env } from "../../config";
import { CostTransactionService } from "../cost/CostTransactionService";
import { ResourceType } from "../../domain/entities/CostTransaction";

const TASK_KEY = "draft_template_model";
const FALLBACK_PROVIDER = "siliconflow";
const FALLBACK_MODEL = "MiniMaxAI/MiniMax-M2.5";
const INTERNAL_PROJECT_ID = "admin-template-registry";

interface DraftTemplateUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface DraftProjectTemplateResult {
    draft: Partial<ProjectPreset>;
    provider: string;
    model: string;
    usage?: DraftTemplateUsage;
    costEstimate?: CostEstimate;
    durationMs: number;
    rawResponse?: string;
}

function resolveAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none") {
    if (authType === "none") return undefined;
    const key = env.providerApiKeys[providerKey];
    if (!key) return undefined;
    return (authType ?? "bearer") === "api-key" ? key : `Bearer ${key}`;
}

function estimateTokens(messages: Array<{ content: string }>, outputText: string): DraftTemplateUsage {
    const promptChars = messages.reduce((acc, msg) => acc + msg.content.length, 0);
    const promptTokens = Math.max(1, Math.round(promptChars / 4));
    const completionTokens = Math.max(1, Math.round(outputText.length / 4));
    return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
    };
}

function stripCodeFences(text: string): string {
    return text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();
}

function parseDraft(text: string, fallbackCategory?: string): Partial<ProjectPreset> {
    const cleaned = stripCodeFences(text);
    const candidate = cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned;

    try {
        const parsed = JSON.parse(candidate) as Partial<ProjectPreset>;
        return {
            ...parsed,
            category: parsed.category ?? fallbackCategory ?? "custom",
            tags: Array.isArray(parsed.tags) ? parsed.tags.filter(Boolean) : [],
            briefGuideQuestions: Array.isArray(parsed.briefGuideQuestions) ? parsed.briefGuideQuestions.filter(Boolean).slice(0, 8) : [],
        };
    } catch {
        return {
            category: fallbackCategory ?? "custom",
            hint: "AI draft generated — review before publishing",
            tags: fallbackCategory ? [fallbackCategory] : [],
            briefTemplate: cleaned.slice(0, 2000),
            styleTemplate: "Refine visual direction after review.",
            briefGuideQuestions: [],
            outputSpec: {
                pageModel: "single_page",
                sectionModel: "scroll",
                printReady: false,
                systemPromptModule: cleaned.slice(0, 4000),
            },
        };
    }
}

export class DraftProjectTemplate {
    constructor(
        private readonly platformConfigRepository: PlatformConfigRepository,
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly userRepository: UserRepository,
        private readonly getLlmCatalog: GetLlmCatalog,
    ) { }

    async execute(input: {
        userId: string;
        instructions: string;
        category?: string;
        labelHint?: string;
        existingDraft?: {
            label?: string;
            hint?: string;
            category?: string;
            tags?: string[];
            briefTemplate?: string;
            styleTemplate?: string;
            outputSpec?: Partial<ProjectPreset["outputSpec"]>;
        } | null;
    }): Promise<DraftProjectTemplateResult> {
        const startedAt = Date.now();
        const platformConfig = await this.platformConfigRepository.get().catch(() => null);
        const taskSettings = resolvePromptTaskSettingFromConfig(platformConfig, "default", TASK_KEY);
        const { systemPrompt, userPrompt } = buildDraftProjectTemplateRequest({
            instructions: input.instructions,
            category: input.category,
            labelHint: input.labelHint,
            existingDraft: input.existingDraft,
            taskSettings,
        });

        const catalog = await this.getLlmCatalog.execute();
        const activeProviders = catalog.providers.filter((provider) => provider.isActive);
        const selectedProviderCatalog = activeProviders.find((provider) => provider.provider === taskSettings.provider)
            ?? activeProviders.find((provider) => provider.provider === FALLBACK_PROVIDER)
            ?? activeProviders[0];

        if (!selectedProviderCatalog) {
            throw new Error("No active LLM provider configured for template drafting");
        }

        const providerCatalog = selectedProviderCatalog;

        const modelId = providerCatalog.models.find((model) => model.isActive && model.id === taskSettings.model)?.id
            ?? providerCatalog.models.find((model) => model.isActive && model.isDefault)?.id
            ?? providerCatalog.models.find((model) => model.isActive)?.id
            ?? FALLBACK_MODEL;

        const authHeader = resolveAuthHeader(providerCatalog.provider, providerCatalog.authType);
        if (!authHeader && providerCatalog.authType !== "none") {
            throw new Error(`Missing API key for provider ${providerCatalog.provider}`);
        }

        const messages = [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userPrompt },
        ];

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
                messages,
            })),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(`Template drafting provider error ${response.status}`);
        }

        const rawResponse = String(payload?.choices?.[0]?.message?.content ?? "").trim();
        const usage = payload?.usage
            ? {
                promptTokens: Number(payload.usage.prompt_tokens ?? 0),
                completionTokens: Number(payload.usage.completion_tokens ?? 0),
                totalTokens: Number(payload.usage.total_tokens ?? 0),
            }
            : estimateTokens(messages, rawResponse);

        let providerCostUsd: number | undefined;
        if (providerCatalog.provider === "siliconflow") {
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

        const draft = parseDraft(rawResponse, input.category);

        await this.promptExecutionLogRepository.create({
            taskKey: TASK_KEY,
            projectId: INTERNAL_PROJECT_ID,
            userId: input.userId,
            provider: providerCatalog.provider,
            model: modelId,
            inputPrompt: input.instructions,
            optimizedPrompt: JSON.stringify(draft),
            renderedSystemPrompt: systemPrompt,
            renderedUserPrompt: userPrompt,
            contextMeta: {
                projectType: draft.labelEn ?? draft.label ?? input.labelHint,
                detectedDomain: [input.category ?? "template-model"].filter(Boolean),
                assetIds: [],
                usedMoodboard: false,
                usedUserProfile: false,
            },
            usage,
            costEstimate,
            status: "succeeded",
            durationMs: Date.now() - startedAt,
        }).catch(() => undefined);

        this.userRepository.incrementTokensConsumed(input.userId, usage.totalTokens).catch(() => undefined);

        // Cost ledger (fire-and-forget)
        CostTransactionService.instance.record({
            userId: input.userId,
            projectId: INTERNAL_PROJECT_ID,
            resourceType: ResourceType.LLM_TEMPLATE_DRAFT,
            resourceSubtype: modelId,
            precomputedTotalEur: costEstimate.amount,
            units: {
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
            },
            meta: {
                taskKey: TASK_KEY,
                provider: providerCatalog.provider,
                model: modelId,
                category: input.category,
            },
        });

        return {
            draft,
            provider: providerCatalog.provider,
            model: modelId,
            usage,
            costEstimate,
            durationMs: Date.now() - startedAt,
            rawResponse,
        };
    }
}
