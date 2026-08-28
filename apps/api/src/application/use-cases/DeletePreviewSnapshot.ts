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

        // AL-015: re-link before deleting, never after. Children keep the seed chain intact by
        // inheriting the deleted snapshot's own seed — the grandparent for a mid-chain delete,
        // or nothing (they become roots) when the deleted snapshot was itself a root. Doing this
        // after deleteById would leave a window where the children point at nothing.
        await this.repo.relinkChildren(projectId, snapshotId, snapshot.parentSnapshotId);

        const deleted = await this.repo.deleteById(projectId, snapshotId);
        if (!deleted) {
            const err = new Error("Preview snapshot not found");
            (err as NodeJS.ErrnoException & { status: number }).status = 404;
            throw err;
        }
    }
}
