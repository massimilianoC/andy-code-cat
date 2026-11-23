/**
 * GenerateArtifact — the one artifact generation engine (AL-003), as an application use case.
 *
 * Until Phase 0 of docs/specs/BACKGROUND_RUNS.md this was ~800 lines inside the two handlers of
 * `llmRoutes.ts` (`/llm/chat-preview` and `/llm/chat-preview/stream`), bound to the HTTP response.
 * A generation without a browser could not reuse it, and a second copy would have been a second
 * pipeline nobody could tell apart from the first (AGENTS.md Rule Zero). Both routes are now thin
 * adapters over this class, and the background worker calls the same `execute()`.
 *
 * What a caller chooses, and nothing else:
 * - `transport`: one provider call returning JSON ("single") or a streamed one ("stream");
 * - `sink`: where the streamed thinking/answer chunks and media progress go (SSE, or nowhere);
 * - `abortSignal` / `isStopped`: what ends the call early — the HTTP adapter wires a closed
 *   response, a worker wires its cancel flag and its own time ceiling.
 *
 * Everything that decides what is sent to the model, how the reply is parsed, patched, resolved,
 * journalled and costed lives here once. The characterisation suite
 * (`llmChatPreview.characterization.e2e.test.ts`) pins the observable behaviour of both
 * transports.
 */
import {
    llmChatPreviewSchema,
    type LlmChatPreviewInput,
    type LlmChatPreviewResult,
    type MediaResolutionMetadata,
} from "@andy-code-cat/contracts";
import { env } from "../../config";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import { ResourceType } from "../../domain/entities/CostTransaction";
import { HttpError, normalizeHttpError } from "../../presentation/http/errors/httpError";
import { describeGeneratedJavaScriptSyntaxError } from "../artifacts/generatedJavaScriptSyntax";
import { CostTransactionService } from "../cost/CostTransactionService";
import { readProviderCostUsd } from "../cost/resolveLlmCallCost";
import { buildChatCompletionRequestBody } from "../llm/chatRequestAdapter";
import { estimateCost } from "../llm/costPolicy";
import { emitLlmFailureLog } from "../llm/llmFailureLog";
import {
    buildMessagesWithHistory,
    buildParseFailureStructured,
    isGenerationParseFailure,
    resolveUsageWithFallback,
    type LlmMessage,
    tryBuildSectionContextOpts,
} from "../llm/llmMessageBuilder";
import { buildFormattedReply, tryParseStructuredJson } from "../llm/llmParser";
import { applyFocusPatch } from "../llm/llmPatchMerger";
import { assertPromptTraceParity } from "../llm/promptTraceParity";
import {
    buildProviderApiKeyMissingError,
    buildProviderResponseError,
    resolveProviderAuthHeader,
} from "../llm/providerAuth";
import type { MediaProgressEvent, ResolveArtifactMedia } from "../media/ResolveArtifactMedia";
import { ExecutionLogger } from "../services/ExecutionLogger";
import type { OpenWorkSession } from "./OpenWorkSession";
import type { LlmRuntimeContext, ResolvePromptExecution } from "./ResolvePromptExecution";

/**
 * I11 (SSOT program): a "pending" PromptExecutionLog older than this is treated as abandoned
 * (e.g. the API process crashed mid-call) and no longer blocks a retry using the same
 * idempotencyKey. Matches the generous end of this route's own generation timeouts.
 */
export const PROMPT_EXECUTION_IDEMPOTENCY_STALE_MS = 5 * 60_000;

/** Time allowed for the provider to start answering a streamed call. */
const STREAM_CONNECT_TIMEOUT_MS = 20 * 60 * 1000;

export type GenerationTransport = "single" | "stream";

export interface GenerationSink {
    /** The provider accepted a streamed call: the caller may now commit to a streaming response. */
    streamOpened?(): void;
    thinking?(chunk: string): void;
    answer?(chunk: string): void;
    mediaProgress?(event: MediaProgressEvent): void;
}

export interface GenerateArtifactInput {
    userId: string;
    projectId: string;
    /** The request exactly as received; parsed here against `llmChatPreviewSchema`. */
    rawBody: unknown;
    /** The work session the caller already resolved, if any. One is opened when absent. */
    workSessionId?: string;
    transport: GenerationTransport;
    sink?: GenerationSink;
    /** Aborts the provider call in flight. */
    abortSignal?: AbortSignal;
    /** Polled between streamed chunks; true ends the read as an interruption. */
    isStopped?: () => boolean;
    startedAt?: number;
}

export interface InterruptedGeneration {
    provider: string;
    model: string;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    costEstimate: LlmChatPreviewResult["costEstimate"];
    durationMs: number;
    partialReply?: string;
}

export type GenerateArtifactOutcome =
    | { kind: "completed"; result: LlmChatPreviewResult; workSessionId?: string }
    /** The stream was cut part-way; the journal row is failed with the partial work kept. */
    | { kind: "interrupted"; interrupted: InterruptedGeneration }
    /** Aborted before the provider answered: nothing was produced and nothing is reported. */
    | { kind: "aborted" };

