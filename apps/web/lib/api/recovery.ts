import { call } from "./call";
import type {
    ZeroEffortRecoveryStatus,
    DiscardPendingProjectResult,
} from "@andy-code-cat/contracts";

/**
 * Interrupted-run recovery (docs/specs/INTERRUPTED_RUN_RECOVERY.md).
 *
 * Zero Effort has no chat and no model picker, so when its one generation breaks the user's only
 * option is to start over having paid for whatever the model already produced. These two calls
 * carry the offer and the refusal.
 */

/**
 * Whether this project has a failed generation worth resuming, and how much work it left behind.
 *
 * The server decides `recoverable`, not the client. A 402 or an invalid key produced no partial
 * work at all, and offering to resume from nothing would waste the user's time and a second paid
 * call — so the judgement lives where the journal row is, and the client never re-derives it from
 * raw fields.
 */
export function getRecoveryStatus(token: string, projectId: string): Promise<ZeroEffortRecoveryStatus> {
    return call<ZeroEffortRecoveryStatus>("GET", `/v1/projects/${projectId}/recovery/status`, undefined, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}

/**
 * Deletes the project and everything the failed attempt left behind.
 *
 * Returns what it removed rather than a bare acknowledgement, so the UI can say so afterwards. A
 * failure should not sit in the project list looking like work, but deleting a project also deletes
 * its journal, its costs and its session — which is why this is never the default action.
 */
export function discardPendingProject(token: string, projectId: string): Promise<DiscardPendingProjectResult> {
    return call<DiscardPendingProjectResult>("POST", `/v1/projects/${projectId}/recovery/discard`, undefined, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}
