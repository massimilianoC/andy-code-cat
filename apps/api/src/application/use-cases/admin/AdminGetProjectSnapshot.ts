import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import type { PreviewSnapshotRepository } from "../../../domain/repositories/PreviewSnapshotRepository";

/**
 * Superadmin read of a single snapshot's full artifacts, bypassing ownership.
 * Admin routes are already gated cross-tenant by requireSuperAdmin — no owner check here.
 */
export class AdminGetProjectSnapshot {
    constructor(private readonly previewSnapshotRepository: PreviewSnapshotRepository) { }

    async execute(projectId: string, snapshotId: string): Promise<PreviewSnapshot | null> {
        return this.previewSnapshotRepository.findById(projectId, snapshotId);
    }
}
