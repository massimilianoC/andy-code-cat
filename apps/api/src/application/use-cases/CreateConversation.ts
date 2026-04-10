import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { Conversation, Message } from "../../domain/entities/Conversation";

export class CreateConversation {
    constructor(private readonly conversationRepository: ConversationRepository) { }

    async execute(input: {
        projectId: string;
        userId: string;
        title?: string;
        firstMessage?: Pick<Message, "role" | "content" | "metadata">;
    }): Promise<Conversation> {
        return this.conversationRepository.create({
            projectId: input.projectId,
            userId: input.userId,
            title: input.title,
            firstMessage: input.firstMessage,
        });
    }
}
