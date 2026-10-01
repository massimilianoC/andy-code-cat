/**
 * Shared catalog-model helpers.
 *
 * Before this module, `dedupeModelsById` existed as three byte-equivalent private copies
 * (`liveProviderCatalog.ts`, `ResolvePromptExecution.ts`, `didacticRoutes.ts`) and the composer's
 * provider/model cascade was hand-inlined inside `ResolvePromptExecution` even though
 * `modelSelection.ts` had already been created (I1) to be the single home for model-resolution
 * rules. Four of the seven live resolution call sites had adopted `resolveModelSelection()`; the
 * one serving 100% of generation traffic had not.
 *
 * The cascade reproduced here is a THIRD real shape, distinct from `modelSelection.ts`'s
 * "vibe-cascade" and "optimizer-cascade" — it is capability- and role-aware, and it may legally
 * resolve NO model at all (the caller then either trusts an unvalidated openai-compatible
 * override or fails). That last property is why it cannot be folded into
 * `ModelSelectionDecision`, whose `effective.model` is a required string: forcing it would have
 * to invent a hardcoded fallback the composer has never had.
 *
 * ZERO-INTENDED-BEHAVIOUR-CHANGE: this is an extraction, not a redesign. The characterization
 * tests in `__tests__/catalogModels.test.ts` pin the cascade's exact tie-breaks, and I10's
 * golden-payload snapshot (`llmPromptPreview.e2e.test.ts`) guards the composed output end to end.
 */

import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";

type CatalogModel = LlmProviderCatalog["models"][number];

/**
 * Drops inactive and id-less models and collapses duplicate ids, preferring the `isDefault`
 * entry when the same id appears more than once. First occurrence wins otherwise.
 */
export function dedupeModelsById<M extends { id: string; isActive?: boolean; isDefault?: boolean }>(
    models: readonly M[],
): M[] {
    const byId = new Map<string, M>();

    for (const model of models) {
        if (!model.isActive || !model.id) continue;

        const previous = byId.get(model.id);
        if (!previous) {
            byId.set(model.id, model);
            continue;
        }

        if (model.isDefault && !previous.isDefault) {
            byId.set(model.id, model);
        }
    }

    return [...byId.values()];
}

export interface ResolveComposerCascadeInput {
    /** The full hydrated catalog, NOT pre-filtered: the requested-provider branch filters on `isActive` itself. */
    providers: readonly LlmProviderCatalog[];
    requestedProvider?: string;
    requestedModel?: string;
    capability?: string;
    pipelineRole?: string;
    /** `env.LLM_DEFAULT_PROVIDER`. */
    envDefaultProvider: string;
}

export interface ComposerCascadeResult {
    /** `undefined` only when the catalog carries no providers at all. */
    providerCatalog?: LlmProviderCatalog;
    /** Deduped active models of the resolved provider; empty when no provider resolved. */
    providerModels: CatalogModel[];
    /** `undefined` when the catalog offers no active model at all for this provider. */
    roleModel?: CatalogModel;
    /**
     * A specific model was asked for and the catalog does not offer it as active.
     *
     * Reported rather than absorbed. The cascade below would otherwise fall through to a default
     * and answer with a model nobody asked for — the request would succeed, the cost record would
     * name a different model than the caller chose, and nothing would say so. Whether that is an
     * error or a silent substitution is the caller's decision to make explicitly.
     */
    requestedModelUnavailable: boolean;
    /** Same, for the provider: it was named, and it is not an active provider. */
    requestedProviderUnavailable: boolean;
}

/**
 * The composer cascade, verbatim:
 *
 *   provider: requested (must be active) ?? env default ?? providers[0]
 *   model:    explicit (must be in the deduped list)
 *             ?? capability + isDefault
 *             ?? pipelineRole + isDefault
 *             ?? pipelineRole + isFallback
 *             ?? dialogue + isDefault
 *             ?? first active
 */
export function resolveComposerCascade(input: ResolveComposerCascadeInput): ComposerCascadeResult {
    const providerCatalog =
        (input.requestedProvider
            ? input.providers.find((p) => p.provider === input.requestedProvider && p.isActive)
            : undefined) ??
        input.providers.find((p) => p.provider === input.envDefaultProvider) ??
        input.providers[0];

    const requestedProviderUnavailable = Boolean(input.requestedProvider)
        && !input.providers.some((p) => p.provider === input.requestedProvider && p.isActive);

    if (!providerCatalog) {
        return {
            providerCatalog: undefined,
            providerModels: [],
            roleModel: undefined,
            requestedModelUnavailable: Boolean(input.requestedModel),
            requestedProviderUnavailable,
        };
    }

    const providerModels = dedupeModelsById(providerCatalog.models);

    const explicitModel = input.requestedModel
        ? providerModels.find((model) => model.id === input.requestedModel)
        : undefined;

    const roleModel =
        explicitModel ??
        (input.capability
            ? providerModels.find((m) => m.capabilities.includes(input.capability!) && m.isDefault && m.isActive)
            : undefined) ??
        providerModels.find((m) => m.role === input.pipelineRole && m.isDefault && m.isActive) ??
        providerModels.find((m) => m.role === input.pipelineRole && m.isFallback && m.isActive) ??
        providerModels.find((m) => m.role === "dialogue" && m.isDefault && m.isActive) ??
        providerModels.find((m) => m.isActive);

    return {
        providerCatalog,
        providerModels,
        roleModel,
        // providerModels is the deduped ACTIVE list, so "asked for it and did not find it" covers
        // both an id that does not exist and one an operator has switched off. The catalog in
        // Mongo is the source of truth for what may be spent on; a value the caller supplies is
        // a request, not an authority.
        requestedModelUnavailable: Boolean(input.requestedModel) && !explicitModel,
        requestedProviderUnavailable,
    };
}

/** Providers that run on the operator's own machine and are unreachable from a hosted deploy. */
const LOCAL_PROVIDERS = new Set(["lmstudio"]);

export interface PlatformDefaultModel {
    provider: string;
    model: string;
}

/**
 * The model a user gets when they have not chosen one: what the pickers pre-select and what a
 * run started without a choice is locked to.
 *
 * It is the catalog's own `dialogue` default — the operator sets it in /admin/models — taken from
 * the configured default provider (`LLM_DEFAULT_PROVIDER`) first, then from any remote provider,
 * and from a local one only when nothing else offers a default.
 *
 * The provider order used to be whatever the catalog happened to list. Mongo lists providers
 * alphabetically, so `lmstudio` always came first, and its seeded placeholder
 * `local/default-chat` became every user's default on the hosted deploy, where no LM Studio is
 * reachable: a user who did not pick a model got no result at all.
 */
export function resolvePlatformDefault(
    providers: readonly LlmProviderCatalog[],
    preferredProvider?: string,
): PlatformDefaultModel | undefined {
    const active = providers.filter((provider) => provider.isActive);
    const ranked = [
        ...active.filter((provider) => provider.provider === preferredProvider),
        ...active.filter((provider) => provider.provider !== preferredProvider && !LOCAL_PROVIDERS.has(provider.provider)),
        ...active.filter((provider) => provider.provider !== preferredProvider && LOCAL_PROVIDERS.has(provider.provider)),
    ];
    const isDialogueDefault = (model: CatalogModel) => model.isActive && model.isDefault && model.role === "dialogue";
    const isAnyDefault = (model: CatalogModel) => model.isActive && model.isDefault;

    for (const matches of [isDialogueDefault, isAnyDefault]) {
        for (const provider of ranked) {
            const model = provider.models.find(matches);
            if (model) return { provider: provider.provider, model: model.id };
        }
    }
    return undefined;
}
