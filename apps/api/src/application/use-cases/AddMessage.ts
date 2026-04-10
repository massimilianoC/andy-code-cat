import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { Message } from "../../domain/entities/Conversation";

export class AddMessage {
    constructor(private readonly conversationRepository: ConversationRepository) { }

    async execute(input: {
        conversationId: string;
        projectId: string;
        role: Message["role"];
        content: string;
        metadata?: Message["metadata"];
    }): Promise<Message> {
        const conv = await this.conversationRepository.findById(input.conversationId, input.projectId);
        if (!conv) {
            const err = new Error("Conversation not found");
            (err as NodeJS.ErrnoException & { status: number }).status = 404;
            throw err;
        }

        return this.conversationRepository.addMessage(
            input.conversationId,
            input.projectId,
            { role: input.role, content: input.content, metadata: input.metadata }
        );
    }
}
