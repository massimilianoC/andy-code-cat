import { createHash } from "crypto";
import { describeError } from "../errors/describeError";
import { resolveLlmCallCost, toUserFacingCost } from "../cost/resolveLlmCallCost";
import { buildChatCompletionRequestBody } from "../llm/chatRequestAdapter";
import { instrumentArtifactHtml, validateAnchors } from "../didactic/instrumentArtifactHtml";
import { buildDidacticPrompt } from "../llm/didacticPrompts";
import { parseJsonWithRepairs } from "../llm/llmParser";
import { CostTransactionService } from "../cost/CostTransactionService";
import { ExecutionLogger } from "../services/ExecutionLogger";
import { ResourceType } from "../../domain/entities/CostTransaction";
import type { DidacticArtifactKnowledge, DidacticTopic, DidacticQuiz } from "../../domain/entities/DidacticArtifactKnowledge";
import type { DidacticArtifactKnowledgeRepository } from "../../domain/repositories/DidacticArtifactKnowledgeRepository";
import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";

const TASK_KEY = "didactic_knowledge_generate";

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
    snapshotId: string;
    userId: string;
    snapshot: PreviewSnapshot;
    uiLanguage: "it" | "en";
    llmContext: LlmContext;
    /** Correlation keys — see docs/specs/WORK_SESSION_TRACING_SPEC.md §3. */
    workSessionId?: string;
    pipelineRunId?: string;
}

interface Output {
    knowledge: DidacticArtifactKnowledge;
    costEstimate?: { providerCostEur: number; totalEur: number };
}

function computeGroundingHash(snapshot: PreviewSnapshot): string {
    const { html, css, js } = snapshot.artifacts;
    const trace = snapshot.metadata?.promptingTrace;
    const traceStr = trace
        ? `${trace.originalUserMessage}\n${trace.prePromptTemplate ?? ""}\n${trace.effectiveSystemPrompt ?? ""}`
        : "";
    return createHash("sha256").update(html + css + js + traceStr).digest("hex").slice(0, 32);
}

type DidacticJsonShape = { overview: string; topics: DidacticTopic[]; quizzes: DidacticQuiz[] };

function isDidacticJsonShape(value: unknown): value is DidacticJsonShape {
    return (
        typeof value === "object" && value !== null
        && typeof (value as Record<string, unknown>).overview === "string"
        && Array.isArray((value as Record<string, unknown>).topics)
        && Array.isArray((value as Record<string, unknown>).quizzes)
    );
}

/**
 * Reuses the artifact parser's repair chain (`parseJsonWithRepairs`, `application/llm/llmParser.ts`)
 * rather than growing a third copy of it — see `parseSectionPlan` (`application/llm/sectionPlan.ts`)
 * for the same pattern. This call used to carry its own 3-of-5 strategy subset, missing
 * `repairTruncatedJson` — the most likely failure mode here, since measured runs produce 4000-6000
 * completion tokens of JSON and a `max_tokens` cutoff lands mid-object.
 *
 * Fence-stripping stays local: `parseJsonWithRepairs` operates on a single already-delimited
 * candidate and does not know about ```json fences — that extraction is the caller's job on every
 * consumer of the shared chain, `parseSectionPlan` included.
 */
function parseDidacticJson(raw: string): DidacticJsonShape | null {
    let trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
        trimmed = trimmed.replace(/^```(?:json)?\s*\n?/i, "");
        const lastFence = trimmed.lastIndexOf("```");
        if (lastFence > 0) trimmed = trimmed.slice(0, lastFence).trim();
    }

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    const candidates = [
        trimmed,
        firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : null,
        // A truncated reply (max_tokens cutoff) never closes its last brace — hand the chain the
        // open remainder too, so repairTruncatedJson gets a candidate it can actually close.
        firstBrace >= 0 ? trimmed.slice(firstBrace) : null,
    ].filter((c): c is string => c !== null);

    for (const candidate of candidates) {
        const parsed = parseJsonWithRepairs(candidate, isDidacticJsonShape);
        if (!parsed) continue;
        return {
            overview: String(parsed.value.overview),
            topics: parsed.value.topics,
            quizzes: parsed.value.quizzes,
        };
    }
    return null;
}