/**
 * A streamed read failed after the response had started. The journal row is already completed as
 * failed; the transport only has to say so (`{ type: "error", message, durationMs }`).
 */
export class GenerationStreamReadError extends Error {
    constructor(message: string, readonly durationMs: number) {
        super(message);
        this.name = "GenerationStreamReadError";
    }
}

interface ProviderReply {
    rawReply: string;
    rawThinking: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    providerCostUsd?: number;
    finishReason?: string;
}

function resolveChatPreviewMaxTokens(requestedMaxTokens?: number): number {
    const previewCeiling = 64_000;
    const defaultPreviewBudget = Math.min(env.LLM_DEFAULT_MAX_COMPLETION_TOKENS, previewCeiling);
    return Math.min(requestedMaxTokens ?? defaultPreviewBudget, env.LLM_MAX_COMPLETION_TOKENS, previewCeiling);
}

function costPolicy() {
    return {
        textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
        imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
        videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
        usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
        providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
    };
}

function buildPromptExecutionMediaResolutionSummary(metadata?: MediaResolutionMetadata) {
    if (!metadata) {
        return undefined;
    }

    const resolvedCount = metadata.directives?.filter((directive) => directive.status === "resolved" || directive.status === "fallback_resolved").length
        ?? metadata.assetIds?.length
        ?? 0;
    const failedCount = metadata.directives?.filter((directive) => directive.status === "unresolved").length ?? 0;

    if (!metadata.degraded && resolvedCount === 0 && failedCount === 0 && (!metadata.mediaKeys || metadata.mediaKeys.length === 0)) {
        return undefined;
    }

    return {
        version: metadata.version,
        resolvedCount,
        failedCount,
        degraded: metadata.degraded,
        mediaKeys: metadata.mediaKeys,
        traceIds: metadata.traceIds,
    };
}

