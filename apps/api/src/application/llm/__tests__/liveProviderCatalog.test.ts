import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";
import { clearLiveModelCatalogCache, hydrateProviderCatalog } from "../liveProviderCatalog";

describe("hydrateProviderCatalog", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        // The live-model cache is keyed by provider|baseUrl|hasAuth, so every case in this file
        // shares one key — without this, the second test would read the first one's result.
        clearLiveModelCatalogCache();
    });

    it("keeps all discovered OpenRouter models and infers capabilities instead of hiding non-text entries", async () => {
        const providerCatalog: LlmProviderCatalog = {
            provider: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1",
            apiType: "openai-compatible",
            authType: "bearer",
            isActive: true,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            models: [
                // Approved by the operator, and still offered by the provider. Discovery no
                // longer activates anything on its own, so a case about capability inference has
                // to say which model was approved or it is really a case about activation.
                {
                    id: "google/gemma-4-31b-it:free",
                    provider: "openrouter",
                    role: "dialogue",
                    capabilities: ["chat"],
                    isDefault: true,
                    isFallback: false,
                    isActive: true,
                },
                {
                    id: "google/gemma-4-27b-it:free",
                    provider: "openrouter",
                    role: "dialogue",
                    capabilities: ["chat"],
                    isDefault: false,
                    isFallback: true,
                    isActive: true,
                },
            ],
        };

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { id: "google/gemma-4-31b-it:free", architecture: { modality: "text->text" }, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["response_format"] },
                    { id: "black-forest-labs/flux-1-schnell", architecture: { modality: "text->image" } },
                ],
            }),
        }));

        const hydrated = await hydrateProviderCatalog(providerCatalog, "test-key");

        expect(hydrated.models.map((model) => model.id)).toEqual([
            "google/gemma-4-31b-it:free",
            "black-forest-labs/flux-1-schnell",
            "google/gemma-4-27b-it:free",
        ]);
        expect(hydrated.models[0]?.priceTier).toBe("free");
        expect(hydrated.models[0]?.isDefault).toBe(true);
        expect(hydrated.models[0]?.capabilities).toEqual(["chat"]);
        expect(hydrated.models[0]?.promptTemplate).toContain("## MODEL-SPECIFIC GUIDANCE");
        expect(hydrated.models[0]?.supportedParameters).toEqual(["response_format"]);
        expect(hydrated.models[1]?.capabilities).toEqual(["image_generation"]);
        expect(hydrated.models[2]?.capabilities).toEqual(["chat"]);
        // The stored entry the provider stopped listing is carried over and flagged, not dropped.
        expect(hydrated.models[2]?.availability).toBe("deprecated");
        // The one model discovery returned that nobody approved stays off.
        expect(hydrated.models[1]?.isActive).toBe(false);
    });

    /**
     * Activation is the operator's decision and only the operator's decision. Discovery reports
     * what a provider offers; it does not get a vote on what this platform will spend money on.
     */
    describe("operator-curated activation", () => {
        function catalogWith(models: LlmProviderCatalog["models"]): LlmProviderCatalog {
            return {
                provider: "openrouter",
                baseUrl: "https://openrouter.ai/api/v1",
                apiType: "openai-compatible",
                authType: "bearer",
                isActive: true,
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
                updatedAt: new Date("2026-01-01T00:00:00.000Z"),
                models,
            };
        }

        function model(id: string, overrides: Partial<LlmProviderCatalog["models"][number]> = {}) {
            return {
                id,
                provider: "openrouter",
                role: "dialogue" as const,
                capabilities: ["chat"],
                isDefault: false,
                isFallback: true,
                isActive: true,
                ...overrides,
            };
        }

        function stubDiscovery(ids: string[]) {
            vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    data: ids.map((id) => ({ id, architecture: { modality: "text->text" }, pricing: { prompt: "0.000001", completion: "0.000002" } })),
                }),
            }));
        }

        it("keeps a model the operator switched off, marked off rather than removed", async () => {
            stubDiscovery(["keep/allowed", "banned/expensive", "never/seen-before"]);

            const hydrated = await hydrateProviderCatalog(
                catalogWith([
                    model("keep/allowed", { isDefault: true, isFallback: false }),
                    model("banned/expensive", { isActive: false }),
                ]),
                "test-key",
            );

            // It used to be dropped here, which meant a model switched off in /admin/models
            // disappeared from the admin list too and could never be switched back on.
            const banned = hydrated.models.find((m) => m.id === "banned/expensive");
            expect(banned).toBeDefined();
            expect(banned?.isActive).toBe(false);
            expect(hydrated.models.find((m) => m.id === "keep/allowed")?.isActive).toBe(true);
        });

        it("does not nominate an unapproved model as the default", async () => {
            stubDiscovery(["banned/first", "keep/second"]);

            const hydrated = await hydrateProviderCatalog(
                catalogWith([model("banned/first", { isActive: false })]),
                "test-key",
            );

            expect(hydrated.models.map((m) => m.id)).toEqual(["banned/first", "keep/second"]);
            // "First discovered" is no longer a stand-in for "the one to use": nothing here has
            // been approved, so nothing here is the default.
            expect(hydrated.models.filter((m) => m.isDefault)).toHaveLength(0);
        });

        it("a model the operator has never ruled on arrives INACTIVE", async () => {
            stubDiscovery(["untouched/model"]);

            const hydrated = await hydrateProviderCatalog(catalogWith([]), "test-key");

            // The platform spends the account owner's money. A provider adding models to its
            // listing must not silently make them spendable — the operator enables what they use.
            expect(hydrated.models.map((m) => m.id)).toEqual(["untouched/model"]);
            expect(hydrated.models[0]?.isActive).toBe(false);
        });

        it("an explicit activation survives rediscovery", async () => {
            stubDiscovery(["chosen/model", "other/model"]);

            const hydrated = await hydrateProviderCatalog(
                catalogWith([model("chosen/model", { isActive: true })]),
                "test-key",
            );

            expect(hydrated.models.find((m) => m.id === "chosen/model")?.isActive).toBe(true);
            expect(hydrated.models.find((m) => m.id === "other/model")?.isActive).toBe(false);
        });

        it("a stored model the provider no longer lists is kept and flagged, not dropped", async () => {
            stubDiscovery(["still/offered"]);

            const hydrated = await hydrateProviderCatalog(
                catalogWith([
                    model("still/offered", { isActive: true }),
                    model("retired/model", { isActive: true }),
                ]),
                "test-key",
            );

            const retired = hydrated.models.find((m) => m.id === "retired/model");
            // Its id may already be referenced by a stored model lock, an execution log entry or
            // a published build. Deleting the row turns every one of those into a dangling string.
            expect(retired).toBeDefined();
            expect(retired?.availability).toBe("deprecated");
            expect(hydrated.models.find((m) => m.id === "still/offered")?.availability).toBeUndefined();
        });
    });
});
