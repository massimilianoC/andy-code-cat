import type { PipelineModelRole } from "./LlmCatalog";

export type UserRole = "user" | "admin" | "superadmin";

export type UserPlan = "free" | "pro" | "enterprise" | "unlimited";

export interface UserLimits {
    maxProjects: number;          // -1 = unlimited
    maxMonthlyTokensK: number;    // monthly LLM tokens in thousands; -1 = unlimited
    maxStorageMb: number;         // asset storage cap in MB; -1 = unlimited
    maxPublishedSites: number;    // concurrent live deployments; -1 = unlimited
    plan: UserPlan;
    planExpiresAt?: Date;
}

export const DEFAULT_USER_LIMITS: UserLimits = {
    maxProjects: -1,
    maxMonthlyTokensK: -1,
    maxStorageMb: -1,
    maxPublishedSites: -1,
    plan: "unlimited",
};

export interface UserLlmPreferences {
    defaultProvider: string;
    roleModelOverrides?: Partial<Record<PipelineModelRole, string>>;
}

export interface User {
    id: string;
    email: string;
    passwordHash: string;
    passwordPolicyVersion?: number;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    isBlocked: boolean;
    roles: UserRole[];
    limits?: UserLimits;
    llmPreferences?: UserLlmPreferences;
    /** Lifetime total tokens consumed via LLM calls (integer, accumulated). */
    tokensConsumedLifetime?: number;
    createdAt: Date;
}
