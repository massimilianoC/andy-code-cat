import type { PlatformConfig } from "../entities/PlatformConfig";
import type { ProductGovernanceConfig } from "../entities/PlatformConfig";
import type { UserLimits } from "../entities/User";

export interface UpdatePlatformConfigInput {
    registrationOpen?: boolean;
    emailVerificationRequired?: boolean;
    defaultUserLimits?: Partial<UserLimits>;
    governanceByProduct?: Record<string, Partial<{
        promptTemplates: Partial<ProductGovernanceConfig["promptTemplates"]>;
        injections: Partial<ProductGovernanceConfig["injections"]>;
        nginx: Partial<ProductGovernanceConfig["nginx"]>;
    }>>;
    updatedByUserId?: string;
}

export interface PlatformConfigRepository {
    get(): Promise<PlatformConfig | null>;
    upsert(input: UpdatePlatformConfigInput): Promise<PlatformConfig>;
}
