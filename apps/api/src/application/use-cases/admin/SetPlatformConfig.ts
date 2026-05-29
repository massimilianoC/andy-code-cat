import { setPlatformConfigSchema } from "@andy-code-cat/contracts";
import type { PlatformConfigRepository } from "../../../domain/repositories/PlatformConfigRepository";
import { resolveMediaProviderPolicy } from "../../media/mediaProviderPolicy";

export class SetPlatformConfig {
    constructor(private readonly configRepository: PlatformConfigRepository) { }

    async execute(callerUserId: string, rawInput: unknown) {
        const input = setPlatformConfigSchema.parse(rawInput);
        const updated = await this.configRepository.upsert({
            ...input,
            updatedByUserId: callerUserId,
        });
        return {
            registrationOpen: updated.registrationOpen,
            emailVerificationRequired: updated.emailVerificationRequired,
            defaultUserLimits: {
                ...updated.defaultUserLimits,
                planExpiresAt: updated.defaultUserLimits.planExpiresAt?.toISOString(),
            },
            governanceByProduct: updated.governanceByProduct ?? {},
            mediaProviderPolicy: resolveMediaProviderPolicy(updated),
            updatedAt: updated.updatedAt.toISOString(),
            updatedByUserId: updated.updatedByUserId,
        };
    }
}
