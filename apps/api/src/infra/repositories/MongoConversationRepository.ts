import { randomUUID } from "crypto";
import { getDb } from "../db/mongo";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { Conversation, Message, BackgroundTask } from "../../domain/entities/Conversation";
import type { Collection, Filter } from "mongodb";

const COLLECTION = "conversations";

interface ConversationDocument {
    _id: string;
    projectId: string;
    userId: string;
    title: string;
    messages: Message[];
    totalTokens: number;
    /** Running total of policy-estimated cost (EUR) across all assistant messages. */
    totalCost: number;
    createdAt: Date;
    updatedAt: Date;
}

function toEntity(doc: ConversationDocument): Conversation {
    const { _id, ...rest } = doc;
    return { ...rest, id: _id, totalCost: rest.totalCost ?? 0 };
}

export class MongoConversationRepository implements ConversationRepository {
    private async col(): Promise<Collection<ConversationDocument>> {
        const db = await getDb();
        return db.collection<ConversationDocument>(COLLECTION);
    }

    async create(data: {
        projectId: string;
        userId: string;
        title?: string;
        firstMessage?: Pick<Message, 'role' | 'content' | 'metadata'>;
    }): Promise<Conversation> {
        const now = new Date();
        const messages: Message[] = [];

        if (data.firstMessage) {
            messages.push({
                id: randomUUID(),
                role: data.firstMessage.role,
                content: data.firstMessage.content,
                timestamp: now,
                metadata: data.firstMessage.metadata,
                backgroundTasks: [],
            });
        }

        const title =
            data.title ??
            (data.firstMessage
                ? data.firstMessage.content.slice(0, 60).replace(/\n/g, " ")
                : "Nuova conversazione");

        const doc = {
            _id: randomUUID(),
            projectId: data.projectId,
            userId: data.userId,
            title,
            messages,
            totalTokens: 0,
            totalCost: 0,
            createdAt: now,
            updatedAt: now,
        };

        const col = await this.col();
        await col.insertOne(doc as ConversationDocument);
        return toEntity(doc);
    }

    async findById(id: string, projectId: string): Promise<Conversation | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: id, projectId } as Filter<ConversationDocument>);
        return doc ? toEntity(doc) : null;
    }

    async listForProject(
        projectId: string,
        userId: string
    ): Promise<Omit<Conversation, "messages">[]> {
        const col = await this.col();
        const docs = await col
            .find({ projectId, userId } as Filter<ConversationDocument>, { projection: { messages: 0 } })
            .sort({ updatedAt: -1 })
            .toArray();
        return docs.map(toEntity);
    }

    async findForProject(projectId: string, userId: string): Promise<Conversation | null> {
        const col = await this.col();
        const doc = await col
            .find({ projectId, userId } as Filter<ConversationDocument>)
            .sort({ updatedAt: -1 })
            .limit(1)
            .next();
        return doc ? toEntity(doc) : null;
    }

    async addMessage(
        conversationId: string,
        projectId: string,
        msg: Pick<Message, "role" | "content" | "metadata">
    ): Promise<Message> {
        const message: Message = {
            id: randomUUID(),
            role: msg.role,
            content: msg.content,
            timestamp: new Date(),
            metadata: msg.metadata,
            backgroundTasks: [],
        };

        const tokenDelta = msg.metadata?.tokenUsage?.totalTokens ?? 0;
        const costDelta = msg.metadata?.costEstimate?.amount ?? 0;

        const col = await this.col();
        await col.updateOne(
            { _id: conversationId, projectId } as Filter<ConversationDocument>,
            {
                $push: { messages: message },
                $inc: { totalTokens: tokenDelta, totalCost: costDelta },
                $set: { updatedAt: new Date() },
            }
        );

        return message;
    }

    async addBackgroundTask(
        conversationId: string,
        messageId: string,
        task: Omit<BackgroundTask, "id" | "startedAt">
    ): Promise<BackgroundTask> {
        const backgroundTask: BackgroundTask = {
            ...task,
            id: randomUUID(),
            startedAt: new Date(),
        };

        const col = await this.col();
        await col.updateOne(
            { _id: conversationId, "messages.id": messageId } as Filter<ConversationDocument>,
            {
                $push: { "messages.$.backgroundTasks": backgroundTask },
                $set: { updatedAt: new Date() },
            }
        );

        return backgroundTask;
    }

    async updateBackgroundTask(
        conversationId: string,
        messageId: string,
        taskId: string,
        update: Partial<Pick<BackgroundTask, "status" | "output" | "error" | "completedAt" | "tokenUsage" | "costEstimate">>
    ): Promise<void> {
        const setFields: Record<string, unknown> = { updatedAt: new Date() };

        for (const [key, value] of Object.entries(update)) {
            setFields[`messages.$[msg].backgroundTasks.$[task].${key}`] = value;
        }

        const col = await this.col();
        await col.updateOne(
            { _id: conversationId } as Filter<ConversationDocument>,
            { $set: setFields },
            {
                arrayFilters: [
                    { "msg.id": messageId },
                    { "task.id": taskId },
                ],
            }
        );
    }
}
