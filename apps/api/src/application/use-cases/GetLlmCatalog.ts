import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";
import type { LlmCatalogRepository } from "../../domain/repositories/LlmCatalogRepository";
import { buildDefaultSiliconFlowCatalog } from "../llm/defaultSiliconFlowCatalog";
import { buildDefaultLmStudioCatalog } from "../llm/defaultLmStudioCatalog";
import { buildDefaultOpenRouterCatalog } from "../llm/defaultOpenRouterCatalog";

export class GetLlmCatalog {
    constructor(
        private readonly source: "env" | "mongo",
        private readonly siliconFlowBaseUrl: string,
        private readonly lmStudioBaseUrl: string,
        private readonly openRouterBaseUrl: string,
        private readonly repository?: LlmCatalogRepository,
        private readonly hasOpenRouterApiKey: boolean = false
    ) { }

    async execute(): Promise<{ source: "env" | "mongo"; providers: LlmProviderCatalog[] }> {
        if (this.source === "env") {
            return {
                source: "env",
                providers: [
                    buildDefaultSiliconFlowCatalog(this.siliconFlowBaseUrl),
                    buildDefaultLmStudioCatalog(this.lmStudioBaseUrl),
                    buildDefaultOpenRouterCatalog(this.openRouterBaseUrl, this.hasOpenRouterApiKey),
                ]
            };
        }

        if (!this.repository) {
            throw new Error("LLM catalog repository is required when source is mongo");
        }

        const providers = await this.repository.listActiveProviders();
        return {
            source: "mongo",
            providers
        };
    }
}
