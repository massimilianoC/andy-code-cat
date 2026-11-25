/**
 * The contract every record-storing platform capability implements, so that one registry can
 * summarise, list, export, delete and clear a project's data — and so that project deletion can
 * never forget a capability again (it once forgot leaderboard_scores; see release 2026.11.25.5).
 *
 * Every method takes the full scope. Implementations spread it into every query; none may accept
 * a free-form filter from the caller.
 */
export interface ProjectDataScope {
    ownerUserId: string;
    projectId: string;
}

export interface ProjectDataGroupSummary {
    id: string;
    label: string;
    records: number;
    lastWriteAt?: Date;
}

export interface ProjectDataRecord {
    id: string;
    groupId: string;
    createdAt: Date;
    data: Record<string, unknown>;
}

export interface ProjectDataListQuery {
    groupId?: string;
    page: number;
    limit: number;
    search?: string;
}

export interface ProjectDataCapability {
    /** Stable id, also the typed confirmation for clear(). e.g. "leaderboard", "forms". */
    readonly id: string;
    readonly label: string;
    groups(scope: ProjectDataScope): Promise<ProjectDataGroupSummary[]>;
    list(scope: ProjectDataScope, query: ProjectDataListQuery): Promise<{ items: ProjectDataRecord[]; total: number }>;
    /** Newest first, at most `max` records. */
    exportRecords(scope: ProjectDataScope, groupId: string | undefined, max: number): Promise<ProjectDataRecord[]>;
    deleteRecord(scope: ProjectDataScope, recordId: string): Promise<boolean>;
    /** One group, or every group of the capability when groupId is undefined. Returns records removed. */
    clear(scope: ProjectDataScope, groupId?: string): Promise<number>;
}
