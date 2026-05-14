import type { FormatHint } from "@andy-code-cat/contracts";

export type UserTemplateStatus = "draft" | "active" | "archived";

/**
 * UserTemplate — a reusable Layer T preprompt block captured from a past generation.
 *
 * Lifecycle:
 *   draft   — auto-created by ProposeUserTemplate after an ad-hoc format-hint job.
 *             expires at `expiresAt` (+30 days from creation) via TTL index.
 *   active  — user explicitly saved it; never expires.
 *   archived — soft-deleted by user or admin; retained forever for audit.
 *
 * Classification:
 *   isSystem=true templates are promoted by a superadmin and shown to all tenants
 *   (or a specified subset). Layer Φ classifier catalog includes them.
 */
export interface UserTemplate {
    id: string;
    ownerId: string;
    tenantId: string;
    name: string;
    description: string;
    formatHint: FormatHint | null;
    sectorKeywords: string[];
    /** The Nunjucks-renderable Layer T content (max 2000 chars). */
    prepromptBlock: string;
    /** The job that triggered the ad-hoc rules leading to this draft. */
    sourceJobId: string | null;
    isSystem: boolean;
    status: UserTemplateStatus;
    usageCount: number;
    lastUsedAt: Date | null;
    /** Set to +30d for "draft"; null for "active". TTL index purges expired drafts. */
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export type CreateUserTemplateInput = Pick<
    UserTemplate,
    | "ownerId"
    | "tenantId"
    | "name"
    | "description"
    | "formatHint"
    | "sectorKeywords"
    | "prepromptBlock"
    | "sourceJobId"
    | "status"
    | "expiresAt"
>;
