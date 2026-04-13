import { z } from "zod";

// ── Plan & limits ─────────────────────────────────────────────────────────────

export const userPlanSchema = z.enum(["free", "pro", "enterprise", "unlimited"]);
export type UserPlan = z.infer<typeof userPlanSchema>;

export const userLimitsSchema = z.object({
    maxProjects: z.number().int().min(-1).default(-1),
    maxMonthlyTokensK: z.number().int().min(-1).default(-1),
    maxStorageMb: z.number().int().min(-1).default(-1),
    maxPublishedSites: z.number().int().min(-1).default(-1),
    plan: userPlanSchema.default("unlimited"),
    planExpiresAt: z.coerce.date().optional(),
});
export type UserLimitsInput = z.infer<typeof userLimitsSchema>;

export const setUserLimitsSchema = userLimitsSchema.partial();
export type SetUserLimitsInput = z.infer<typeof setUserLimitsSchema>;

// ── Platform config ───────────────────────────────────────────────────────────

export const setPlatformConfigSchema = z.object({
    registrationOpen: z.boolean().optional(),
    emailVerificationRequired: z.boolean().optional(),
    defaultUserLimits: setUserLimitsSchema.optional(),
    governanceByProduct: z.record(z.string().min(1), z.object({
        promptTemplates: z.object({
            generationSystem: z.string().max(20000).default(""),
            focusedEditSystem: z.string().max(20000).default(""),
            reviewSystem: z.string().max(20000).default(""),
        }).partial().optional(),
        injections: z.object({
            headHtml: z.string().max(40000).default(""),
            headerHtml: z.string().max(40000).default(""),
            footerHtml: z.string().max(40000).default(""),
            scriptInHead: z.string().max(40000).default(""),
            scriptBeforeBodyClose: z.string().max(40000).default(""),
            googleTagManagerId: z.string().max(128).default(""),
            googleAnalyticsId: z.string().max(128).default(""),
            matomoSiteId: z.string().max(128).default(""),
            matomoUrl: z.string().max(2048).default(""),
        }).partial().optional(),
        nginx: z.object({
            publicDomain: z.string().max(255).default(""),
            publishSubdomainPattern: z.string().max(255).default("{publishId}"),
            cacheTtlSeconds: z.number().int().min(0).max(86400).default(300),
            clientMaxBodySizeMb: z.number().int().min(1).max(1024).default(20),
            extraServerDirectives: z.string().max(40000).default(""),
        }).partial().optional(),
    }).default({}).optional()).optional(),
});
export type SetPlatformConfigInput = z.infer<typeof setPlatformConfigSchema>;

// ── User management ───────────────────────────────────────────────────────────

export const adminUserRoleSchema = z.enum(["user", "admin", "superadmin"]);

export const adminCreateUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    roles: z.array(adminUserRoleSchema).min(1).default(["user"]),
    emailVerified: z.boolean().default(true),
    limits: userLimitsSchema.optional(),
});
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

export const setUserRolesSchema = z.object({
    roles: z.array(adminUserRoleSchema).min(1),
});
export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;

export const blockUserSchema = z.object({
    blocked: z.boolean(),
});
export type BlockUserInput = z.infer<typeof blockUserSchema>;

export const listUsersQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    role: adminUserRoleSchema.optional(),
    isBlocked: z.enum(["true", "false"]).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

// ── Publication control ───────────────────────────────────────────────────────

export const adminBlockDeploymentSchema = z.object({
    blocked: z.boolean(),
});
export type AdminBlockDeploymentInput = z.infer<typeof adminBlockDeploymentSchema>;

export const adminSetSlugSchema = z.object({
    customSlug: z.string()
        .min(2)
        .max(63)
        .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers and hyphens allowed")
        .nullable(),
});
export type AdminSetSlugInput = z.infer<typeof adminSetSlugSchema>;

// ── DTOs returned by admin endpoints ─────────────────────────────────────────

export interface AdminUserDto {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    isBlocked: boolean;
    roles: string[];
    limits?: {
        maxProjects: number;
        maxMonthlyTokensK: number;
        maxStorageMb: number;
        maxPublishedSites: number;
        plan: string;
        planExpiresAt?: string;
    };
    createdAt: string;
}

export interface PlatformStatsDto {
    totalUsers: number;
    blockedUsers: number;
    totalProjects: number;
    totalLiveDeployments: number;
    usersByRole: Record<string, number>;
}

export interface PlatformConfigDto {
    registrationOpen: boolean;
    emailVerificationRequired: boolean;
    defaultUserLimits: {
        maxProjects: number;
        maxMonthlyTokensK: number;
        maxStorageMb: number;
        maxPublishedSites: number;
        plan: string;
        planExpiresAt?: string;
    };
    governanceByProduct?: Record<string, {
        promptTemplates: {
            generationSystem: string;
            focusedEditSystem: string;
            reviewSystem: string;
        };
        injections: {
            headHtml: string;
            headerHtml: string;
            footerHtml: string;
            scriptInHead: string;
            scriptBeforeBodyClose: string;
            googleTagManagerId: string;
            googleAnalyticsId: string;
            matomoSiteId: string;
            matomoUrl: string;
        };
        nginx: {
            publicDomain: string;
            publishSubdomainPattern: string;
            cacheTtlSeconds: number;
            clientMaxBodySizeMb: number;
            extraServerDirectives: string;
        };
    }>;
    updatedAt: string;
    updatedByUserId?: string;
}

export interface AdminDeploymentDto {
    id: string;
    publishId: string;
    customSlug?: string;
    projectId: string;
    userId: string;
    status: string;
    url: string;
    isAdminBlocked: boolean;
    adminBlockedAt?: string;
    createdAt: string;
    updatedAt: string;
}
