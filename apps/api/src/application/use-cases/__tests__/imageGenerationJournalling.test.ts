/**
 * The image-generation slice must leave a readable trace too
 * (docs/specs/SESSION_TRACING_EXECUTION_PLAN.md WP4b, docs/specs/WORK_SESSION_TRACING_SPEC.md §2).
 *
 * Before this, `GenerateProjectImage` recorded no journal row at all for its SiliconFlow calls: an
 * image that cost money and took 30 seconds left no record of what prompt produced it. These tests
 * assert the journal row exists, is written before the provider call is dispatched, carries the
 * prompt/endpoint/correlation ids, is completed on both success and failure, and — because this is
 * an image call, not a chat call — never carries the base64 image payload into the journal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Same shape the sibling vibeJournalling suite uses: the real config module exits the process when
// MONGODB_URI and the JWT secrets are absent, which a unit test has no business providing.
vi.mock("../../../config", () => ({
    env: {
        hasSiliconFlowApiKey: true,
        SILICONFLOW_API_KEY: "test-key",
        SILICONFLOW_BASE_URL: "https://api.siliconflow.test/v1",
        SILICONFLOW_IMAGE_MODEL: "black-forest-labs/FLUX.1-schnell",
        SILICONFLOW_IMAGE_SIZE: "1024x1024",
        SILICONFLOW_IMAGE_STEPS: 4,
        COST_POLICY_TEXT_EUR_PER_1K_TOKENS: 0.002,
        COST_POLICY_IMAGE_EUR_PER_ASSET: 0.02,
        COST_POLICY_VIDEO_EUR_PER_ASSET: 0.2,
        COST_POLICY_USD_TO_EUR_RATE: 0.92,
        COST_POLICY_PROVIDER_MARKUP_FACTOR: 1.2,
    },
}));

import { GenerateProjectImage } from "../GenerateProjectImage";
import type { ProjectAssetRepository } from "../../../domain/repositories/ProjectAssetRepository";
import type { ProjectAsset } from "../../../domain/entities/ProjectAsset";
import type { IFileStorage } from "../../../infra/storage/IFileStorage";
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
    async listByWorkSession(): Promise<PromptExecutionLog[]> { return []; }
    async deleteByProject(): Promise<number> { return 0; }
}

/** Minimal in-memory stand-in for ProjectAssetRepository — only what GenerateProjectImage calls. */
class FakeAssetRepository {
    private byId = new Map<string, ProjectAsset>();
    private seq = 0;

    async create(input: Parameters<ProjectAssetRepository["create"]>[0]): Promise<ProjectAsset> {
        const asset: ProjectAsset = {
            id: `asset-${++this.seq}`,
            projectId: input.projectId,
            userId: input.userId,
            scope: input.scope ?? "project",
            originalName: input.originalName,
            storedFilename: input.storedFilename,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            source: input.source,
            label: input.label,
            useInProject: input.useInProject,
            styleRole: input.styleRole,
            descriptionText: input.descriptionText,
            generationStatus: input.generationStatus,
            generationPrompt: input.generationPrompt,
            generationMetadata: input.generationMetadata,
            semanticMetadata: input.semanticMetadata,
            createdAt: new Date(),
        };
        this.byId.set(asset.id, asset);
        return asset;
    }

    async update(id: string, _projectId: string, _userId: string, data: Partial<ProjectAsset>): Promise<ProjectAsset | null> {
        const existing = this.byId.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...data };
        this.byId.set(id, updated);
        return updated;
    }

    get(id: string): ProjectAsset | undefined {
        return this.byId.get(id);
    }
}

class FakeStorage {
    async saveUpload(): Promise<string> { return "stored"; }
    async deleteUpload(): Promise<void> { }
    uploadFilePath(): string { return "/fake/storage/path"; }
}

function createUseCase(journal?: PromptExecutionLogRepository) {
    const assetRepository = new FakeAssetRepository();
    const storage = new FakeStorage();
    const useCase = new GenerateProjectImage(
        assetRepository as unknown as ProjectAssetRepository,
        storage as unknown as IFileStorage,
        undefined,
        undefined,
        undefined,
        undefined,
        journal,
    );
    return { useCase, assetRepository };
}

