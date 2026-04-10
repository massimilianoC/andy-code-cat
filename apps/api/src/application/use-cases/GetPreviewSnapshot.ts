import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

export class GetPreviewSnapshot {
    constructor(private readonly previewSnapshotRepository: PreviewSnapshotRepository) { }

    async execute(projectId: string, snapshotId: string): Promise<PreviewSnapshot | null> {
        return this.previewSnapshotRepository.findById(projectId, snapshotId);
    }
}
