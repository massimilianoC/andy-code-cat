import type { LlmPromptingTrace } from "@andy-code-cat/contracts";
import { PRESET_CATALOG } from "../../domain/entities/ProjectPreset";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { UserStyleProfileRepository } from "../../domain/repositories/UserStyleProfileRepository";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { GetLlmCatalog } from "./GetLlmCatalog";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import { estimateCost, type CostEstimate } from "../llm/costPolicy";
import { getSiliconFlowPrice } from "../llm/siliconflowPricing";
import { buildChatCompletionRequestBody } from "../llm/chatRequestAdapter";
import { env } from "../../config";
import { buildOptimizeUserPromptRequest } from "../prompting/optimizeUserPromptInstruction";
import { buildProjectKnowledgeLayer } from "../llm/systemPromptLayers";
import { buildProjectLayerDContext, PROJECT_LAYER_D_WAIT_FOR_PENDING_MS } from "../documents/projectLayerDContext";
import {
    resolveAttachmentPolicyFromConfig,
    resolveDocumentContextPolicyFromConfig,
    resolvePromptTaskSettingFromConfig,
    type PromptTaskSetting,
} from "../../domain/entities/PlatformConfig";
import { CostTransactionService } from "../cost/CostTransactionService";
import { ResourceType } from "../../domain/entities/CostTransaction";
import { resolveModelSelection, type ResolveModelSelectionInput } from "../llm/modelSelection";
import { observeModelSelectionShadow } from "../llm/modelSelectionShadow";
import type { ResolvePipelineModelLock } from "./ResolvePipelineModelLock";

const TASK_KEY = "optimize_user_prompt";
const FALLBACK_PROVIDER = "siliconflow";
const FALLBACK_MODEL = "MiniMaxAI/MiniMax-M3";

// Reasoning/thinking models (e.g. Kimi, DeepSeek-R1) may stream the actual answer
// through the reasoning channel and leave `content` empty. Strip any <think> wrapper
// and use the reasoning text as the optimized prompt rather than silently reverting
// to the original — otherwise the user pays for an optimization that is discarded.
function stripThinkBlocks(text: string): string {
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<\/?think>/gi, "")
        .trim();
}

function resolveOptimizedText(content: string, reasoning: string, rawPrompt: string): string {
    return stripThinkBlocks(content) || stripThinkBlocks(reasoning) || rawPrompt;
}

// Returns true when the LLM output is likely truncated and should not replace the original prompt.
function isOutputLikelyTruncated(optimized: string, raw: string, finishReason: string): boolean {
    // Explicit token cutoff reported by the provider
    if (finishReason === "length") return true;
    // Output suspiciously short relative to input (< 15% and < 80 chars minimum)
    if (raw.length > 200 && optimized.length < Math.max(raw.length * 0.15, 80)) return true;
    // Ends mid-sentence: no sentence-terminating character at the end
    const trimmed = optimized.trimEnd();
    if (trimmed.length > 30 && !/[.!?:;)\]"'\u00bb\n]$/.test(trimmed)) return true;
    return false;
}

type OptimizerUsage = {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
};

// Structurally a subset of the canonical LlmPromptingTrace (packages/contracts/src/llm.ts) —
// converged via Pick so the shape is authored once. The optimizer only ever sends
// system/user messages (no assistant turn), which remains a valid subtype of
// LlmPromptingTraceMessage's broader role union.
type OptimizerTrace = Pick<LlmPromptingTrace, "originalUserMessage" | "effectiveSystemPrompt" | "messagesSentToLlm">;

type OptimizePromptResponse = {
    taskKey: string;
    optimizedPrompt: string;
    provider: string;
    model: string;
    usage?: OptimizerUsage;
    costEstimate?: CostEstimate;
    durationMs: number;
    skipped?: boolean;
    rawResponse?: string;
    finishReason?: string;
    truncated?: boolean;
    promptingTrace?: OptimizerTrace;
};

