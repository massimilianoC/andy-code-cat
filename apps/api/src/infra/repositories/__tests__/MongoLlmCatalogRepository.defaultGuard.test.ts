/**
 * Regression tests for the one-default-per-role invariant on writes.
 *
 * The admin model editor lets a superadmin uncheck "default" on a model. Nothing in the UI stops
 * them from doing that to the only default a role has — and the UI is not the only writer:
 * anything calling upsertModel/deleteModel/setModelsActive directly (scripts, other admin tools)
 * has the same access. Landing a write that leaves a role with zero defaults is worse than
 * rejecting it outright: every cascade that resolves a model for that role (catalogModels.ts,
 * modelSelection.ts) looks for `isDefault && isActive`, misses, and falls back to `isFallback`,
 * picking by list order — silently running the wrong (and possibly most expensive) model.
 *
 * normalizeModels() in MongoLlmCatalogRepository.ts already carries a promotion branch for
 * exactly this: when a role ends up with no isDefault:true entry after a write, it promotes an
 * active model of that role (or, lacking one, the first model of that role) back to isDefault:true.
 * Every mutating method (upsertModel, deleteModel, setModelsActive, upsertProvider) already
 * normalizes through it. These tests pin that behaviour so it cannot regress quietly — there is
 * no separate guard to write; normalizeModels' existing promotion branch is the guard.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

let mongod: MongoMemoryServer;
let repo: import("../MongoLlmCatalogRepository").MongoLlmCatalogRepository;

const PROVIDER = "siliconflow";

async function modelsFor(provider = PROVIDER) {
    const providers = await repo.listAllProviders();
    return providers.find((entry) => entry.provider === provider)?.models ?? [];
}

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri("default-guard-test");
    const { MongoLlmCatalogRepository } = await import("../MongoLlmCatalogRepository");
    repo = new MongoLlmCatalogRepository();
}, 120_000);

afterAll(async () => {
    await mongod?.stop();
});

describe("upsertModel: one default per role survives a write that would clear it", () => {
    beforeEach(async () => {
        await repo.upsertProvider({
            provider: PROVIDER,
            baseUrl: "https://api.siliconflow.com/v1",
            apiType: "openai-compatible",
            authType: "bearer",
            isActive: true,
            models: [
                { id: "sole/dialogue-default", provider: PROVIDER, role: "dialogue", capabilities: ["chat"], isDefault: true, isFallback: false, isActive: true },
            ],
        });
    });

    it("refuses to leave a role with zero defaults when the only default is unchecked", async () => {
        const updated = await repo.upsertModel({
            provider: PROVIDER,
            modelId: "sole/dialogue-default",
            patch: { isDefault: false },
        });

        // Rejecting the write outright and silently reverting it read the same to the caller
        // either way: the response is the authority, and the response says the role still has
        // exactly one default — the model the operator just tried to un-default.
        const dialogueDefaults = updated.models.filter((model) => model.role === "dialogue" && model.isDefault);
        expect(dialogueDefaults).toHaveLength(1);
        expect(dialogueDefaults[0]?.id).toBe("sole/dialogue-default");
    });

    it("promotes a different active sibling when the current default is unchecked", async () => {
        await repo.upsertModel({
            provider: PROVIDER,
            modelId: "sibling/dialogue-model",
            patch: { role: "dialogue", isDefault: false, isActive: true },
        });

        const updated = await repo.upsertModel({
            provider: PROVIDER,
            modelId: "sole/dialogue-default",
            patch: { isDefault: false },
        });

        const dialogueDefaults = updated.models.filter((model) => model.role === "dialogue" && model.isDefault);
        expect(dialogueDefaults).toHaveLength(1);
        // The demoted model itself is not re-promoted this time — its active sibling is.
        expect(dialogueDefaults[0]?.id).toBe("sibling/dialogue-model");
        expect(updated.models.find((model) => model.id === "sole/dialogue-default")?.isDefault).toBe(false);
    });

    it("does not resurrect an inactive sibling ahead of the active model being un-defaulted", async () => {
        await repo.upsertModel({
            provider: PROVIDER,
            modelId: "inactive/dialogue-model",
            patch: { role: "dialogue", isDefault: false, isActive: false },
        });

        const updated = await repo.upsertModel({
            provider: PROVIDER,
            modelId: "sole/dialogue-default",
            patch: { isDefault: false },
        });

        const dialogueDefaults = updated.models.filter((model) => model.role === "dialogue" && model.isDefault);
        expect(dialogueDefaults).toHaveLength(1);
        expect(dialogueDefaults[0]?.id).toBe("sole/dialogue-default");
    });

    it("still allows replacing the default outright by setting a different model's isDefault true", async () => {
        await repo.upsertModel({
            provider: PROVIDER,
            modelId: "sibling/dialogue-model",
            patch: { role: "dialogue", isDefault: false, isActive: true },
        });

        const updated = await repo.upsertModel({
            provider: PROVIDER,
            modelId: "sibling/dialogue-model",
            patch: { isDefault: true },
        });

        const dialogueDefaults = updated.models.filter((model) => model.role === "dialogue" && model.isDefault);
        expect(dialogueDefaults).toHaveLength(1);
        expect(dialogueDefaults[0]?.id).toBe("sibling/dialogue-model");
    });

    it("keeps roles independent: clearing one role's default does not touch another role's default", async () => {
        await repo.upsertModel({
            provider: PROVIDER,
            modelId: "sole/quality-default",
            patch: { role: "quality_check", isDefault: true, isActive: true },
        });

        const updated = await repo.upsertModel({
            provider: PROVIDER,
            modelId: "sole/dialogue-default",
            patch: { isDefault: false },
        });

        expect(updated.models.find((model) => model.id === "sole/quality-default")?.isDefault).toBe(true);
        expect(updated.models.find((model) => model.id === "sole/dialogue-default")?.isDefault).toBe(true);
    });
});

describe("deleteModel: removing the last default of a role promotes a survivor", () => {
    beforeEach(async () => {
        await repo.upsertProvider({
            provider: PROVIDER,
            baseUrl: "https://api.siliconflow.com/v1",
            apiType: "openai-compatible",
            authType: "bearer",
            isActive: true,
            models: [
                { id: "doomed/default", provider: PROVIDER, role: "vision", capabilities: ["chat"], isDefault: true, isFallback: false, isActive: true },
                { id: "survivor/model", provider: PROVIDER, role: "vision", capabilities: ["chat"], isDefault: false, isFallback: true, isActive: true },
            ],
        });
    });

    it("promotes the remaining active model of the role after the default is deleted", async () => {
        const updated = await repo.deleteModel(PROVIDER, "doomed/default");
        const visionDefaults = updated.models.filter((model) => model.role === "vision" && model.isDefault);
        expect(visionDefaults).toHaveLength(1);
        expect(visionDefaults[0]?.id).toBe("survivor/model");
    });
});
