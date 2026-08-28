import { describe, expect, it } from "vitest";

import { resolveModelSelection, type ResolveModelSelectionInput } from "../modelSelection";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";

/**
 * Characterization tests for resolveModelSelection.
 *
 * These pin TODAY's exact model-resolution outputs for the three real call sites
 * (VibeClassify.ts / VibePrefill.ts share the "vibe-cascade" profile; OptimizeUserPrompt.ts
 * uses "optimizer-cascade"). This is a safety net for later work — it must never be "fixed"
 * to change a row's expected output without an accompanying deliberate behavior-change PR.
 */

const FALLBACK_PROVIDER = "siliconflow";
const FALLBACK_MODEL = "MiniMaxAI/MiniMax-M3";

function siliconflow(models: LlmProviderCatalog["models"]): LlmProviderCatalog {
    return {
        provider: "siliconflow",
        baseUrl: "https://llm.test/siliconflow/v1",
        apiType: "openai-compatible",
        authType: "none",
        isActive: true,
        models,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

function openrouter(models: LlmProviderCatalog["models"]): LlmProviderCatalog {
    return {
        provider: "openrouter",
        baseUrl: "https://llm.test/openrouter/v1",
        apiType: "openai-compatible",
        authType: "bearer",
        isActive: true,
        models,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

function lmstudio(models: LlmProviderCatalog["models"]): LlmProviderCatalog {
    return {
        provider: "lmstudio",
        baseUrl: "https://llm.test/lmstudio/v1",
        apiType: "custom",
        authType: "none",
        isActive: true,
        models,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

function model(id: string, opts?: { isActive?: boolean; isDefault?: boolean; role?: string }): LlmProviderCatalog["models"][number] {
    return {
        id,
        provider: "siliconflow",
        role: (opts?.role ?? "dialogue") as any,
        capabilities: ["chat"],
        isDefault: opts?.isDefault ?? false,
        isFallback: false,
        isActive: opts?.isActive ?? true,
    };
}

const BASE_VIBE: Omit<ResolveModelSelectionInput, "activeProviders" | "requestedProvider" | "requestedModel" | "taskSettingProvider" | "taskSettingModel"> = {
    profile: "vibe-cascade",
    fallbackProvider: FALLBACK_PROVIDER,
    hardcodedFallbackModel: FALLBACK_MODEL,
    requireOverrideInCatalog: true,
    gateOverrideOnOpenAiCompatible: false,
    policy: "legacy",
};

const BASE_OPTIMIZER: Omit<ResolveModelSelectionInput, "activeProviders" | "requestedProvider" | "requestedModel" | "taskSettingProvider" | "taskSettingModel"> = {
    profile: "optimizer-cascade",
    fallbackProvider: FALLBACK_PROVIDER,
    hardcodedFallbackModel: FALLBACK_MODEL,
    requireOverrideInCatalog: false,
    gateOverrideOnOpenAiCompatible: true,
    policy: "legacy",
    envDefaultProvider: "siliconflow",
};

describe("resolveModelSelection — vibe-cascade (VibeClassify.ts / VibePrefill.ts)", () => {
    it("honors a request-override provider+model that exist in the catalog", () => {
        const decision = resolveModelSelection({
            ...BASE_VIBE,
            activeProviders: [
                siliconflow([model("MiniMaxAI/MiniMax-M3", { isDefault: true })]),
                openrouter([model("Qwen/Qwen3-32B", { isDefault: true })]),
            ],
            requestedProvider: "openrouter",
            requestedModel: "Qwen/Qwen3-32B",
            taskSettingProvider: "siliconflow",
            taskSettingModel: "MiniMaxAI/MiniMax-M3",
        });

        expect(decision.effective).toEqual({ provider: "openrouter", model: "Qwen/Qwen3-32B" });
        expect(decision.providerSource).toBe("request-override");
        expect(decision.modelSource).toBe("request-override");
        expect(decision.honoredRequest).toBe(true);
    });

    it("falls through silently to task-setting when the requested provider is not active in the catalog", () => {
        const decision = resolveModelSelection({
            ...BASE_VIBE,
            activeProviders: [siliconflow([model("MiniMaxAI/MiniMax-M3", { isDefault: true })])],
            requestedProvider: "does-not-exist",
            requestedModel: undefined,
            taskSettingProvider: "siliconflow",
            taskSettingModel: "MiniMaxAI/MiniMax-M3",
        });

        expect(decision.effective).toEqual({ provider: "siliconflow", model: "MiniMaxAI/MiniMax-M3" });
        expect(decision.providerSource).toBe("task-setting");
        expect(decision.modelSource).toBe("task-setting");
        expect(decision.honoredRequest).toBe(false);
        expect(decision.blocked).toBeUndefined();
    });

    it("falls through silently to the catalog default (isDefault) model when the requested model is not active on the resolved provider", () => {
        const decision = resolveModelSelection({
            ...BASE_VIBE,
            activeProviders: [siliconflow([
                model("MiniMaxAI/MiniMax-M3", { isDefault: true }),
                model("stale-model", { isActive: false }),
            ])],
            requestedProvider: "siliconflow",
            requestedModel: "stale-model",
            taskSettingProvider: "siliconflow",
            taskSettingModel: "not-active-either",
        });

        expect(decision.effective).toEqual({ provider: "siliconflow", model: "MiniMaxAI/MiniMax-M3" });
        expect(decision.modelSource).toBe("catalog-default");
    });

    it("uses the hardcoded FALLBACK_PROVIDER when no override and no task-setting provider match", () => {
        const decision = resolveModelSelection({
            ...BASE_VIBE,
            activeProviders: [
                siliconflow([model("MiniMaxAI/MiniMax-M3", { isDefault: true })]),
                openrouter([model("Qwen/Qwen3-32B", { isDefault: true })]),
            ],
            requestedProvider: undefined,
            requestedModel: undefined,
            taskSettingProvider: "not-configured",
            taskSettingModel: "not-configured",
        });

        expect(decision.effective.provider).toBe("siliconflow");
        expect(decision.providerSource).toBe("catalog-default");
    });

    it("never silently falls back to lmstudio: skips it in favor of any other active provider", () => {
        const decision = resolveModelSelection({
            ...BASE_VIBE,
            activeProviders: [
                lmstudio([model("local-model", { isDefault: true })]),
                openrouter([model("Qwen/Qwen3-32B", { isDefault: true })]),
            ],
            requestedProvider: undefined,
            requestedModel: undefined,
            taskSettingProvider: "not-configured",
            taskSettingModel: "not-configured",
        });

        expect(decision.effective.provider).toBe("openrouter");
        expect(decision.providerSource).toBe("catalog-first");
    });

    it("falls back to lmstudio when it is the ONLY active provider (activeProviders[0] catch-all)", () => {
        const decision = resolveModelSelection({
            ...BASE_VIBE,
            activeProviders: [lmstudio([model("local-model", { isDefault: true })])],
            requestedProvider: undefined,
            requestedModel: undefined,
            taskSettingProvider: "not-configured",
            taskSettingModel: "not-configured",
        });

        expect(decision.effective).toEqual({ provider: "lmstudio", model: "local-model" });
        expect(decision.providerSource).toBe("catalog-first");
    });

    it("returns providerCatalog=undefined and skip-shaped hardcoded-fallback when there is no active provider at all", () => {
        const decision = resolveModelSelection({
            ...BASE_VIBE,
            activeProviders: [],
            requestedProvider: undefined,
            requestedModel: undefined,
            taskSettingProvider: "siliconflow",
            taskSettingModel: "MiniMaxAI/MiniMax-M3",
        });

        expect(decision.providerCatalog).toBeUndefined();
        expect(decision.effective).toEqual({ provider: FALLBACK_PROVIDER, model: FALLBACK_MODEL });
    });

    it("uses the hardcoded FALLBACK_MODEL when the resolved provider has no active models at all", () => {
        const decision = resolveModelSelection({
            ...BASE_VIBE,
            activeProviders: [siliconflow([model("some-inactive-model", { isActive: false })])],
            requestedProvider: undefined,
            requestedModel: undefined,
            taskSettingProvider: "not-configured",
            taskSettingModel: "not-configured",
        });

        expect(decision.effective).toEqual({ provider: "siliconflow", model: FALLBACK_MODEL });
        expect(decision.modelSource).toBe("hardcoded-fallback");
    });

    it("under strict policy, blocks instead of falling through when the requested provider override is not in the catalog", () => {
        const decision = resolveModelSelection({
            ...BASE_VIBE,
            policy: "strict",
            activeProviders: [siliconflow([model("MiniMaxAI/MiniMax-M3", { isDefault: true })])],
            requestedProvider: "does-not-exist",
            requestedModel: undefined,
            taskSettingProvider: "siliconflow",
            taskSettingModel: "MiniMaxAI/MiniMax-M3",
        });

        expect(decision.blocked).toBeDefined();
        expect(decision.blocked?.code).toBe("PROVIDER_NOT_IN_CATALOG");
    });

    it("under strict policy, blocks instead of falling through when the requested model override is not active on the resolved provider", () => {
        const decision = resolveModelSelection({
            ...BASE_VIBE,
            policy: "strict",
            activeProviders: [siliconflow([model("MiniMaxAI/MiniMax-M3", { isDefault: true })])],
            requestedProvider: "siliconflow",
            requestedModel: "not-a-real-model",
            taskSettingProvider: "siliconflow",
            taskSettingModel: "MiniMaxAI/MiniMax-M3",
        });

        expect(decision.blocked).toBeDefined();
        expect(decision.blocked?.code).toBe("MODEL_NOT_IN_CATALOG");
    });
});

describe("resolveModelSelection — optimizer-cascade (OptimizeUserPrompt.ts)", () => {
    it("honors a direct provider-name override, and honors the model override without checking catalog membership because apiType is openai-compatible (KNOWN-DIVERGENCE)", () => {
        // KNOWN-DIVERGENCE (future work): "not-a-real-model" is never validated against
        // siliconflow's model list — this mirrors a real, currently-latent defect in
        // OptimizeUserPrompt.ts's cascade, preserved here exactly as-is.
        const decision = resolveModelSelection({
            ...BASE_OPTIMIZER,
            activeProviders: [siliconflow([model("MiniMaxAI/MiniMax-M3", { isDefault: true })])],
            requestedProvider: "siliconflow",
            requestedModel: "not-a-real-model",
            taskSettingProvider: "siliconflow",
            taskSettingModel: "MiniMaxAI/MiniMax-M3",
        });

        expect(decision.effective).toEqual({ provider: "siliconflow", model: "not-a-real-model" });
        expect(decision.modelSource).toBe("request-override");
    });

    it("resolves the provider by which one owns the requested model, when the direct provider-name match fails", () => {
        const decision = resolveModelSelection({
            ...BASE_OPTIMIZER,
            activeProviders: [
                siliconflow([model("MiniMaxAI/MiniMax-M3", { isDefault: true })]),
                openrouter([model("Qwen/Qwen3-32B", { isDefault: true })]),
            ],
            requestedProvider: "not-a-real-provider",
            requestedModel: "Qwen/Qwen3-32B",
            taskSettingProvider: "siliconflow",
            taskSettingModel: "MiniMaxAI/MiniMax-M3",
        });

        expect(decision.effective).toEqual({ provider: "openrouter", model: "Qwen/Qwen3-32B" });
        expect(decision.providerSource).toBe("request-override");
        expect(decision.modelSource).toBe("request-override");
    });

    it("falls through to task-setting provider when neither direct-name nor model-owner match", () => {
        const decision = resolveModelSelection({
            ...BASE_OPTIMIZER,
            activeProviders: [
                siliconflow([model("MiniMaxAI/MiniMax-M3", { isDefault: true })]),
                openrouter([model("Qwen/Qwen3-32B", { isDefault: true })]),
            ],
            requestedProvider: undefined,
            requestedModel: undefined,
            taskSettingProvider: "openrouter",
            taskSettingModel: "Qwen/Qwen3-32B",
        });

        expect(decision.effective).toEqual({ provider: "openrouter", model: "Qwen/Qwen3-32B" });
        expect(decision.providerSource).toBe("task-setting");
        expect(decision.modelSource).toBe("task-setting");
    });

    it("falls through to env.LLM_DEFAULT_PROVIDER when no override and no task-setting match", () => {
        const decision = resolveModelSelection({
            ...BASE_OPTIMIZER,
            envDefaultProvider: "openrouter",
            activeProviders: [
                siliconflow([model("MiniMaxAI/MiniMax-M3", { isDefault: true })]),
                openrouter([model("Qwen/Qwen3-32B", { isDefault: true })]),
            ],
            requestedProvider: undefined,
            requestedModel: undefined,
            taskSettingProvider: "not-configured",
            taskSettingModel: "not-configured",
        });

        expect(decision.effective.provider).toBe("openrouter");
        expect(decision.providerSource).toBe("catalog-role-default");
    });

    it("falls through to the hardcoded FALLBACK_PROVIDER when env default is also unmatched", () => {
        const decision = resolveModelSelection({
            ...BASE_OPTIMIZER,
            envDefaultProvider: "not-configured-either",
            activeProviders: [
                openrouter([model("Qwen/Qwen3-32B", { isDefault: true })]),
                siliconflow([model("MiniMaxAI/MiniMax-M3", { isDefault: true })]),
            ],
            requestedProvider: undefined,
            requestedModel: undefined,
            taskSettingProvider: "not-configured",
            taskSettingModel: "not-configured",
        });

        expect(decision.effective.provider).toBe("siliconflow");
        expect(decision.providerSource).toBe("catalog-default");
    });

    it("prefers the dialogue-role default model over a plain isDefault model when no override/task-setting model matches", () => {
        const decision = resolveModelSelection({
            ...BASE_OPTIMIZER,
            activeProviders: [siliconflow([
                model("vision-default", { isDefault: true, role: "vision" }),
                model("dialogue-default", { isDefault: true, role: "dialogue" }),
            ])],
            requestedProvider: "siliconflow",
            requestedModel: undefined,
            taskSettingProvider: "siliconflow",
            taskSettingModel: "not-active",
        });

        expect(decision.effective.model).toBe("dialogue-default");
        expect(decision.modelSource).toBe("catalog-role-default");
    });

    it("does NOT honor a model override when the resolved provider's apiType is not openai-compatible", () => {
        const decision = resolveModelSelection({
            ...BASE_OPTIMIZER,
            activeProviders: [lmstudio([model("local-model", { isDefault: true })])],
            requestedProvider: "lmstudio",
            requestedModel: "local-model-override",
            taskSettingProvider: "lmstudio",
            taskSettingModel: "local-model",
        });

        expect(decision.effective.model).toBe("local-model");
        expect(decision.modelSource).toBe("task-setting");
    });

    it("throws-equivalent (providerCatalog undefined) when there is no active provider at all", () => {
        const decision = resolveModelSelection({
            ...BASE_OPTIMIZER,
            activeProviders: [],
            requestedProvider: undefined,
            requestedModel: undefined,
            taskSettingProvider: "siliconflow",
            taskSettingModel: "MiniMaxAI/MiniMax-M3",
        });

        expect(decision.providerCatalog).toBeUndefined();
    });
});
