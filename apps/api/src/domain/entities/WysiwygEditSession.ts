/**
 * WysiwygEditSession — domain entity.
 *
 * Tracks an in-progress visual editing session started by a user on a given
 * PreviewSnapshot.  The session stores the "live" HTML/CSS/JS state so that:
 *   - the browser can recover the edit if the page is refreshed
 *   - a commit operation can create a new PreviewSnapshot with full audit metadata
 *
 * Double-sandbox enforced at the repository/route level (userId + projectId).
 */
export interface WysiwygEditSession {
    id: string;
    projectId: string;
    userId: string;
    conversationId: string;

    /** The PreviewSnapshot this editing session was started from. */
    originSnapshotId: string;

    /** Latest working copy of the three artefacts. */
    currentHtml: string;
    currentCss: string;
    currentJs: string;

    /** Filled when the session is committed as a new PreviewSnapshot. */
    committedSnapshotId?: string;

    /** How many save-state calls have been recorded (used as a simple "dirty" counter). */
    operationCount: number;

    /** active → user is editing; committed → session closed after commit. */
    status: "active" | "committed";

    createdAt: Date;
    updatedAt: Date;
}
