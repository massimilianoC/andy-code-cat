import { PRESET_CATALOG } from "../domain/entities/ProjectPreset";
import { closeDb } from "../infra/db/mongo";
import { MongoProjectPresetRepository } from "../infra/repositories/MongoProjectPresetRepository";

async function run() {
    const repository = new MongoProjectPresetRepository();
    const result = await repository.seedDefaults(PRESET_CATALOG);

    console.log(`Preset seed completed. upserted=${result.upserted}`);
}

run()
    .then(async () => {
        await closeDb();
    })
    .catch(async (error) => {
        console.error("Preset seed failed", error);
        await closeDb().catch(() => undefined);
        process.exit(1);
    });
