import type {
    CanonicalBriefEnvelope,
    ModelSelectionBlockCode,
    OptimizationPolicy,
    PipelineEntryMode,
    PipelineModelLock,
    PipelineRunStatus,
    PipelineStage,
    PipelineStageExecutionRef,
} from "@andy-code-cat/contracts";

/**
 * `PipelineRun` domain entity — I7 of the SSOT program (see
 * docs/SSOT_REFACTOR_PROGRESS.md and
 * docs/specs/SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md).
 *
 * Follows this repo's existing entity convention (see PreviewSnapshot.ts / ExecutionLog.ts):
 * a plain TS interface describing the persisted document shape, plus free (non-method) pure
 * functions for invariants — not a class with instance methods.
 *
 * Timestamps are native `Date` here (unlike `PipelineRunDto` in
 * packages/contracts/src/pipelineRun.ts, whose `createdAt`/`updatedAt`/`selectedAt`/etc. are
 * ISO strings for wire transport) — this mirrors how PreviewSnapshot's domain entity uses
 * `Date` while its DTO/API-facing counterpart is serialised to strings by Express's JSON
 * encoder. Repositories and route handlers are the boundary that converts between the two.
 *
 * Additive and unconsumed in this batch: nothing in apps/api wires this into a live route
 * beyond the new, gated pipelineRunRoutes.ts (I7) and ResolvePipelineModelLock (I8) — no
 * existing request-handling path changes behavior because of this file.
 */

export interface PipelineRunBlockedDetail {
    code: ModelSelectionBlockCode;
    stage: PipelineStage;
    at: Date;
}

export interface PipelineRun {
    id: string;
    projectId: string;
    ownerUserId: string;
    conversationId?: string;
    entryMode: PipelineEntryMode;
    /** Frozen once set — see assertLockImmutable(). Never mutate this field in place. */
    modelLock: PipelineModelLock;
    optimizationPolicy: OptimizationPolicy;
    canonicalBrief?: CanonicalBriefEnvelope;
    status: PipelineRunStatus;
    stages: PipelineStageExecutionRef[];
    blocked?: PipelineRunBlockedDetail;
    createdAt: Date;
    updatedAt: Date;
}

// ── Model lock immutability ─────────────────────────────────────────────────

/**
 * Throws if `next` differs from `previous` in any field (including nested `requested`/
 * `effective` sub-fields). Once a run's `modelLock` is set at creation time, it can never
 * change — this is the entire point of the aggregate: a single frozen provider/model decision
 * that every stage dispatch re-checks for availability but never re-resolves.
 */
export function assertLockImmutable(previous: PipelineModelLock, next: PipelineModelLock): void {
    const same =
        previous.policy === next.policy &&
        previous.selectedAt === next.selectedAt &&
        previous.selectedBy === next.selectedBy &&
        previous.requested.providerId === next.requested.providerId &&
        previous.requested.modelId === next.requested.modelId &&
        previous.requested.catalogRevision === next.requested.catalogRevision &&
        previous.effective.providerId === next.effective.providerId &&
        previous.effective.modelId === next.effective.modelId;

    if (!same) {
        throw new Error("PipelineRun: modelLock is immutable once set and cannot be changed");
    }
}

// ── Status transitions ──────────────────────────────────────────────────────

const TERMINAL_STATUSES: ReadonlySet<PipelineRunStatus> = new Set(["completed", "failed", "cancelled"]);

/** Legal transitions, excluding the universal "* -> cancelled" rule handled separately below. */
const ALLOWED_TRANSITIONS: ReadonlyArray<readonly [PipelineRunStatus, PipelineRunStatus]> = [
    ["draft", "ready_for_generation"],
    ["ready_for_generation", "running"],
    ["running", "completed"],
    ["running", "failed"],
    ["running", "blocked"],
    ["draft", "blocked"],
    ["ready_for_generation", "blocked"],
    ["blocked", "ready_for_generation"],
];

/**
 * Throws on any transition not in the allowed set below. `completed`/`failed`/`cancelled` are
 * terminal — no transition out of them is ever legal, including to `cancelled` again.
 *
 * Legal transitions:
 *   draft -> ready_for_generation
 *   ready_for_generation -> running
 *   running -> completed | failed | blocked
 *   draft -> blocked
 *   ready_for_generation -> blocked
 *   blocked -> ready_for_generation   (user supplies a new model; run retries)
 *   <any non-terminal> -> cancelled   (cancellation is always allowed except from a terminal state)
 *
 * `detail` is required whenever `to === "blocked"` — a run can never enter `blocked` without a
 * reason. Callers transitioning to `blocked` must pass the block code/stage that will be
 * persisted as `PipelineRun.blocked`.
 */
export function assertStatusTransition(
    from: PipelineRunStatus,
    to: PipelineRunStatus,
    detail?: { code: ModelSelectionBlockCode; stage: PipelineStage },
): void {
    if (to === "blocked" && !detail) {
        throw new Error('PipelineRun: transition to "blocked" requires a blocked detail (code + stage)');
    }

    if (to === "cancelled") {
        if (TERMINAL_STATUSES.has(from)) {
            throw new Error(`PipelineRun: illegal status transition "${from}" -> "${to}" (already terminal)`);
        }
        return;
    }

    const isAllowed = ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
    if (!isAllowed) {
        throw new Error(`PipelineRun: illegal status transition "${from}" -> "${to}"`);
    }
}

// ── Stage append (immutable) ────────────────────────────────────────────────

/**
 * Returns a new `PipelineRun` with `stage` appended to `stages` — never mutates `run` in
 * place, matching this repo's other entity conventions (e.g. PreviewSnapshot's activate()
 * always returns/persists a fresh document rather than mutating the one passed in).
 */
export function appendStage(run: PipelineRun, stage: PipelineStageExecutionRef): PipelineRun {
    return {
        ...run,
        stages: [...run.stages, stage],
        updatedAt: new Date(),
    };
}