export function parseLlmChatPreviewBody(raw: unknown): LlmChatPreviewInput {
    const parsed = llmChatPreviewSchema.safeParse(raw);
    if (parsed.success) {
        return parsed.data;
    }

    const focusOnlyError =
        parsed.error.issues.length > 0 &&
        parsed.error.issues.every((issue) => issue.path[0] === "focusContext");

    if (focusOnlyError && raw && typeof raw === "object") {
        const fallbackParsed = llmChatPreviewSchema.safeParse({
            ...(raw as Record<string, unknown>),
            focusContext: undefined,
        });

        if (fallbackParsed.success) {
            console.warn("[llm] invalid focusContext ignored - falling back to full-project context.", {
                focusContextErrors: parsed.error.flatten().fieldErrors.focusContext,
            });
            return fallbackParsed.data;
        }
    }

    throw parsed.error;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

export class GenerateArtifact {
    constructor(
        private readonly resolvePromptExecution: ResolvePromptExecution,
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly openWorkSession: OpenWorkSession,
        private readonly snapshotRepository: PreviewSnapshotRepository,
        private readonly resolveArtifactMedia: ResolveArtifactMedia,
        private readonly userRepository: UserRepository,
    ) { }

    async execute(input: GenerateArtifactInput): Promise<GenerateArtifactOutcome> {
        const startedAt = input.startedAt ?? Date.now();
        // I11 (SSOT program): set once the durable pending record is written, read wherever this
        // generation exits (success, interrupted, or failure) to complete that record.
        let promptExecutionLogId: string | undefined;

        try {
            return await this.run(input, startedAt, (id) => { promptExecutionLogId = id; });
        } catch (error) {
            if (error instanceof GenerationStreamReadError) {
                throw error;
            }
            const normalized = normalizeHttpError(error);
            const raw = input.rawBody as { provider?: string; model?: string } | undefined;
            emitLlmFailureLog({
                projectId: input.projectId,
                durationMs: Date.now() - startedAt,
                provider: raw?.provider,
                model: raw?.model,
                code: normalized.code,
                message: normalized.userMessage,
                details: normalized.details,
            });
            // I11: best-effort — never let a failed journal write mask the real error.
            if (promptExecutionLogId) {
                this.promptExecutionLogRepository.complete(promptExecutionLogId, {
                    status: "failed",
                    errorMessage: normalized.userMessage,
                    durationMs: Date.now() - startedAt,
                }).catch(() => { });
            }
            throw error;
        }
    }

    /**
     * A generation is an intent. `workSessionMiddleware` only RESOLVES a session — Vibe opens one
     * at classify/prefill and the launch route for the guided handoff — but Project Mode opens
     * none: it creates a blank project and the workspace dispatches the first prompt straight
     * here. Measured in production on 2026-09-10: a Project Mode `generate` row carrying no
     * session. So when none is open this opens it (`reuseOrOpen` never throws: tracing must not
     * fail a generation).
     */
    private async resolveWorkSessionId(input: GenerateArtifactInput): Promise<string | undefined> {
        if (input.workSessionId) return input.workSessionId;
        const opened = await this.openWorkSession.reuseOrOpen(undefined, {
            userId: input.userId,
            entryMode: "workspace",
            projectId: input.projectId,
        });
        return opened?.id;
    }

    private async run(
        input: GenerateArtifactInput,
        startedAt: number,
        onPendingWritten: (id: string) => void,
    ): Promise<GenerateArtifactOutcome> {
        const streaming = input.transport === "stream";
        const body = parseLlmChatPreviewBody(input.rawBody);
        const isFocusedMode = Boolean(
            body.focusContext
            && body.focusContext.mode !== "project"
            && body.currentArtifacts
            && (body.currentArtifacts.html || body.currentArtifacts.css || body.currentArtifacts.js)
        );
        const sectionOpts = tryBuildSectionContextOpts(isFocusedMode, body);
        const context = await this.resolvePromptExecution.execute({
            projectId: input.projectId,
            userId: input.userId,
            pipelineRole: body.pipelineRole,
            provider: body.provider,
            model: body.model,
            capability: body.capability,
            assetIds: body.assetIds,
            systemPrompt: body.systemPrompt,
            outputLanguage: body.uiLanguage,
            focusedMode: isFocusedMode ? {
                focusContext: body.focusContext!,
                pageMap: sectionOpts?.pageMap,
            } : undefined,
            pipelineRunId: body.pipelineRunId,
        });
        const effectiveSystemPrompt = context.systemPrompt;

        const { messages, historyIncluded } = buildMessagesWithHistory(
            effectiveSystemPrompt,
            body.message,
            body.history,
            body.currentArtifacts,
            body.focusContext,
            sectionOpts,
        );
        assertPromptTraceParity({
            effectiveSystemPrompt,
            layers: context.promptLayers,
            messagesSentToLlm: messages,
        });

        const authHeader = resolveProviderAuthHeader(context.providerCatalog.provider, context.providerCatalog.authType);
        if (streaming) {
            console.log(`[stream-debug] provider=${context.providerCatalog.provider} model=${context.modelId} authType=${context.providerCatalog.authType} hasAuth=${Boolean(authHeader)} historyIncluded=${historyIncluded} msgCount=${messages.length}`);
        }

        if (!authHeader && context.providerCatalog.authType !== "none") {
            throw buildProviderApiKeyMissingError(context);
        }

        // ── I11: durable pending journal write, AWAITED before the provider call ──────
        if (body.idempotencyKey) {
            const activeDuplicate = await this.promptExecutionLogRepository.findActiveByIdempotencyKey(
                input.projectId,
                input.userId,
                body.idempotencyKey,
                PROMPT_EXECUTION_IDEMPOTENCY_STALE_MS,
            );
            if (activeDuplicate) {
                throw new HttpError("A request with this idempotency key is already in flight or has already completed", {
                    statusCode: 409,
                    code: "DUPLICATE_REQUEST",
                    userMessage: "Questa richiesta è già stata inviata. Attendi il completamento prima di ripetere.",
                    details: { promptExecutionId: activeDuplicate.id, status: activeDuplicate.status },
                });
            }
        }
        const endpoint = `${context.providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions`;
        const workSessionId = await this.resolveWorkSessionId(input);
        const pendingLog = await this.promptExecutionLogRepository.createPending({
            taskKey: "chat",
            projectId: input.projectId,
            userId: input.userId,
            conversationId: body.conversationId,
            workSessionId,
            pipelineRunId: body.pipelineRunId,
            pipelineStage: "generate",
            endpoint,
            provider: context.providerCatalog.provider,
            model: context.modelId,
            inputPrompt: body.message.slice(0, 2000),
            renderedSystemPrompt: effectiveSystemPrompt,
            renderedUserPrompt: messages[messages.length - 1]?.content,
            contextMeta: {
                projectPresetId: context.projectPresetId,
                assetIds: context.contextAssetIds,
                usedMoodboard: false,
                usedUserProfile: false,
            },
            idempotencyKey: body.idempotencyKey,
            // Interrupted-run recovery (docs/specs/INTERRUPTED_RUN_RECOVERY.md §3bis) — the
            // only new field a resumed generation adds. Absent on every ordinary turn.
            resumedFromPromptExecutionId: body.resumedFromPromptExecutionId,
        });
        const promptExecutionLogId = pendingLog.id;
        onPendingWritten(promptExecutionLogId);
        // ── end I11 pending write ───────────────────────────────────────────────────

        const requestBody = JSON.stringify(buildChatCompletionRequestBody({
            provider: context.providerCatalog.provider,
            model: context.modelId,
            ...(streaming ? { stream: true } : {}),
            maxTokens: resolveChatPreviewMaxTokens(body.max_tokens),
            temperature: body.temperature ?? 0.4,
            messages,
            thinkingBudget: body.thinking_budget,
        }));
        const headers = {
            "Content-Type": "application/json",
            ...(authHeader ? { Authorization: authHeader } : {}),
        };

        let reply: ProviderReply;
        if (streaming) {
            const streamed = await this.dispatchStream({
                input, startedAt, endpoint, headers, requestBody, context, messages,
                body, promptExecutionLogId,
            });
            if (streamed.kind !== "reply") return streamed;
            reply = streamed.reply;
        } else {
            reply = await this.dispatchSingle({ endpoint, headers, requestBody, context, messages });
        }

        const result = await this.finalize({
            input, startedAt, body, context, messages, isFocusedMode, reply, promptExecutionLogId,
        });
        return { kind: "completed", result, workSessionId };
    }

    private async dispatchSingle(args: {
        endpoint: string;
        headers: Record<string, string>;
        requestBody: string;
        context: LlmRuntimeContext;
        messages: LlmMessage[];
    }): Promise<ProviderReply> {
        const { context } = args;
        const sfRes = await fetch(args.endpoint, { method: "POST", headers: args.headers, body: args.requestBody });
        const sfJson = await sfRes.json().catch(() => ({}));

        if (!sfRes.ok) {
            console.error("[LLM provider error]", {
                provider: context.providerCatalog.provider,
                model: context.modelId,
                providerStatus: sfRes.status,
                providerBody: sfJson,
            });
            // Pass through 429 (rate limit) and 404 (model not found) directly
            // so the client knows the actual reason instead of seeing a generic 502.
            const outStatus = sfRes.status === 429 ? 429 : sfRes.status === 404 ? 404 : 502;
            throw buildProviderResponseError({
                statusCode: outStatus,
                code: outStatus === 429 ? "LLM_PROVIDER_RATE_LIMIT" : outStatus === 404 ? "LLM_MODEL_NOT_FOUND" : "LLM_PROVIDER_REQUEST_FAILED",
                message: outStatus === 429
                    ? "LLM provider rate limit reached"
                    : outStatus === 404
                        ? "Model not found at provider"
                        : "LLM provider call failed",
                userMessage: outStatus === 429
                    ? "Il provider ha raggiunto il rate limit. Riprova tra poco o seleziona un altro modello."
                    : outStatus === 404
                        ? "Il modello selezionato non e disponibile presso il provider. Scegli un modello diverso."
                        : "La chiamata al provider LLM non e andata a buon fine.",
                provider: context.providerCatalog.provider,
                model: context.modelId,
                providerStatus: sfRes.status,
                providerBody: sfJson,
            });
        }

        const rawReply = String(sfJson?.choices?.[0]?.message?.content ?? "").trim();
        if (!rawReply) {
            throw buildProviderResponseError({
                statusCode: 502,
                code: "LLM_PROVIDER_EMPTY_RESPONSE",
                message: "LLM provider returned empty content",
                userMessage: "Il provider ha restituito una risposta vuota.",
                provider: context.providerCatalog.provider,
                model: context.modelId,
                providerBody: sfJson,
            });
        }

        const usage = sfJson?.usage
            ? {
                promptTokens: Number(sfJson.usage.prompt_tokens ?? 0),
                completionTokens: Number(sfJson.usage.completion_tokens ?? 0),
                totalTokens: Number(sfJson.usage.total_tokens ?? 0),
            }
            : undefined;
        const resolvedUsage = resolveUsageWithFallback({ usage, messages: args.messages, outputText: rawReply });
        return {
            rawReply,
            rawThinking: "",
            usage,
            providerCostUsd: readProviderCostUsd({
                provider: context.providerCatalog.provider,
                modelId: context.modelId,
                providerUsage: sfJson?.usage,
                usage: resolvedUsage,
            }),
            finishReason: sfJson?.choices?.[0]?.finish_reason,
        };
    }

    private async dispatchStream(args: {
        input: GenerateArtifactInput;
        startedAt: number;
        endpoint: string;
        headers: Record<string, string>;
        requestBody: string;
        context: LlmRuntimeContext;
        messages: LlmMessage[];
        body: LlmChatPreviewInput;
        promptExecutionLogId: string;
    }): Promise<{ kind: "reply"; reply: ProviderReply } | Exclude<GenerateArtifactOutcome, { kind: "completed" }>> {
        const { input, startedAt, context } = args;
        const sink = input.sink ?? {};
        const isStopped = input.isStopped ?? (() => false);

        // The provider call is aborted by the caller's signal (client gone, run cancelled) or by
        // the connect ceiling below, whichever comes first.
        const fetchAbort = new AbortController();
        const onExternalAbort = () => fetchAbort.abort();
        if (input.abortSignal?.aborted) fetchAbort.abort();
        input.abortSignal?.addEventListener("abort", onExternalAbort);
        const fetchTimeout = setTimeout(() => fetchAbort.abort(), STREAM_CONNECT_TIMEOUT_MS);
        console.log(`[stream-debug] starting fetch to provider at ${Date.now() - startedAt}ms`);

        try {
            let sfRes: Response;
            try {
                sfRes = await fetch(args.endpoint, {
                    method: "POST",
                    headers: args.headers,
                    body: args.requestBody,
                    signal: fetchAbort.signal,
                });
            } catch (fetchErr) {
                clearTimeout(fetchTimeout);
                if (isAbortError(fetchErr)) {
                    console.log(`[stream-debug] AbortError from fetch at ${Date.now() - startedAt}ms`);
                    return { kind: "aborted" };
                }
                console.log(`[stream-debug] fetch threw non-abort error at ${Date.now() - startedAt}ms:`, fetchErr);
                throw buildProviderResponseError({
                    statusCode: 502,
                    code: "LLM_PROVIDER_CONNECTION_FAILED",
                    message: fetchErr instanceof Error ? fetchErr.message : "Provider connection error",
                    userMessage: "Non e stato possibile contattare il provider LLM.",
                    provider: context.providerCatalog.provider,
                    model: context.modelId,
                });
            }
            clearTimeout(fetchTimeout);

            if (!sfRes.ok || !sfRes.body) {
                const providerBody = await sfRes.text().catch(() => "");
                console.log(`[stream-debug] provider error status=${sfRes.status} at ${Date.now() - startedAt}ms body=${providerBody.slice(0, 200)}`);
                throw buildProviderResponseError({
                    statusCode: sfRes.status === 429 ? 429 : sfRes.status === 404 ? 404 : 502,
                    code: sfRes.status === 429 ? "LLM_PROVIDER_RATE_LIMIT" : sfRes.status === 404 ? "LLM_MODEL_NOT_FOUND" : "LLM_PROVIDER_REQUEST_FAILED",
                    message: `Provider error ${sfRes.status}`,
                    userMessage: sfRes.status === 429
                        ? "Il provider ha raggiunto il rate limit. Riprova tra poco o seleziona un altro modello."
                        : sfRes.status === 404
                            ? "Il modello selezionato non e disponibile presso il provider. Scegli un modello diverso."
                            : "La chiamata al provider LLM non e andata a buon fine.",
                    provider: context.providerCatalog.provider,
                    model: context.modelId,
                    providerStatus: sfRes.status,
                    providerBody,
                });
            }

            sink.streamOpened?.();
            console.log(`[stream-debug] provider response ok, starting stream read at ${Date.now() - startedAt}ms`);

            const reader = sfRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let rawReply = "";
            // Reasoning is billed from the same completion budget as the answer, so on a truncated
            // call this is the only surviving record of work already paid for.
            let rawThinking = "";
            let usage: ProviderReply["usage"];
            let providerCostUsdStream: number | undefined;
            let finishReason: string | undefined;
            let streamAborted = false;

            try {
                while (true) {
                    if (isStopped()) { streamAborted = true; break; }
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith("data:")) continue;

                        const data = trimmed.slice(5).trim();
                        if (!data || data === "[DONE]") {
                            continue;
                        }

                        try {
                            const json = JSON.parse(data) as {
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
                                    /** OpenRouter real cost in USD */
                                    cost?: number | string;
                                };
                            };

                            const delta = json.choices?.[0]?.delta;
                            const thinking =
                                delta?.reasoning_content ??
                                delta?.reasoning ??
                                delta?.thinking;

                            const content = delta?.content;

                            if (thinking) {
                                rawThinking += String(thinking);
                                sink.thinking?.(String(thinking));
                            }

                            if (content) {
                                rawReply += String(content);
                                sink.answer?.(String(content));
                            }

                            const fr = json.choices?.[0]?.finish_reason;
                            if (fr) {
                                finishReason = String(fr);
                            }

                            if (json.usage) {
                                usage = {
                                    promptTokens: Number(json.usage.prompt_tokens ?? 0),
                                    completionTokens: Number(json.usage.completion_tokens ?? 0),
                                    totalTokens: Number(json.usage.total_tokens ?? 0),
                                };
                                const rc = json.usage.cost;
                                if (typeof rc === "number") providerCostUsdStream = rc;
                                else if (typeof rc === "string") { const p = parseFloat(rc); if (!isNaN(p)) providerCostUsdStream = p; }
                            }
                        } catch {
                            // Ignore malformed chunk.
                        }
                    }
                }
            } catch (streamReadErr) {
                if (isAbortError(streamReadErr)) {
                    streamAborted = true;
                } else {
                    console.log(`[stream-debug] stream read error at ${Date.now() - startedAt}ms:`, streamReadErr);
                    const message = streamReadErr instanceof Error ? streamReadErr.message : "Stream read error";
                    await this.promptExecutionLogRepository.complete(args.promptExecutionLogId, {
                        status: "failed",
                        errorMessage: message,
                        durationMs: Date.now() - startedAt,
                    }).catch(() => { });
                    throw new GenerationStreamReadError(message, Date.now() - startedAt);
                }
            }

            // The stream carries no final usage object, so whatever was accumulated from the chunks
            // is passed in as the explicit figure; the shared rule supplies the fallback.
            if (usage) {
                providerCostUsdStream = readProviderCostUsd({
                    provider: context.providerCatalog.provider,
                    modelId: context.modelId,
                    usage,
                    explicitCostUsd: providerCostUsdStream,
                });
            }

            if (streamAborted || isStopped()) {
                return {
                    kind: "interrupted",
                    interrupted: await this.recordInterruption({
                        input, startedAt, context, body: args.body, messages: args.messages,
                        promptExecutionLogId: args.promptExecutionLogId,
                        rawReply, rawThinking, usage, providerCostUsd: providerCostUsdStream, finishReason,
                    }),
                };
            }

            return {
                kind: "reply",
                reply: { rawReply: rawReply.trim(), rawThinking, usage, providerCostUsd: providerCostUsdStream, finishReason },
            };
        } finally {
            clearTimeout(fetchTimeout);
            input.abortSignal?.removeEventListener("abort", onExternalAbort);
        }
    }

    private async recordInterruption(args: {
        input: GenerateArtifactInput;
        startedAt: number;
        context: LlmRuntimeContext;
        body: LlmChatPreviewInput;
        messages: LlmMessage[];
        promptExecutionLogId: string;
        rawReply: string;
        rawThinking: string;
        usage: ProviderReply["usage"];
        providerCostUsd?: number;
        finishReason?: string;
    }): Promise<InterruptedGeneration> {
        const partialUsage = resolveUsageWithFallback({ usage: args.usage, messages: args.messages, outputText: args.rawReply });
        this.userRepository.incrementTokensConsumed(args.input.userId, partialUsage.totalTokens).catch(() => { });
        const partialCost = estimateCost(
            { capability: args.body.capability, tokenUsage: partialUsage, providerCostUsd: args.providerCostUsd },
            costPolicy(),
        );
        // I11: the journal never got a success write for this run — mark it failed (interrupted)
        // rather than leaving it "pending" forever.
        await this.promptExecutionLogRepository.complete(args.promptExecutionLogId, {
            status: "failed",
            errorMessage: "Generation interrupted (client disconnect or timeout)",
            durationMs: Date.now() - args.startedAt,
            finishReason: args.finishReason ?? "interrupted",
            // The work already paid for: an interrupted generation is precisely the case where the
            // partial answer and the reasoning behind it are worth more than the error message,
            // because they are what a resumed attempt would start from instead of starting over.
            rawResponse: args.rawReply || undefined,
            reasoningTrace: args.rawThinking ? args.rawThinking.slice(0, 20_000) : undefined,
        }).catch(() => { });
        return {
            provider: args.context.providerCatalog.provider,
            model: args.context.modelId,
            usage: partialUsage,
            costEstimate: partialCost,
            durationMs: Date.now() - args.startedAt,
            partialReply: args.rawReply.length > 0 ? args.rawReply.slice(0, 200) : undefined,
        };
    }

    private async finalize(args: {
        input: GenerateArtifactInput;
        startedAt: number;
        body: LlmChatPreviewInput;
        context: LlmRuntimeContext;
        messages: LlmMessage[];
        isFocusedMode: boolean;
        reply: ProviderReply;
        promptExecutionLogId: string;
    }): Promise<LlmChatPreviewResult> {
        const { input, body, context, messages, isFocusedMode, reply, promptExecutionLogId } = args;
        const streaming = input.transport === "stream";
        const rawReply = reply.rawReply;

        const parsed = tryParseStructuredJson(rawReply);
        const generationParseError = isGenerationParseFailure({
            parseValid: parsed.parseValid,
            isFocusedMode,
            hasCurrentArtifacts: Boolean(body.currentArtifacts?.html),
        });
        let structured = parsed.structured ?? buildParseFailureStructured();
        let mediaResolutionMetadata: MediaResolutionMetadata | undefined;
        let focusPatchApplied: boolean | undefined;
        let focusPatchParseError: boolean | undefined;
        if (isFocusedMode && body.currentArtifacts) {
            if (parsed.structured?.focusPatch) {
                // When selectedElement is present, derive anchor server-side from outerHtml
                // so the LLM doesn't need to include it (avoids JSON encoding failures).
                const serverAnchor = body.focusContext?.selectedElement?.outerHtml;
                const patchResult = applyFocusPatch(body.currentArtifacts, parsed.structured.focusPatch, {
                    html: body.currentArtifacts.html ?? "",
                    css: body.currentArtifacts.css ?? "",
                    js: body.currentArtifacts.js ?? "",
                }, serverAnchor);
                // When the focused patch targets HTML, the LLM may also provide companion CSS/JS
                // rules required to style the new element. Carry those through so the new element
                // renders correctly without a second round-trip for the user. Appended to the
                // base: using || would silently drop the base styles when the LLM breaks the
                // focused-mode protocol and returns non-empty artifacts.
                const patchType = parsed.structured.focusPatch.targetType;
                const companionCss = patchType === "html" ? (parsed.structured.artifacts?.css ?? "") : "";
                const companionJs = patchType === "html" ? (parsed.structured.artifacts?.js ?? "") : "";
                structured = {
                    ...structured,
                    artifacts: {
                        ...patchResult.artifacts,
                        css: [patchResult.artifacts.css, companionCss].filter(Boolean).join("\n"),
                        js: [patchResult.artifacts.js, companionJs].filter(Boolean).join("\n"),
                    },
                };
                focusPatchApplied = patchResult.patchApplied;
                // Fallback: client HTML may have been truncated (htmlLimit) so the target element
                // was cut off. Retry the merge against the server's stored active snapshot, which
                // always contains the full artifact HTML.
                if (!focusPatchApplied) {
                    const activeSnap = await this.snapshotRepository.getActiveForProject(input.projectId).catch(() => null);
                    if (activeSnap?.artifacts.html) {
                        const retryResult = applyFocusPatch(
                            activeSnap.artifacts,
                            parsed.structured.focusPatch,
                            activeSnap.artifacts,
                            serverAnchor
                        );
                        if (retryResult.patchApplied) {
                            console.info("[focusPatch] server-snapshot fallback applied successfully");
                            structured = {
                                ...structured,
                                artifacts: {
                                    ...retryResult.artifacts,
                                    css: [retryResult.artifacts.css, companionCss].filter(Boolean).join("\n"),
                                    js: [retryResult.artifacts.js, companionJs].filter(Boolean).join("\n"),
                                },
                            };
                            focusPatchApplied = true;
                        }
                    }
                }
            } else {
                // Focused mode but no focusPatch (parse failed or LLM chat-only) — preserve
                // currentArtifacts so no snapshot is created with fallback HTML.
                structured = {
                    ...structured,
                    artifacts: {
                        html: body.currentArtifacts.html ?? "",
                        css: body.currentArtifacts.css ?? "",
                        js: body.currentArtifacts.js ?? "",
                    },
                };
                focusPatchApplied = false;
                // When the JSON parse itself failed in focused mode, craft a user-friendly reply
                // instead of dumping the raw LLM output, and flag the error so the frontend can
                // suggest a model switch.
                if (!parsed.parseValid) {
                    focusPatchParseError = true;
                    structured = {
                        ...structured,
                        chat: {
                            summary: "Il modello ha prodotto una risposta non interpretabile (JSON malformato). L'elemento non è stato modificato.",
                            bullets: [
                                "La pagina resta invariata.",
                                "Prova a cambiare modello o ripetere la richiesta.",
                            ],
                            nextActions: [],
                        },
                    };
                }
            }
        }
        // Post-process media placeholders and legacy provider URLs into stable ProjectAsset URLs.
        // Wrapped in try/catch: media resolution must never abort the artifact delivery. If
        // resolution fails entirely the user gets the raw artifacts and a logged warning.
        if (!generationParseError && (structured.artifacts?.html || structured.artifacts?.css)) {
            try {
                const sink = input.sink;
                const mediaResolution = await this.resolveArtifactMedia.execute({
                    projectId: input.projectId,
                    userId: input.userId,
                    artifacts: structured.artifacts,
                    mediaManifest: structured.mediaManifest,
                    sourceContext: {
                        route: streaming ? "chat-preview-stream" : "chat-preview",
                        conversationId: body.conversationId,
                        focusPatchApplied,
                    },
                    mode: isFocusedMode ? "focused_edit" : "initial_generation",
                    // Forward deterministic media-resolution steps to the caller in real time.
                    ...(sink?.mediaProgress ? { onProgress: (event: MediaProgressEvent) => sink.mediaProgress!(event) } : {}),
                });
                structured = {
                    ...structured,
                    artifacts: mediaResolution.artifacts,
                };
                mediaResolutionMetadata = mediaResolution.metadata;
            } catch (mediaError) {
                console.error(`[llm/${streaming ? "chat-preview-stream" : "chat-preview"}] media resolution failed — delivering artifacts without resolved media:`, mediaError);
                ExecutionLogger.instance.emit({
                    projectId: input.projectId,
                    domain: "system",
                    eventType: "artifact_media_resolution_error",
                    level: "error",
                    status: "failure",
                    metadata: { error: mediaError instanceof Error ? mediaError.message : String(mediaError) },
                });
            }
        }
        const formattedReply = (parsed.parseValid || focusPatchParseError || generationParseError) ? buildFormattedReply(structured) : rawReply;
        const resolvedUsage = resolveUsageWithFallback({
            usage: reply.usage,
            messages,
            outputText: rawReply,
        });
        this.userRepository.incrementTokensConsumed(input.userId, resolvedUsage.totalTokens).catch(() => { });

        const result: LlmChatPreviewResult = {
            reply: formattedReply,
            rawResponse: rawReply,
            structuredParseValid: parsed.parseValid,
            // Reported, never thrown here: refusing at the generation boundary would discard a
            // complete artifact over a syntax slip. The storage boundary still refuses it.
            generatedJavaScriptError: parsed.structured?.artifacts?.js
                ? describeGeneratedJavaScriptSyntaxError(parsed.structured.artifacts.js)
                : undefined,
            promptingTrace: {
                originalUserMessage: body.message,
                promptConfigId: context.promptConfigId,
                prePromptTemplate: context.prePromptTemplate,
                effectiveSystemPrompt: context.systemPrompt,
                layers: context.promptLayers,
                messagesSentToLlm: messages,
                focusContext: body.focusContext,
            },
            structured,
            mediaResolution: mediaResolutionMetadata,
            focusPatchApplied,
            focusPatchParseError,
            generationParseError: generationParseError || undefined,
            provider: context.providerCatalog.provider,
            model: context.modelId,
            finishReason: reply.finishReason,
            usage: resolvedUsage,
            costEstimate: estimateCost(
                {
                    capability: body.capability,
                    tokenUsage: resolvedUsage,
                    providerCostUsd: reply.providerCostUsd,
                },
                costPolicy(),
            ),
            durationMs: Date.now() - args.startedAt,
            simulated: false,
            promptExecutionId: promptExecutionLogId,
        };
        const mediaResolutionSummary = buildPromptExecutionMediaResolutionSummary(result.mediaResolution);
        const streamingMeta = streaming ? { streaming: true } : {};

        // ── Execution log (fire-and-forget) ──────────────────────────────
        ExecutionLogger.instance.emit({
            projectId: input.projectId,
            domain: "llm",
            eventType: "llm_generation_complete",
            level: parsed.parseValid ? "info" : "warn",
            status: parsed.parseValid ? "success" : "partial",
            durationMs: result.durationMs,
            metadata: {
                provider: result.provider,
                model: result.model,
                finishReason: result.finishReason,
                promptTokens: result.usage?.promptTokens,
                completionTokens: result.usage?.completionTokens,
                costEur: result.costEstimate?.amount,
                structuredParseValid: result.structuredParseValid,
                simulated: result.simulated,
                isFocusedMode,
                focusPatchPresent: Boolean(focusPatchApplied !== undefined),
                ...streamingMeta,
            },
        });
        if (generationParseError) {
            const rawLen = rawReply.length;
            ExecutionLogger.instance.emit({
                projectId: input.projectId,
                conversationId: body.conversationId,
                domain: "llm",
                eventType: "llm_generation_parse_failed",
                level: "error",
                status: "failure",
                durationMs: result.durationMs,
                metadata: {
                    provider: result.provider,
                    model: result.model,
                    finishReason: result.finishReason,
                    completionTokens: result.usage?.completionTokens,
                    isFocusedMode,
                    streaming,
                    rawLength: rawLen,
                    rawPrefix: rawReply.slice(0, 1200),
                    rawSuffix: rawLen > 1800 ? rawReply.slice(-600) : "",
                },
            });
        }
        if (isFocusedMode && focusPatchApplied !== undefined) {
            ExecutionLogger.instance.emit({
                projectId: input.projectId,
                domain: "focus_patch",
                eventType: focusPatchApplied ? "focus_patch_applied" : "focus_patch_failed",
                level: focusPatchApplied ? "info" : "warn",
                status: focusPatchApplied ? "success" : "failure",
                durationMs: result.durationMs,
                metadata: {
                    anchorTag: body.focusContext?.selectedElement?.tag,
                    anchorPfIdPresent: Boolean(body.focusContext?.selectedElement?.outerHtml?.includes("data-pf-id")),
                    ...streamingMeta,
                },
            });
        }
        // ── end execution log ─────────────────────────────────────────────

        // ── I11: durable journal completion, AWAITED before the result is delivered ──
        // Chat costs are included in project cost totals alongside optimize/suggest costs, and the
        // record a retry's idempotencyKey check would find reflects the final outcome before the
        // client sees it.
        const completion = this.promptExecutionLogRepository.complete(promptExecutionLogId, {
            status: "succeeded",
            usage: result.usage,
            mediaResolutionSummary,
            costEstimate: result.costEstimate,
            durationMs: result.durationMs,
            finishReason: result.finishReason,
            // Kept whenever the call did not end cleanly, not only on truncation. A "stop" finish
            // means the model said what it meant to say and the trace is dead weight; anything
            // else means work was cut short, and the trace is the only record of it.
            ...(streaming ? {
                reasoningTrace: reply.finishReason && reply.finishReason !== "stop"
                    ? reply.rawThinking.slice(0, 20_000)
                    : undefined,
            } : {}),
            // The reply before parsing and repair: proves not only WHICH prompt produced the
            // artifact but what the model actually emitted.
            rawResponse: result.rawResponse,
        });
        if (streaming) {
            await completion.catch(() => { });
        } else {
            await completion;
        }
        // ── end I11 journal completion ──────────────────────────────────────

        // ── Cost ledger: append-only transaction record ───────────────────
        CostTransactionService.instance.record({
            userId: input.userId,
            projectId: input.projectId,
            resourceType: ResourceType.LLM_CHAT,
            resourceSubtype: context.modelId,
            providerCostUsd: reply.providerCostUsd,
            precomputedTotalEur: result.costEstimate?.amount,
            units: result.usage ? {
                promptTokens: result.usage.promptTokens,
                completionTokens: result.usage.completionTokens,
                totalTokens: result.usage.totalTokens,
            } : {},
            sourceRef: { conversationId: body.conversationId },
            meta: {
                provider: result.provider,
                model: result.model,
                finishReason: result.finishReason,
                isFocusedMode,
                ...streamingMeta,
            },
        });
        // ── end cost ledger ───────────────────────────────────────────────

        return result;
    }
}
