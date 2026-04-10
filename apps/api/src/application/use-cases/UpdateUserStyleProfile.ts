import { updateUserStyleProfileSchema } from "@andy-code-cat/contracts";
import type { UserStyleProfile } from "../../domain/entities/UserStyleProfile";
import type { UserStyleProfileRepository } from "../../domain/repositories/UserStyleProfileRepository";
import { VALID_TAG_IDS, MAX_TAGS_PER_CATEGORY } from "../../domain/entities/StyleTag";

export class UpdateUserStyleProfile {
    constructor(private readonly profileRepo: UserStyleProfileRepository) { }

    async execute(userId: string, rawInput: unknown): Promise<UserStyleProfile> {
        const input = updateUserStyleProfileSchema.parse(rawInput);

        // Validate tag IDs (only check non-empty arrays)
        const tagFields = [
            input.identityTags,
            input.sectorTags,
            input.audienceTags,
            input.visualTags,
            input.paletteTags,
            input.typographyTags,
            input.layoutTags,
            input.toneTags,
            input.referenceTags,
            input.featureTags,
        ].filter((arr): arr is string[] => Array.isArray(arr));

        for (const arr of tagFields) {
            if (arr.length > MAX_TAGS_PER_CATEGORY) {
                throw Object.assign(new Error(`Maximum ${MAX_TAGS_PER_CATEGORY} tags per category`), { statusCode: 400 });
            }
            for (const id of arr) {
                if (!VALID_TAG_IDS.has(id)) {
                    throw Object.assign(new Error(`Unknown tag id: ${id}`), { statusCode: 400 });
                }
            }
        }

        return this.profileRepo.upsert(userId, input);
    }
}
