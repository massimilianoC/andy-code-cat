import type { LlmCatalogRepository } from "../../domain/repositories/LlmCatalogRepository";
import type { GetEffectiveLlmCatalog } from "./GetEffectiveLlmCatalog";

export interface ReconcileLlmCatalogAvailabilityResult {
    checkedAt: string;
    providers: Array<{ provider: string; live: number; deprecated: number }>;
}

/**
 * Establish, against each provider, which stored models are still on offer.
 *
 * Providers retire models without warning. Until now a retired model simply stopped appearing:
 * for a locally discovered provider it vanished from the catalog outright, and for the others it
 * lingered as a stored row indistinguishable from a live one — so a dispatch to it failed with a
 * provider error rather than a comprehensible "this model is gone".
 *
 * Nothing is deleted. A model id is a foreign key in several places that outlive the catalog — a
 * PipelineRun's frozen model lock, the execution journal, the cost ledger, a published build's
 * provenance — and deleting the row would turn every one of those references into a string that
 * resolves to nothing. Marking it costs one field and keeps the history readable.
 *
 * Run at startup and whenever an operator refreshes the registry. Not on every read: this makes a
 * network call per provider, and the read path is on the critical path of every generation.
 */
export class ReconcileLlmCatalogAvailability {
    constructor(
        private readonly repository: LlmCatalogRepository,
        private readonly getEffectiveLlmCatalog: GetEffectiveLlmCatalog,
    ) { }

    async execute(): Promise<ReconcileLlmCatalogAvailabilityResult> {
        const checkedAt = new Date();
        const catalog = await this.getEffectiveLlmCatalog.execute({ forceRefresh: true });
        const providers: ReconcileLlmCatalogAvailabilityResult["providers"] = [];

        for (const provider of catalog.providers) {
            // Only what discovery actually returned counts as live. Rows the hydration carried
            // over from storage are exactly the ones under question, so they must not vote on
            // their own availability.
            const liveModelIds = provider.models
                .filter((model) => model.availability !== "deprecated")
                .map((model) => model.id)
                .filter((id) => id.length > 0);

            // A provider that is unreachable reports nothing, which would look identical to a
            // provider that retired its entire catalogue. Refusing to act on an empty result is
            // the difference between "we could not check" and "everything is gone".
            if (liveModelIds.length === 0) continue;

            const counts = await this.repository
                .markAvailability({ provider: provider.provider, liveModelIds, checkedAt })
                .catch(() => ({ live: 0, deprecated: 0 }));

            providers.push({ provider: provider.provider, ...counts });
        }

        return { checkedAt: checkedAt.toISOString(), providers };
    }
}
