import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        enrichmentInjectLayerD: false,
        enrichmentEnabled: false,
        ENRICHMENT_LAYER_D_MAX_CHARS: 6000,
        LLM_DEFAULT_PROVIDER: "siliconflow",
        LLM_DEFAULT_MAX_COMPLETION_TOKENS: 32000,
        pipelineRunEnabled: true,
    },
}));

import { env } from "../../../config";
import { ResolvePromptExecution } from "../ResolvePromptExecution";

const ACTIVE_CATALOG = {
    providers: [
        {
            provider: "siliconflow",
            baseUrl: "https://llm.test/v1",
            apiType: "openai-compatible",
            authType: "none",
            isActive: true,
            models: [{
                id: "MiniMaxAI/MiniMax-M2.5",
                role: "dialogue",
                capabilities: ["chat"],
                isDefault: true,
                isFallback: false,
                isActive: true,
            }],
        },
        {
            provider: "openrouter",
            baseUrl: "https://openrouter.test/v1",
            apiType: "openai-compatible",
            authType: "bearer",
            isActive: true,
            models: [{
                id: "moonshotai/Kimi-K3",
                role: "dialogue",
                capabilities: ["chat"],
                isDefault: false,
                isFallback: false,
                isActive: true,
            }],
        },
    ],
};

function createResolver(overrides?: {
    resolvePipelineModelLock?: { dispatch: ReturnType<typeof vi.fn> };
    catalog?: typeof ACTIVE_CATALOG;
}) {
    const projectRepository = {
        findByIdForUser: vi.fn(async () => ({
            id: "project-1",
            ownerUserId: "user-1",
            name: "Test Project",
            presetId: "landing",
            createdAt: new Date(),
            updatedAt: new Date(),
        })),
    };
    const moodboardRepository = { findByProjectId: vi.fn(async () => null) };
    const userStyleProfileRepository = { findByUserId: vi.fn(async () => null) };
    const assetRepository = { listByProject: vi.fn(async () => []) };
    const platformConfigRepo = { get: vi.fn(async () => null) };
    const presetRepository = { findById: vi.fn(async () => null) };
    const resolveBrandDocumentContext = { execute: vi.fn(async () => []) };
    const resolveBrandContext = { execute: vi.fn(async () => ({ entries: [], hasMustUse: false })) };
    const getLlmPromptConfig = { execute: vi.fn(async () => ({ id: "cfg-1", enabled: false, prePromptTemplate: undefined })) };
    const getLlmCatalog = { execute: vi.fn(async () => overrides?.catalog ?? ACTIVE_CATALOG) };
    const resolvePipelineModelLock = overrides?.resolvePipelineModelLock ?? {
        dispatch: vi.fn(async () => {
            throw new Error("resolvePipelineModelLock.dispatch should not be called on the legacy path");
        }),
    };
    const storage = {};

    const resolver = new ResolvePromptExecution(
        getLlmCatalog as any,
        getLlmPromptConfig as any,
        moodboardRepository as any,
        userStyleProfileRepository as any,
        projectRepository as any,
        platformConfigRepo as any,
        assetRepository as any,
        presetRepository as any,
        resolveBrandDocumentContext as any,
        resolveBrandContext as any,
        resolvePipelineModelLock as any,
        storage as any,
    );

    return { resolver, resolvePipelineModelLock };
}

