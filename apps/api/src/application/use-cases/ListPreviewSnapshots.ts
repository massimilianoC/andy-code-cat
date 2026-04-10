import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

export class ListPreviewSnapshots {
    constructor(private readonly previewSnapshotRepository: PreviewSnapshotRepository) { }

    async execute(projectId: string, conversationId?: string): Promise<PreviewSnapshot[]> {
        if (conversationId) {
            return this.previewSnapshotRepository.listByConversation(projectId, conversationId);
        }
        return this.previewSnapshotRepository.listByProject(projectId);
    }
}
