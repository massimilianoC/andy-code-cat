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
        const defaults = [
            buildDefaultSiliconFlowCatalog(this.siliconFlowBaseUrl),
            buildDefaultLmStudioCatalog(this.lmStudioBaseUrl),
            buildDefaultOpenRouterCatalog(this.openRouterBaseUrl, this.hasOpenRouterApiKey),
        ];
        const existingByProvider = new Map(
            (await this.repository.listAllProviders()).map((provider) => [provider.provider, provider]),
        );

        for (const catalog of defaults) {
            const existing = existingByProvider.get(catalog.provider);
            const existingModelsById = new Map((existing?.models ?? []).map((model) => [model.id, model]));
            const defaultIds = new Set(catalog.models.map((model) => model.id));

            // Seed supplies missing defaults and current endpoint metadata. An existing row is
            // an operator decision: never turn it on/off or replace its role, name, prompts or
            // default status merely because someone pressed "Sync seed → Mongo".
            const models = [
                ...catalog.models.map((model) => ({
                    ...model,
                    ...(existingModelsById.get(model.id) ?? {}),
                    provider: catalog.provider,
                })),
                // Keep manually added and provider-discovered models too. Removing one would
                // break stored model locks and make an operator's explicit activation vanish.
                ...(existing?.models ?? []).filter((model) => !defaultIds.has(model.id)),
            ];

            await this.repository.upsertProvider({
                provider: catalog.provider,
                baseUrl: catalog.baseUrl,
                apiType: catalog.apiType,
                authType: catalog.authType,
                isActive: existing?.isActive ?? catalog.isActive,
                models,
            });
        }

        return {
            providersUpserted: 3,
            modelsUpserted: defaults.reduce((total, catalog) => total + catalog.models.length, 0),
        };
    }
}
