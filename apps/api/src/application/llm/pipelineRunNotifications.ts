import type { PipelineStage } from "@andy-code-cat/contracts";
import { SystemNotifier } from "../services/SystemNotifier";

interface PipelineRunBlockedContext {
    projectId: string;
    userId: string;
    runId: string;
    stage: PipelineStage;
    code: string;
    lockedProviderId: string;
    lockedModelId: string;
}

/**
 * I17 of the SSOT program. A strict-dispatch block (409 MODEL_LOCK_UNAVAILABLE) used to be
 * visible only as an HTTP error response the caller happened to be watching for at that exact
 * moment — invisible after the fact if the user was away from the tab, refreshed, or the error
 * surfaced in a code path that didn't render it. This persists the block as a SystemNotification
 * so it survives via the existing `/v1/notifications` inbox regardless of when the user looks.
 */
export function notifyPipelineRunBlocked(context: PipelineRunBlockedContext): void {
    SystemNotifier.instance.emit({
        projectId: context.projectId,
        userId: context.userId,
        audience: "both",
        domain: "llm",
        severity: "warning",
        title: "Modello bloccato",
        message: `Il modello selezionato per questo progetto (${context.lockedProviderId}/${context.lockedModelId}) non e piu disponibile per la fase "${context.stage}" — la generazione e stata bloccata invece di usarne un altro in silenzio.`,
        sourceEventType: "pipeline_run_blocked",
        metadata: {
            pipelineRunId: context.runId,
            stage: context.stage,
            code: context.code,
            lockedProviderId: context.lockedProviderId,
            lockedModelId: context.lockedModelId,
        },
    });
}
