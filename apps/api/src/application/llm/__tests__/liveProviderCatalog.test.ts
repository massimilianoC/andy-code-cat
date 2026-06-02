import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";
import { hydrateProviderCatalog } from "../liveProviderCatalog";

describe("hydrateProviderCatalog", () => {
    afterEach(() => {
        vi.restoreAllMocks();
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
});
