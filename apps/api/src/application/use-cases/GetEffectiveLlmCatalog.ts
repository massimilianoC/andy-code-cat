import type { GetLlmCatalog } from "./GetLlmCatalog";

export class GetEffectiveLlmCatalog {
    constructor(
        private readonly getLlmCatalog: GetLlmCatalog,
    ) { }

    async execute() {
        return this.getLlmCatalog.execute();
    }
}