type PreparedExecutionContext = {
    project: Awaited<ReturnType<ProjectRepository["findByIdForUser"]>> extends infer T ? Exclude<T, null> : never;
    preset: (typeof PRESET_CATALOG)[number] | undefined;
    taskSettings: PromptTaskSetting;
    selectedAssets: Awaited<ReturnType<ProjectAssetRepository["listByProject"]>>;
    usedMoodboard: boolean;
    usedUserProfile: boolean;
    systemPrompt: string;
    userPrompt: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    providerCatalog: Awaited<ReturnType<GetLlmCatalog["execute"]>>["providers"][number];
    modelId: string;
    authHeader?: string;
    effectiveTaskKey: string;
};

function resolveAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none") {
    if (authType === "none") return undefined;
    const key = env.providerApiKeys[providerKey];
    if (!key) return undefined;
    return (authType ?? "bearer") === "api-key" ? key : `Bearer ${key}`;
}

/**
 * When strict dispatch (I13/I14) throws before a `PreparedExecutionContext` exists (blocked or
 * catalog-mismatch), `persistFailureLog` would otherwise fall back to the hardcoded
 * FALLBACK_PROVIDER/FALLBACK_MODEL constants — recording a model that was never actually
 * targeted, which corrupts the audit/cost journal this program exists to make trustworthy. The
 * strict-dispatch throw sites attach `lockedProviderId`/`lockedModelId` (the run's locked target
 * that failed to dispatch); this extracts them so the failure log can record the truth instead.
 */