/** Polls the fake repository until the background `setTimeout` job has moved the asset out of "queued". */
async function waitForSettledAsset(assetRepository: FakeAssetRepository, assetId: string, timeoutMs = 2000): Promise<ProjectAsset> {
    const start = Date.now();
    for (;;) {
        const asset = assetRepository.get(assetId);
        if (asset && asset.generationStatus !== "queued") return asset;
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for asset ${assetId} to settle`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

const B64_PAYLOAD = "ZmFrZS1pbWFnZS1ieXRlcy10aGF0LW11c3QtbmV2ZXItcmVhY2gtdGhlLWpvdXJuYWw=";

function successResponseBody() {
    return {
        created: 1710000000,
        data: [{ b64_json: B64_PAYLOAD, width: 1024, height: 1024, revised_prompt: "a revised prompt" }],
        usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12 },
    };
}

describe("Zero Effort journalling — GenerateProjectImage (image_generation)", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(successResponseBody()), { status: 200 })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it("writes the pending row BEFORE dispatching the provider fetch", async () => {
        const journal = new RecordingJournal();
        const order: string[] = [];
        const originalCreate = journal.createPending.bind(journal);
        journal.createPending = async (input) => { order.push("journal"); return originalCreate(input); };
        vi.stubGlobal("fetch", vi.fn(async () => {
            order.push("provider");
            return new Response(JSON.stringify(successResponseBody()), { status: 200 });
        }));

        const { useCase, assetRepository } = createUseCase(journal);
        const result = await useCase.execute({
            projectId: "p1",
            userId: "u1",
            prompt: "a cabin in the woods",
            targetMode: "background",
        });

        await waitForSettledAsset(assetRepository, result.asset.id);

        expect(order).toEqual(["journal", "provider"]);
    });

    it("records the endpoint, the actual image prompt, the stage, and the correlation ids", async () => {
        const journal = new RecordingJournal();
        const { useCase, assetRepository } = createUseCase(journal);

        const result = await useCase.execute({
            projectId: "p1",
            userId: "u1",
            prompt: "a cabin in the woods at dusk",
            targetMode: "background",
            workSessionId: "ws-1",
            pipelineRunId: "run-1",
        });

        await waitForSettledAsset(assetRepository, result.asset.id);

        expect(journal.pending).toHaveLength(1);
        const row = journal.pending[0]!;
        expect(row.pipelineStage).toBe("image_generation");
        expect(row.workSessionId).toBe("ws-1");
        expect(row.pipelineRunId).toBe("run-1");
        // The endpoint is the real image-generation route, not the chat-completions one.
        expect(row.endpoint).toBe("https://api.siliconflow.test/v1/images/generations");
        expect(row.provider).toBe("siliconflow");
        // No finish_reason / chat framing is invented — the image prompt actually sent is what's recorded.
        expect(row.inputPrompt).toContain("a cabin in the woods at dusk");
        expect(row.renderedUserPrompt).toContain("a cabin in the woods at dusk");
    });

    it("completes the row as succeeded with cost, and never carries the base64 bytes into rawResponse", async () => {
        const journal = new RecordingJournal();
        const { useCase, assetRepository } = createUseCase(journal);

        const result = await useCase.execute({
            projectId: "p1",
            userId: "u1",
            prompt: "a cabin in the woods",
            targetMode: "background",
        });

        await waitForSettledAsset(assetRepository, result.asset.id);

        expect(journal.completions).toHaveLength(1);
        const completion = journal.completions[0]!.completion;
        expect(completion.status).toBe("succeeded");
        if (completion.status !== "succeeded") throw new Error("unreachable");
        expect(completion.costEstimate?.amount).toBeGreaterThanOrEqual(0);
        expect(completion.durationMs).toBeGreaterThanOrEqual(0);
        // This is a prompt journal, not a second copy of the asset — the asset already has its own
        // storage. The base64 payload must never appear in the journal row.
        expect(completion.rawResponse).toBeDefined();
        expect(completion.rawResponse).not.toContain(B64_PAYLOAD);
        expect(completion.rawResponse).toContain("omitted");
    });

    it("marks the row failed when the provider refuses, instead of leaving it pending forever", async () => {
        const journal = new RecordingJournal();
        vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
        const { useCase, assetRepository } = createUseCase(journal);

        const result = await useCase.execute({
            projectId: "p1",
            userId: "u1",
            prompt: "a cabin in the woods",
            targetMode: "background",
        });

        await waitForSettledAsset(assetRepository, result.asset.id);

        expect(journal.completions).toHaveLength(1);
        const completion = journal.completions[0]!.completion;
        expect(completion.status).toBe("failed");
        if (completion.status !== "failed") throw new Error("unreachable");
        expect(completion.errorMessage).toBeTruthy();

        const asset = assetRepository.get(result.asset.id)!;
        expect(asset.generationStatus).toBe("failed");
    });

    it("still generates the image when the journal itself is broken — tracing must not break generation", async () => {
        const brokenJournal = new RecordingJournal();
        brokenJournal.createPending = async () => { throw new Error("mongo down"); };
        const { useCase, assetRepository } = createUseCase(brokenJournal);

        const result = await useCase.execute({
            projectId: "p1",
            userId: "u1",
            prompt: "a cabin in the woods",
            targetMode: "background",
        });

        const asset = await waitForSettledAsset(assetRepository, result.asset.id);

        expect(asset.generationStatus).toBe("ready");
        expect(brokenJournal.completions).toHaveLength(0);
    });

    it("still generates the image when no repository is wired at all", async () => {
        const { useCase, assetRepository } = createUseCase(undefined);

        const result = await useCase.execute({
            projectId: "p1",
            userId: "u1",
            prompt: "a cabin in the woods",
            targetMode: "background",
        });

        const asset = await waitForSettledAsset(assetRepository, result.asset.id);

        expect(asset.generationStatus).toBe("ready");
    });
});
