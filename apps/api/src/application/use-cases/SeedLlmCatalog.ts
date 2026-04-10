import type { LlmCatalogRepository } from "../../domain/repositories/LlmCatalogRepository";
import { buildDefaultSiliconFlowCatalog } from "../llm/defaultSiliconFlowCatalog";
import { buildDefaultLmStudioCatalog } from "../llm/defaultLmStudioCatalog";
import { buildDefaultOpenRouterCatalog } from "../llm/defaultOpenRouterCatalog";

export class SeedLlmCatalog {
    constructor(
        private readonly repository: LlmCatalogRepository,
        private readonly siliconFlowBaseUrl: string,
        private readonly lmStudioBaseUrl: string,
        private readonly openRouterBaseUrl: string,
        private readonly hasOpenRouterApiKey: boolean = false
    ) { }

    async execute(): Promise<{ providersUpserted: number; modelsUpserted: number }> {
        const siliconFlowCatalog = buildDefaultSiliconFlowCatalog(this.siliconFlowBaseUrl);
        const lmStudioCatalog = buildDefaultLmStudioCatalog(this.lmStudioBaseUrl);
        const openRouterCatalog = buildDefaultOpenRouterCatalog(this.openRouterBaseUrl, this.hasOpenRouterApiKey);

        await this.repository.upsertProvider({
            provider: siliconFlowCatalog.provider,
            baseUrl: siliconFlowCatalog.baseUrl,
            apiType: siliconFlowCatalog.apiType,
            authType: siliconFlowCatalog.authType,
            isActive: siliconFlowCatalog.isActive,
            models: siliconFlowCatalog.models
        });

        await this.repository.upsertProvider({
            provider: lmStudioCatalog.provider,
            baseUrl: lmStudioCatalog.baseUrl,
            apiType: lmStudioCatalog.apiType,
            authType: lmStudioCatalog.authType,
            isActive: lmStudioCatalog.isActive,
            models: lmStudioCatalog.models
        });

        await this.repository.upsertProvider({
            provider: openRouterCatalog.provider,
            baseUrl: openRouterCatalog.baseUrl,
            apiType: openRouterCatalog.apiType,
            authType: openRouterCatalog.authType,
            isActive: openRouterCatalog.isActive,
            models: openRouterCatalog.models
        });

        return {
            providersUpserted: 3,
            modelsUpserted: siliconFlowCatalog.models.length + lmStudioCatalog.models.length + openRouterCatalog.models.length
        };
    }
}
