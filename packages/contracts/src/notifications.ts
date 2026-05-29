import { z } from "zod";

export const systemNotificationAudienceSchema = z.enum(["user", "superadmin", "both"]);
export const systemNotificationDomainSchema = z.enum(["media", "llm", "publish", "export", "system"]);
export const systemNotificationSeveritySchema = z.enum(["info", "warning", "error"]);
export const systemNotificationStatusSchema = z.enum(["unread", "read"]);

export const systemNotificationSourceEventTypeSchema = z.enum([
    "media_provider_failed",
    "media_provider_fallback_used",
    "media_resolution_failed",
    "media_persistence_failed",
    "publish_blocked_unresolved_media",
    "export_blocked_unresolved_media",
]);

export const listSystemNotificationsQuerySchema = z.object({
    domain: systemNotificationDomainSchema.optional(),
    severity: systemNotificationSeveritySchema.optional(),
    status: systemNotificationStatusSchema.optional(),
    projectId: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
}).strict();

export interface SystemNotificationDto {
    id: string;
    projectId?: string;
    userId?: string;
    audience: z.infer<typeof systemNotificationAudienceSchema>;
    domain: z.infer<typeof systemNotificationDomainSchema>;
    severity: z.infer<typeof systemNotificationSeveritySchema>;
    status: z.infer<typeof systemNotificationStatusSchema>;
    title: string;
    message: string;
    sourceEventType: z.infer<typeof systemNotificationSourceEventTypeSchema>;
    metadata: Record<string, unknown>;
    createdAt: string;
    readAt?: string;
}

export type ListSystemNotificationsQuery = z.infer<typeof listSystemNotificationsQuerySchema>;
