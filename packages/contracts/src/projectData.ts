import { z } from "zod";

/**
 * Project data — one owner-facing view over every platform capability that stores records for a
 * project (leaderboards, form submissions, …). docs/specs/PROJECT_DATA_PANEL.md.
 *
 * A capability groups its records (a leaderboard board, a form). Records are shown as plain JSON;
 * the owner can list, export, delete one, or clear a group or the whole capability.
 */

export const projectDataCapabilityIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
export const projectDataGroupIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/);

export interface ProjectDataGroupSummaryDto {
    id: string;
    label: string;
    records: number;
    lastWriteAt?: string;
}

export interface ProjectDataCapabilitySummaryDto {
    id: string;
    label: string;
    records: number;
    lastWriteAt?: string;
    groups: ProjectDataGroupSummaryDto[];
}

export interface ProjectDataSummaryDto {
    capabilities: ProjectDataCapabilitySummaryDto[];
}

export interface ProjectDataRecordDto {
    id: string;
    groupId: string;
    createdAt: string;
    /** The stored record, as the owner may see it. Never contains another project's data. */
    data: Record<string, unknown>;
}

export const listProjectDataRecordsQuerySchema = z.object({
    groupId: projectDataGroupIdSchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    /** Plain text, matched case-insensitively against the record's string values. Never a query language. */
    search: z.string().trim().max(100).optional(),
});
export type ListProjectDataRecordsQuery = z.infer<typeof listProjectDataRecordsQuerySchema>;

export interface ProjectDataRecordPageDto {
    items: ProjectDataRecordDto[];
    total: number;
    page: number;
    limit: number;
}

export const clearProjectDataSchema = z.object({
    groupId: projectDataGroupIdSchema.optional(),
    /** Must equal the capability id: a typed confirmation, so a stray request cannot wipe data. */
    confirm: z.string(),
}).strict();

export const exportProjectDataQuerySchema = z.object({
    groupId: projectDataGroupIdSchema.optional(),
    format: z.enum(["json", "csv"]).default("json"),
});

/** Upper bound of one export; a capability with more records is exported in its newest N. */
export const PROJECT_DATA_EXPORT_MAX_RECORDS = 10_000;
