import type { PreviewSnapshot } from "../entities/PreviewSnapshot";

export interface PreviewSnapshotRepository {
    create(input: {
        projectId: string;
        conversationId: string;
        sourceMessageId?: string;
        parentSnapshotId?: string;
        artifacts: PreviewSnapshot["artifacts"];
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
}
