import { describe, expect, it } from "vitest";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";
import { dedupeModelsById, resolveComposerCascade } from "../catalogModels";

/**
 * Characterization tests for the composer cascade extracted out of ResolvePromptExecution.
 * These pin the exact tie-break order the inline version had; if a future change reorders the
 * `??` chain, these fail rather than silently shifting which model 100% of generation traffic
 * gets dispatched to.
 */

function model(overrides: Partial<LlmProviderCatalog["models"][number]> & { id: string }) {
    return {
        provider: "acme",
        role: "dialogue",
        capabilities: ["chat"],
        isDefault: false,
        isFallback: false,
        isActive: true,
        ...overrides,
    } satisfies LlmProviderCatalog["models"][number];
}

function provider(overrides: Partial<LlmProviderCatalog> & { provider: string }): LlmProviderCatalog {
    return {
        baseUrl: "https://example.test/v1",
        apiType: "openai-compatible",
        authType: "bearer",
        isActive: true,
        models: [],
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...overrides,
    };
}

describe("dedupeModelsById", () => {
    it("drops inactive and id-less models", () => {
        const result = dedupeModelsById([
            model({ id: "keep" }),
            model({ id: "drop", isActive: false }),
            model({ id: "" }),
        ]);

        expect(result.map((m) => m.id)).toEqual(["keep"]);
    });

    it("keeps the first occurrence unless a later duplicate is the default", () => {
        const firstWins = dedupeModelsById([
            model({ id: "dup", displayName: "first" }),
            model({ id: "dup", displayName: "second" }),
        ]);
        expect(firstWins[0]?.displayName).toBe("first");

        const defaultWins = dedupeModelsById([
            model({ id: "dup", displayName: "first" }),
            model({ id: "dup", displayName: "second", isDefault: true }),
        ]);
        expect(defaultWins[0]?.displayName).toBe("second");
    });
});

describe("resolveComposerCascade — provider resolution", () => {
    const providers = [
        provider({ provider: "first" }),
        provider({ provider: "envdefault" }),
        provider({ provider: "requested" }),
        provider({ provider: "inactive", isActive: false }),
    ];

    it("honours an active requested provider", () => {
        const result = resolveComposerCascade({
            providers,
            requestedProvider: "requested",
            envDefaultProvider: "envdefault",
        });
        expect(result.providerCatalog?.provider).toBe("requested");
    });

    it("ignores a requested provider that is inactive and falls back to the env default", () => {
        const result = resolveComposerCascade({
            providers,
            requestedProvider: "inactive",
            envDefaultProvider: "envdefault",
        });
        expect(result.providerCatalog?.provider).toBe("envdefault");
    });

    it("falls back to the first provider when the env default is absent", () => {
        const result = resolveComposerCascade({
            providers,
            envDefaultProvider: "nowhere",
        });
        expect(result.providerCatalog?.provider).toBe("first");
    });

    it("resolves nothing on an empty catalog", () => {
        const result = resolveComposerCascade({ providers: [], envDefaultProvider: "envdefault" });
        expect(result.providerCatalog).toBeUndefined();
        expect(result.providerModels).toEqual([]);
        expect(result.roleModel).toBeUndefined();
    });
});

