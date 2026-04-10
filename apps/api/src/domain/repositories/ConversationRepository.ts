import type { Conversation, Message, BackgroundTask } from "../entities/Conversation";

export interface ConversationRepository {
    create(data: {
        projectId: string;
        userId: string;
        title?: string;
        firstMessage?: Pick<Message, 'role' | 'content' | 'metadata'>;
    }): Promise<Conversation>;

    findById(id: string, projectId: string): Promise<Conversation | null>;

    /** Returns conversations without the messages array (summary list) */
    listForProject(projectId: string, userId: string): Promise<Omit<Conversation, 'messages'>[]>;

    /** Returns the single primary conversation for a project (most recent), or null. */
    findForProject(projectId: string, userId: string): Promise<Conversation | null>;

    addMessage(
        conversationId: string,
        projectId: string,
        message: Pick<Message, 'role' | 'content' | 'metadata'>
    ): Promise<Message>;

    addBackgroundTask(
        conversationId: string,
        messageId: string,
        task: Omit<BackgroundTask, 'id' | 'startedAt'>
    ): Promise<BackgroundTask>;

    updateBackgroundTask(
        conversationId: string,
        messageId: string,
        taskId: string,
        update: Partial<Pick<BackgroundTask, 'status' | 'output' | 'error' | 'completedAt' | 'tokenUsage' | 'costEstimate'>>
    ): Promise<void>;
}
