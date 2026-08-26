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
                {
                    id: "google/gemma-4-27b-it:free",
                    provider: "openrouter",
                    role: "dialogue",
                    capabilities: ["chat"],
                    isDefault: true,
                    isFallback: false,
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
    });

    describe("operator-curated deactivation", () => {
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

        it("keeps a model the operator switched off out of the catalog even when the provider still lists it", async () => {
            stubDiscovery(["keep/allowed", "banned/expensive", "never/seen-before"]);

            const hydrated = await hydrateProviderCatalog(
                catalogWith([
                    model("keep/allowed", { isDefault: true, isFallback: false }),
                    model("banned/expensive", { isActive: false }),
                ]),
                "test-key",
            );

            expect(hydrated.models.map((m) => m.id)).not.toContain("banned/expensive");
            expect(hydrated.models.map((m) => m.id)).toEqual(["keep/allowed", "never/seen-before"]);
        });

        it("still promotes a default when the operator deactivated the discovered first entry", async () => {
            stubDiscovery(["banned/first", "keep/second"]);

            const hydrated = await hydrateProviderCatalog(
                catalogWith([model("banned/first", { isActive: false })]),
                "test-key",
            );

            expect(hydrated.models.map((m) => m.id)).toEqual(["keep/second"]);
            expect(hydrated.models.filter((m) => m.isDefault)).toHaveLength(1);
            expect(hydrated.models[0]?.isDefault).toBe(true);
        });

        it("yields an empty model list when the operator deactivated every discovered model", async () => {
            stubDiscovery(["banned/one", "banned/two"]);

            const hydrated = await hydrateProviderCatalog(
                catalogWith([
                    model("banned/one", { isActive: false }),
                    model("banned/two", { isActive: false }),
                ]),
                "test-key",
            );

            expect(hydrated.models).toEqual([]);
        });

        it("leaves models the operator never touched active", async () => {
            stubDiscovery(["untouched/model"]);

            const hydrated = await hydrateProviderCatalog(catalogWith([]), "test-key");

            expect(hydrated.models.map((m) => m.id)).toEqual(["untouched/model"]);
            expect(hydrated.models[0]?.isActive).toBe(true);
        });
    });
});
