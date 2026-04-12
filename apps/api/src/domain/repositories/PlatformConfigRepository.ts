import type { PlatformConfig } from "../entities/PlatformConfig";
import type { UserLimits } from "../entities/User";

export interface UpdatePlatformConfigInput {
    registrationOpen?: boolean;
    emailVerificationRequired?: boolean;
    defaultUserLimits?: Partial<UserLimits>;
    updatedByUserId?: string;
}

export interface PlatformConfigRepository {
    get(): Promise<PlatformConfig | null>;
    upsert(input: UpdatePlatformConfigInput): Promise<PlatformConfig>;
}
