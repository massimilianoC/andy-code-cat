import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { Conversation } from "../../domain/entities/Conversation";

/**
 * GetOrCreateProjectConversation — enforces 1 conversation per project.
 *
 * Returns the existing primary conversation for the project or creates
 * a new empty one if none exists yet.  This is the single entry-point
 * the workspace UI should call on mount to resolve its chat stream.
 */
export class GetOrCreateProjectConversation {
    constructor(private readonly conversationRepository: ConversationRepository) { }

    async execute(input: {
        projectId: string;
        userId: string;
    }): Promise<{ conversation: Conversation; created: boolean }> {
        const existing = await this.conversationRepository.findForProject(
            input.projectId,
            input.userId
        );

        if (existing) {
            return { conversation: existing, created: false };
        }

        const conversation = await this.conversationRepository.create({
            projectId: input.projectId,
            userId: input.userId,
        });

        return { conversation, created: true };
    }
}
