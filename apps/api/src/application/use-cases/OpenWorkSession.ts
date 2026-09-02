import type { PipelineEntryMode } from "@andy-code-cat/contracts";
import type { WorkSessionRepository, WorkSessionRecord } from "../../domain/repositories/WorkSessionRepository";
import type { WorkSessionConfig } from "../../domain/entities/WorkSession";

export interface OpenWorkSessionInput {
    userId: string;
    entryMode: PipelineEntryMode;
    organizationId?: string;
    projectId?: string;
    config?: WorkSessionConfig;
}

/**
 * Opens the session that everything downstream will name
 * (docs/specs/SESSION_TRACING_EXECUTION_PLAN.md WP4a).
 *
 * Called by the three entry routes at the moment the user engages a tool. The id it returns travels
 * back to the client, which sends it on every subsequent request as `x-work-session-id`, so the
 * whole chain — classify, prefill, brief, generate, edits, image generation — resolves to one
 * history without any of those call sites having to know how sessions are created.
 *
 * `reuse` exists because an entry route is hit more than once per session: a user who edits their
 * prompt and re-submits is still in the same session, and opening a second one would split a single
 * intent into two unrelated histories.
 */
export class OpenWorkSession {
    constructor(private readonly repository: WorkSessionRepository) { }

    async execute(input: OpenWorkSessionInput): Promise<WorkSessionRecord> {
        return this.repository.open({
            userId: input.userId,
            organizationId: input.organizationId,
            projectId: input.projectId,
            entryMode: input.entryMode,
            config: input.config ?? {},
        });
    }

    /**
     * Returns the still-open session with this id if it belongs to the caller, otherwise opens a new
     * one. This is what an entry route should call: it makes a resubmission continue the session it
     * belongs to, and a stale or foreign id start a clean one instead of failing the request.
     *
     * Never throws for tracing reasons. A generation must not die because session bookkeeping did.
     */
    async reuseOrOpen(
        existingId: string | undefined,
        input: OpenWorkSessionInput,
    ): Promise<WorkSessionRecord | null> {
        try {
            if (existingId) {
                const existing = await this.repository.findByIdForUser(existingId, input.userId);
                if (existing && existing.status === "open") return existing;
            }
            return await this.execute(input);
        } catch {
            return null;
        }
    }
}
