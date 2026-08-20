import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";

/**
 * Pin-down of today's model-resolution cascades used by VibeClassify, VibePrefill, and
 * OptimizeUserPrompt. This module is a ZERO-INTENDED-BEHAVIOR-CHANGE refactor: it exists so
 * the three call sites stop each maintaining their own hand-copied cascade, and so later work
 * (a `PipelineRun` / `ModelSelectionDecision` aggregate) has a single, pure, testable place to
 * build on instead of three drifting inline copies.
 *
 * Two real cascade shapes exist today:
 *  - "vibe-cascade"       — VibeClassify.ts / VibePrefill.ts (byte-identical logic in both files).
 *  - "optimizer-cascade"  — OptimizeUserPrompt.ts (a differently-shaped cascade, including the
 *                            `apiType === "openai-compatible"` override gate).
 *
 * `resolveModelSelection` is a pure function: no I/O, no repository calls. Callers fetch the
 * catalog and platform config themselves and pass the already-resolved data in.
 */

export type ModelSelectionProfile = "vibe-cascade" | "optimizer-cascade";

export type ModelSelectionSource =
    | "request-override"
    | "task-setting"
    | "catalog-role-default"
    | "catalog-default"
    | "catalog-first"
    | "hardcoded-fallback";

export interface ModelSelectionDecision {
    requested: { provider?: string; model?: string };
    effective: { provider: string; model: string };
    providerSource: ModelSelectionSource;
    modelSource: ModelSelectionSource;
    honoredRequest: boolean;
    policy: "legacy" | "strict";
    blocked?: { code: string; reason: string };
    /**
     * The catalog entry that matched `effective.provider`, or `undefined` when no active
     * provider could be resolved at all (e.g. `activeProviders` is empty). Callers that today
     * short-circuit to a "no active provider" / "no active LLM provider" response must branch
     * on this being `undefined` — it mirrors the pre-refactor `if (!selectedProviderCatalog)`
     * guard in each of the three original call sites byte-for-byte.
     */
    providerCatalog?: LlmProviderCatalog;
}

export interface ResolveModelSelectionInput {
    /** Selects which real-world cascade shape to reproduce. See module doc above. */
    profile: ModelSelectionProfile;
    /** Already filtered to `isActive` providers, exactly as every call site pre-filters today. */
    activeProviders: LlmProviderCatalog[];
    requestedProvider?: string;
    requestedModel?: string;
    taskSettingProvider?: string;
    taskSettingModel?: string;
    /** env.LLM_DEFAULT_PROVIDER — only consulted by the "optimizer-cascade" profile today. */
    envDefaultProvider?: string;
    /** Hardcoded "siliconflow" constant — identical across all three call sites today. */
    fallbackProvider: string;
    /** Hardcoded "MiniMaxAI/MiniMax-M3" constant — identical across all three call sites today. */
    hardcodedFallbackModel: string;
    /**
     * true for Vibe classify/prefill: under "strict" policy, a requested provider/model
     * override that cannot be resolved against the active catalog blocks instead of falling
     * through. Has NO effect under "legacy" policy — today's behavior always falls through
     * silently to the next cascade step, exactly as the real `??` chains do.
     */
    requireOverrideInCatalog: boolean;
    /**
     * true only for the optimizer today: a requested model override is honored WITHOUT
     * verifying it is actually present/active on the resolved provider's model list, as long
     * as that provider's `apiType === "openai-compatible"`. This is a real, currently-latent
     * defect in the optimizer's cascade (see the KNOWN-DIVERGENCE comment in the
     * characterization tests) and is preserved here exactly as-is — fixing it is explicitly
     * out of scope for this PR.
     */
    gateOverrideOnOpenAiCompatible: boolean;
    /** Defaults to "legacy". No caller in this PR ever passes "strict" — that's for later work. */
    policy?: "legacy" | "strict";
}

const LMSTUDIO_PROVIDER = "lmstudio";

export function resolveModelSelection(input: ResolveModelSelectionInput): ModelSelectionDecision {
    const policy = input.policy ?? "legacy";
    return input.profile === "vibe-cascade"
        ? resolveVibeCascade(input, policy)
        : resolveOptimizerCascade(input, policy);
}

function blockedDecision(
    input: ResolveModelSelectionInput,
    policy: "strict",
    blocked: { code: string; reason: string },
): ModelSelectionDecision {
    return {
        requested: { provider: input.requestedProvider, model: input.requestedModel },
        effective: { provider: input.fallbackProvider, model: input.hardcodedFallbackModel },
        providerSource: "hardcoded-fallback",
        modelSource: "hardcoded-fallback",
        honoredRequest: false,
        policy,
        blocked,
    };
}

function noProviderDecision(input: ResolveModelSelectionInput, policy: "legacy" | "strict"): ModelSelectionDecision {
    return {
        requested: { provider: input.requestedProvider, model: input.requestedModel },
        effective: { provider: input.fallbackProvider, model: input.hardcodedFallbackModel },
        providerSource: "hardcoded-fallback",
        modelSource: "hardcoded-fallback",
        honoredRequest: false,
        policy,
        providerCatalog: undefined,
    };
}

