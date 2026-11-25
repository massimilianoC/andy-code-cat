import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";

// config.ts validates process.env on import: set the minimum before any module loads.
vi.hoisted(() => {
    process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
    process.env.JWT_ACCESS_SECRET ??= "test-access-secret-min-32-chars-!!xyz";
    process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-min-32-chars-!!xyz";
});

vi.mock("../../cost/CostTransactionService", () => ({
    CostTransactionService: { instance: { record: vi.fn(async () => undefined) } },
}));

import { OptimizeImagePrompt } from "../OptimizeImagePrompt";

/**
 * The image-prompt optimizer resolves its model through the shared composer cascade
 * (SSOT_STATUS.md §3): a model the operator switched off in the catalog is never
 * dispatched, whoever asked for it, and no hardcoded model id is ever sent.
 */

function model(overrides: Partial<LlmProviderCatalog["models"][number]> & { id: string }) {
    return {
        provider: "local",
        role: "dialogue",
        capabilities: ["chat"],
        isDefault: false,
        isFallback: false,
        isActive: true,
        ...overrides,
    } satisfies LlmProviderCatalog["models"][number];
}

function catalog(models: LlmProviderCatalog["models"]): LlmProviderCatalog[] {
    return [{
        provider: "local",
        baseUrl: "https://llm.test/v1",
        apiType: "openai-compatible",
        authType: "none",
        isActive: true,
        models,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }];
}

const packet = {
    projectName: "Demo",
    projectType: "landing",
    targetMode: "foreground" as const,
    sectionRole: "hero",
    paletteHints: [],
    styleHints: [],
    brandContextHints: [],
    compositionHints: [],
    assetHints: [],
    selectedAssetIds: [],
    contextSummary: "",
};

function build(providers: LlmProviderCatalog[]) {
    const platformConfigRepository = { get: vi.fn(async () => null) };
    const promptExecutionLogRepository = { create: vi.fn(async () => ({})) };
    const getLlmCatalog = { execute: vi.fn(async () => ({ providers })) };
    return new OptimizeImagePrompt(
        platformConfigRepository as never,
        promptExecutionLogRepository as never,
        getLlmCatalog as never,
    );
}

let dispatched: string[] = [];

beforeEach(() => {
    dispatched = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
        dispatched.push(JSON.parse(init.body).model);
        return new Response(JSON.stringify({ choices: [{ message: { content: "a refined prompt" } }] }), { status: 200 });
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const run = (useCase: OptimizeImagePrompt, extra: { provider?: string; model?: string } = {}) => useCase.execute({
    projectId: "p1",
    userId: "u1",
    productKey: "default",
    rawPrompt: "a cat on a roof",
    packet,
    usedMoodboard: false,
    usedUserProfile: false,
    ...extra,
});

describe("OptimizeImagePrompt model selection", () => {
    it("never dispatches a requested model the operator switched off", async () => {
        const useCase = build(catalog([
            model({ id: "vendor/switched-off", isActive: false }),
            model({ id: "vendor/dialogue-default", isDefault: true }),
        ]));

        const result = await run(useCase, { provider: "local", model: "vendor/switched-off" });

        expect(dispatched).toEqual(["vendor/dialogue-default"]);
        expect(result.model).toBe("vendor/dialogue-default");
    });

    it("honours a requested model that is active", async () => {
        const useCase = build(catalog([
            model({ id: "vendor/dialogue-default", isDefault: true }),
            model({ id: "vendor/requested" }),
        ]));

        await run(useCase, { provider: "local", model: "vendor/requested" });

        expect(dispatched).toEqual(["vendor/requested"]);
    });

    it("does not fall back to a hardcoded model id absent from the catalog", async () => {
        // No explicit model: the task default (MiniMax-M3 on siliconflow) is not in this catalog.
        const useCase = build(catalog([model({ id: "vendor/only-active", isDefault: true })]));

        await run(useCase);

        expect(dispatched).toEqual(["vendor/only-active"]);
    });
});
