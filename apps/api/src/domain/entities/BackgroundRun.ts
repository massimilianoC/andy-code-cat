/**
 * BackgroundRun — one Vibe flow carried by the server for one user, in one project
 * (docs/specs/BACKGROUND_RUNS.md §3.2).
 *
 *   queued ─▶ classifying ─▶ briefing ─▶ launching ─▶ generating ─▶ snapshotting ─▶ publishing ─▶ done
 *      └──────────────┴────────────┴────────────┴─────────────┴──────────────┴──────────────┴─▶ failed | cancelled
 *
 * `status` always names the step that has NOT completed yet. Completing a step and entering the
 * next are one write, so a worker that dies at any point leaves a run whose status is exactly the
 * step to (re)start, with every earlier step's output already stored in `outputs`.
 */
import {
    BACKGROUND_RUN_STEPS,
    BACKGROUND_RUN_TERMINAL_STATUSES,
    type BackgroundRunStatus,
    type BackgroundRunStep,
    type GuidedLaunchInput,
} from "@andy-code-cat/contracts";

export type { BackgroundRunStatus, BackgroundRunStep };

export type BackgroundRunTransitionPhase = "started" | "completed" | "failed" | "cancelled" | "deferred";

export interface BackgroundRunTransition {
    status: BackgroundRunStatus;
    phase: BackgroundRunTransitionPhase;
    at: Date;
    workerId?: string;
    detail?: string;
}

/** What each completed step left behind — the resume point of a restarted worker. */
export interface BackgroundRunOutputs {
    classification?: {
        templateId: string | null;
        formatHint: string | null;
        confidence: number;
        skipped: boolean;
        workSessionId?: string;
    };
    brief?: {
        /** The prefill was skipped or failed and the brief was built from the prompt alone. */
        fromPromptOnly: boolean;
        /** The intake that was auto-approved, exactly as the launch received it. */
        intake: GuidedLaunchInput;
        warnings?: string[];
    };
    launch?: {
        pipelineRunId: string;
        conversationId: string;
    };
    generation?: {
        promptExecutionId: string;
        userMessageId: string;
        assistantMessageId?: string;
        snapshotId?: string;
    };
    snapshot?: {
        snapshotId: string;
    };
    publish?: {
        deploymentId: string;
        publishId: string;
        publicUrl: string;
        proposedSlug?: string;
    };
}

export interface BackgroundRunLease {
    workerId: string;
    expiresAt: Date;
    heartbeatAt: Date;
}

export interface BackgroundRunInput {
    prompt: string;
    uiLanguage?: string;
    provider?: string;
    model?: string;
}

export interface BackgroundRunError {
    code: string;
    message: string;
    step?: BackgroundRunStatus;
}

export interface BackgroundRun {
    id: string;
    userId: string;
    projectId: string;
    status: BackgroundRunStatus;
    input: BackgroundRunInput;
    outputs: BackgroundRunOutputs;
    transitions: BackgroundRunTransition[];
    lease: BackgroundRunLease | null;
    /** Number of times a worker claimed the run. */
    attempts: number;
    cancelRequested: boolean;
    /** Not claimable before this instant (a deferred step waiting on something in flight). */
    notBefore?: Date;
    /** Cost recorded so far, EUR, from the journal rows of this run's project. */
    costEur: number;
    error?: BackgroundRunError;
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date;
    finishedAt?: Date;
}

const TERMINAL = new Set<BackgroundRunStatus>(BACKGROUND_RUN_TERMINAL_STATUSES);

export function isTerminalStatus(status: BackgroundRunStatus): boolean {
    return TERMINAL.has(status);
}

/** The step a run in `status` executes next (queued → classifying), or null when terminal. */
export function stepToRun(status: BackgroundRunStatus): BackgroundRunStep | null {
    if (status === "queued") return BACKGROUND_RUN_STEPS[0];
    if (isTerminalStatus(status)) return null;
    return status as BackgroundRunStep;
}

/** The status a run enters when `step` completes. */
export function statusAfter(step: BackgroundRunStep): BackgroundRunStatus {
    const index = BACKGROUND_RUN_STEPS.indexOf(step);
    return index === BACKGROUND_RUN_STEPS.length - 1 ? "done" : BACKGROUND_RUN_STEPS[index + 1]!;
}

/** Legal edges of the state machine. Anything else is a defect and is refused by the repository. */
export function canTransition(from: BackgroundRunStatus, to: BackgroundRunStatus): boolean {
    if (isTerminalStatus(from)) return false;
    if (to === "failed" || to === "cancelled") return true;
    const step = stepToRun(from);
    if (!step) return false;
    // entering the current step (queued → classifying) or completing it (step → next)
    return to === step || to === statusAfter(step);
}
