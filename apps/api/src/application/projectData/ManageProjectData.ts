import {
    PROJECT_DATA_EXPORT_MAX_RECORDS,
    type ListProjectDataRecordsQuery,
    type ProjectDataCapabilitySummaryDto,
    type ProjectDataRecordDto,
    type ProjectDataRecordPageDto,
    type ProjectDataSummaryDto,
} from "@andy-code-cat/contracts";
import type { ProjectDataCapability, ProjectDataGroupSummary, ProjectDataRecord, ProjectDataScope } from "../../domain/projectData/ProjectDataCapability";
import type { ProjectDataRegistry } from "./ProjectDataRegistry";
import { encodeProjectDataCsv } from "./projectDataCsv";

export interface ProjectDataExportFile {
    filename: string;
    contentType: string;
    body: string;
    /** Records exported, and records the capability holds for the same group(s). */
    exported: number;
    total: number;
}

export function toProjectDataRecordDto(record: ProjectDataRecord): ProjectDataRecordDto {
    return { id: record.id, groupId: record.groupId, createdAt: record.createdAt.toISOString(), data: record.data };
}

function latest(dates: (Date | undefined)[]): Date | undefined {
    return dates.reduce<Date | undefined>((acc, date) => (date && (!acc || date > acc) ? date : acc), undefined);
}

function sumRecords(groups: ProjectDataGroupSummary[]): number {
    return groups.reduce((acc, group) => acc + group.records, 0);
}

/** File-name safe: letters, digits, dot, dash and underscore only. */
function safeFilenamePart(text: string): string {
    return text.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 64) || "data";
}

function timestamp(now: Date): string {
    return now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function notFound(capabilityId: string): Error {
    return Object.assign(new Error(`Unknown project data capability: ${capabilityId}`), {
        statusCode: 404,
        code: "PROJECT_DATA_CAPABILITY_NOT_FOUND",
        userMessage: "This kind of project data does not exist.",
    });
}

/**
 * The owner's view over every capability in the registry (docs/specs/PROJECT_DATA_PANEL.md).
 * Every call takes the scope resolved by the sandbox; nothing here accepts a filter beyond the
 * closed set of the contract (group, page, limit, plain-text search).
 */
export class ManageProjectData {
    constructor(private readonly registry: ProjectDataRegistry) { }

    private capability(capabilityId: string): ProjectDataCapability {
        const capability = this.registry.get(capabilityId);
        if (!capability) throw notFound(capabilityId);
        return capability;
    }

    async summary(scope: ProjectDataScope): Promise<ProjectDataSummaryDto> {
        const capabilities = await Promise.all(this.registry.capabilities.map(async (capability): Promise<ProjectDataCapabilitySummaryDto> => {
            const groups = await capability.groups(scope);
            const lastWriteAt = latest(groups.map((group) => group.lastWriteAt));
            return {
                id: capability.id,
                label: capability.label,
                records: sumRecords(groups),
                ...(lastWriteAt ? { lastWriteAt: lastWriteAt.toISOString() } : {}),
                groups: groups.map((group) => ({
                    id: group.id,
                    label: group.label,
                    records: group.records,
                    ...(group.lastWriteAt ? { lastWriteAt: group.lastWriteAt.toISOString() } : {}),
                })),
            };
        }));
        return { capabilities };
    }

    async list(scope: ProjectDataScope, capabilityId: string, query: ListProjectDataRecordsQuery): Promise<ProjectDataRecordPageDto> {
        const capability = this.capability(capabilityId);
        const { items, total } = await capability.list(scope, {
            groupId: query.groupId,
            page: query.page,
            limit: query.limit,
            search: query.search || undefined,
        });
        return { items: items.map(toProjectDataRecordDto), total, page: query.page, limit: query.limit };
    }

    async deleteRecord(scope: ProjectDataScope, capabilityId: string, recordId: string): Promise<boolean> {
        return this.capability(capabilityId).deleteRecord(scope, recordId);
    }

    /** `confirm` must equal the capability id: a typed confirmation, so a stray request cannot wipe data. */
    async clear(scope: ProjectDataScope, capabilityId: string, input: { groupId?: string; confirm: string }): Promise<{ removed: number }> {
        const capability = this.capability(capabilityId);
        if (input.confirm !== capability.id) {
            throw Object.assign(new Error("Clear confirmation does not match the capability id"), {
                statusCode: 400,
                code: "PROJECT_DATA_CONFIRMATION_MISMATCH",
                userMessage: `Type "${capability.id}" to confirm.`,
            });
        }
        return { removed: await capability.clear(scope, input.groupId) };
    }

    async exportFile(
        scope: ProjectDataScope,
        capabilityId: string,
        input: { groupId?: string; format: "json" | "csv" },
        now: Date = new Date(),
    ): Promise<ProjectDataExportFile> {
        const capability = this.capability(capabilityId);
        const [records, groups] = await Promise.all([
            capability.exportRecords(scope, input.groupId, PROJECT_DATA_EXPORT_MAX_RECORDS),
            capability.groups(scope),
        ]);
        const total = sumRecords(input.groupId === undefined ? groups : groups.filter((group) => group.id === input.groupId));
        const exportedRecords = records.slice(0, PROJECT_DATA_EXPORT_MAX_RECORDS);
        const filename = [
            "project-data",
            safeFilenamePart(capability.id),
            ...(input.groupId !== undefined ? [safeFilenamePart(input.groupId)] : []),
            timestamp(now),
        ].join("-") + `.${input.format}`;

        if (input.format === "csv") {
            return { filename, contentType: "text/csv; charset=utf-8", body: encodeProjectDataCsv(exportedRecords), exported: exportedRecords.length, total };
        }
        const document = {
            capability: capability.id,
            label: capability.label,
            groupId: input.groupId ?? null,
            exportedAt: now.toISOString(),
            total,
            truncated: total > exportedRecords.length,
            records: exportedRecords.map(toProjectDataRecordDto),
        };
        return {
            filename,
            contentType: "application/json; charset=utf-8",
            body: JSON.stringify(document, null, 2),
            exported: exportedRecords.length,
            total,
        };
    }
}