export class GenerateDidacticKnowledge {
    constructor(
        private repo: DidacticArtifactKnowledgeRepository,
        /**
         * Optional so existing callers and tests keep working, but every production wiring should
         * pass it: without it this call records a cost transaction and nothing else — we would know
         * what the generation cost and nothing about what was asked or what the model answered
         * (docs/specs/WORK_SESSION_TRACING_SPEC.md §2).
         */
        private readonly promptExecutionLogRepository?: PromptExecutionLogRepository,
    ) {}

    async execute(input: Input): Promise<Output> {
        const startMs = Date.now();
        const { snapshot, llmContext, uiLanguage } = input;

        // 1. Instrument HTML
        const { instrumentedHtml, idIndex } = instrumentArtifactHtml(snapshot.artifacts.html);
        const cssLines = snapshot.artifacts.css.split("\n").length;
        const jsLines = snapshot.artifacts.js.split("\n").length;

        // 2. Build prompt
        const { system, user } = buildDidacticPrompt({
            mode: "generate",
            artifacts: { html: instrumentedHtml, css: snapshot.artifacts.css, js: snapshot.artifacts.js },
            promptingTrace: snapshot.metadata?.promptingTrace,
            uiLanguage,
        });

        // 3. Call LLM
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

        // Journalled before dispatch, never after: a record written only on success cannot explain a
        // call that never came back. Failing to journal must not fail the generation, so the id is
        // optional from here on (docs/specs/WORK_SESSION_TRACING_SPEC.md §2).
        const pendingLogId = this.promptExecutionLogRepository && input.projectId && input.userId
            ? await this.promptExecutionLogRepository.createPending({
                taskKey: TASK_KEY,
                projectId: input.projectId,
                userId: input.userId,
                workSessionId: input.workSessionId,
                pipelineRunId: input.pipelineRunId,
                pipelineStage: "didactic_knowledge",
                endpoint: url,
                provider: llmContext.provider,
                model: llmContext.model,
                inputPrompt: user.slice(0, 2000),
                renderedSystemPrompt: system,
                renderedUserPrompt: user,
                contextMeta: { usedMoodboard: false, usedUserProfile: false },
            }).then((log) => log.id).catch(() => null)
            : null;
        // Tracks whether the row was already resolved as "succeeded" (a raw reply was received) so
        // a downstream parse failure below does not re-complete it as "failed" — the provider call
        // itself succeeded, this app just could not turn the reply into structured knowledge.
        let journalResolved = false;

        try {
            const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
            if (!res.ok) {
                const text = await res.text().catch(() => "unknown");
                throw new Error(`LLM request failed: ${res.status} ${text}`);
            }

            const json = await res.json();
            const rawReply = String(json.choices?.[0]?.message?.content ?? "");
            const usage = json.usage
                ? {
                      promptTokens: Number(json.usage.prompt_tokens ?? 0),
                      completionTokens: Number(json.usage.completion_tokens ?? 0),
                      totalTokens: Number(json.usage.total_tokens ?? 0),
                  }
                : undefined;
            const finishReason = String(json.choices?.[0]?.finish_reason ?? "") || undefined;

            // The one costing model, not a fourth hand-rolled copy of it. This call used to price
            // itself at the flat rate and record a provider cost of zero, on what is the single
            // most expensive operation the product performs.
            const callCost = usage
                ? resolveLlmCallCost({
                    provider: llmContext.provider,
                    modelId: llmContext.model,
                    providerUsage: json.usage,
                    usage,
                    capability: "chat",
                })
                : undefined;

            if (pendingLogId) {
                const journalCostEstimate = callCost?.estimate;

                // `rawResponse` is the reply exactly as the provider sent it, before
                // parseDidacticJson's repair chain touches it — see the field's own doc comment on
                // `PromptExecutionLog` for why that distinction matters (run f51ee098).
                await this.promptExecutionLogRepository!.complete(pendingLogId, {
                    status: "succeeded",
                    durationMs: Date.now() - startMs,
                    usage,
                    costEstimate: journalCostEstimate,
                    finishReason,
                    rawResponse: rawReply,
                }).catch(() => undefined);
                journalResolved = true;
            }

            // 4. Parse JSON
            const parsed = parseDidacticJson(rawReply);
            if (!parsed) {
                console.error("[Didactic] Failed to parse JSON. Raw reply (first 2000 chars):", rawReply.slice(0, 2000));
                throw new Error("Failed to parse didactic knowledge JSON");
            }

            // 5. Validate anchors
            const allAnchors = [
                ...parsed.topics.flatMap((t) => t.anchors),
                ...parsed.quizzes.flatMap((q) => q.anchors),
            ];
            const { valid: validAnchors, dropped: droppedAnchors } = validateAnchors(allAnchors, idIndex, {
                html: instrumentedHtml.split("\n").length,
                css: cssLines,
                js: jsLines,
            });

            // Replace anchors in topics/quizzes with only valid ones (drop invalid)
            const validAnchorSet = new Set(validAnchors);
            const cleanTopics = parsed.topics.map((t) => ({
                ...t,
                anchors: t.anchors.filter((a) => validAnchorSet.has(a)),
            }));
            const cleanQuizzes = parsed.quizzes.map((q) => ({
                ...q,
                anchors: q.anchors.filter((a) => validAnchorSet.has(a)),
            }));

            // 6. Persist
            const groundingHash = computeGroundingHash(snapshot);
            const knowledge: DidacticArtifactKnowledge = {
                id: crypto.randomUUID(),
                projectId: input.projectId,
                snapshotId: input.snapshotId,
                userId: input.userId,
                overview: parsed.overview,
                topics: cleanTopics,
                quizzes: cleanQuizzes,
                groundingHash,
                model: llmContext.model,
                provider: llmContext.provider,
                generatedAt: new Date(),
            };

            const saved = await this.repo.upsert(knowledge);

            // 7. Cost + log
            const durationMs = Date.now() - startMs;
            // What was actually spent, not a placeholder. This returned zero unconditionally, so
            // the panel told the user a generation costing several cents had cost nothing.
            const costEstimate = callCost ? toUserFacingCost(callCost) : undefined;

            ExecutionLogger.instance.emit({
                projectId: input.projectId,
                snapshotId: input.snapshotId,
                domain: "llm",
                eventType: "didactic_knowledge_generate",
                level: "info",
                status: droppedAnchors.length > 0 ? "partial" : "success",
                durationMs,
                metadata: {
                    provider: llmContext.provider,
                    model: llmContext.model,
                    promptTokens: usage?.promptTokens,
                    completionTokens: usage?.completionTokens,
                    topicsCount: cleanTopics.length,
                    quizzesCount: cleanQuizzes.length,
                    droppedAnchors: droppedAnchors.length,
                },
            });

            CostTransactionService.instance.record({
                userId: input.userId,
                projectId: input.projectId,
                resourceType: ResourceType.LLM_DIDACTIC_KNOWLEDGE,
                resourceSubtype: llmContext.model,
                providerCostUsd: callCost?.providerCostUsd,
                // The ledger keeps this total rather than recomputing, so the row, the journal and
                // the number returned to the panel are the same number.
                precomputedTotalEur: callCost?.estimate.amount,
                units: usage ? {
                    promptTokens: usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    totalTokens: usage.totalTokens,
                } : {},
                sourceRef: { promptExecutionLogId: pendingLogId ?? undefined },
                meta: { provider: llmContext.provider, model: llmContext.model, snapshotId: input.snapshotId },
            });

            return { knowledge: saved, costEstimate };
        } catch (error) {
            if (pendingLogId && !journalResolved) {
                await this.promptExecutionLogRepository!.complete(pendingLogId, {
                    status: "failed",
                    durationMs: Date.now() - startMs,
                    // Not `error.message`: a network failure's message is always "fetch failed",
                    // and a journal row that records only that cannot tell a DNS miss from an
                    // expired certificate weeks later.
                    errorMessage: describeError(error),
                }).catch(() => undefined);
            }
            throw error;
        }
    }
}
