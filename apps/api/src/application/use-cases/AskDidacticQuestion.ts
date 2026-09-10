import { env } from "../../config";
import { buildChatCompletionRequestBody } from "../llm/chatRequestAdapter";
import { buildDidacticPrompt } from "../llm/didacticPrompts";
import { estimateCost } from "../llm/costPolicy";
import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { DidacticQnaEntry, DidacticQnaFocus } from "../../domain/entities/DidacticQnaEntry";
import type { DidacticQnaRepository } from "../../domain/repositories/DidacticQnaRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";

const TASK_KEY = "didactic_ask";

interface LlmContext {
    provider: string;
    model: string;
    baseUrl: string;
    apiKey: string;
    temperature: number;
    maxTokens: number;
}

interface Input {
    projectId: string;
    userId: string;
    snapshotId: string;
    snapshot: PreviewSnapshot;
    question: string;
    focus?: DidacticQnaFocus;
    uiLanguage: "it" | "en";
    llmContext: LlmContext;
    /** Correlation keys — see docs/specs/WORK_SESSION_TRACING_SPEC.md §3. */
    workSessionId?: string;
    pipelineRunId?: string;
}

interface Output {
    answer: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    model: string;
    provider: string;
}

export class AskDidacticQuestion {
    constructor(
        private repo: DidacticQnaRepository,
        /**
         * Optional so existing callers and tests keep working, but every production wiring should
         * pass it: without it this call records its cost and nothing else — we would know what the
         * Q&A cost and nothing about what was asked or what the model answered
         * (docs/specs/WORK_SESSION_TRACING_SPEC.md §2).
         */
        private readonly promptExecutionLogRepository?: PromptExecutionLogRepository,
    ) {}

    async execute(input: Input): Promise<Output> {
        const { snapshot, llmContext, uiLanguage, question, focus } = input;

        const { system, user } = buildDidacticPrompt({
            mode: "ask",
            artifacts: snapshot.artifacts,
            promptingTrace: snapshot.metadata?.promptingTrace,
            focus: focus
                ? {
                      kind: focus.kind,
                      pfId: focus.pfId,
                      outerHtml: focus.outerHtml,
                      lineRange: focus.lineRange,
                      selectedText: focus.selectedText,
                  }
                : undefined,
            question,
            uiLanguage,
        });

        const body = buildChatCompletionRequestBody({
            provider: llmContext.provider,
            model: llmContext.model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            maxTokens: llmContext.maxTokens,
            temperature: llmContext.temperature,
        });

        const url = `${llmContext.baseUrl}/chat/completions`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${llmContext.apiKey}`,
        };

        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        if (!res.ok) {
            const text = await res.text().catch(() => "unknown");
            throw new Error(`LLM request failed: ${res.status} ${text}`);
        }

        const json = await res.json();
        const answer = String(json.choices?.[0]?.message?.content ?? "");
        const usage = json.usage
            ? {
                  promptTokens: Number(json.usage.prompt_tokens ?? 0),
                  completionTokens: Number(json.usage.completion_tokens ?? 0),
                  totalTokens: Number(json.usage.total_tokens ?? 0),
              }
            : undefined;

        return { answer, usage, model: llmContext.model, provider: llmContext.provider };
    }

    async streamTokens(
        input: Input,
        onToken: (delta: string) => void
    ): Promise<{ fullAnswer: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; model: string; provider: string }> {
        const { snapshot, llmContext, uiLanguage, question, focus } = input;

        const { system, user } = buildDidacticPrompt({
            mode: "ask",
            artifacts: snapshot.artifacts,
            promptingTrace: snapshot.metadata?.promptingTrace,
            focus: focus
                ? {
                      kind: focus.kind,
                      pfId: focus.pfId,
                      outerHtml: focus.outerHtml,
                      lineRange: focus.lineRange,
                      selectedText: focus.selectedText,
                  }
                : undefined,
            question,
            uiLanguage,
        });

        const body = buildChatCompletionRequestBody({
            provider: llmContext.provider,
            model: llmContext.model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            maxTokens: llmContext.maxTokens,
            temperature: llmContext.temperature,
        });

        const url = `${llmContext.baseUrl}/chat/completions`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${llmContext.apiKey}`,
        };

