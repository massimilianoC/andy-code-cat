import type { WysiwygEditSession } from "../../domain/entities/WysiwygEditSession";
import type { WysiwygEditSessionRepository } from "../../domain/repositories/WysiwygEditSessionRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";

export class CommitWysiwygSession {
    constructor(
        private readonly wysiwygRepo: WysiwygEditSessionRepository,
        private readonly snapshotRepo: PreviewSnapshotRepository
    ) { }

    /**
     * 1. Loads the session (must be active, in the project scope).
     * 2. Creates a new PreviewSnapshot from the session's current artefacts.
     *    - parentSnapshotId → originSnapshotId (links to the origin)
     *    - finishReason → 'wysiwyg-edit-light'
     *    - wysiwygSessionId stored in metadata for full audit trail
     * 3. Activates the new snapshot for the conversation.
     * 4. Marks the session as committed.
     */
    async execute(input: {
        sessionId: string;
        projectId: string;
        description?: string;
    }): Promise<{ session: WysiwygEditSession; snapshot: PreviewSnapshot } | null> {
        const session = await this.wysiwygRepo.findById(input.sessionId, input.projectId);
        if (!session || session.status !== "active") return null;

        const snapshot = await this.snapshotRepo.create({
            projectId: session.projectId,
            conversationId: session.conversationId,
            parentSnapshotId: session.originSnapshotId,
            artifacts: {
                html: session.currentHtml,
                css: session.currentCss,
                js: session.currentJs,
            },
            metadata: {
                finishReason: "wysiwyg-edit-light",
                wysiwygSessionId: session.id,
                wysiwygDescription: input.description,
                originSnapshotId: session.originSnapshotId,
            } as PreviewSnapshot["metadata"] & {
                wysiwygSessionId?: string;
                wysiwygDescription?: string;
                originSnapshotId?: string;
            },
            activate: true,
        });

        const committed = await this.wysiwygRepo.commit(
            session.id,
            session.projectId,
            snapshot.id
        );

        return { session: committed ?? session, snapshot };
    }
}
