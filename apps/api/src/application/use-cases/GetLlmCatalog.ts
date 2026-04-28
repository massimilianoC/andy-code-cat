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
        const fallbackProviders = [
            buildDefaultSiliconFlowCatalog(this.siliconFlowBaseUrl),
            buildDefaultLmStudioCatalog(this.lmStudioBaseUrl),
            buildDefaultOpenRouterCatalog(this.openRouterBaseUrl, this.hasOpenRouterApiKey),
        ];

        if (!this.repository) {
            return {
                source: "env",
                providers: fallbackProviders,
            };
        }

        const mongoProviders = await this.repository.listActiveProviders().catch(() => []);
        if (mongoProviders.length > 0) {
            return {
                source: "mongo",
                providers: mongoProviders,
            };
        }

        return {
            source: "env",
            providers: fallbackProviders,
        };
    }
}
