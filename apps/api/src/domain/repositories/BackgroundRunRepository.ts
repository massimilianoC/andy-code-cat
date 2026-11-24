import type {
    BackgroundRun,
    BackgroundRunError,
    BackgroundRunInput,
    BackgroundRunOutputs,
    BackgroundRunStatus,
    BackgroundRunTransitionPhase,
} from "../entities/BackgroundRun";

export interface RecordBackgroundRunTransition {
    /** The status the run moves to (or stays in, for "started" / "deferred"). */
    status: BackgroundRunStatus;
    /** What happened, recorded in the transition log. */
    phase: BackgroundRunTransitionPhase;
    /** The status the log entry names, when it differs from the new status (a step completing). */
    loggedAs?: BackgroundRunStatus;
    /** The status the run must currently be in — the write is refused otherwise. */
    expectedStatus: BackgroundRunStatus;
    /** Merged into `outputs` (shallow, per step key). */
    outputs?: Partial<BackgroundRunOutputs>;
    costEur?: number;
    error?: BackgroundRunError;
    detail?: string;
}

/**
 * Every method that changes a claimed run takes the worker id and only writes while that worker
 * still holds the lease: a worker whose lease expired (and whose run another worker picked up)
 * can no longer move it. Reads for users are always scoped by `userId` — an id alone finds nothing.
 */
export interface BackgroundRunRepository {
    create(input: { userId: string; projectId: string; input: BackgroundRunInput }): Promise<BackgroundRun>;
    findByIdForUser(id: string, userId: string): Promise<BackgroundRun | null>;
    listForUser(userId: string, limit: number): Promise<BackgroundRun[]>;
    /** Runs of the user that are not terminal (queued or in progress). */
    countActiveForUser(userId: string): Promise<number>;
    /** Runs currently held by a live lease, whole installation. */
    countLeased(now: Date): Promise<number>;
    deleteById(id: string, userId: string): Promise<boolean>;

    /** Atomically takes the oldest claimable run: not terminal, no live lease, not deferred. */
    claimNext(input: { workerId: string; leaseMs: number; now: Date }): Promise<BackgroundRun | null>;
    /** Extends the lease; null when the worker no longer holds it. */
    renewLease(id: string, workerId: string, leaseMs: number, now: Date): Promise<BackgroundRun | null>;
    /** Gives the run back to the queue, optionally not before `notBefore`. */
    releaseLease(id: string, workerId: string, notBefore?: Date, detail?: string): Promise<boolean>;
    /** Appends a transition and applies it; null when the lease is lost or the status moved. */
    recordTransition(id: string, workerId: string, transition: RecordBackgroundRunTransition): Promise<BackgroundRun | null>;

    /** Stores the live progress of the step in flight; false when the lease is lost. */
    recordProgress(id: string, workerId: string, progress: { generatedChars: number }, now: Date): Promise<boolean>;

    /**
     * The owner asks to stop. A queued run nobody holds is cancelled at once; a run in progress
     * is flagged and the worker stops it at its next heartbeat or step boundary.
     */
    requestCancel(id: string, userId: string, now: Date): Promise<BackgroundRun | null>;
}
