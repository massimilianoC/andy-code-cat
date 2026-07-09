import type { PreviewSnapshotRepository } from "../../../domain/repositories/PreviewSnapshotRepository";

/**
 * Metadata-only snapshot summary for the admin "Versions" list.
 * Deliberately omits `artifacts`/`metadata`/`focusContext` — listing versions is not
 * sensitive the way viewing rendered content is, so only the single-snapshot fetch
 * (AdminGetProjectSnapshot) writes an audit-log entry.
 */
export interface AdminSnapshotSummary {
    id: string;
    conversationId: string;
    sourceMessageId?: string;
    parentSnapshotId?: string;
    isActive: boolean;
    createdAt: Date;
    activatedAt?: Date;
}

export class AdminListProjectSnapshots {
    constructor(private readonly previewSnapshotRepository: PreviewSnapshotRepository) { }

    async execute(projectId: string): Promise<AdminSnapshotSummary[]> {
        const snapshots = await this.previewSnapshotRepository.listByProject(projectId);
        return snapshots.map((s) => ({
            id: s.id,
            conversationId: s.conversationId,
            sourceMessageId: s.sourceMessageId,
            parentSnapshotId: s.parentSnapshotId,
            isActive: s.isActive,
            createdAt: s.createdAt,
            activatedAt: s.activatedAt,
        }));
    }
}
