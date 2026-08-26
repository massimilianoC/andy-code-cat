import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";
import type { LlmCatalogRepository } from "../../domain/repositories/LlmCatalogRepository";
import { buildDefaultSiliconFlowCatalog } from "../llm/defaultSiliconFlowCatalog";
import { buildDefaultLmStudioCatalog } from "../llm/defaultLmStudioCatalog";
import { buildDefaultOpenRouterCatalog } from "../llm/defaultOpenRouterCatalog";
import { hydrateProviderCatalog } from "../llm/liveProviderCatalog";

export class GetLlmCatalog {
    constructor(
        private readonly source: "env" | "mongo",
        private readonly siliconFlowBaseUrl: string,
        private readonly lmStudioBaseUrl: string,
        private readonly openRouterBaseUrl: string,
        private readonly repository?: LlmCatalogRepository,
        private readonly hasOpenRouterApiKey: boolean = false,
        private readonly providerApiKeys: Record<string, string | undefined> = {},
        private readonly defaultProvider: string = "siliconflow",
    ) { }

    async execute(options?: { forceRefresh?: boolean }): Promise<{ source: "env" | "mongo"; providers: LlmProviderCatalog[]; activeProvider: string }> {
        const fallbackProviders = [
            buildDefaultSiliconFlowCatalog(this.siliconFlowBaseUrl),
            buildDefaultLmStudioCatalog(this.lmStudioBaseUrl),
            buildDefaultOpenRouterCatalog(this.openRouterBaseUrl, this.hasOpenRouterApiKey),
        ];

        const baseCatalog = await (async () => {
            if (!this.repository) {
                return {
                    source: "env" as const,
                    providers: fallbackProviders,
                };
            }

            const mongoProviders = await this.repository.listActiveProviders().catch(() => []);
            if (mongoProviders.length > 0) {
                return {
                    source: "mongo" as const,
                    // A local provider's address is deployment configuration, not catalog
                    // content. The persisted record here held a LAN IP that the API container
                    // could not reach (the machine had moved behind Docker), so every discovery
                    // and every dispatch to LM Studio timed out — invisibly, because the catalog
                    // then served the seeded placeholder model as if it were real. The
                    // configured URL is the one the runtime can actually reach, so it wins.
                    providers: mongoProviders.map((provider) => (
                        provider.provider === "lmstudio" && this.lmStudioBaseUrl
                            ? { ...provider, baseUrl: this.lmStudioBaseUrl }
                            : provider
                    )),
                };
            }

            return {
                source: "env" as const,
                providers: fallbackProviders,
            };
        })();

        const providers = await Promise.all(
            baseCatalog.providers.map((provider) => hydrateProviderCatalog(
                provider,
                this.providerApiKeys[provider.provider],
                { forceRefresh: options?.forceRefresh },
            )),
        );

        const activeProvider =
            providers.find((provider) => provider.models.some((model) => model.isDefault && model.role === "dialogue"))?.provider
            ?? providers.find((provider) => provider.models.some((model) => model.isDefault))?.provider
            ?? this.defaultProvider;

        return {
            ...baseCatalog,
            providers,
            activeProvider,
        };
    }
}
