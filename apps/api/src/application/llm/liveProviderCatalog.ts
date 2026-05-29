import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";
import { getSiliconFlowPrice } from "./siliconflowPricing";

const LIVE_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

type RuntimeModel = LlmProviderCatalog["models"][number];

const liveModelCache = new Map<string, { expiresAt: number; models: RuntimeModel[] }>();

function dedupeModelsById(models: RuntimeModel[]): RuntimeModel[] {
    const byId = new Map<string, RuntimeModel>();

    for (const model of models) {
        if (!model.isActive || !model.id) continue;
        const previous = byId.get(model.id);
        if (!previous || (model.isDefault && !previous.isDefault)) {
            byId.set(model.id, model);
        }
    }

    return [...byId.values()];
}

function assignPriceTiers(models: RuntimeModel[]): RuntimeModel[] {
    const paidPrices = models
        .map((model) => model.priceInputUsdPerM)
        .filter((price): price is number => price !== undefined && price > 0);

    if (paidPrices.length === 0) {
        return models.map((model) => (
            model.priceInputUsdPerM === 0
                ? { ...model, priceTier: "free" }
                : model
        ));
    }

    const sorted = [...paidPrices].sort((left, right) => left - right);
    const pickPercentile = (percentile: number) => sorted[Math.floor((sorted.length - 1) * percentile)]!;
    const p25 = pickPercentile(0.25);
    const p50 = pickPercentile(0.5);
    const p75 = pickPercentile(0.75);

    return models.map((model) => {
        const price = model.priceInputUsdPerM;
        if (price === undefined) return model;
        if (price === 0) return { ...model, priceTier: "free" };
        if (price <= p25) return { ...model, priceTier: "€" };
        if (price <= p50) return { ...model, priceTier: "€€" };
        if (price <= p75) return { ...model, priceTier: "€€€" };
        return { ...model, priceTier: "€€€€" };
    });
}

function shouldKeepDiscoveredModel(providerKey: string, model: { id?: string; architecture?: { modality?: string } }): boolean {
    const id = String(model.id ?? "").trim();
    return Boolean(id && providerKey);
}

function buildAuthHeader(apiKey: string | undefined, authType?: "api-key" | "bearer" | "none") {
    if (authType === "none" || !apiKey) return undefined;
    return (authType ?? "bearer") === "api-key" ? apiKey : `Bearer ${apiKey}`;
}

type DiscoveredModel = {
    id?: string;
    architecture?: { modality?: string };
    pricing?: { prompt?: string; completion?: string };
};

function inferCapabilities(input: { id: string; modality?: string }): string[] {
    const modality = (input.modality ?? "").toLowerCase();
    const id = input.id.toLowerCase();

    if (modality.endsWith("->image") || id.includes("flux") || id.includes("stable-diffusion") || id.includes("stable_diffusion")) {
        return ["image_generation"];
    }

    if (modality.endsWith("->video") || id.includes("video") || id.includes("cogvideo") || id.includes("kling") || id.includes("hunyuan-video")) {
        return ["video_generation"];
    }

    if (modality.endsWith("->embedding") || id.includes("embedding") || id.includes("bge-")) {
        return ["embeddings"];
    }

    const hasVision =
        modality.startsWith("text+image") ||
        id.includes("vision") ||
        id.includes("vl-") ||
        id.includes("-vl") ||
        id.includes("llava") ||
        id.includes("pixtral") ||
        id.includes("gpt-4o") ||
        (id.includes("gemini") && modality.includes("image"));

    if (hasVision) {
        return ["vision", "chat"];
    }

    if (modality.endsWith("->text") || modality === "text" || modality === "" || modality.startsWith("text")) {
        return ["chat"];
    }

    return [];
}

function inferRole(input: { existingRole?: RuntimeModel["role"]; capabilities: string[] }): RuntimeModel["role"] {
    if (input.existingRole) {
        return input.existingRole;
    }

    if (input.capabilities.includes("image_generation")) {
        return "image_gen";
    }

    if (input.capabilities.includes("embeddings")) {
        return "embeddings";
    }

    if (input.capabilities.includes("vision")) {
        return "vision";
    }

    return "dialogue";
}

