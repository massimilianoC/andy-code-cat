import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import { extractMediaPlaceholderKeys } from "../media/replaceMediaPlaceholders";

export class ActivatePreviewSnapshot {
    constructor(private readonly previewSnapshotRepository: PreviewSnapshotRepository) { }

    async execute(input: { projectId: string; conversationId?: string; snapshotId: string }): Promise<PreviewSnapshot> {
        const target = await this.previewSnapshotRepository.findById(input.projectId, input.snapshotId);
        if (!target || (input.conversationId && target.conversationId !== input.conversationId)) {
            const err = new Error("Preview snapshot not found");
            (err as NodeJS.ErrnoException & { status: number }).status = 404;
            throw err;
        }

        const unresolvedKeys = extractMediaPlaceholderKeys(target.artifacts);
        if (unresolvedKeys.length > 0) {
            const err = new Error(`Cannot activate preview snapshot with unresolved media placeholders: ${unresolvedKeys.join(", ")}`);
            (err as NodeJS.ErrnoException & { status: number }).status = 400;
            throw err;
        }

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
