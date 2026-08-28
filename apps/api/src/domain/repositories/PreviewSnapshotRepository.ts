import type { PreviewSnapshot } from "../entities/PreviewSnapshot";

export interface PreviewSnapshotRepository {
    create(input: {
        projectId: string;
        conversationId: string;
        sourceMessageId?: string;
        parentSnapshotId?: string;
        artifacts: PreviewSnapshot["artifacts"];
        serviceManifest?: PreviewSnapshot["serviceManifest"];
        focusContext?: PreviewSnapshot["focusContext"];
        metadata?: PreviewSnapshot["metadata"];
        activate: boolean;
    }): Promise<PreviewSnapshot>;

    listByConversation(projectId: string, conversationId: string): Promise<PreviewSnapshot[]>;

    /** List ALL snapshots in a project regardless of conversation, sorted desc by createdAt. */
    listByProject(projectId: string): Promise<PreviewSnapshot[]>;

    findById(projectId: string, snapshotId: string): Promise<PreviewSnapshot | null>;

    getActive(projectId: string, conversationId: string): Promise<PreviewSnapshot | null>;

    /** Get the single active snapshot for the entire project (across all conversations). */
    getActiveForProject(projectId: string): Promise<PreviewSnapshot | null>;

    activate(projectId: string, conversationId: string, snapshotId: string): Promise<PreviewSnapshot | null>;

    /** Activate a snapshot at project level — deactivates ALL snapshots in the project. */
    activateForProject(projectId: string, snapshotId: string): Promise<PreviewSnapshot | null>;

    /** Delete a single snapshot. Returns true if deleted, false if not found. */
    deleteById(projectId: string, snapshotId: string): Promise<boolean>;

    /**
     * AL-015: re-parent every snapshot whose parentSnapshotId is `fromParentId` to `toParentId`.
     * Called before deleting `fromParentId` so the chain never dangles. `toParentId` is the
     * deleted snapshot's own seed, which may be undefined — children of a deleted root correctly
     * become roots themselves rather than inheriting a made-up ancestor. Project-scoped, same as
     * every other chain operation (AL-016). Returns the number of snapshots re-linked.
     */
    relinkChildren(projectId: string, fromParentId: string, toParentId?: string): Promise<number>;

    /** Persist the stored thumbnail path after the background Puppeteer job completes. */
    updateThumbnailPath(projectId: string, snapshotId: string, storedPath: string): Promise<void>;

    /**
     * Return the single active snapshot (with thumbnailPath if present) for each of the
     * given projectIds. Returned as a Map keyed by projectId.
     */
    getActiveForProjects(projectIds: string[]): Promise<Map<string, PreviewSnapshot>>;
}
