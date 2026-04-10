import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { BackgroundTask } from "../../domain/entities/Conversation";

export class LogBackgroundTask {
    constructor(private readonly conversationRepository: ConversationRepository) { }

    async execute(input: {
        conversationId: string;
        projectId: string;
        messageId: string;
        type: string;
        pipelineProfile?: string;
        input?: unknown;
        output?: unknown;
        status?: BackgroundTask["status"];
        error?: string;
        tokenUsage?: BackgroundTask["tokenUsage"];
        costEstimate?: BackgroundTask["costEstimate"];
    }): Promise<BackgroundTask> {
        const conv = await this.conversationRepository.findById(
            input.conversationId,
            input.projectId
        );
        if (!conv) {
            const err = new Error("Conversation not found");
            (err as NodeJS.ErrnoException & { status: number }).status = 404;
            throw err;
        }

        const msg = conv.messages.find((m) => m.id === input.messageId);
        if (!msg) {
            const err = new Error("Message not found");
            (err as NodeJS.ErrnoException & { status: number }).status = 404;
            throw err;
        }

        return this.conversationRepository.addBackgroundTask(
            input.conversationId,
            input.messageId,
            {
                type: input.type,
                status: input.status ?? "pending",
                pipelineProfile: input.pipelineProfile,
                input: input.input,
                output: input.output,
                error: input.error,
                tokenUsage: input.tokenUsage,
                costEstimate: input.costEstimate,
            }
        );
    }
}
