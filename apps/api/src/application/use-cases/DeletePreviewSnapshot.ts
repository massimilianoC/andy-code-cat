import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

export class DeletePreviewSnapshot {
    constructor(private readonly repo: PreviewSnapshotRepository) { }

    async execute(projectId: string, snapshotId: string): Promise<void> {
        // Prevent deleting the currently active snapshot
        const snapshot = await this.repo.findById(projectId, snapshotId);
        if (!snapshot) {
            const err = new Error("Preview snapshot not found");
            (err as NodeJS.ErrnoException & { status: number }).status = 404;
            throw err;
        }
        if (snapshot.isActive) {
            const err = new Error("Cannot delete the active snapshot. Activate another version first.");
            (err as NodeJS.ErrnoException & { status: number }).status = 409;
            throw err;
        }

        const deleted = await this.repo.deleteById(projectId, snapshotId);
        if (!deleted) {
            const err = new Error("Preview snapshot not found");
            (err as NodeJS.ErrnoException & { status: number }).status = 404;
            throw err;
        }
    }
}