describe("resolveComposerCascade — model resolution order", () => {
    const models = [
        model({ id: "capability-default", capabilities: ["vision"], isDefault: true, role: "vision" }),
        model({ id: "role-default", role: "coding", isDefault: true }),
        model({ id: "role-fallback", role: "coding", isFallback: true }),
        model({ id: "dialogue-default", role: "dialogue", isDefault: true }),
        model({ id: "plain-active", role: "embeddings" }),
    ];
    const providers = [provider({ provider: "acme", models })];
    const base = { providers, envDefaultProvider: "acme" } as const;

    it("an explicit in-catalog model beats everything", () => {
        const result = resolveComposerCascade({ ...base, requestedModel: "plain-active", capability: "vision", pipelineRole: "coding" });
        expect(result.roleModel?.id).toBe("plain-active");
    });

    it("an explicit model absent from the catalog does NOT resolve — the caller decides what to do", () => {
        const result = resolveComposerCascade({ ...base, requestedModel: "not-in-catalog", pipelineRole: "coding" });
        expect(result.roleModel?.id).toBe("role-default");
    });

    it("capability + isDefault beats the pipeline role", () => {
        const result = resolveComposerCascade({ ...base, capability: "vision", pipelineRole: "coding" });
        expect(result.roleModel?.id).toBe("capability-default");
    });

    it("role default beats role fallback", () => {
        const result = resolveComposerCascade({ ...base, pipelineRole: "coding" });
        expect(result.roleModel?.id).toBe("role-default");
    });

    it("role fallback is used when the role has no default", () => {
        const withoutRoleDefault = [provider({ provider: "acme", models: models.filter((m) => m.id !== "role-default") })];
        const result = resolveComposerCascade({ providers: withoutRoleDefault, envDefaultProvider: "acme", pipelineRole: "coding" });
        expect(result.roleModel?.id).toBe("role-fallback");
    });

    it("falls back to the dialogue default for an unknown role", () => {
        const result = resolveComposerCascade({ ...base, pipelineRole: "nonexistent-role" });
        expect(result.roleModel?.id).toBe("dialogue-default");
    });

    it("falls back to the first active model when nothing else matches", () => {
        const onlyPlain = [provider({ provider: "acme", models: [model({ id: "plain-active", role: "embeddings" })] })];
        const result = resolveComposerCascade({ providers: onlyPlain, envDefaultProvider: "acme", pipelineRole: "coding" });
        expect(result.roleModel?.id).toBe("plain-active");
    });

    it("resolves no model when the provider has no active models", () => {
        const allInactive = [provider({ provider: "acme", models: [model({ id: "off", isActive: false })] })];
        const result = resolveComposerCascade({ providers: allInactive, envDefaultProvider: "acme", pipelineRole: "coding" });
        expect(result.providerCatalog?.provider).toBe("acme");
        expect(result.roleModel).toBeUndefined();
    });
});

/**
 * The catalog is the source of truth for what may be dispatched. These pin the difference
 * between "the caller asked for nothing" and "the caller asked for something the catalog does
 * not offer" — a distinction the cascade used to absorb by quietly falling through to a default,
 * and which ResolvePromptExecution used to sidestep entirely by returning the requested id
 * verbatim for any openai-compatible provider.
 */
describe("resolveComposerCascade — an unhonoured request is reported, not absorbed", () => {
    const acme = provider({
        provider: "acme",
        models: [
            model({ id: "acme/on", isDefault: true }),
            model({ id: "acme/off", isActive: false }),
        ],
    });

    it("reports nothing unavailable when no specific model was asked for", () => {
        const result = resolveComposerCascade({
            providers: [acme],
            envDefaultProvider: "acme",
        });

        expect(result.requestedModelUnavailable).toBe(false);
        expect(result.requestedProviderUnavailable).toBe(false);
        expect(result.roleModel?.id).toBe("acme/on");
    });

    it("honours a request for an active model", () => {
        const result = resolveComposerCascade({
            providers: [acme],
            requestedProvider: "acme",
            requestedModel: "acme/on",
            envDefaultProvider: "acme",
        });

        expect(result.requestedModelUnavailable).toBe(false);
        expect(result.roleModel?.id).toBe("acme/on");
    });

    it("reports a model an operator switched off", () => {
        const result = resolveComposerCascade({
            providers: [acme],
            requestedProvider: "acme",
            requestedModel: "acme/off",
            envDefaultProvider: "acme",
        });

        // The cascade still produces a usable roleModel — that is its job — but the caller can
        // now see that it is NOT the one that was asked for, instead of dispatching to a
        // different model and recording its cost under a request nobody made.
        expect(result.requestedModelUnavailable).toBe(true);
        expect(result.roleModel?.id).toBe("acme/on");
    });

    it("reports a model that does not exist at all", () => {
        const result = resolveComposerCascade({
            providers: [acme],
            requestedProvider: "acme",
            requestedModel: "acme/never-existed",
            envDefaultProvider: "acme",
        });

        expect(result.requestedModelUnavailable).toBe(true);
    });

    it("reports a provider that is not active", () => {
        const parked = provider({ provider: "parked", isActive: false, models: [model({ id: "parked/one" })] });

        const result = resolveComposerCascade({
            providers: [acme, parked],
            requestedProvider: "parked",
            requestedModel: "parked/one",
            envDefaultProvider: "acme",
        });

        expect(result.requestedProviderUnavailable).toBe(true);
        // Resolution fell to another provider entirely — exactly the silent substitution the
        // flag exists to make visible.
        expect(result.providerCatalog?.provider).toBe("acme");
    });

    it("reports unavailability even when the catalog is empty", () => {
        const result = resolveComposerCascade({
            providers: [],
            requestedProvider: "acme",
            requestedModel: "acme/on",
            envDefaultProvider: "acme",
        });

        expect(result.requestedModelUnavailable).toBe(true);
        expect(result.requestedProviderUnavailable).toBe(true);
        expect(result.providerCatalog).toBeUndefined();
    });
});