/**
 * Mirrors VibeClassify.ts (~lines 190-216) and VibePrefill.ts (~lines 544-579) — the two files
 * carry byte-identical resolution logic today.
 */
function resolveVibeCascade(input: ResolveModelSelectionInput, policy: "legacy" | "strict"): ModelSelectionDecision {
    const {
        activeProviders,
        requestedProvider,
        requestedModel,
        taskSettingProvider,
        taskSettingModel,
        fallbackProvider,
        hardcodedFallbackModel,
    } = input;

    // ── Provider resolution ──
    // Real cascade:
    //   overrideProviderCatalog
    //     ?? activeProviders.find(p => p.provider === taskSettings.provider)
    //     ?? activeProviders.find(p => p.provider === FALLBACK_PROVIDER)
    //     ?? activeProviders.find(p => p.provider !== "lmstudio")
    //     ?? activeProviders[0]
    const overrideProviderCatalog = requestedProvider
        ? activeProviders.find((p) => p.provider === requestedProvider)
        : undefined;

    let providerCatalog: LlmProviderCatalog | undefined;
    let providerSource: ModelSelectionSource;
    let providerHonoredRequest = false;

    if (overrideProviderCatalog) {
        providerCatalog = overrideProviderCatalog;
        providerSource = "request-override";
        providerHonoredRequest = true;
    } else if (policy === "strict" && input.requireOverrideInCatalog && requestedProvider) {
        return blockedDecision(input, "strict", {
            code: "PROVIDER_NOT_IN_CATALOG",
            reason: `Requested provider "${requestedProvider}" is not active in the catalog.`,
        });
    } else {
        const taskCatalog = activeProviders.find((p) => p.provider === taskSettingProvider);
        const fallbackCatalog = activeProviders.find((p) => p.provider === fallbackProvider);
        const nonLmStudioCatalog = activeProviders.find((p) => p.provider !== LMSTUDIO_PROVIDER);
        providerCatalog = taskCatalog ?? fallbackCatalog ?? nonLmStudioCatalog ?? activeProviders[0];
        providerSource = taskCatalog
            ? "task-setting"
            : fallbackCatalog
                ? "catalog-default"
                // covers both "first non-lmstudio active provider" and the final activeProviders[0]
                : "catalog-first";
    }

    if (!providerCatalog) {
        return noProviderDecision(input, policy);
    }

    // ── Model resolution (within the resolved provider) ──
    // Real cascade:
    //   overrideModelId
    //     ?? providerCatalog.models.find(m => m.isActive && m.id === taskSettings.model)
    //     ?? providerCatalog.models.find(m => m.isActive && m.isDefault)
    //     ?? providerCatalog.models.find(m => m.isActive)
    //     ?? FALLBACK_MODEL
    const overrideModelId = requestedModel
        ? providerCatalog.models.find((m) => m.isActive && m.id === requestedModel)?.id
        : undefined;

    let modelId: string;
    let modelSource: ModelSelectionSource;
    let modelHonoredRequest = false;

    if (overrideModelId) {
        modelId = overrideModelId;
        modelSource = "request-override";
        modelHonoredRequest = true;
    } else if (policy === "strict" && input.requireOverrideInCatalog && requestedModel) {
        return blockedDecision(input, "strict", {
            code: "MODEL_NOT_IN_CATALOG",
            reason: `Requested model "${requestedModel}" is not active on provider "${providerCatalog.provider}".`,
        });
    } else {
        const taskModel = providerCatalog.models.find((m) => m.isActive && m.id === taskSettingModel);
        const defaultModel = providerCatalog.models.find((m) => m.isActive && m.isDefault);
        const firstActive = providerCatalog.models.find((m) => m.isActive);
        modelId = taskModel?.id ?? defaultModel?.id ?? firstActive?.id ?? hardcodedFallbackModel;
        modelSource = taskModel
            ? "task-setting"
            : defaultModel
                ? "catalog-default"
                : firstActive
                    ? "catalog-first"
                    : "hardcoded-fallback";
    }

    return {
        requested: { provider: requestedProvider, model: requestedModel },
        effective: { provider: providerCatalog.provider, model: modelId },
        providerSource,
        modelSource,
        honoredRequest: providerHonoredRequest || modelHonoredRequest,
        policy,
        providerCatalog,
    };
}

/**
 * Mirrors OptimizeUserPrompt.ts (~lines 414-437).
 */
