import { z } from "zod";
import type { FormatHint } from "./vibecore";

export type UserTemplateStatus = "draft" | "active" | "archived";

// ─── Response shape ──────────────────────────────────────────────────────────

export interface UserTemplateDto {
    id: string;
    ownerId: string;
    name: string;
    description: string;
    formatHint: FormatHint | null;
    sectorKeywords: string[];
    isSystem: boolean;
    status: UserTemplateStatus;
    usageCount: number;
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
    updatedAt: string;
}

// ─── Request schemas ─────────────────────────────────────────────────────────

export const activateUserTemplateSchema = z.object({}).strict();

export const promoteToSystemSchema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(300),
    tenantScope: z.union([z.literal("all"), z.array(z.string())]).default("all"),
});

export type PromoteToSystemInput = z.infer<typeof promoteToSystemSchema>;
