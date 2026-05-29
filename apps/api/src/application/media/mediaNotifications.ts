import type { ImageResolutionAttempt } from "../../infra/image/types";
import { SystemNotifier } from "../services/SystemNotifier";

interface MediaNotificationContext {
    projectId: string;
    userId: string;
    mediaKey?: string;
    query: string;
    assetId?: string;
    finalProvider?: string;
    attemptedProviders?: ImageResolutionAttempt[];
    sourceContext?: Record<string, unknown>;
    error?: string;
}

export function notifyMediaProviderFallback(context: MediaNotificationContext): void {
    SystemNotifier.instance.emit({
        projectId: context.projectId,
        userId: context.userId,
        audience: "both",
        domain: "media",
        severity: "warning",
        title: "Provider media in fallback",
        message: `Il media${context.mediaKey ? ` ${context.mediaKey}` : ""} e stato risolto con ${context.finalProvider ?? "un provider alternativo"}.`,
        sourceEventType: "media_provider_fallback_used",
        metadata: {
            mediaKey: context.mediaKey,
            query: context.query,
            assetId: context.assetId,
            finalProvider: context.finalProvider,
            attemptedProviders: context.attemptedProviders,
            sourceContext: context.sourceContext,
        },
    });
}

export function notifyMediaPersistenceFailure(context: MediaNotificationContext): void {
    SystemNotifier.instance.emit({
        projectId: context.projectId,
        userId: context.userId,
        audience: "both",
        domain: "media",
        severity: "error",
        title: "Persistenza media fallita",
        message: `Non e stato possibile salvare il media${context.mediaKey ? ` ${context.mediaKey}` : ""}: ${context.error ?? "errore sconosciuto"}.`,
        sourceEventType: "media_persistence_failed",
        metadata: {
            mediaKey: context.mediaKey,
            query: context.query,
            error: context.error,
            sourceContext: context.sourceContext,
        },
    });
}

export function notifyMediaResolutionFailure(context: MediaNotificationContext): void {
    SystemNotifier.instance.emit({
        projectId: context.projectId,
        userId: context.userId,
        audience: "both",
        domain: "media",
        severity: "error",
        title: "Risoluzione media fallita",
        message: `Non e stato possibile risolvere il media${context.mediaKey ? ` ${context.mediaKey}` : ""}: ${context.error ?? "errore sconosciuto"}.`,
        sourceEventType: "media_resolution_failed",
        metadata: {
            mediaKey: context.mediaKey,
            query: context.query,
            error: context.error,
            sourceContext: context.sourceContext,
        },
    });
}