        const startedAt = Date.now();

        // Journalled before dispatch, never after: a record written only on success cannot explain a
        // call that never came back. Failing to journal must not fail the answer — the id is optional
        // from here on (docs/specs/WORK_SESSION_TRACING_SPEC.md §2).
        const pendingLogId = this.promptExecutionLogRepository && input.projectId && input.userId
            ? await this.promptExecutionLogRepository.createPending({
                taskKey: TASK_KEY,
                projectId: input.projectId,
                userId: input.userId,
                workSessionId: input.workSessionId,
                pipelineRunId: input.pipelineRunId,
                pipelineStage: "didactic_ask",
                endpoint: url,
                provider: llmContext.provider,
                model: llmContext.model,
                inputPrompt: question.slice(0, 2000),
                renderedSystemPrompt: system,
                renderedUserPrompt: user,
                contextMeta: { usedMoodboard: false, usedUserProfile: false },
            }).then((log) => log.id).catch(() => null)
            : null;

        try {
            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify({ ...body, stream: true }),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => "unknown");
                throw new Error(`LLM request failed: ${res.status} ${text}`);
            }

            const reader = res.body?.getReader();
            if (!reader) throw new Error("No response body from LLM");

            const decoder = new TextDecoder();
            let sseBuffer = "";
            let fullAnswer = "";
            let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
            let finishReason: string | undefined;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                sseBuffer += decoder.decode(value, { stream: true });

                const lines = sseBuffer.split("\n");
                sseBuffer = lines.pop() ?? "";

                for (const line of lines) {
                    if (!line.startsWith("data:")) continue;
                    const data = line.slice(5).trim();
                    if (data === "[DONE]") continue;
                    try {
                        const chunk = JSON.parse(data) as {
                            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
                            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
                        };
                        const delta = chunk.choices?.[0]?.delta?.content;
                        if (delta) {
                            fullAnswer += delta;
                            onToken(delta);
                        }
                        if (chunk.choices?.[0]?.finish_reason) {
                            finishReason = chunk.choices[0]!.finish_reason ?? undefined;
                        }
                        if (chunk.usage) {
                            usage = {
                                promptTokens: Number(chunk.usage.prompt_tokens ?? 0),
                                completionTokens: Number(chunk.usage.completion_tokens ?? 0),
                                totalTokens: Number(chunk.usage.total_tokens ?? 0),
                            };
                        }
                    } catch {
                        // skip malformed SSE chunks
                    }
                }
            }

            if (pendingLogId) {
                const costEstimate = usage
                    ? estimateCost(
                        { capability: "chat", tokenUsage: usage },
                        {
                            textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                            imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                            videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                            usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
                            providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
                        },
                    )
                    : undefined;

                // `rawResponse` is the streamed reply exactly as accumulated from the provider's own
                // deltas — nothing here re-renders or repairs it before it is journalled.
                await this.promptExecutionLogRepository!.complete(pendingLogId, {
                    status: "succeeded",
                    durationMs: Date.now() - startedAt,
                    usage,
                    costEstimate,
                    finishReason,
                    rawResponse: fullAnswer,
                }).catch(() => undefined);
            }

            return { fullAnswer, usage, model: llmContext.model, provider: llmContext.provider };
        } catch (error) {
            if (pendingLogId) {
                await this.promptExecutionLogRepository!.complete(pendingLogId, {
                    status: "failed",
                    durationMs: Date.now() - startedAt,
                    errorMessage: error instanceof Error ? error.message : String(error),
                }).catch(() => undefined);
            }
            throw error;
        }
    }

    async persist(input: Input & Output): Promise<DidacticQnaEntry> {
        const entry: DidacticQnaEntry = {
            id: crypto.randomUUID(),
            projectId: input.projectId,
            userId: input.userId,
            snapshotId: input.snapshotId,
            focus: input.focus,
            question: input.question,
            answer: input.answer,
            model: input.model,
            provider: input.provider,
            usage: input.usage,
            createdAt: new Date(),
        };
        return this.repo.insert(entry);
    }
}