describe("ResolvePromptExecution — I14 strict cutover wave 2 (pipelineRunId dispatch)", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        env.pipelineRunEnabled = true;
    });

    it("PIPELINE_RUN_ENABLED=false: falls back to the legacy cascade even when pipelineRunId is set (master rollback lever)", async () => {
        env.pipelineRunEnabled = false;
        const dispatch = vi.fn();
        const { resolver } = createResolver({ resolvePipelineModelLock: { dispatch } });

        const context = await resolver.execute({
            projectId: "project-1",
            userId: "user-1",
            pipelineRole: "dialogue",
            pipelineRunId: "run-1",
        });

        expect(dispatch).not.toHaveBeenCalled();
        expect(context.providerCatalog.provider).toBe("siliconflow");
        expect(context.modelId).toBe("MiniMaxAI/MiniMax-M2.5");
    });

    it("legacy path (no pipelineRunId): resolves via the cascade, never calls dispatch", async () => {
        const { resolver, resolvePipelineModelLock } = createResolver();

        const context = await resolver.execute({
            projectId: "project-1",
            userId: "user-1",
            pipelineRole: "dialogue",
        });

        expect(resolvePipelineModelLock.dispatch).not.toHaveBeenCalled();
        expect(context.providerCatalog.provider).toBe("siliconflow");
        expect(context.modelId).toBe("MiniMaxAI/MiniMax-M2.5");
    });

    it("strict dispatch: uses the PipelineRun's locked provider/model, stage 'generate' when not focused-edit", async () => {
        const dispatch = vi.fn(async () => ({
            run: {
                id: "run-1",
                modelLock: {
                    effective: { providerId: "openrouter", modelId: "moonshotai/Kimi-K3" },
                },
            },
            blocked: null,
            lockApplies: true,
        }));
        const { resolver } = createResolver({ resolvePipelineModelLock: { dispatch } });

        const context = await resolver.execute({
            projectId: "project-1",
            userId: "user-1",
            pipelineRole: "dialogue",
            pipelineRunId: "run-1",
        });

        expect(dispatch).toHaveBeenCalledWith({ runId: "run-1", ownerUserId: "user-1", projectId: "project-1", stage: "generate" });
        expect(context.providerCatalog.provider).toBe("openrouter");
        expect(context.modelId).toBe("moonshotai/Kimi-K3");
    });

    it("strict dispatch: uses stage 'focused_edit' when focusedMode is present", async () => {
        const dispatch = vi.fn(async () => ({
            run: {
                id: "run-1",
                modelLock: {
                    effective: { providerId: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5" },
                },
            },
            blocked: null,
            lockApplies: true,
        }));
        const { resolver } = createResolver({ resolvePipelineModelLock: { dispatch } });

        await resolver.execute({
            projectId: "project-1",
            userId: "user-1",
            pipelineRole: "dialogue",
            pipelineRunId: "run-1",
            focusedMode: {
                focusContext: { mode: "element" } as any,
            },
        });

        expect(dispatch).toHaveBeenCalledWith({ runId: "run-1", ownerUserId: "user-1", projectId: "project-1", stage: "focused_edit" });
    });

    it("strict dispatch: an explicit unvalidated model override is IGNORED (unlike the legacy openai-compatible trust path)", async () => {
        const dispatch = vi.fn(async () => ({
            run: {
                id: "run-1",
                modelLock: {
                    effective: { providerId: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5" },
                },
            },
            blocked: null,
            lockApplies: true,
        }));
        const { resolver } = createResolver({ resolvePipelineModelLock: { dispatch } });

        const context = await resolver.execute({
            projectId: "project-1",
            userId: "user-1",
            pipelineRole: "dialogue",
            pipelineRunId: "run-1",
            model: "some-unvalidated-model-not-in-catalog",
        });

        expect(context.modelId).toBe("MiniMaxAI/MiniMax-M2.5");
    });

    it("strict dispatch: throws a 409 and never resolves a context when the lock is blocked", async () => {
        const dispatch = vi.fn(async () => ({
            run: { id: "run-1" },
            blocked: { code: "MODEL_LOCK_UNAVAILABLE", stage: "generate", at: new Date() },
        }));
        const { resolver } = createResolver({ resolvePipelineModelLock: { dispatch } });

        await expect(resolver.execute({
            projectId: "project-1",
            userId: "user-1",
            pipelineRole: "dialogue",
            pipelineRunId: "run-1",
        })).rejects.toMatchObject({ statusCode: 409, code: "MODEL_LOCK_UNAVAILABLE" });
    });

    it("strict dispatch: throws a 409 when the locked provider is no longer in the active catalog", async () => {
        const dispatch = vi.fn(async () => ({
            run: {
                id: "run-1",
                modelLock: {
                    effective: { providerId: "removed-provider", modelId: "some/model" },
                },
            },
            blocked: null,
            lockApplies: true,
        }));
        const { resolver } = createResolver({ resolvePipelineModelLock: { dispatch } });

        await expect(resolver.execute({
            projectId: "project-1",
            userId: "user-1",
            pipelineRole: "dialogue",
            pipelineRunId: "run-1",
        })).rejects.toMatchObject({ statusCode: 409, code: "MODEL_LOCK_UNAVAILABLE" });
    });

    it("strict dispatch: throws a 409 when the locked model is no longer in the provider's active catalog", async () => {
        const dispatch = vi.fn(async () => ({
            run: {
                id: "run-1",
                modelLock: {
                    effective: { providerId: "siliconflow", modelId: "removed-model" },
                },
            },
            blocked: null,
            lockApplies: true,
        }));
        const { resolver } = createResolver({ resolvePipelineModelLock: { dispatch } });

        await expect(resolver.execute({
            projectId: "project-1",
            userId: "user-1",
            pipelineRole: "dialogue",
            pipelineRunId: "run-1",
        })).rejects.toMatchObject({ statusCode: 409, code: "MODEL_LOCK_UNAVAILABLE" });
    });
});
