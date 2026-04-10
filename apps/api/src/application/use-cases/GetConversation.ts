import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { Conversation } from "../../domain/entities/Conversation";

export class GetConversation {
    constructor(private readonly conversationRepository: ConversationRepository) { }

    async execute(conversationId: string, projectId: string): Promise<Conversation> {
        const conv = await this.conversationRepository.findById(conversationId, projectId);
        if (!conv) {
            const err = new Error("Conversation not found");
            (err as NodeJS.ErrnoException & { status: number }).status = 404;
            throw err;
        }
        return conv;
    }
}
