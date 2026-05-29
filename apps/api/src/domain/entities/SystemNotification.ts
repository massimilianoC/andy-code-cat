export type SystemNotificationAudience = "user" | "superadmin" | "both";
export type SystemNotificationDomain = "media" | "llm" | "publish" | "export" | "system";
export type SystemNotificationSeverity = "info" | "warning" | "error";
export type SystemNotificationStatus = "unread" | "read";

export type SystemNotificationSourceEventType =
    | "media_provider_failed"
    | "media_provider_fallback_used"
    | "media_resolution_failed"
    | "media_persistence_failed"
    | "publish_blocked_unresolved_media"
    | "export_blocked_unresolved_media";

export interface SystemNotification {
    id: string;
    projectId?: string;
    userId?: string;
    audience: SystemNotificationAudience;
    domain: SystemNotificationDomain;
    severity: SystemNotificationSeverity;
    status: SystemNotificationStatus;
    title: string;
    message: string;
    sourceEventType: SystemNotificationSourceEventType;
    metadata: Record<string, unknown>;
    createdAt: Date;
    readAt?: Date;
}
