import type { SystemNotification } from "../entities/SystemNotification";

export type CreateSystemNotificationInput = Omit<SystemNotification, "id" | "createdAt" | "status" | "readAt">;

export interface SystemNotificationQuery {
    domain?: SystemNotification["domain"];
    severity?: SystemNotification["severity"];
    status?: SystemNotification["status"];
    projectId?: string;
    limit?: number;
}

export interface SystemNotificationRepository {
    create(input: CreateSystemNotificationInput): Promise<SystemNotification>;
    listForUser(userId: string, query?: SystemNotificationQuery): Promise<SystemNotification[]>;
    listForAdmin(query?: SystemNotificationQuery): Promise<SystemNotification[]>;
    markRead(id: string, userId: string): Promise<SystemNotification | null>;
}