function resolveOptimizerCascade(input: ResolveModelSelectionInput, policy: "legacy" | "strict"): ModelSelectionDecision {
    const {
        activeProviders,
        requestedProvider,
        requestedModel,
        taskSettingProvider,
        taskSettingModel,
        envDefaultProvider,
        fallbackProvider,
        hardcodedFallbackModel,
    } = input;

    // ── Provider resolution ──
    // Real cascade:
    //   activeProviders.find(p => p.provider === input.provider)
    //     ?? (requestedModel ? activeProviders.find(p => p.models.some(m => m.isActive && m.id === requestedModel)) : undefined)
    //     ?? activeProviders.find(p => p.provider === taskSettings.provider)
    //     ?? activeProviders.find(p => p.provider === env.LLM_DEFAULT_PROVIDER)
    //     ?? activeProviders.find(p => p.provider === FALLBACK_PROVIDER)
    //     ?? activeProviders[0]
    const directProviderMatch = requestedProvider
        ? activeProviders.find((p) => p.provider === requestedProvider)
        : undefined;
    const modelOwnerMatch = !directProviderMatch && requestedModel
        ? activeProviders.find((p) => p.models.some((m) => m.isActive && m.id === requestedModel))
        : undefined;
    const taskCatalog = activeProviders.find((p) => p.provider === taskSettingProvider);
    const envDefaultCatalog = activeProviders.find((p) => p.provider === envDefaultProvider);
    const fallbackCatalog = activeProviders.find((p) => p.provider === fallbackProvider);

    const providerCatalog =
        directProviderMatch ?? modelOwnerMatch ?? taskCatalog ?? envDefaultCatalog ?? fallbackCatalog ?? activeProviders[0];

    if (!providerCatalog) {
        return noProviderDecision(input, policy);
    }

    const providerSource: ModelSelectionSource = directProviderMatch
        ? "request-override"
        : modelOwnerMatch
            ? "request-override"
            : taskCatalog
                ? "task-setting"
                : envDefaultCatalog
                    ? "catalog-role-default"
                    : fallbackCatalog
                        ? "catalog-default"
                        : "catalog-first";
    const providerHonoredRequest = Boolean(directProviderMatch || modelOwnerMatch);

    // ── Model resolution ──
    // Real cascade:
    //   (requestedModel && providerCatalog.apiType === "openai-compatible" ? requestedModel : undefined)
    //     || (taskSettings.model && activeModels.some(m => m.id === taskSettings.model) ? taskSettings.model : undefined)
    //     || activeModels.find(m => m.role === "dialogue" && m.isDefault)?.id
    //     || activeModels.find(m => m.isDefault)?.id
    //     || activeModels[0]?.id
    //     || FALLBACK_MODEL
    //
    // KNOWN-DIVERGENCE (future work): the direct override branch below does NOT verify that
    // `requestedModel` is actually present/active on `providerCatalog.models` — it only checks
    // the provider's apiType. If a caller passes a provider+model pair where the provider
    // matches directly (step 1 above) but the model does not belong to that provider, today's
    // code (and this pure-function mirror of it) will still send that unverified model id
    // straight to the provider. This is preserved exactly, not fixed, in this PR.
    const activeModels = providerCatalog.models.filter((m) => m.isActive);
    const gateSatisfied = input.gateOverrideOnOpenAiCompatible
        ? providerCatalog.apiType === "openai-compatible"
        : Boolean(requestedModel);
    const gatedOverride = requestedModel && gateSatisfied ? requestedModel : undefined;

    let modelId: string;
    let modelSource: ModelSelectionSource;
    let modelHonoredRequest = false;

    if (gatedOverride) {
        modelId = gatedOverride;
        modelSource = "request-override";
        modelHonoredRequest = true;
    } else if (
        policy === "strict" &&
        requestedModel &&
        input.gateOverrideOnOpenAiCompatible &&
        providerCatalog.apiType !== "openai-compatible"
    ) {
        return blockedDecision(input, "strict", {
            code: "MODEL_OVERRIDE_NOT_OPENAI_COMPATIBLE",
            reason: `Requested model "${requestedModel}" cannot be honored: provider "${providerCatalog.provider}" apiType is "${providerCatalog.apiType ?? "unknown"}", not "openai-compatible".`,
        });
    } else {
        const taskModel = taskSettingModel && activeModels.some((m) => m.id === taskSettingModel) ? taskSettingModel : undefined;
        const dialogueDefault = activeModels.find((m) => m.role === "dialogue" && m.isDefault)?.id;
        const anyDefault = activeModels.find((m) => m.isDefault)?.id;
        const firstActive = activeModels[0]?.id;
        modelId = taskModel ?? dialogueDefault ?? anyDefault ?? firstActive ?? hardcodedFallbackModel;
        modelSource = taskModel
            ? "task-setting"
            : dialogueDefault
                ? "catalog-role-default"
                : anyDefault
                    ? "catalog-default"
                    : firstActive
                        ? "catalog-first"
                        : "hardcoded-fallback";
    }

    return {
        requested: { provider: requestedProvider, model: requestedModel },
        effective: { provider: providerCatalog.provider, model: modelId },
        providerSource,
        modelSource,
        honoredRequest: providerHonoredRequest || modelHonoredRequest,
        policy,
        providerCatalog,
    };
}
