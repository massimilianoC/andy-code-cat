import { createHash } from "crypto";
import { env } from "../../config";
import { buildChatCompletionRequestBody } from "../llm/chatRequestAdapter";
import { instrumentArtifactHtml, validateAnchors } from "../didactic/instrumentArtifactHtml";
import { buildDidacticPrompt } from "../llm/didacticPrompts";
import { CostTransactionService } from "../cost/CostTransactionService";
import { ExecutionLogger } from "../services/ExecutionLogger";
import { ResourceType } from "../../domain/entities/CostTransaction";
import type { DidacticArtifactKnowledge, DidacticTopic, DidacticQuiz } from "../../domain/entities/DidacticArtifactKnowledge";
import type { DidacticArtifactKnowledgeRepository } from "../../domain/repositories/DidacticArtifactKnowledgeRepository";
import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";

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

function extractFirstJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === "{") depth++;
        if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
}

function parseDidacticJson(raw: string): { overview: string; topics: DidacticTopic[]; quizzes: DidacticQuiz[] } | null {
    let trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
        trimmed = trimmed.replace(/^```(?:json)?\s*\n?/i, "");
        const lastFence = trimmed.lastIndexOf("```");
        if (lastFence > 0) trimmed = trimmed.slice(0, lastFence).trim();
    }
    const candidate = extractFirstJsonObject(trimmed);
    if (!candidate) return null;
    try {
        const parsed = JSON.parse(candidate);
        if (!parsed.overview || !Array.isArray(parsed.topics) || !Array.isArray(parsed.quizzes)) return null;
        return {
            overview: String(parsed.overview),
            topics: parsed.topics as DidacticTopic[],
            quizzes: parsed.quizzes as DidacticQuiz[],
        };
    } catch {
        return null;
    }
}

export class GenerateDidacticKnowledge {
    constructor(private repo: DidacticArtifactKnowledgeRepository) {}

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

        // 4. Parse JSON
        const parsed = parseDidacticJson(rawReply);
        if (!parsed) {
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
        const costEstimate = { providerCostEur: 0, totalEur: 0 }; // actual cost computed by CostTransactionService

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
            providerCostUsd: 0,
            units: usage ? {
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
            } : {},
            sourceRef: { promptExecutionLogId: undefined },
            meta: { provider: llmContext.provider, model: llmContext.model, snapshotId: input.snapshotId },
        });

        return { knowledge: saved, costEstimate };
    }
}
