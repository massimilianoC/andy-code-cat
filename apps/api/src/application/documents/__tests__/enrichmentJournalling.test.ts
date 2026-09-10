/**
 * The Zero Effort chain must leave a readable trace
 * (docs/specs/WORK_SESSION_TRACING_SPEC.md §2, §6).
 *
 * Before this, `ImageAnalyzer` and `DocumentBriefExtractor` recorded NOTHING of their own: no
 * journal row for the vision call, and the document-brief / dataset-appendix calls were only
 * journalled AFTER the provider round-trip finished — a shape that cannot explain a call that
 * never came back. These tests assert both LLM calls now write a pending row BEFORE dispatch and
 * complete it with the per-call detail (endpoint, raw reply, finish reason, correlation ids) —
 * and that a broken journal never blocks the enrichment itself.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import { analyzeImage } from "../image/ImageAnalyzer";
import { extractDocumentBrief, extractDatasetAppendix } from "../enrichment/DocumentBriefExtractor";
import type { PromptExecutionLogRepository } from "../../../domain/repositories/PromptExecutionLogRepository";
import type { PromptExecutionLog, PromptExecutionCompletion, NewPendingPromptExecution } from "../../../domain/entities/PromptExecutionLog";
import type { DatasetStructuredData } from "../../../domain/entities/AssetEnrichmentTrace";

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

afterEach(() => vi.unstubAllGlobals());

describe("Zero Effort journalling — ImageAnalyzer", () => {
    const VISION_REPLY = JSON.stringify({
        sceneDescription: "a red mug on a wooden table",
        detectedObjects: ["mug"],
        dominantHex: ["#ff0000"],
        dominantNames: ["red"],
        backgroundTone: "light",
        imageCategory: "photograph",
    });

    function stubFetch() {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            choices: [{ message: { content: VISION_REPLY }, finish_reason: "stop" }],
            usage: { prompt_tokens: 500, completion_tokens: 120, total_tokens: 620 },
        }), { status: 200 })));
    }

    it("writes the pending row BEFORE dispatching, so a call that never returns is still recorded", async () => {
        const journal = new RecordingJournal();
        const order: string[] = [];
        const originalCreate = journal.createPending.bind(journal);
        journal.createPending = async (input) => { order.push("journal"); return originalCreate(input); };
        vi.stubGlobal("fetch", vi.fn(async () => {
            order.push("provider");
            return new Response(JSON.stringify({
                choices: [{ message: { content: VISION_REPLY }, finish_reason: "stop" }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }), { status: 200 });
        }));

        await analyzeImage({
            buffer: Buffer.from("fake-image-bytes"),
            mimeType: "image/png",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "vision-model",
            authHeader: undefined,
            provider: "siliconflow",
            promptExecutionLogRepository: journal,
            projectId: "p1",
            userId: "u1",
        });

        expect(order).toEqual(["journal", "provider"]);
    });

    it("records the endpoint, pipeline stage, and correlation ids", async () => {
        stubFetch();
        const journal = new RecordingJournal();

        await analyzeImage({
            buffer: Buffer.from("fake-image-bytes"),
            mimeType: "image/png",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "vision-model",
            authHeader: undefined,
            provider: "siliconflow",
            promptExecutionLogRepository: journal,
            projectId: "p1",
            userId: "u1",
            workSessionId: "ws-1",
            pipelineRunId: "run-1",
            assetId: "asset-1",
        });

        expect(journal.pending).toHaveLength(1);
        const row = journal.pending[0]!;
        expect(row.taskKey).toBe("enrich_image");
        expect(row.pipelineStage).toBe("image_analysis");
        expect(row.workSessionId).toBe("ws-1");
        expect(row.pipelineRunId).toBe("run-1");
        expect(row.endpoint).toBe("https://api.siliconflow.com/v1/chat/completions");
        expect(row.provider).toBe("siliconflow");
        expect(row.contextMeta.assetIds).toEqual(["asset-1"]);
        expect(row.renderedUserPrompt).toContain("asset classification specialist");
    });

    it("stores the reply exactly as the model sent it, not the parsed conclusion", async () => {
        stubFetch();
        const journal = new RecordingJournal();

        await analyzeImage({
            buffer: Buffer.from("fake-image-bytes"),
            mimeType: "image/png",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "vision-model",
            authHeader: undefined,
            provider: "siliconflow",
            promptExecutionLogRepository: journal,
            projectId: "p1",
            userId: "u1",
        });

        expect(journal.completions).toHaveLength(1);
        const completion = journal.completions[0]!.completion;
        expect(completion.status).toBe("succeeded");
        expect(completion.rawResponse).toBe(VISION_REPLY);
        expect(completion.finishReason).toBe("stop");
    });

    it("marks the row failed when the provider refuses, instead of leaving it pending forever", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
        const journal = new RecordingJournal();

        await expect(analyzeImage({
            buffer: Buffer.from("fake-image-bytes"),
            mimeType: "image/png",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "vision-model",
            authHeader: undefined,
            provider: "siliconflow",
            promptExecutionLogRepository: journal,
            projectId: "p1",
            userId: "u1",
        })).rejects.toThrow();

        expect(journal.completions).toHaveLength(1);
        expect(journal.completions[0]!.completion.status).toBe("failed");
    });

    it("still analyzes when the journal itself is broken — tracing must not break enrichment", async () => {
        stubFetch();
        const brokenJournal = new RecordingJournal();
        brokenJournal.createPending = async () => { throw new Error("mongo down"); };
        brokenJournal.complete = async () => { throw new Error("mongo down"); };

        const result = await analyzeImage({
            buffer: Buffer.from("fake-image-bytes"),
            mimeType: "image/png",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "vision-model",
            authHeader: undefined,
            provider: "siliconflow",
            promptExecutionLogRepository: brokenJournal,
            projectId: "p1",
            userId: "u1",
        });

        expect(result.visualAnalysis.sceneDescription).toContain("red mug");
    });

    it("still analyzes when no journal is wired at all", async () => {
        stubFetch();
        const result = await analyzeImage({
            buffer: Buffer.from("fake-image-bytes"),
            mimeType: "image/png",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "vision-model",
            authHeader: undefined,
            provider: "siliconflow",
        });

        expect(result.visualAnalysis.sceneDescription).toContain("red mug");
    });
});

describe("Zero Effort journalling — DocumentBriefExtractor.extractDocumentBrief", () => {
    const BRIEF_REPLY = JSON.stringify({
        documentType: "brochure",
        purposeSentence: "a test brochure",
        contentSummary: "summary text",
    });

    function stubFetch() {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            choices: [{ message: { content: BRIEF_REPLY }, finish_reason: "stop" }],
            usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 },
        }), { status: 200 })));
    }

    it("writes the pending row BEFORE dispatching", async () => {
        const journal = new RecordingJournal();
        const order: string[] = [];
        const originalCreate = journal.createPending.bind(journal);
        journal.createPending = async (input) => { order.push("journal"); return originalCreate(input); };
        vi.stubGlobal("fetch", vi.fn(async () => {
            order.push("provider");
            return new Response(JSON.stringify({
                choices: [{ message: { content: BRIEF_REPLY }, finish_reason: "stop" }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }), { status: 200 });
        }));

        await extractDocumentBrief({
            textSnippet: "This is a test document with enough text to pass the length gate for analysis.",
            assetKind: "pdf",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "text-model",
            authHeader: undefined,
            journal: {
                promptExecutionLogRepository: journal,
                provider: "siliconflow",
                projectId: "p1",
                userId: "u1",
            },
        });

        expect(order).toEqual(["journal", "provider"]);
    });

    it("records the endpoint, pipeline stage, and correlation ids", async () => {
        stubFetch();
        const journal = new RecordingJournal();

        await extractDocumentBrief({
            textSnippet: "This is a test document with enough text to pass the length gate for analysis.",
            assetKind: "pdf",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "text-model",
            authHeader: undefined,
            journal: {
                promptExecutionLogRepository: journal,
                provider: "siliconflow",
                projectId: "p1",
                userId: "u1",
                workSessionId: "ws-2",
                pipelineRunId: "run-2",
                assetId: "asset-2",
            },
        });

        expect(journal.pending).toHaveLength(1);
        const row = journal.pending[0]!;
        expect(row.taskKey).toBe("enrich_document");
        expect(row.pipelineStage).toBe("document_brief");
        expect(row.workSessionId).toBe("ws-2");
        expect(row.pipelineRunId).toBe("run-2");
        expect(row.endpoint).toBe("https://api.siliconflow.com/v1/chat/completions");
        expect(row.provider).toBe("siliconflow");
        expect(row.contextMeta.assetIds).toEqual(["asset-2"]);
        expect(row.renderedUserPrompt).toContain("test document with enough text");
    });

    it("stores the reply exactly as the model sent it, not the parsed conclusion", async () => {
        stubFetch();
        const journal = new RecordingJournal();

        await extractDocumentBrief({
            textSnippet: "This is a test document with enough text to pass the length gate for analysis.",
            assetKind: "pdf",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "text-model",
            authHeader: undefined,
            journal: { promptExecutionLogRepository: journal, provider: "siliconflow", projectId: "p1", userId: "u1" },
        });

        expect(journal.completions).toHaveLength(1);
        const completion = journal.completions[0]!.completion;
        expect(completion.status).toBe("succeeded");
        expect(completion.rawResponse).toBe(BRIEF_REPLY);
        expect(completion.finishReason).toBe("stop");
    });

    it("marks the row failed when the provider refuses, instead of leaving it pending forever", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
        const journal = new RecordingJournal();

        await expect(extractDocumentBrief({
            textSnippet: "This is a test document with enough text to pass the length gate for analysis.",
            assetKind: "pdf",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "text-model",
            authHeader: undefined,
            journal: { promptExecutionLogRepository: journal, provider: "siliconflow", projectId: "p1", userId: "u1" },
        })).rejects.toThrow();

        expect(journal.completions).toHaveLength(1);
        expect(journal.completions[0]!.completion.status).toBe("failed");
    });

    it("still extracts the brief when the journal itself is broken — tracing must not break enrichment", async () => {
        stubFetch();
        const brokenJournal = new RecordingJournal();
        brokenJournal.createPending = async () => { throw new Error("mongo down"); };
        brokenJournal.complete = async () => { throw new Error("mongo down"); };

        const result = await extractDocumentBrief({
            textSnippet: "This is a test document with enough text to pass the length gate for analysis.",
            assetKind: "pdf",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "text-model",
            authHeader: undefined,
            journal: { promptExecutionLogRepository: brokenJournal, provider: "siliconflow", projectId: "p1", userId: "u1" },
        });

        expect(result.brief.purposeSentence).toBe("a test brochure");
    });

    it("still extracts the brief when no journal is wired at all", async () => {
        stubFetch();
        const result = await extractDocumentBrief({
            textSnippet: "This is a test document with enough text to pass the length gate for analysis.",
            assetKind: "pdf",
            baseUrl: "https://api.siliconflow.com/v1",
            model: "text-model",
            authHeader: undefined,
        });

        expect(result.brief.purposeSentence).toBe("a test brochure");
    });
});

describe("Zero Effort journalling — DocumentBriefExtractor.extractDatasetAppendix", () => {
    const APPENDIX_REPLY = JSON.stringify({
        analyticalSummary: "a dataset of orders",
        keySignals: ["signal one"],
    });

    const datasetStructuredData: DatasetStructuredData = {
        sourceFormat: "csv",
        tables: [],
        facts: {
            rowCount: 10,
            columnCount: 3,
            numericColumnCount: 1,
            categoricalColumnCount: 2,
            booleanColumnCount: 0,
            dateColumnCount: 0,
            supportedAggregations: ["count"],
        },
    };

    function stubFetch() {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            choices: [{ message: { content: APPENDIX_REPLY }, finish_reason: "stop" }],
            usage: { prompt_tokens: 200, completion_tokens: 60, total_tokens: 260 },
        }), { status: 200 })));
    }

    it("writes the pending row BEFORE dispatching and records taskKey/pipelineStage separately from the brief call", async () => {
        const journal = new RecordingJournal();
        const order: string[] = [];
        const originalCreate = journal.createPending.bind(journal);
        journal.createPending = async (input) => { order.push("journal"); return originalCreate(input); };
        vi.stubGlobal("fetch", vi.fn(async () => {
            order.push("provider");
            return new Response(JSON.stringify({
                choices: [{ message: { content: APPENDIX_REPLY }, finish_reason: "stop" }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }), { status: 200 });
        }));

        await extractDatasetAppendix({
            datasetStructuredData,
            baseUrl: "https://api.siliconflow.com/v1",
            model: "text-model",
            authHeader: undefined,
            journal: { promptExecutionLogRepository: journal, provider: "siliconflow", projectId: "p1", userId: "u1" },
        });

        expect(order).toEqual(["journal", "provider"]);
        expect(journal.pending[0]!.taskKey).toBe("enrich_dataset_appendix");
        expect(journal.pending[0]!.pipelineStage).toBe("document_brief");
    });

    it("stores the reply exactly as the model sent it and marks failures instead of leaving the row pending", async () => {
        stubFetch();
        const okJournal = new RecordingJournal();
        await extractDatasetAppendix({
            datasetStructuredData,
            baseUrl: "https://api.siliconflow.com/v1",
            model: "text-model",
            authHeader: undefined,
            journal: { promptExecutionLogRepository: okJournal, provider: "siliconflow", projectId: "p1", userId: "u1" },
        });
        expect(okJournal.completions[0]!.completion.status).toBe("succeeded");
        expect(okJournal.completions[0]!.completion.rawResponse).toBe(APPENDIX_REPLY);

        vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
        const failJournal = new RecordingJournal();
        await expect(extractDatasetAppendix({
            datasetStructuredData,
            baseUrl: "https://api.siliconflow.com/v1",
            model: "text-model",
            authHeader: undefined,
            journal: { promptExecutionLogRepository: failJournal, provider: "siliconflow", projectId: "p1", userId: "u1" },
        })).rejects.toThrow();
        expect(failJournal.completions[0]!.completion.status).toBe("failed");
    });

    it("still extracts the appendix when the journal itself is broken", async () => {
        stubFetch();
        const brokenJournal = new RecordingJournal();
        brokenJournal.createPending = async () => { throw new Error("mongo down"); };
        brokenJournal.complete = async () => { throw new Error("mongo down"); };

        const result = await extractDatasetAppendix({
            datasetStructuredData,
            baseUrl: "https://api.siliconflow.com/v1",
            model: "text-model",
            authHeader: undefined,
            journal: { promptExecutionLogRepository: brokenJournal, provider: "siliconflow", projectId: "p1", userId: "u1" },
        });

        expect(result.appendix.analyticalSummary).toBe("a dataset of orders");
    });
});
