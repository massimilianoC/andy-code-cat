import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";
import { getSiliconFlowPrice } from "./siliconflowPricing";
import { decorateSeedModel } from "./modelRegistryPresets";
import { dedupeModelsById } from "./catalogModels";

const LIVE_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Providers whose model list is volatile by nature: the operator loads and unloads models by
 * hand while working, so a five-minute cache would keep offering a model that is no longer in
 * memory — and dispatching to it fails. Always re-read these.
 */
const ALWAYS_FRESH_PROVIDERS = new Set(["lmstudio"]);

/**
 * A local endpoint either answers immediately or is not running. Waiting the platform default
 * for it would make every catalog read — including ones that never touch LM Studio — pay a TCP
 * timeout whenever the operator has it closed.
 */
const LOCAL_DISCOVERY_TIMEOUT_MS = 2_000;

/** Ceiling for a remote provider's model list — generous, but never unbounded. */
const DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * Skipping the cache for a volatile provider must not mean hammering a dead endpoint. When
 * discovery fails, remember that briefly: long enough to keep the next few requests fast, short
 * enough that starting LM Studio is reflected almost at once.
 */
const LOCAL_DISCOVERY_FAILURE_TTL_MS = 20_000;

const localDiscoveryFailures = new Map<string, number>();

async function fetchWithTimeout(url: string, timeoutMs: number, headers?: Record<string, string>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { method: "GET", headers, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * LM Studio's native endpoint, richer than the OpenAI-compatible `/models`: it reports which
 * models are actually resident in memory (`state: "loaded"`) along with context length and
 * capabilities. Only a loaded model answers a completion request promptly, so that distinction
 * is the difference between a working pick and a stalled one.
 */
interface LmStudioNativeModel {
    id?: string;
    type?: string;
    state?: string;
    max_context_length?: number;
    loaded_context_length?: number;
    capabilities?: string[];
}

async function fetchLmStudioNativeModels(baseUrl: string): Promise<LmStudioNativeModel[] | null> {
    // baseUrl ends in /v1 for the OpenAI-compatible surface; the native API is a sibling.
    const nativeUrl = `${baseUrl.replace(/\/$/, "").replace(/\/v1$/, "")}/api/v0/models`;
    try {
        const response = await fetchWithTimeout(nativeUrl, LOCAL_DISCOVERY_TIMEOUT_MS);
        if (!response.ok) return null;
        const payload = await response.json().catch(() => ({})) as { data?: LmStudioNativeModel[] };
        return Array.isArray(payload.data) ? payload.data : null;
    } catch {
        // Older LM Studio builds have no native API — the caller falls back to /v1/models.
        return null;
    }
}

type RuntimeModel = LlmProviderCatalog["models"][number];

const liveModelCache = new Map<string, { expiresAt: number; models: RuntimeModel[] }>();

export function clearLiveModelCatalogCache(): void {
    liveModelCache.clear();
    localDiscoveryFailures.clear();
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
    supported_parameters?: string[];
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
    options?: { forceRefresh?: boolean },
): Promise<LlmProviderCatalog> {
    const fallbackModels = dedupeModelsById(providerCatalog.models);
    // The CURATED list, before dedupeModelsById drops the deactivated entries. A model a
    // superadmin switched off in /admin/models only exists here — looking it up in
    // `fallbackModels` (as the discovery loop below used to) can never find it, which is exactly
    // why a deactivated model used to come back `isActive: true` the moment the provider still
    // listed it. Every openai-compatible provider is live-discovered, so that was every model.
    // It is now also the source of the activation state itself: what the operator decided is the
    // only thing that decides, and silence means off.
    const curatedById = new Map(providerCatalog.models.filter((model) => model.id).map((model) => [model.id, model]));

    if (providerCatalog.apiType !== "openai-compatible") {
        return { ...providerCatalog, models: fallbackModels };
    }

    const authHeader = buildAuthHeader(apiKey, providerCatalog.authType);
    const allowAnonymousDiscovery = providerCatalog.provider === "openrouter";
    if (!authHeader && providerCatalog.authType !== "none" && !allowAnonymousDiscovery) {
        return { ...providerCatalog, models: fallbackModels };
    }

    const alwaysFresh = ALWAYS_FRESH_PROVIDERS.has(providerCatalog.provider);
    const cacheKey = `${providerCatalog.provider}|${providerCatalog.baseUrl}|${Boolean(authHeader)}`;
    const cached = liveModelCache.get(cacheKey);
    if (!alwaysFresh && !options?.forceRefresh && cached && cached.expiresAt > Date.now()) {
        return { ...providerCatalog, models: cached.models };
    }

    if (alwaysFresh && !options?.forceRefresh) {
        const failedUntil = localDiscoveryFailures.get(cacheKey);
        if (failedUntil && failedUntil > Date.now()) {
            return { ...providerCatalog, models: fallbackModels };
        }
    }

    try {
        // LM Studio first: its native endpoint tells us which models are resident in memory,
        // which /v1/models does not. Falls through to the standard path when unavailable.
        const nativeModels = providerCatalog.provider === "lmstudio"
            ? await fetchLmStudioNativeModels(providerCatalog.baseUrl)
            : null;

        const response = nativeModels
            ? null
            : await fetchWithTimeout(
                `${providerCatalog.baseUrl.replace(/\/$/, "")}/models`,
                alwaysFresh ? LOCAL_DISCOVERY_TIMEOUT_MS : DISCOVERY_TIMEOUT_MS,
                authHeader ? { Authorization: authHeader } : undefined,
            );

        if (response && !response.ok) {
            return { ...providerCatalog, models: fallbackModels };
        }

        const rawModels: DiscoveredModel[] = nativeModels
            ? nativeModels.map((model) => ({
                id: model.id,
                architecture: { modality: model.type === "embeddings" ? "text->embedding" : "text->text" },
            }))
            : ((await response!.json().catch(() => ({})) as { data?: DiscoveredModel[] }).data ?? []);

        // Loaded models first, so the promoted default is one that can answer immediately.
        const loadedIds = new Set(
            (nativeModels ?? []).filter((model) => model.state === "loaded").map((model) => String(model.id ?? "").trim()),
        );
        if (loadedIds.size > 0) {
            rawModels.sort((left, right) =>
                Number(loadedIds.has(String(right.id ?? "").trim())) - Number(loadedIds.has(String(left.id ?? "").trim())));
        }

        if (rawModels.length === 0) {
            if (alwaysFresh) localDiscoveryFailures.set(cacheKey, Date.now() + LOCAL_DISCOVERY_FAILURE_TTL_MS);
            return { ...providerCatalog, models: fallbackModels };
        }

        const mapped = rawModels
            .filter((model) => shouldKeepDiscoveredModel(providerCatalog.provider, model))
            // An operator's explicit "off" outranks live discovery, but "off" is a state, not a
            // deletion: the model stays in the catalog carrying isActive: false. Dropping it here
            // (as this used to) meant a model switched off in /admin/models vanished from the
            // admin list too, so there was no way to switch it back on. Every consumer already
            // filters on isActive — catalogModels.ts, ResolvePipelineModelLock, the picker — so
            // carrying the inactive entry costs nothing and is what makes curation possible.
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

                return decorateSeedModel({
                    id,
                    provider: providerCatalog.provider,
                    role: inferRole({ existingRole: existing?.role, capabilities: existing?.capabilities?.length ? existing.capabilities : inferredCapabilities }),
                    capabilities: existing?.capabilities?.length ? existing.capabilities : inferredCapabilities,
                    // Only an active model can be the default. Before activation defaulted to
                    // off, "first discovered" was a reasonable stand-in for "the one to use";
                    // now it would nominate a model nobody has approved.
                    isDefault: curatedById.get(id)?.isDefault
                        ?? (curatedById.get(id)?.isActive === true
                            && index === 0
                            && !fallbackModels.some((candidate) => candidate.isDefault)),
                    isFallback: existing?.isFallback ?? index !== 0,
                    // A model the operator has never ruled on arrives OFF. The platform spends
                    // the account owner's money, so a provider adding two hundred models to its
                    // listing must not silently make two hundred models spendable. Read from
                    // curatedById, not from `existing`: `existing` comes from fallbackModels,
                    // which dedupeModelsById has already stripped of every inactive entry, so an
                    // explicit "off" would read back as undefined and flip to the default.
                    isActive: curatedById.get(id)?.isActive ?? false,
                    // The operator needs to see at a glance which local models are resident:
                    // picking an unloaded one means waiting for it to be pulled into memory,
                    // or a timeout. Suffixed rather than added as a new domain field to keep
                    // this out of the persisted schema — it is runtime state, not catalog data.
                    displayName: loadedIds.has(id)
                        ? `${existing?.displayName ?? id} · caricato`
                        : existing?.displayName,
                    description: existing?.description,
                    promptTemplate: existing?.promptTemplate,
                    focusPromptTemplate: existing?.focusPromptTemplate,
                    supportedParameters: model.supported_parameters ?? existing?.supportedParameters,
                    ...(priceInputUsdPerM !== undefined ? { priceInputUsdPerM } : {}),
                    ...(priceOutputUsdPerM !== undefined ? { priceOutputUsdPerM } : {}),
                });
            });

        if (mapped.length === 0) {
            return { ...providerCatalog, models: fallbackModels };
        }

        // At most one default per provider, and it must be a live-discovered model the operator
        // has actually activated: keep the first such default, strip isDefault from every other
        // entry. This prevents a stale seed default that is no longer in the provider's live
        // /models list from coexisting with a promoted one.
        let discoveredDefaultSeen = false;
        for (let index = 0; index < mapped.length; index += 1) {
            const model = mapped[index]!;
            if (model.isDefault && model.isActive && !discoveredDefaultSeen) {
                discoveredDefaultSeen = true;
            } else if (model.isDefault) {
                mapped[index] = { ...model, isDefault: false, isFallback: true };
            }
        }
        if (!discoveredDefaultSeen) {
            // Promote the first ACTIVE model, not simply the first. Promoting index 0 blindly —
            // which is what this did while everything arrived active — now nominates a model
            // nobody approved, and every role cascade in catalogModels.ts looks for
            // `isDefault && isActive`, so it would nominate it into a state no resolver accepts.
            // When the operator has activated nothing, this provider has no default, and that is
            // the honest answer rather than an invented one.
            const firstActive = mapped.findIndex((model) => model.isActive);
            if (firstActive >= 0) {
                mapped[firstActive] = { ...mapped[firstActive]!, isDefault: true, isFallback: false };
            }
        }

        const discoveredIds = new Set(mapped.map((model) => model.id));
        // For a volatile local provider the discovered list is the whole truth. Appending seeded
        // entries here is what kept the placeholder `local/default-chat` in the catalog long
        // after LM Studio stopped serving anything by that name — and every dispatch to it failed.
        // Stored models the provider did not list this time. They are kept so the operator can
        // still see and manage them — and so an id referenced by an existing build still resolves
        // to a real catalog row — but they are marked, because "the provider stopped offering
        // this" is a different fact from "the operator switched it off". The persisted flag is
        // written by ReconcileLlmCatalogAvailability; this is the read-time view of the same
        // thing, for the case where reconciliation has not run yet.
        const nonTextFallbacks = alwaysFresh
            ? []
            : providerCatalog.models
                .filter((model) => model.id && !discoveredIds.has(model.id))
                .map((model) => ({
                    ...model,
                    provider: providerCatalog.provider,
                    isDefault: false,
                    availability: "deprecated" as const,
                }));

        localDiscoveryFailures.delete(cacheKey);
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
        if (alwaysFresh) localDiscoveryFailures.set(cacheKey, Date.now() + LOCAL_DISCOVERY_FAILURE_TTL_MS);
        return { ...providerCatalog, models: fallbackModels };
    }
}
