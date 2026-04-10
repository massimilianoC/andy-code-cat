import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

export class CreatePreviewSnapshot {
    constructor(private readonly previewSnapshotRepository: PreviewSnapshotRepository) { }

    async execute(input: {
        projectId: string;
        conversationId: string;
        sourceMessageId?: string;
        parentSnapshotId?: string;
        artifacts: PreviewSnapshot["artifacts"];
        focusContext?: PreviewSnapshot["focusContext"];
        metadata?: PreviewSnapshot["metadata"];
        activate: boolean;
    }): Promise<PreviewSnapshot> {
        return this.previewSnapshotRepository.create(input);
    }
}
