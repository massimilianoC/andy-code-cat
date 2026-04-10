import type { PipelineModelRole } from "./LlmCatalog";

export type UserRole = "user" | "admin";

export interface UserLlmPreferences {
    defaultProvider: string;
    roleModelOverrides?: Partial<Record<PipelineModelRole, string>>;
}

export interface User {
    id: string;
    email: string;
    passwordHash: string;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    isBlocked: boolean;
    roles: UserRole[];
    llmPreferences?: UserLlmPreferences;
    createdAt: Date;
}
