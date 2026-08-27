import type { LlmCatalogRepository } from "../../domain/repositories/LlmCatalogRepository";
import type { GetEffectiveLlmCatalog } from "./GetEffectiveLlmCatalog";

export interface SetLlmModelsActiveResult {
    provider: string;
    isActive: boolean;
    /** Ids that were found in the effective catalog and persisted with the new state. */
    applied: string[];
    /** Ids the provider does not offer and that are not stored either. Reported, not guessed at. */
    unknown: string[];
    /**
     * Ids skipped because the provider no longer offers them. Activating one would put a model
     * back on the menu that cannot be served — reconciliation would switch it off again on the
     * next restart anyway, so the refusal is immediate and explained rather than delayed and
     * mysterious. If the provider re-lists it, reconciliation marks it live and it becomes
     * activatable again with no further action.
     */
    deprecated: string[];
}

/**
 * Turn a set of models on or off, as one decision.
 *
 * The unit is a batch because the operator's unit is a batch: "activate everything from this
 * author", "turn this whole provider off". Sending one request per model would make a single
 * intent arrive as two hundred independent writes that can half-fail, leaving a catalog nobody
 * chose. Here the ids are resolved together, written together, and reported together.
 *
 * Ids are resolved against the EFFECTIVE catalog — stored plus live-discovered — because that is
 * what the operator is looking at when they decide. Most of the catalog exists only in discovery
 * until someone rules on it; the repository materialises those rows so the ruling survives a
 * restart.
 */
export class SetLlmModelsActive {
    constructor(
        private readonly repository: LlmCatalogRepository,
        private readonly getEffectiveLlmCatalog: GetEffectiveLlmCatalog,
    ) { }

    async execute(input: {
        provider: string;
        modelIds: string[];
        isActive: boolean;
    }): Promise<SetLlmModelsActiveResult> {
        const requested = [...new Set(input.modelIds.filter((id) => id.trim().length > 0))];
        if (requested.length === 0) {
            return { provider: input.provider, isActive: input.isActive, applied: [], unknown: [], deprecated: [] };
        }

        const catalog = await this.getEffectiveLlmCatalog.execute();
        const providerCatalog = catalog.providers.find((entry) => entry.provider === input.provider);
        if (!providerCatalog) {
            const err = new Error(`Unknown provider "${input.provider}"`);
            (err as Error & { statusCode: number }).statusCode = 404;
            throw err;
        }

        const byId = new Map(providerCatalog.models.map((model) => [model.id, model]));
        const unknown = requested.filter((id) => !byId.has(id));

        // A model the provider dropped can always be switched OFF — that is how a group
        // deactivation tidies up — but never switched back ON.
        const deprecated = input.isActive
            ? requested.filter((id) => byId.get(id)?.availability === "deprecated")
            : [];
        const skip = new Set([...unknown, ...deprecated]);

        const models = requested
            .filter((id) => !skip.has(id))
            .map((id) => byId.get(id))
            .filter((model) => model !== undefined);
        const applied = models.map((model) => model.id);

        if (models.length > 0) {
            await this.repository.setModelsActive({
                provider: input.provider,
                models,
                isActive: input.isActive,
            });
        }

        return { provider: input.provider, isActive: input.isActive, applied, unknown, deprecated };
    }
}
