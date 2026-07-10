import type { GetLlmCatalog } from "./GetLlmCatalog";

export class GetEffectiveLlmCatalog {
    constructor(
        private readonly getLlmCatalog: GetLlmCatalog,
    ) { }

    async execute(options?: { forceRefresh?: boolean }) {
        return this.getLlmCatalog.execute(options);
    }
}