export async function hydrateProviderCatalog(
    providerCatalog: LlmProviderCatalog,
    apiKey?: string,
): Promise<LlmProviderCatalog> {
    const fallbackModels = dedupeModelsById(providerCatalog.models);

    if (providerCatalog.apiType !== "openai-compatible") {
        return { ...providerCatalog, models: fallbackModels };
    }

    const authHeader = buildAuthHeader(apiKey, providerCatalog.authType);
    const allowAnonymousDiscovery = providerCatalog.provider === "openrouter";
    if (!authHeader && providerCatalog.authType !== "none" && !allowAnonymousDiscovery) {
        return { ...providerCatalog, models: fallbackModels };
    }

    const cacheKey = `${providerCatalog.provider}|${providerCatalog.baseUrl}|${Boolean(authHeader)}`;
    const cached = liveModelCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return { ...providerCatalog, models: cached.models };
    }

    try {
        const response = await fetch(`${providerCatalog.baseUrl.replace(/\/$/, "")}/models`, {
            method: "GET",
            headers: authHeader ? { Authorization: authHeader } : {},
        });

        if (!response.ok) {
            return { ...providerCatalog, models: fallbackModels };
        }

        const payload = await response.json().catch(() => ({})) as { data?: DiscoveredModel[] };
        const rawModels = payload.data ?? [];
        if (rawModels.length === 0) {
            return { ...providerCatalog, models: fallbackModels };
        }

        const mapped = rawModels
            .filter((model) => shouldKeepDiscoveredModel(providerCatalog.provider, model))
            .map((model, index): RuntimeModel => {
                const id = String(model.id ?? "").trim();
                const modality = model.architecture?.modality ?? "";
                const existing = fallbackModels.find((candidate) => candidate.id === id);

                let priceInputUsdPerM: number | undefined;
                let priceOutputUsdPerM: number | undefined;
                if (providerCatalog.provider === "openrouter" && model.pricing?.prompt !== undefined) {
                    const promptPrice = Number.parseFloat(model.pricing.prompt);
                    const completionPrice = Number.parseFloat(model.pricing.completion ?? "0");
                    if (!Number.isNaN(promptPrice)) priceInputUsdPerM = promptPrice * 1_000_000;
                    if (!Number.isNaN(completionPrice)) priceOutputUsdPerM = completionPrice * 1_000_000;
                } else if (providerCatalog.provider === "siliconflow") {
                    const siliconFlowPrice = getSiliconFlowPrice(id);
                    if (siliconFlowPrice) {
                        priceInputUsdPerM = siliconFlowPrice.input;
                        priceOutputUsdPerM = siliconFlowPrice.output;
                    }
                }

                const inferredCapabilities = inferCapabilities({ id, modality });

                return {
                    id,
                    provider: providerCatalog.provider,
                    role: inferRole({ existingRole: existing?.role, capabilities: existing?.capabilities?.length ? existing.capabilities : inferredCapabilities }),
                    capabilities: existing?.capabilities?.length ? existing.capabilities : inferredCapabilities,
                    isDefault: existing?.isDefault ?? (index === 0 && !fallbackModels.some((candidate) => candidate.isDefault)),
                    isFallback: existing?.isFallback ?? index !== 0,
                    isActive: existing?.isActive ?? true,
                    displayName: existing?.displayName,
                    description: existing?.description,
                    promptTemplate: existing?.promptTemplate,
                    focusPromptTemplate: existing?.focusPromptTemplate,
                    ...(priceInputUsdPerM !== undefined ? { priceInputUsdPerM } : {}),
                    ...(priceOutputUsdPerM !== undefined ? { priceOutputUsdPerM } : {}),
                };
            });

        if (mapped.length === 0) {
            return { ...providerCatalog, models: fallbackModels };
        }

        // Exactly one default per provider, and it must be a live-discovered model:
        // keep the first discovered default (or promote discovered[0] when none has it),
        // and strip isDefault from every other entry. This prevents a stale seed default
        // that is no longer in the provider's live /models list from coexisting with the
        // promoted discovered[0] (which previously yielded two `isDefault` models).
        let discoveredDefaultSeen = false;
        for (let index = 0; index < mapped.length; index += 1) {
            const model = mapped[index]!;
            if (model.isDefault && !discoveredDefaultSeen) {
                discoveredDefaultSeen = true;
            } else if (model.isDefault) {
                mapped[index] = { ...model, isDefault: false, isFallback: true };
            }
        }
        if (!discoveredDefaultSeen) {
            mapped[0] = { ...mapped[0]!, isDefault: true, isFallback: false };
        }

        const discoveredIds = new Set(mapped.map((model) => model.id));
        const nonTextFallbacks = fallbackModels
            .filter((model) => model.isActive && !discoveredIds.has(model.id))
            .map((model) => ({ ...model, provider: providerCatalog.provider, isDefault: false }));

        const hydratedModels = assignPriceTiers([...mapped, ...nonTextFallbacks]);
        liveModelCache.set(cacheKey, {
            expiresAt: Date.now() + LIVE_MODEL_CACHE_TTL_MS,
            models: hydratedModels,
        });

        return {
            ...providerCatalog,
            models: hydratedModels,
        };
    } catch {
        return { ...providerCatalog, models: fallbackModels };
    }
}
