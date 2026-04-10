import type { WysiwygEditSession } from "../../domain/entities/WysiwygEditSession";
import type { WysiwygEditSessionRepository } from "../../domain/repositories/WysiwygEditSessionRepository";

export class CreateWysiwygEditSession {
    constructor(private readonly repo: WysiwygEditSessionRepository) { }

    /**
     * Returns an existing active session for the same origin snapshot if one
     * already exists (idempotent), otherwise creates a new one.
     */
    async execute(input: {
        projectId: string;
        userId: string;
        conversationId: string;
        originSnapshotId: string;
        currentHtml: string;
        currentCss: string;
        currentJs: string;
    }): Promise<{ session: WysiwygEditSession; resumed: boolean }> {
        const existing = await this.repo.findActive(
            input.projectId,
            input.conversationId,
            input.originSnapshotId
        );

        if (existing) {
            return { session: existing, resumed: true };
        }

        const session = await this.repo.create(input);
        return { session, resumed: false };
    }
}
