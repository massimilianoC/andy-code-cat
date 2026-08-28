/**
 * Regression tests for markAvailability(). Runs against MongoMemoryServer — no Docker required.
 *
 * The behaviour under test used to be the opposite, and had no test at all: discovery forced
 * `isActive: false` on any stored model missing from a live response. Because SiliconFlow's
 * discovery is not stable — one startup reported 13 models, the next 77 — a model the operator
 * had switched on could be un-approved by a single unlucky poll, and re-appearing later restored
 * `availability: "live"` but never the activation. An operator reported exactly that: they
 * enabled moonshotai/Kimi-K3, selected it, and the pipeline ran on a different model.
 *
 * `isActive` now means one thing only: the operator wants this model usable. Availability is
 * recorded alongside it as information, and a model the provider has genuinely retired fails at
 * dispatch with a named error rather than being silently un-approved beforehand.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

let mongod: MongoMemoryServer;
let repo: import("../MongoLlmCatalogRepository").MongoLlmCatalogRepository;

const PROVIDER = "siliconflow";

async function seedProvider() {
    const { MongoLlmCatalogRepository } = await import("../MongoLlmCatalogRepository");
    repo = new MongoLlmCatalogRepository();
    await repo.upsertProvider({
        provider: PROVIDER,
        baseUrl: "https://api.siliconflow.com/v1",
        apiType: "openai-compatible",
        authType: "bearer",
        isActive: true,
        models: [
            { id: "moonshotai/Kimi-K3", provider: PROVIDER, role: "dialogue", capabilities: ["chat"], isDefault: false, isFallback: false, isActive: true },
            { id: "Qwen/Qwen3-32B", provider: PROVIDER, role: "dialogue", capabilities: ["chat"], isDefault: true, isFallback: false, isActive: true },
            { id: "operator/switched-off", provider: PROVIDER, role: "dialogue", capabilities: ["chat"], isDefault: false, isFallback: false, isActive: false },
        ],
    });
}

async function modelById(id: string) {
    const providers = await repo.listAllProviders();
    const catalog = providers.find((entry) => entry.provider === PROVIDER);
    return catalog?.models.find((model) => model.id === id);
}

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri("markavailability-test");
    await seedProvider();
}, 120_000);

afterAll(async () => {
    await mongod?.stop();
});

describe("markAvailability", () => {
    it("keeps an operator-activated model active when a discovery poll misses it", async () => {
        // The unstable poll: Kimi-K3 is simply absent from this response.
        const counts = await repo.markAvailability({
            provider: PROVIDER,
            liveModelIds: ["Qwen/Qwen3-32B"],
            checkedAt: new Date(),
        });

        expect(counts.live).toBe(1);
        expect(counts.deprecated).toBe(2);

        const kimi = await modelById("moonshotai/Kimi-K3");
        expect(kimi?.availability).toBe("deprecated");
        // The point of the whole fix: availability changed, approval did not.
        expect(kimi?.isActive).toBe(true);
    });

    it("does not resurrect a model the operator switched off by hand", async () => {
        await repo.markAvailability({
            provider: PROVIDER,
            liveModelIds: ["Qwen/Qwen3-32B", "moonshotai/Kimi-K3", "operator/switched-off"],
            checkedAt: new Date(),
        });

        const manual = await modelById("operator/switched-off");
        expect(manual?.availability).toBe("live");
        expect(manual?.isActive).toBe(false);
    });

    it("restores availability when the provider serves the model again, activation intact", async () => {
        const kimi = await modelById("moonshotai/Kimi-K3");
        expect(kimi?.availability).toBe("live");
        expect(kimi?.isActive).toBe(true);
    });

    it("leaves isDefault to the operator as well", async () => {
        await repo.markAvailability({
            provider: PROVIDER,
            liveModelIds: ["moonshotai/Kimi-K3"],
            checkedAt: new Date(),
        });

        const qwen = await modelById("Qwen/Qwen3-32B");
        expect(qwen?.availability).toBe("deprecated");
        expect(qwen?.isDefault).toBe(true);
    });
});
