import type { WysiwygEditSession } from "../entities/WysiwygEditSession";

export interface WysiwygEditSessionRepository {
    create(input: {
        projectId: string;
        userId: string;
        conversationId: string;
        originSnapshotId: string;
        currentHtml: string;
        currentCss: string;
        currentJs: string;
    }): Promise<WysiwygEditSession>;

    /** Return an existing active session for the same project/conversation/snapshot, if any. */
    findActive(
        projectId: string,
        conversationId: string,
        originSnapshotId: string
    ): Promise<WysiwygEditSession | null>;

    /** Fetch a session by id, scoped to the project (sandbox). */
    findById(sessionId: string, projectId: string): Promise<WysiwygEditSession | null>;

    /**
     * Persist the latest working HTML/CSS/JS state (autosave).
     * Increments operationCount.
     * Returns null if sessionId not found or already committed.
     */
    saveState(
        sessionId: string,
        projectId: string,
        html: string,
        css: string,
        js: string
    ): Promise<WysiwygEditSession | null>;

    /**
     * Mark the session as committed and record the resulting snapshot id.
     * Returns null if not found.
     */
    commit(
        sessionId: string,
        projectId: string,
        committedSnapshotId: string
    ): Promise<WysiwygEditSession | null>;
}
