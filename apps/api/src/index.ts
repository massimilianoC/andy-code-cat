import { createApp } from "./app";
import { env } from "./config";
import { getDb } from "./infra/db/mongo";
import { MongoLlmCatalogRepository } from "./infra/repositories/MongoLlmCatalogRepository";
import { SeedLlmCatalog } from "./application/use-cases/SeedLlmCatalog";
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
    });
}

bootstrap().catch((error) => {
    console.error("Cannot start API", error);
    process.exit(1);
});
