/**
 * The Zero Effort chain must leave a readable trace
 * (docs/specs/WORK_SESSION_TRACING_SPEC.md §2, §6).
 *
 * Before this, `VibeClassify` and `VibePrefill` recorded a cost transaction and nothing else: we
 * knew what the classifier and the brief had cost, and neither what we had asked them nor what they
 * had answered. The prefill is the call that decides the whole downstream generation, so its
 * invisibility was the largest hole in the journal.
 *
 * These tests assert the journal rows exist and carry the fields that make a run reconstructible —
 * the prompts, the raw reply, the correlation ids, and the endpoint actually called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Same shape the sibling VibeClassify suite uses: the real config module exits the process when
// MONGODB_URI and the JWT secrets are absent, which a unit test has no business providing.
vi.mock("../../../config", () => ({
    env: {
        vibeClassifierEnabled: true,
        providerApiKeys: {},
        COST_POLICY_TEXT_EUR_PER_1K_TOKENS: 0.002,
        COST_POLICY_IMAGE_EUR_PER_ASSET: 0.02,
        COST_POLICY_VIDEO_EUR_PER_ASSET: 0.2,
        COST_POLICY_USD_TO_EUR_RATE: 0.92,
        COST_POLICY_PROVIDER_MARKUP_FACTOR: 1.2,
    },
}));

import { VibeClassify } from "../VibeClassify";
import type { PromptExecutionLogRepository } from "../../../domain/repositories/PromptExecutionLogRepository";
import type { PromptExecutionLog, PromptExecutionCompletion, NewPendingPromptExecution } from "../../../domain/entities/PromptExecutionLog";

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
}

const CLASSIFIER_REPLY = '{"templateId":"slideshow","formatHint":null,"confidence":0.9,"reasoning":"dice deck"}';

const platformConfigRepository = {
    get: async () => null,
} as never;

const getLlmCatalog = {
    execute: async () => ({
        providers: [{
            provider: "siliconflow",
            isActive: true,
            authType: "none" as const,
            baseUrl: "https://api.siliconflow.com/v1",
            models: [{ id: "MiniMaxAI/MiniMax-M3", isActive: true, capabilities: ["chat"] }],
        }],
    }),
} as never;

describe("Zero Effort journalling — VibeClassify", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            choices: [{ message: { content: CLASSIFIER_REPLY }, finish_reason: "stop" }],
            usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
        }), { status: 200 })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it("writes the pending row BEFORE dispatching, so a call that never returns is still recorded", async () => {
        const journal = new RecordingJournal();
        const order: string[] = [];
        const originalCreate = journal.createPending.bind(journal);
        journal.createPending = async (input) => { order.push("journal"); return originalCreate(input); };
        vi.stubGlobal("fetch", vi.fn(async () => {
            order.push("provider");
            return new Response(JSON.stringify({
                choices: [{ message: { content: CLASSIFIER_REPLY }, finish_reason: "stop" }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }), { status: 200 });
        }));

        await new VibeClassify(platformConfigRepository, getLlmCatalog, journal).execute({
            prompt: "un deck da 10 sezioni",
            userId: "u1",
            projectId: "p1",
        });

        expect(order).toEqual(["journal", "provider"]);
    });

    it("records both prompts, the endpoint, and the correlation ids", async () => {
        const journal = new RecordingJournal();

        await new VibeClassify(platformConfigRepository, getLlmCatalog, journal).execute({
            prompt: "un deck da 10 sezioni per una famiglia",
            userId: "u1",
            projectId: "p1",
            workSessionId: "ws-1",
            pipelineRunId: "run-1",
        });

        expect(journal.pending).toHaveLength(1);
        const row = journal.pending[0]!;
        expect(row.pipelineStage).toBe("vibe_classify");
        expect(row.workSessionId).toBe("ws-1");
        expect(row.pipelineRunId).toBe("run-1");
        // Only the endpoint proves where the request went; the model id proves what we intended.
        expect(row.endpoint).toBe("https://api.siliconflow.com/v1/chat/completions");
        expect(row.renderedSystemPrompt).toContain("classifier");
        expect(row.renderedUserPrompt).toContain("un deck da 10 sezioni");
    });

    it("stores the reply exactly as the model sent it, not the parsed conclusion", async () => {
        const journal = new RecordingJournal();

        await new VibeClassify(platformConfigRepository, getLlmCatalog, journal).execute({
            prompt: "un deck", userId: "u1", projectId: "p1",
        });

        expect(journal.completions).toHaveLength(1);
        const completion = journal.completions[0]!.completion;
        expect(completion.status).toBe("succeeded");
        // The parsed result says what we concluded; the raw text says what the model said —
        // including the cases where it said something we could not read.
        expect(completion.rawResponse).toBe(CLASSIFIER_REPLY);
        expect(completion.finishReason).toBe("stop");
    });

    it("marks the row failed when the provider refuses, instead of leaving it pending forever", async () => {
        const journal = new RecordingJournal();
        vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 429 })));

        await new VibeClassify(platformConfigRepository, getLlmCatalog, journal).execute({
            prompt: "un deck", userId: "u1", projectId: "p1",
        });

        expect(journal.completions[0]!.completion.status).toBe("failed");
    });

    it("still classifies when the journal itself is broken — tracing must not break generation", async () => {
        const brokenJournal = new RecordingJournal();
        brokenJournal.createPending = async () => { throw new Error("mongo down"); };

        const result = await new VibeClassify(platformConfigRepository, getLlmCatalog, brokenJournal).execute({
            prompt: "un deck da 10 sezioni", userId: "u1", projectId: "p1",
        });

        expect(result.skipped).toBe(false);
        expect(result.templateId).toBe("slideshow");
    });
});
