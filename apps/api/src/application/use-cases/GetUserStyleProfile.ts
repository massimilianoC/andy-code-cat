import type { UserStyleProfile } from "../../domain/entities/UserStyleProfile";
import type { UserStyleProfileRepository } from "../../domain/repositories/UserStyleProfileRepository";

export class GetUserStyleProfile {
    constructor(private readonly profileRepo: UserStyleProfileRepository) { }

    async execute(userId: string): Promise<UserStyleProfile> {
        const existing = await this.profileRepo.findByUserId(userId);
        if (existing) return existing;
        // Auto-create empty profile on first access
        return this.profileRepo.initForUser({
            userId,
            onboardingCompleted: false,
            onboardingStep: 0,
            identityTags: [],
            sectorTags: [],
            audienceTags: [],
            visualTags: [],
            paletteTags: [],
            typographyTags: [],
            layoutTags: [],
            toneTags: [],
            referenceTags: [],
            featureTags: [],
        });
    }
}
