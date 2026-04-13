import type { PlatformConfigRepository } from "../../../domain/repositories/PlatformConfigRepository";
import { DEFAULT_USER_LIMITS } from "../../../domain/entities/User";

export class GetPlatformConfig {
    constructor(private readonly configRepository: PlatformConfigRepository) {}

    async execute() {
        const config = await this.configRepository.get();
        // Return current state or defaults if singleton not yet created
        const effective = config ?? {
            id: "global",
            registrationOpen: true,
            emailVerificationRequired: false,
            defaultUserLimits: { ...DEFAULT_USER_LIMITS },
            updatedAt: new Date(),
        };
        return {
            registrationOpen: effective.registrationOpen,
            emailVerificationRequired: effective.emailVerificationRequired,
            defaultUserLimits: {
                ...effective.defaultUserLimits,
                planExpiresAt: effective.defaultUserLimits.planExpiresAt?.toISOString(),
            },
            updatedAt: effective.updatedAt.toISOString(),
            updatedByUserId: effective.updatedByUserId,
        };
    }
}
