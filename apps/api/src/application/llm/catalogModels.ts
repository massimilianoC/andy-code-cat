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
    /**
     * `undefined` is a legal outcome: the caller may still honour an unvalidated model override
     * on an openai-compatible provider, and otherwise fails with "no active model".
     */
    roleModel?: CatalogModel;
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

    if (!providerCatalog) {
        return { providerCatalog: undefined, providerModels: [], roleModel: undefined };
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

    return { providerCatalog, providerModels, roleModel };
}
