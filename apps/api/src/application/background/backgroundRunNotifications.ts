/**
 * The completion notice of a background run (BACKGROUND_RUNS.md §3.6, §6.4: in-app only).
 *
 * It carries where to go next — the site, the project in the Workspace, a proposed slug — and
 * never the brief or any generated content. The web reads the links from `metadata`; the text is
 * for any client that only shows title and message.
 */
import type { BackgroundRun } from "../../domain/entities/BackgroundRun";
import type { Project } from "../../domain/entities/Project";
import { SystemNotifier } from "../services/SystemNotifier";

export interface BackgroundRunNoticeMetadata extends Record<string, unknown> {
    backgroundRunId: string;
    projectId: string;
    projectName?: string;
    conversationId?: string;
    /** App-relative: the project in the Workspace, on the conversation the run generated into. */
    workspacePath: string;
    publicUrl?: string;
    proposedSlug?: string;
    errorCode?: string;
    failedStep?: string;
}

export function workspacePathOf(run: Pick<BackgroundRun, "projectId" | "outputs">): string {
    const conversationId = run.outputs.launch?.conversationId;
    return conversationId
        ? `/workspace/${run.projectId}?conv=${encodeURIComponent(conversationId)}`
        : `/workspace/${run.projectId}`;
}

export async function notifyBackgroundRunFinished(run: BackgroundRun, project: Project | null): Promise<void> {
    const name = project?.name ?? "Progetto";
    const metadata: BackgroundRunNoticeMetadata = {
        backgroundRunId: run.id,
        projectId: run.projectId,
        projectName: project?.name,
        conversationId: run.outputs.launch?.conversationId,
        workspacePath: workspacePathOf(run),
        publicUrl: run.outputs.publish?.publicUrl,
        proposedSlug: run.outputs.publish?.proposedSlug,
    };
    if (run.status === "done") {
        await SystemNotifier.instance.emitAsync({
            projectId: run.projectId,
            userId: run.userId,
            audience: "user",
            domain: "publish",
            severity: "info",
            title: `Sito pronto: ${name}`,
            message: run.outputs.publish?.publicUrl
                ? `Generato e pubblicato in background: ${run.outputs.publish.publicUrl}`
                : "Generato e pubblicato in background.",
            sourceEventType: "background_run_done",
            metadata,
        });
        return;
    }
    if (run.status === "failed") {
        await SystemNotifier.instance.emitAsync({
            projectId: run.projectId,
            userId: run.userId,
            audience: "both",
            domain: "system",
            severity: "error",
            title: `Generazione in background non riuscita: ${name}`,
            message: run.error?.message ?? "La generazione si è interrotta.",
            sourceEventType: "background_run_failed",
            metadata: { ...metadata, errorCode: run.error?.code, failedStep: run.error?.step },
        });
    }
}
