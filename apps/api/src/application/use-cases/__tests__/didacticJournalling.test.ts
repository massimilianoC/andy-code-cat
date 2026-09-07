/**
 * The Zero Effort chain must leave a readable trace
 * (docs/specs/WORK_SESSION_TRACING_SPEC.md §2, §6; docs/specs/SESSION_TRACING_EXECUTION_PLAN.md WP4b).
 *
 * Before this, `AskDidacticQuestion` recorded nothing at all and `GenerateDidacticKnowledge`
 * recorded only a cost transaction: we knew what the didactic calls cost and nothing about what
 * was asked or what the model answered.
 *
 * These tests assert the journal rows exist and carry the fields that make a run reconstructible —
 * the prompts, the raw reply (before any parsing/repair), the correlation ids, and the endpoint
 * actually called — and that tracing never breaks the underlying generation, per docs/specs
 * §0's binding rule.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Same shape the sibling VibeClassify/VibePrefill journalling suite uses: the real config module
// exits the process when MONGODB_URI and the JWT secrets are absent, which a unit test has no
// business providing.
vi.mock("../../../config", () => ({
    env: {
        providerApiKeys: {},
        COST_POLICY_TEXT_EUR_PER_1K_TOKENS: 0.002,
        COST_POLICY_IMAGE_EUR_PER_ASSET: 0.02,
        COST_POLICY_VIDEO_EUR_PER_ASSET: 0.2,
        COST_POLICY_USD_TO_EUR_RATE: 0.92,
        COST_POLICY_PROVIDER_MARKUP_FACTOR: 1.2,
    },
}));

import { AskDidacticQuestion } from "../AskDidacticQuestion";
import { GenerateDidacticKnowledge } from "../GenerateDidacticKnowledge";
import type { PromptExecutionLogRepository } from "../../../domain/repositories/PromptExecutionLogRepository";
import type { PromptExecutionLog, PromptExecutionCompletion, NewPendingPromptExecution } from "../../../domain/entities/PromptExecutionLog";
import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import type { DidacticQnaRepository } from "../../../domain/repositories/DidacticQnaRepository";
import type { DidacticArtifactKnowledgeRepository } from "../../../domain/repositories/DidacticArtifactKnowledgeRepository";

class RecordingJournal implements PromptExecutionLogRepository {
    pending: NewPendingPromptExecution[] = [];
    completions: Array<{ id: string; completion: PromptExecutionCompletion }> = [];

    async createPending(input: NewPendingPromptExecution): Promise<PromptExecutionLog> {
        this.pending.push(input);
        return { ...input, id: `log-${this.pending.length}`, status: "pending", durationMs: 0, createdAt: new Date() } as PromptExecutionLog;
    }
    async complete(id: string, completion: PromptExecutionCompletion): Promise<PromptExecutionLog> {
        this.completions.push({ id, completion });
        return { id } as PromptExecutionLog;
    }
    async create(): Promise<PromptExecutionLog> { throw new Error("not used"); }
    async findActiveByIdempotencyKey(): Promise<PromptExecutionLog | null> { return null; }
    async summarizeByProject() { return { totalCost: 0, totalTokens: 0, runs: 0 }; }
    async summarizeAll() { return { totalCost: 0, totalTokens: 0, runs: 0 }; }
    async summarizeCostsByUser() { return {}; }
    async listRecentByProject(): Promise<PromptExecutionLog[]> { return []; }
    async listRecentAll(): Promise<PromptExecutionLog[]> { return []; }
    async listByWorkSession(): Promise<PromptExecutionLog[]> { return []; }
    async deleteByProject(): Promise<number> { return 0; }
}

const snapshot: PreviewSnapshot = {
    id: "snap-1",
    projectId: "p1",
    conversationId: "c1",
    isActive: true,
    artifacts: {
        html: '<div id="root"><h1>Hello</h1></div>',
        css: "h1 { color: red; }",
        js: "console.log('hi');",
    },
    createdAt: new Date(),
};

const llmContext = {
    provider: "siliconflow",
    model: "MiniMaxAI/MiniMax-M3",
    baseUrl: "https://api.siliconflow.com/v1",
    apiKey: "test-key",
    temperature: 0.4,
    maxTokens: 2048,
};

const noopQnaRepo: DidacticQnaRepository = {
    listByProject: async () => [],
    insert: async (entry) => entry,
};

const noopKnowledgeRepo: DidacticArtifactKnowledgeRepository = {
    findByProjectAndSnapshot: async () => null,
    upsert: async (k) => k,
    deleteBySnapshot: async () => undefined,
    deleteByProject: async () => 0,
};

function sseChunk(obj: unknown): string {
    return `data: ${JSON.stringify(obj)}\n\n`;
}

const ASK_ANSWER = "The <h1> renders 'Hello' because the CSS rule sets its color to red.";

function askStreamBody(): string {
    return (
        sseChunk({ choices: [{ delta: { content: ASK_ANSWER } }] })
        + sseChunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 } })
        + "data: [DONE]\n\n"
    );
}

describe("Zero Effort journalling — AskDidacticQuestion", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(askStreamBody(), { status: 200 })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it("writes the pending row BEFORE dispatching, so a call that never returns is still recorded", async () => {
        const journal = new RecordingJournal();
        const order: string[] = [];
        const originalCreate = journal.createPending.bind(journal);
        journal.createPending = async (input) => { order.push("journal"); return originalCreate(input); };
        vi.stubGlobal("fetch", vi.fn(async () => {
            order.push("provider");
            return new Response(askStreamBody(), { status: 200 });
        }));

        const useCase = new AskDidacticQuestion(noopQnaRepo, journal);
        await useCase.streamTokens({
            projectId: "p1",
            userId: "u1",
            snapshotId: "snap-1",
            snapshot,
            question: "Why is the title red?",
            uiLanguage: "en",
            llmContext,
        }, () => {});

        expect(order).toEqual(["journal", "provider"]);
    });

    it("records both prompts, the endpoint, and the correlation ids", async () => {
        const journal = new RecordingJournal();
        const useCase = new AskDidacticQuestion(noopQnaRepo, journal);

        await useCase.streamTokens({
            projectId: "p1",
            userId: "u1",
            snapshotId: "snap-1",
            snapshot,
            question: "Why is the title red?",
            uiLanguage: "en",
            llmContext,
            workSessionId: "ws-1",
            pipelineRunId: "run-1",
        }, () => {});

        expect(journal.pending).toHaveLength(1);
        const row = journal.pending[0]!;
        expect(row.pipelineStage).toBe("didactic_ask");
        expect(row.workSessionId).toBe("ws-1");
        expect(row.pipelineRunId).toBe("run-1");
        // Only the endpoint proves where the request went; the model id proves what we intended.
        expect(row.endpoint).toBe("https://api.siliconflow.com/v1/chat/completions");
        expect(row.provider).toBe("siliconflow");
        expect(row.model).toBe("MiniMaxAI/MiniMax-M3");
        expect(row.inputPrompt).toBe("Why is the title red?");
        expect(row.renderedSystemPrompt).toContain("didactic code explainer");
        expect(row.renderedUserPrompt).toContain("Why is the title red?");
        expect(row.contextMeta).toEqual({ usedMoodboard: false, usedUserProfile: false });
    });

    it("stores the reply exactly as streamed from the model, not a re-rendered version", async () => {
        const journal = new RecordingJournal();
        const useCase = new AskDidacticQuestion(noopQnaRepo, journal);

        await useCase.streamTokens({
            projectId: "p1", userId: "u1", snapshotId: "snap-1", snapshot,
            question: "Why is the title red?", uiLanguage: "en", llmContext,
        }, () => {});

        expect(journal.completions).toHaveLength(1);
        const completion = journal.completions[0]!.completion;
        expect(completion.status).toBe("succeeded");
        // The persisted Q&A entry is what we later render; the raw reply is what the model
        // actually said — this is the only field that captures the latter.
        expect(completion.rawResponse).toBe(ASK_ANSWER);
        expect(completion.finishReason).toBe("stop");
        if (completion.status === "succeeded") {
            expect(completion.usage).toEqual({ promptTokens: 40, completionTokens: 20, totalTokens: 60 });
        }
    });

    it("marks the row failed when the provider refuses, instead of leaving it pending forever", async () => {
        const journal = new RecordingJournal();
        vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 429 })));
        const useCase = new AskDidacticQuestion(noopQnaRepo, journal);

        await expect(useCase.streamTokens({
            projectId: "p1", userId: "u1", snapshotId: "snap-1", snapshot,
            question: "Why is the title red?", uiLanguage: "en", llmContext,
        }, () => {})).rejects.toThrow();

        expect(journal.completions).toHaveLength(1);
        expect(journal.completions[0]!.completion.status).toBe("failed");
    });

    it("still answers when the journal itself is broken — tracing must not break generation", async () => {
        const brokenJournal = new RecordingJournal();
        brokenJournal.createPending = async () => { throw new Error("mongo down"); };
        const useCase = new AskDidacticQuestion(noopQnaRepo, brokenJournal);

        const result = await useCase.streamTokens({
            projectId: "p1", userId: "u1", snapshotId: "snap-1", snapshot,
            question: "Why is the title red?", uiLanguage: "en", llmContext,
        }, () => {});

        expect(result.fullAnswer).toBe(ASK_ANSWER);
        expect(brokenJournal.completions).toHaveLength(0);
    });
});

const KNOWLEDGE_REPLY = JSON.stringify({
    overview: "This page shows a hello world heading styled in red.",
    topics: [
        {
            id: "t1",
            category: "html_structure",
            difficulty: "base",
            title: "Root wrapper",
            summary: "The root div wraps the heading.",
            anchors: [],
        },
    ],
    quizzes: [
        {
            id: "q1",
            difficulty: "base",
            question: "What color is the title?",
            options: ["red", "blue", "green", "yellow"],
            correctIndex: 0,
            explanation: "The CSS rule sets h1 to red.",
            anchors: [],
        },
    ],
});

function knowledgeResponseBody(): string {
    return JSON.stringify({
        choices: [{ message: { content: KNOWLEDGE_REPLY }, finish_reason: "stop" }],
        usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
    });
}

describe("Zero Effort journalling — GenerateDidacticKnowledge", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(knowledgeResponseBody(), { status: 200 })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it("writes the pending row BEFORE dispatching, so a call that never returns is still recorded", async () => {
        const journal = new RecordingJournal();
        const order: string[] = [];
        const originalCreate = journal.createPending.bind(journal);
        journal.createPending = async (input) => { order.push("journal"); return originalCreate(input); };
        vi.stubGlobal("fetch", vi.fn(async () => {
            order.push("provider");
            return new Response(knowledgeResponseBody(), { status: 200 });
        }));

        const useCase = new GenerateDidacticKnowledge(noopKnowledgeRepo, journal);
        await useCase.execute({
            projectId: "p1",
            snapshotId: "snap-1",
            userId: "u1",
            snapshot,
            uiLanguage: "en",
            llmContext,
        });

        expect(order).toEqual(["journal", "provider"]);
    });

    it("records both prompts, the endpoint, and the correlation ids", async () => {
        const journal = new RecordingJournal();
        const useCase = new GenerateDidacticKnowledge(noopKnowledgeRepo, journal);

        await useCase.execute({
            projectId: "p1",
            snapshotId: "snap-1",
            userId: "u1",
            snapshot,
            uiLanguage: "en",
            llmContext,
            workSessionId: "ws-2",
            pipelineRunId: "run-2",
        });

        expect(journal.pending).toHaveLength(1);
        const row = journal.pending[0]!;
        expect(row.pipelineStage).toBe("didactic_knowledge");
        expect(row.workSessionId).toBe("ws-2");
        expect(row.pipelineRunId).toBe("run-2");
        expect(row.endpoint).toBe("https://api.siliconflow.com/v1/chat/completions");
        expect(row.provider).toBe("siliconflow");
        expect(row.model).toBe("MiniMaxAI/MiniMax-M3");
        expect(row.renderedSystemPrompt).toContain("didactic code explainer");
        expect(row.renderedUserPrompt).toContain("[INSTRUMENTED HTML]");
        expect(row.contextMeta).toEqual({ usedMoodboard: false, usedUserProfile: false });
    });

    it("stores the reply exactly as the model sent it, before parseDidacticJson touches it", async () => {
        const journal = new RecordingJournal();
        const useCase = new GenerateDidacticKnowledge(noopKnowledgeRepo, journal);

        await useCase.execute({
            projectId: "p1", snapshotId: "snap-1", userId: "u1", snapshot, uiLanguage: "en", llmContext,
        });

        expect(journal.completions).toHaveLength(1);
        const completion = journal.completions[0]!.completion;
        expect(completion.status).toBe("succeeded");
        // The knowledge document is the *parsed and cleaned* result; only rawResponse says what
        // the model actually returned, verbatim.
        expect(completion.rawResponse).toBe(KNOWLEDGE_REPLY);
        expect(completion.finishReason).toBe("stop");
        if (completion.status === "succeeded") {
            expect(completion.usage).toEqual({ promptTokens: 200, completionTokens: 80, totalTokens: 280 });
        }
    });

    it("marks the row failed when the provider refuses, instead of leaving it pending forever", async () => {
        const journal = new RecordingJournal();
        vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 429 })));
        const useCase = new GenerateDidacticKnowledge(noopKnowledgeRepo, journal);

        await expect(useCase.execute({
            projectId: "p1", snapshotId: "snap-1", userId: "u1", snapshot, uiLanguage: "en", llmContext,
        })).rejects.toThrow();

        expect(journal.completions).toHaveLength(1);
        expect(journal.completions[0]!.completion.status).toBe("failed");
    });

    it("still generates knowledge when the journal itself is broken — tracing must not break generation", async () => {
        const brokenJournal = new RecordingJournal();
        brokenJournal.createPending = async () => { throw new Error("mongo down"); };
        const useCase = new GenerateDidacticKnowledge(noopKnowledgeRepo, brokenJournal);

        const result = await useCase.execute({
            projectId: "p1", snapshotId: "snap-1", userId: "u1", snapshot, uiLanguage: "en", llmContext,
        });

        expect(result.knowledge.overview).toBe("This page shows a hello world heading styled in red.");
        expect(brokenJournal.completions).toHaveLength(0);
    });
});
