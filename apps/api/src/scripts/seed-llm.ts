import { env } from "../config";
import { MongoLlmCatalogRepository } from "../infra/repositories/MongoLlmCatalogRepository";
import { SeedLlmCatalog } from "../application/use-cases/SeedLlmCatalog";

async function run() {
    const repository = new MongoLlmCatalogRepository();
    const useCase = new SeedLlmCatalog(repository, env.SILICONFLOW_BASE_URL, env.LMSTUDIO_BASE_URL, env.OPENROUTER_BASE_URL, env.hasOpenRouterApiKey);
    const result = await useCase.execute();

    console.log(
        `LLM seed completed. providersUpserted=${result.providersUpserted}, modelsUpserted=${result.modelsUpserted}`
    );
}

run().catch((error) => {
    console.error("LLM seed failed", error);
    process.exit(1);
});
