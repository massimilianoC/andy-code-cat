import type { SystemNotificationDto } from "@andy-code-cat/contracts";
import { call } from "./call";

export interface ListNotificationsResult {
    notifications: SystemNotificationDto[];
}

export function listNotifications(token: string) {
    return call<ListNotificationsResult>("GET", "/v1/notifications?status=unread&limit=50", undefined, {
        Authorization: `Bearer ${token}`,
    });
}

export function markNotificationRead(token: string, notificationId: string) {
    return call<{ notification: SystemNotificationDto }>("PATCH", `/v1/notifications/${notificationId}/read`, undefined, {
        Authorization: `Bearer ${token}`,
    });
}
