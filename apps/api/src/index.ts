import { createApp } from "./app";
import { env } from "./config";
import { getDb } from "./infra/db/mongo";
import { MongoLlmCatalogRepository } from "./infra/repositories/MongoLlmCatalogRepository";
import { SeedLlmCatalog } from "./application/use-cases/SeedLlmCatalog";
import { GetLlmCatalog } from "./application/use-cases/GetLlmCatalog";
import { GetEffectiveLlmCatalog } from "./application/use-cases/GetEffectiveLlmCatalog";
import { ReconcileLlmCatalogAvailability } from "./application/use-cases/ReconcileLlmCatalogAvailability";
import { MongoProjectAssetRepository } from "./infra/repositories/MongoProjectAssetRepository";
import { MongoExportRepository } from "./infra/repositories/MongoExportRepository";
import { MongoSiteDeploymentRepository } from "./infra/repositories/MongoSiteDeploymentRepository";

async function bootstrap() {
    await getDb();

    // Ensure MongoDB indexes for new collections
    await new MongoProjectAssetRepository().ensureIndexes();
    await new MongoExportRepository().ensureIndexes();
    await new MongoSiteDeploymentRepository().ensureIndexes();

    if (env.LLM_CATALOG_SOURCE === "mongo" && env.llmAutoSeedOnStartup) {
        const repository = new MongoLlmCatalogRepository();
        const seed = new SeedLlmCatalog(repository, env.SILICONFLOW_BASE_URL, env.LMSTUDIO_BASE_URL, env.OPENROUTER_BASE_URL, env.hasOpenRouterApiKey);
        await seed.execute();
    }

    const app = createApp();

    app.listen(env.API_PORT, () => {
        console.log(`API listening on port ${env.API_PORT}`);
        // After listening, not before: this makes one network call per provider and a slow or
        // unreachable one must not hold the API out of service. Failures are logged and dropped —
        // a stale availability flag is a cosmetic problem, an API that will not start is not.
        void reconcileCatalogAvailability();
    });
}

async function reconcileCatalogAvailability(): Promise<void> {
    // No LLM_CATALOG_SOURCE guard. That flag only labels the response: GetLlmCatalog uses Mongo
    // whenever a repository is supplied and it holds providers, which is how every route builds
    // it — this deployment runs LLM_CATALOG_SOURCE=env with a fully populated llm_providers
    // collection. Gating on the flag meant reconciliation silently never ran.
    try {
        const repository = new MongoLlmCatalogRepository();
        const getLlmCatalog = new GetLlmCatalog(
            "mongo",
            env.SILICONFLOW_BASE_URL,
            env.LMSTUDIO_BASE_URL,
            env.OPENROUTER_BASE_URL,
            repository,
            env.hasOpenRouterApiKey,
            env.providerApiKeys,
            env.LLM_DEFAULT_PROVIDER,
        );
        const result = await new ReconcileLlmCatalogAvailability(
            repository,
            new GetEffectiveLlmCatalog(getLlmCatalog),
        ).execute();
        for (const provider of result.providers) {
            // These count STORED rows, not what the provider offers. "0 still offered" on a
            // provider serving seven models means the seven were never stored — not that the
            // provider is empty. Saying so in the line itself, because the short version read as
            // the opposite and was reported as such once already.
            console.log(
                `[llm-catalog] ${provider.provider}: stored rows — ${provider.live} still offered, `
                + `${provider.deprecated} no longer offered (availability only — activation is the operator's)`,
            );
        }
    } catch (error) {
        console.warn("[llm-catalog] availability reconciliation skipped", error);
    }
}

bootstrap().catch((error) => {
    console.error("Cannot start API", error);
    process.exit(1);
});