function extractLockedModelFields(error: unknown): { provider?: string; model?: string } {
    if (!error || typeof error !== "object") return {};
    const provider = "lockedProviderId" in error ? (error as { lockedProviderId?: unknown }).lockedProviderId : undefined;
    const model = "lockedModelId" in error ? (error as { lockedModelId?: unknown }).lockedModelId : undefined;
    return {
        provider: typeof provider === "string" ? provider : undefined,
        model: typeof model === "string" ? model : undefined,
    };
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


export class OptimizeUserPrompt {
    constructor(
        private readonly projectRepository: ProjectRepository,
        private readonly moodboardRepository: ProjectMoodboardRepository,
        private readonly userStyleProfileRepository: UserStyleProfileRepository,
        private readonly assetRepository: ProjectAssetRepository,
        private readonly platformConfigRepository: PlatformConfigRepository,
        private readonly userRepository: UserRepository,
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly getLlmCatalog: GetLlmCatalog,
        private readonly resolvePipelineModelLock: ResolvePipelineModelLock,
        private readonly storage?: IFileStorage,
    ) { }

    private buildPromptingTrace(input: { rawPrompt: string }, context: PreparedExecutionContext): OptimizerTrace {
        return {
            originalUserMessage: input.rawPrompt,
            effectiveSystemPrompt: context.systemPrompt,
            messagesSentToLlm: context.messages,
        };
    }

    private computeProviderCostUsd(input: {
        provider: string;
        modelId: string;
        usage: OptimizerUsage;
        rawProviderCost?: unknown;
    }) {
        let providerCostUsd: number | undefined = undefined;
        if (typeof input.rawProviderCost === "number") {
            providerCostUsd = input.rawProviderCost;
        } else if (typeof input.rawProviderCost === "string") {
            const parsed = parseFloat(input.rawProviderCost);
            if (!Number.isNaN(parsed)) providerCostUsd = parsed;
        }

        if (providerCostUsd === undefined && input.provider === "siliconflow") {
            const sfPrice = getSiliconFlowPrice(input.modelId);
            if (sfPrice && sfPrice.priceUnit === "per_m_tokens") {
                providerCostUsd =
                    (input.usage.promptTokens / 1_000_000) * sfPrice.input +
                    (input.usage.completionTokens / 1_000_000) * sfPrice.output;
            }
        }

        return providerCostUsd;
    }

    private buildResult(input: {
        startedAt: number;
        request: {
            rawPrompt: string;
        };
        context: PreparedExecutionContext;
        optimizedPrompt: string;
        rawResponse?: string;
        finishReason?: string;
        truncated?: boolean;
        usage?: OptimizerUsage;
        providerCostUsd?: number;
        skipped?: boolean;
    }): OptimizePromptResponse {
        const usage = input.usage ?? estimateTokens({ messages: input.context.messages, outputText: input.optimizedPrompt });
        return {
            taskKey: input.context.effectiveTaskKey,
            optimizedPrompt: input.optimizedPrompt,
            provider: input.context.providerCatalog.provider,
            model: input.context.modelId,
            usage,
            costEstimate: input.skipped
                ? undefined
                : estimateCost(
                    { capability: "chat", tokenUsage: usage, providerCostUsd: input.providerCostUsd },
                    {
                        textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                        imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                        videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                        usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
                        providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
                    },
                ),
            durationMs: Date.now() - input.startedAt,
            skipped: input.skipped ?? false,
            rawResponse: input.rawResponse ?? input.optimizedPrompt,
            finishReason: input.finishReason,
            truncated: input.truncated ?? false,
            promptingTrace: this.buildPromptingTrace(input.request, input.context),
        };
    }

    private async persistSuccessLog(input: {
        request: {
            projectId: string;
            userId: string;
            rawPrompt: string;
            conversationId?: string;
            sessionId?: string;
        };
        context: PreparedExecutionContext;
        result: OptimizePromptResponse;
    }) {
        const { request, context, result } = input;
        if (result.usage) {
            this.userRepository.incrementTokensConsumed(request.userId, result.usage.totalTokens).catch(() => { });
        }

        await this.promptExecutionLogRepository.create({
            taskKey: context.effectiveTaskKey,
            projectId: request.projectId,
            userId: request.userId,
            conversationId: request.conversationId,
            sessionId: request.sessionId,
            provider: result.provider,
            model: result.model,
            inputPrompt: request.rawPrompt,
            optimizedPrompt: result.optimizedPrompt,
            renderedSystemPrompt: context.systemPrompt,
            renderedUserPrompt: context.userPrompt,
            contextMeta: {
                projectPresetId: context.project.presetId,
                projectType: context.preset?.labelEn ?? context.project.presetId,
                detectedDomain: [context.project.name].filter(Boolean),
                assetIds: context.selectedAssets.map((asset) => asset.id),
                usedMoodboard: context.usedMoodboard,
                usedUserProfile: context.usedUserProfile,
            },
            usage: result.usage,
            costEstimate: result.costEstimate,
            status: "succeeded",
            durationMs: result.durationMs,
        });

        // Cost ledger (fire-and-forget)
        if (result.usage && !result.skipped) {
            CostTransactionService.instance.record({
                userId: request.userId,
                projectId: request.projectId,
                resourceType: ResourceType.LLM_PROMPT_OPT,
                resourceSubtype: result.model,
                precomputedTotalEur: result.costEstimate?.amount,
                units: {
                    promptTokens: result.usage.promptTokens,
                    completionTokens: result.usage.completionTokens,
                    totalTokens: result.usage.totalTokens,
                },
                sourceRef: {
                    conversationId: request.conversationId,
                    sessionId: request.sessionId,
                },
                meta: {
                    taskKey: context.effectiveTaskKey,
                    provider: result.provider,
                    model: result.model,
                },
            });
        }
    }

    private async persistFailureLog(input: {
        request: {
            projectId: string;
            userId: string;
            rawPrompt: string;
            conversationId?: string;
            sessionId?: string;
            provider?: string;
            model?: string;
        };
        context?: PreparedExecutionContext;
        error: unknown;
        startedAt: number;
    }) {
        const { request, context, error, startedAt } = input;
        await this.promptExecutionLogRepository.create({
            taskKey: context?.effectiveTaskKey ?? TASK_KEY,
            projectId: request.projectId,
            userId: request.userId,
            conversationId: request.conversationId,
            sessionId: request.sessionId,
            provider: context?.providerCatalog.provider ?? request.provider ?? FALLBACK_PROVIDER,
            model: context?.modelId ?? request.model ?? FALLBACK_MODEL,
            inputPrompt: request.rawPrompt,
            renderedSystemPrompt: context?.systemPrompt,
            renderedUserPrompt: context?.userPrompt,
            contextMeta: {
                projectPresetId: context?.project.presetId,
                projectType: context?.preset?.labelEn ?? context?.project.presetId,
                assetIds: context?.selectedAssets.map((asset) => asset.id) ?? [],
                usedMoodboard: false,
                usedUserProfile: false,
            },
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Prompt optimization failed",
            durationMs: Date.now() - startedAt,
        });
    }

    private async prepareExecutionContext(input: {
        projectId: string;
        userId: string;
        rawPrompt: string;
        assetIds?: string[];
        provider?: string;
        model?: string;
        taskKey?: string;
        pipelineRunId?: string;
    }): Promise<{ context: PreparedExecutionContext } | { skippedResult: OptimizePromptResponse }> {
        const project = await this.projectRepository.findByIdForUser(input.projectId, input.userId);
        if (!project) {
            throw new Error("Project not found for prompt optimization");
        }

        const productKey = project.presetId ?? "default";
        const preset = PRESET_CATALOG.find((entry) => entry.id === project.presetId);
        const [moodboard, userProfile, platformConfig] = await Promise.all([
            this.moodboardRepository.findByProjectId(input.projectId),
            this.userStyleProfileRepository.findByUserId(input.userId),
            this.platformConfigRepository.get().catch(() => null),
        ]);

        const effectiveTaskKey = input.taskKey ?? TASK_KEY;
        const taskSettings = resolvePromptTaskSettingFromConfig(platformConfig, productKey, effectiveTaskKey);
        const attachmentPolicy = resolveAttachmentPolicyFromConfig(platformConfig, productKey);
        const documentContextPolicy = resolveDocumentContextPolicyFromConfig(platformConfig, productKey);
        const allAssets = await this.assetRepository.listByProject(input.projectId, input.userId).catch(() => []);
        const selectedAssets = input.assetIds?.length
            ? allAssets.filter((asset) => input.assetIds!.includes(asset.id))
            : allAssets
                .filter((asset) => asset.useInProject || Boolean(asset.descriptionText))
                .slice(0, documentContextPolicy.maxAssetsPerPrompt);

        if (selectedAssets.length > attachmentPolicy.maxAttachmentsPerPrompt) {
            throw Object.assign(
                new Error(`Too many assets selected for optimization (max ${attachmentPolicy.maxAttachmentsPerPrompt})`),
                { statusCode: 422, code: "ATTACHMENT_LIMIT_EXCEEDED" },
            );
        }

        const oversizedAsset = selectedAssets.find((asset) => asset.fileSize > attachmentPolicy.maxFileSizeBytes);
        if (oversizedAsset) {
            throw Object.assign(
                new Error(`Selected asset exceeds per-file size limit (${oversizedAsset.originalName})`),
                { statusCode: 413, code: "ATTACHMENT_FILE_TOO_LARGE" },
            );
        }

        const selectedTotalBytes = selectedAssets.reduce((acc, asset) => acc + asset.fileSize, 0);
        if (selectedTotalBytes > attachmentPolicy.maxTotalBytes) {
            throw Object.assign(new Error("Selected assets exceed total size limit for optimization"), {
                statusCode: 422,
                code: "ATTACHMENT_TOTAL_SIZE_EXCEEDED",
            });
        }

        const layerDContext = env.enrichmentInjectLayerD && this.storage
            ? (await buildProjectLayerDContext({
                assetRepository: this.assetRepository,
                storage: this.storage,
                projectId: input.projectId,
                userId: input.userId,
                assets: selectedAssets,
                maxChars: 6000,
                maxAssets: documentContextPolicy.maxAssetsPerPrompt,
                fallbackInlineExtractionMaxAssets: documentContextPolicy.fallbackInlineExtractionMaxAssets,
                waitForPendingMs: env.enrichmentEnabled ? PROJECT_LAYER_D_WAIT_FOR_PENDING_MS : 0,
            })).layer
            : env.enrichmentInjectLayerD
                ? buildProjectKnowledgeLayer(selectedAssets, {
                    maxChars: 6000,
                    maxAssets: documentContextPolicy.maxAssetsPerPrompt,
                })
                : "";

        const { systemPrompt, userPrompt } = buildOptimizeUserPromptRequest({
            rawPrompt: input.rawPrompt,
            projectName: project.name,
            projectType: preset?.labelEn ?? project.presetId ?? "generic project",
            moodboard,
            userProfile,
            assets: selectedAssets,
            taskSettings,
            layerDContext: layerDContext || undefined,
        });

        const messages: Array<{ role: "system" | "user"; content: string }> = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ];

        const catalog = await this.getLlmCatalog.execute();
        const activeProviders = catalog.providers.filter((provider) => provider.isActive);
        const requestedModel = input.model?.trim();

        let providerCatalog: (typeof activeProviders)[number] | undefined;
        let modelId: string | undefined;

        if (input.pipelineRunId && env.pipelineRunEnabled) {
            // I13 strict cutover wave 1: a PipelineRun's frozen modelLock governs dispatch
            // instead of the legacy cascade. dispatch() re-validates the lock against the live
            // catalog and never substitutes a different model — a stale/deactivated lock blocks
            // (409) rather than silently falling back. Gated on PIPELINE_RUN_ENABLED too, not
            // just the presence of pipelineRunId: this is the master rollback lever's whole
            // point — flipping the flag off must revert EVERY call site to legacy behavior, even
            // one that (incorrectly, or from a stale client) still sends a pipelineRunId.
            const { run, blocked } = await this.resolvePipelineModelLock.dispatch({
                runId: input.pipelineRunId,
                ownerUserId: input.userId,
                projectId: input.projectId,
                stage: "optimize",
            });

            if (blocked) {
                throw Object.assign(
                    new Error(`Pipeline model lock unavailable for optimize stage: ${blocked.code}`),
                    {
                        statusCode: 409,
                        code: blocked.code,
                        lockedProviderId: run.modelLock.effective.providerId,
                        lockedModelId: run.modelLock.effective.modelId,
                    },
                );
            }

            const lockedProviderId = run.modelLock.effective.providerId;
            const lockedModelId = run.modelLock.effective.modelId;
            providerCatalog = activeProviders.find((provider) => provider.provider === lockedProviderId);
            const lockedModel = providerCatalog?.models.find((model) => model.isActive && model.id === lockedModelId);
            if (!providerCatalog || !lockedModel) {
                throw Object.assign(
                    new Error(`Locked provider/model is no longer in the active catalog: ${lockedProviderId}/${lockedModelId}`),
                    { statusCode: 409, code: "MODEL_LOCK_UNAVAILABLE", lockedProviderId, lockedModelId },
                );
            }
            modelId = lockedModelId;
        } else {
            const selectionInput: ResolveModelSelectionInput = {
                profile: "optimizer-cascade",
                activeProviders,
                requestedProvider: input.provider,
                requestedModel,
                taskSettingProvider: taskSettings.provider,
                taskSettingModel: taskSettings.model,
                envDefaultProvider: env.LLM_DEFAULT_PROVIDER,
                fallbackProvider: FALLBACK_PROVIDER,
                hardcodedFallbackModel: FALLBACK_MODEL,
                requireOverrideInCatalog: false,
                // Preserved exactly as-is (out of scope to "fix" here): an override is only honored
                // when the resolved provider's apiType === "openai-compatible".
                gateOverrideOnOpenAiCompatible: true,
                policy: "legacy",
            };
            const decision = resolveModelSelection(selectionInput);
            observeModelSelectionShadow(selectionInput, decision, {
                projectId: input.projectId,
                taskKey: input.taskKey ?? TASK_KEY,
            });

            if (!decision.providerCatalog) {
                throw new Error("No active LLM provider configured for prompt optimization");
            }

            providerCatalog = decision.providerCatalog;
            modelId = decision.effective.model;
        }

        if (!taskSettings.enabled) {
            return {
                skippedResult: {
                    taskKey: effectiveTaskKey,
                    optimizedPrompt: input.rawPrompt,
                    provider: providerCatalog.provider,
                    model: modelId,
                    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                    costEstimate: undefined,
                    durationMs: 0,
                    skipped: true,
                    rawResponse: input.rawPrompt,
                    finishReason: "skipped",
                    promptingTrace: {
                        originalUserMessage: input.rawPrompt,
                        effectiveSystemPrompt: systemPrompt,
                        messagesSentToLlm: messages,
                    },
                },
            };
        }

        const authHeader = resolveAuthHeader(providerCatalog.provider, providerCatalog.authType);
        if (!authHeader && providerCatalog.authType !== "none") {
            throw new Error(`Missing API key for provider ${providerCatalog.provider}`);
        }

        return {
            context: {
                project,
                preset,
                taskSettings,
                selectedAssets,
                usedMoodboard: Boolean(moodboard),
                usedUserProfile: Boolean(userProfile),
                systemPrompt,
                userPrompt,
                messages,
                providerCatalog,
                modelId,
                authHeader,
                effectiveTaskKey,
            },
        };
    }

    async execute(input: {
        projectId: string;
        userId: string;
        rawPrompt: string;
        assetIds?: string[];
        conversationId?: string;
        sessionId?: string;
        provider?: string;
        model?: string;
        taskKey?: string;
        pipelineRunId?: string;
    }): Promise<OptimizePromptResponse> {
        const startedAt = Date.now();
        let preparedContext: PreparedExecutionContext | undefined;

        try {
            const prepared = await this.prepareExecutionContext(input);
            if ("skippedResult" in prepared) {
                return {
                    ...prepared.skippedResult,
                    durationMs: Date.now() - startedAt,
                };
            }

            preparedContext = prepared.context;
            const response = await fetch(`${preparedContext.providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(preparedContext.authHeader ? { Authorization: preparedContext.authHeader } : {}),
                },
                body: JSON.stringify(buildChatCompletionRequestBody({
                    provider: preparedContext.providerCatalog.provider,
                    model: preparedContext.modelId,
                    maxTokens: Math.min(preparedContext.taskSettings.maxCompletionTokens, env.LLM_MAX_COMPLETION_TOKENS),
                    temperature: preparedContext.taskSettings.temperature,
                    messages: preparedContext.messages,
                })),
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(`Prompt optimizer provider error ${response.status}`);
            }

            const optimizerMessage = payload?.choices?.[0]?.message;
            const finishReasonRaw = String(payload?.choices?.[0]?.finish_reason ?? "stop");
            const resolvedText = resolveOptimizedText(
                String(optimizerMessage?.content ?? ""),
                String(optimizerMessage?.reasoning_content ?? optimizerMessage?.reasoning ?? ""),
                input.rawPrompt,
            );
            const truncated = isOutputLikelyTruncated(resolvedText, input.rawPrompt, finishReasonRaw);
            const optimizedPrompt = truncated ? input.rawPrompt : resolvedText;
            const usage = payload?.usage
                ? {
                    promptTokens: Number(payload.usage.prompt_tokens ?? 0),
                    completionTokens: Number(payload.usage.completion_tokens ?? 0),
                    totalTokens: Number(payload.usage.total_tokens ?? 0),
                }
                : estimateTokens({ messages: preparedContext.messages, outputText: optimizedPrompt });

            const providerCostUsd = this.computeProviderCostUsd({
                provider: preparedContext.providerCatalog.provider,
                modelId: preparedContext.modelId,
                usage,
                rawProviderCost: payload?.usage?.cost,
            });

            const result = this.buildResult({
                startedAt,
                request: input,
                context: preparedContext,
                optimizedPrompt,
                rawResponse: resolvedText,
                finishReason: finishReasonRaw,
                truncated,
                usage,
                providerCostUsd,
            });

            await this.persistSuccessLog({ request: input, context: preparedContext, result });
            return result;
        } catch (error) {
            await this.persistFailureLog({
                request: { ...input, ...extractLockedModelFields(error) },
                context: preparedContext,
                error,
                startedAt,
            });
            throw error;
        }
    }

    async executeStream(input: {
        projectId: string;
        userId: string;
        rawPrompt: string;
        assetIds?: string[];
        conversationId?: string;
        sessionId?: string;
        provider?: string;
        model?: string;
        taskKey?: string;
        pipelineRunId?: string;
    }, handlers?: {
        onThinking?: (chunk: string) => void;
        onAnswer?: (chunk: string) => void;
    }): Promise<OptimizePromptResponse> {
        const startedAt = Date.now();
        let preparedContext: PreparedExecutionContext | undefined;

        try {
            const prepared = await this.prepareExecutionContext(input);
            if ("skippedResult" in prepared) {
                return {
                    ...prepared.skippedResult,
                    durationMs: Date.now() - startedAt,
                };
            }

            preparedContext = prepared.context;
            const response = await fetch(`${preparedContext.providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(preparedContext.authHeader ? { Authorization: preparedContext.authHeader } : {}),
                },
                body: JSON.stringify(buildChatCompletionRequestBody({
                    provider: preparedContext.providerCatalog.provider,
                    model: preparedContext.modelId,
                    stream: true,
                    maxTokens: Math.min(preparedContext.taskSettings.maxCompletionTokens, env.LLM_MAX_COMPLETION_TOKENS),
                    temperature: preparedContext.taskSettings.temperature,
                    messages: preparedContext.messages,
                })),
            });

            if (!response.ok || !response.body) {
                throw new Error(`Prompt optimizer provider error ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let rawReply = "";
            let reasoningReply = "";
            let finishReason: string | undefined;
            let usage: OptimizerUsage | undefined;
            let providerCostUsd: number | undefined;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) continue;

                    const data = trimmed.slice(5).trim();
                    if (!data || data === "[DONE]") continue;

                    try {
                        const payload = JSON.parse(data) as {
                            choices?: Array<{
                                delta?: {
                                    content?: string;
                                    reasoning_content?: string;
                                    reasoning?: string;
                                    thinking?: string;
                                };
                                finish_reason?: string | null;
                            }>;
                            usage?: {
                                prompt_tokens?: number;
                                completion_tokens?: number;
                                total_tokens?: number;
                                cost?: number | string;
                            };
                        };

                        const delta = payload.choices?.[0]?.delta;
                        const thinking = delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking;
                        const content = delta?.content;

                        if (thinking) {
                            reasoningReply += String(thinking);
                            handlers?.onThinking?.(String(thinking));
                        }

                        if (content) {
                            rawReply += String(content);
                            handlers?.onAnswer?.(String(content));
                        }

                        const fr = payload.choices?.[0]?.finish_reason;
                        if (fr) {
                            finishReason = String(fr);
                        }

                        if (payload.usage) {
                            usage = {
                                promptTokens: Number(payload.usage.prompt_tokens ?? 0),
                                completionTokens: Number(payload.usage.completion_tokens ?? 0),
                                totalTokens: Number(payload.usage.total_tokens ?? 0),
                            };
                            providerCostUsd = this.computeProviderCostUsd({
                                provider: preparedContext.providerCatalog.provider,
                                modelId: preparedContext.modelId,
                                usage,
                                rawProviderCost: payload.usage.cost,
                            });
                        }
                    } catch {
                        // Ignore malformed chunk.
                    }
                }
            }

            const resolvedStreamText = resolveOptimizedText(rawReply, reasoningReply, input.rawPrompt);
            const streamFinishReason = finishReason ?? "stop";
            const streamTruncated = isOutputLikelyTruncated(resolvedStreamText, input.rawPrompt, streamFinishReason);
            const optimizedPrompt = streamTruncated ? input.rawPrompt : resolvedStreamText;
            const result = this.buildResult({
                startedAt,
                request: input,
                context: preparedContext,
                optimizedPrompt,
                rawResponse: (rawReply.trim() || reasoningReply.trim()) || resolvedStreamText,
                finishReason: streamFinishReason,
                truncated: streamTruncated,
                usage,
                providerCostUsd,
            });

            await this.persistSuccessLog({ request: input, context: preparedContext, result });
            return result;
        } catch (error) {
            await this.persistFailureLog({
                request: { ...input, ...extractLockedModelFields(error) },
                context: preparedContext,
                error,
                startedAt,
            });
            throw error;
        }
    }
}
