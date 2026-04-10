import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

export class ActivatePreviewSnapshot {
    constructor(private readonly previewSnapshotRepository: PreviewSnapshotRepository) { }

    async execute(input: { projectId: string; conversationId?: string; snapshotId: string }): Promise<PreviewSnapshot> {
        let snapshot: PreviewSnapshot | null;
        if (input.conversationId) {
            snapshot = await this.previewSnapshotRepository.activate(input.projectId, input.conversationId, input.snapshotId);
        } else {
            snapshot = await this.previewSnapshotRepository.activateForProject(input.projectId, input.snapshotId);
        }
        if (!snapshot) {
            const err = new Error("Preview snapshot not found");
            (err as NodeJS.ErrnoException & { status: number }).status = 404;
            throw err;
        }
        return snapshot;
    }
}
