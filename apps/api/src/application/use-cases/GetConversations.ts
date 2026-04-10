import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { Conversation } from "../../domain/entities/Conversation";

export class GetConversations {
    constructor(private readonly conversationRepository: ConversationRepository) { }

    async execute(
        projectId: string,
        userId: string
    ): Promise<Omit<Conversation, "messages">[]> {
        return this.conversationRepository.listForProject(projectId, userId);
    }
}
