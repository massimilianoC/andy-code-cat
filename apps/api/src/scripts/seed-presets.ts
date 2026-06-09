import { PRESET_CATALOG } from "../domain/entities/ProjectPreset";
import { MongoProjectPresetRepository } from "../infra/repositories/MongoProjectPresetRepository";

async function run() {
    const repository = new MongoProjectPresetRepository();
    const result = await repository.seedDefaults(PRESET_CATALOG);

    console.log(`Preset seed completed. upserted=${result.upserted}`);
}

run().catch((error) => {
    console.error("Preset seed failed", error);
    process.exit(1);
});
