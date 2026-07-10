import { env } from "../config";
import { closeDb } from "../infra/db/mongo";
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

run()
    .then(async () => {
        await closeDb();
    })
    .catch(async (error) => {
        console.error("LLM seed failed", error);
        await closeDb().catch(() => undefined);
        process.exit(1);
    });
