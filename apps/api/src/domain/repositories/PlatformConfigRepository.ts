import type { PlatformConfig } from "../entities/PlatformConfig";
import type { ProductGovernanceConfig } from "../entities/PlatformConfig";
import type { PlatformCostRates } from "../entities/PlatformConfig";
import type { MediaProviderPolicy } from "../entities/PlatformConfig";
import type { UserLimits } from "../entities/User";

export interface UpdatePlatformConfigInput {
    registrationOpen?: boolean;
    emailVerificationRequired?: boolean;
    defaultUserLimits?: Partial<UserLimits>;
    governanceByProduct?: Record<string, Partial<{
        promptTemplates: Partial<ProductGovernanceConfig["promptTemplates"]>;
        promptTaskSettings: Partial<Record<string, Partial<NonNullable<ProductGovernanceConfig["promptTaskSettings"]>[string]>>>;
        injections: Partial<ProductGovernanceConfig["injections"]>;
        cookieBanner: Partial<NonNullable<ProductGovernanceConfig["cookieBanner"]>>;
        legal: Partial<NonNullable<ProductGovernanceConfig["legal"]>>;
        nginx: Partial<ProductGovernanceConfig["nginx"]>;
    }>>;
    updatedByUserId?: string;
    costRates?: Partial<Omit<PlatformCostRates, "updatedAt" | "updatedByUserId">> & { updatedByUserId?: string };
    mediaProviderPolicy?: Partial<{
        stockImage: Partial<MediaProviderPolicy["stockImage"]>;
    }>;
}

export interface PlatformConfigRepository {
    get(): Promise<PlatformConfig | null>;
    upsert(input: UpdatePlatformConfigInput): Promise<PlatformConfig>;
}
