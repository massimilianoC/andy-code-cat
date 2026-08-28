import type { WysiwygEditSession } from "../../domain/entities/WysiwygEditSession";
import type { WysiwygEditSessionRepository } from "../../domain/repositories/WysiwygEditSessionRepository";
import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { CreatePreviewSnapshot } from "./CreatePreviewSnapshot";

export class CommitWysiwygSession {
    constructor(
        private readonly wysiwygRepo: WysiwygEditSessionRepository,
        /**
         * AL-031 — the WYSIWYG commit used to write to the snapshot repository directly,
         * which made it a second save path for artifact versions: it produced versions with
         * no contentHash (AL-039), it could not suppress a no-op save (AL-045), and it wrote
         * two metadata keys through an `as` cast that the artifact contract never declared.
         * It goes through the one write path now. A second way to persist a version is an
         * architectural change, not a shortcut.
         */
        private readonly createPreviewSnapshot: CreatePreviewSnapshot,
    ) { }

    /**
     * 1. Loads the session (must be active, in the project scope).
     * 2. Creates a new PreviewSnapshot from the session's current artefacts.
     *    - parentSnapshotId → originSnapshotId (the seed this edit branched from)
     *    - finishReason → 'wysiwyg-edit-light'
     *    - wysiwygSessionId stored in metadata for full audit trail
     * 3. Activates the new snapshot for the conversation.
     * 4. Marks the session as committed.
     *
     * When the edit changed nothing, step 2 returns the origin version unchanged (AL-045)
     * and the session commits against it — the user still leaves edit mode looking at the
     * version they were editing, history simply does not gain a duplicate of it.
     */
    async execute(input: {
        sessionId: string;
        projectId: string;
        description?: string;
        baseContentHash?: string;
    }): Promise<{ session: WysiwygEditSession; snapshot: PreviewSnapshot; created: boolean } | null> {
        const session = await this.wysiwygRepo.findById(input.sessionId, input.projectId);
        if (!session || session.status !== "active") return null;

        const { snapshot, created } = await this.createPreviewSnapshot.execute({
            projectId: session.projectId,
            conversationId: session.conversationId,
            parentSnapshotId: session.originSnapshotId,
            baseContentHash: input.baseContentHash,
            artifacts: {
                html: session.currentHtml,
                css: session.currentCss,
                js: session.currentJs,
            },
            metadata: {
                finishReason: "wysiwyg-edit-light",
                wysiwygSessionId: session.id,
                wysiwygDescription: input.description,
            },
            activate: true,
        });

        const committed = await this.wysiwygRepo.commit(
            session.id,
            session.projectId,
            snapshot.id
        );

        return { session: committed ?? session, snapshot, created };
    }
}
