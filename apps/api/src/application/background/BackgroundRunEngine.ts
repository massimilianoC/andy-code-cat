/**
 * Drives one claimed BackgroundRun through its state machine (BACKGROUND_RUNS.md §3.2).
 *
 * For every step: re-check the run's authority (guard), write "started", execute, measure the cost,
 * then write "completed" and enter the next status in ONE conditional write. A worker that dies
 * anywhere leaves `status` = the step to restart and every earlier output stored; the steps
 * themselves are written to be resumable (they look at `outputs` and at the journal before doing
 * paid work again).
 *
 * The engine knows nothing about Vibe: what each step does is `BackgroundRunSteps`. It only owns
 * the order, the persistence of every transition, the cost ceiling and how a run ends.
 */
import type { BackgroundRun, BackgroundRunOutputs, BackgroundRunStep } from "../../domain/entities/BackgroundRun";
import { isTerminalStatus, statusAfter, stepToRun } from "../../domain/entities/BackgroundRun";
import type { BackgroundRunRepository } from "../../domain/repositories/BackgroundRunRepository";

export type RunInterruptReason = "cancelled" | "shutdown" | "lease_lost";

/** Passed as an AbortSignal reason: why the worker stopped a run in flight. */
export class RunInterrupt extends Error {
    constructor(readonly reason: RunInterruptReason) {
        super(`background run interrupted: ${reason}`);
        this.name = "RunInterrupt";
    }
}

/** A step that cannot proceed yet (e.g. a call of a previous attempt still in flight). */
export class BackgroundRunDeferred extends Error {
    constructor(message: string, readonly retryAfterMs: number) {
        super(message);
        this.name = "BackgroundRunDeferred";
    }
}

/** A step refused or failed for a reason the user should see; `code` is stable. */
export class BackgroundRunStepError extends Error {
    constructor(readonly code: string, message: string) {
        super(message);
        this.name = "BackgroundRunStepError";
    }
}

export interface BackgroundRunStepContext {
    run: BackgroundRun;
    workerId: string;
    signal: AbortSignal;
}

export interface BackgroundRunSteps {
    /**
     * Re-checks, before every step, that the run may still act: owner not blocked, project still
     * owned, limits. Throws `BackgroundRunStepError` to refuse.
     */
    guard(ctx: BackgroundRunStepContext, step: BackgroundRunStep): Promise<void>;
    /** Does the step's work and returns what it produced. Must be resumable. */
    execute(step: BackgroundRunStep, ctx: BackgroundRunStepContext): Promise<Partial<BackgroundRunOutputs>>;
    /** What the run has cost so far, EUR — read after every step. */
    measureCostEur(ctx: BackgroundRunStepContext): Promise<number>;
    /** Called once when the run reached done or failed (notification). Never throws into the engine. */
    onFinished?(run: BackgroundRun): Promise<void>;
}

export interface BackgroundRunEngineOptions {
    maxCostEur: number;
    maxAttempts: number;
}

function describe(error: unknown): { code: string; message: string } {
    if (error instanceof BackgroundRunStepError) return { code: error.code, message: error.message };
    const candidate = error as { code?: unknown; userMessage?: unknown; message?: unknown };
    const code = typeof candidate?.code === "string" ? candidate.code : "BACKGROUND_RUN_STEP_FAILED";
    const message = typeof candidate?.userMessage === "string"
        ? candidate.userMessage
        : error instanceof Error ? error.message : String(error);
    return { code, message: message.slice(0, 500) };
}

export class BackgroundRunEngine {
    constructor(
        private readonly repository: BackgroundRunRepository,
        private readonly steps: BackgroundRunSteps,
        private readonly options: BackgroundRunEngineOptions,
    ) { }

    /** Returns the run as left by this worker (null when the lease was lost along the way). */
    async process(claimed: BackgroundRun, workerId: string, signal: AbortSignal): Promise<BackgroundRun | null> {
        let run: BackgroundRun = claimed;
        try {
            if (run.cancelRequested) throw new RunInterrupt("cancelled");
            if (run.attempts > this.options.maxAttempts) {
                throw new BackgroundRunStepError(
                    "BACKGROUND_RUN_TOO_MANY_ATTEMPTS",
                    `The run was picked up ${run.attempts - 1} times without finishing; it is stopped rather than retried again.`,
                );
            }

            for (let step = stepToRun(run.status); step; step = stepToRun(run.status)) {
                this.throwIfInterrupted(signal);
                // Every write returns the stored run, so a cancel request is seen at each boundary
                // even between two heartbeats.
                if (run.cancelRequested) throw new RunInterrupt("cancelled");
                const ctx: BackgroundRunStepContext = { run, workerId, signal };
                await this.steps.guard(ctx, step);
                this.throwIfInterrupted(signal);

                run = await this.write(run.id, workerId, {
                    status: step,
                    phase: "started",
                    expectedStatus: run.status,
                    detail: run.status === step ? `resumed (attempt ${run.attempts})` : undefined,
                });

                const outputs = await this.steps.execute(step, { run, workerId, signal });
                this.throwIfInterrupted(signal);
                const costEur = await this.steps.measureCostEur({ run, workerId, signal });

                run = await this.write(run.id, workerId, {
                    status: statusAfter(step),
                    loggedAs: step,
                    phase: "completed",
                    expectedStatus: step,
                    outputs,
                    costEur,
                });

                if (costEur > this.options.maxCostEur && !isTerminalStatus(run.status)) {
                    throw new BackgroundRunStepError(
                        "BACKGROUND_RUN_COST_CEILING",
                        `The run has cost €${costEur.toFixed(4)}, above its ceiling of €${this.options.maxCostEur.toFixed(2)}; it is stopped.`,
                    );
                }
            }
            await this.finished(run);
            return run;
        } catch (error) {
            return this.end(run, workerId, signal, error);
        }
    }

    private throwIfInterrupted(signal: AbortSignal): void {
        if (signal.aborted) {
            throw signal.reason instanceof RunInterrupt ? signal.reason : new RunInterrupt("shutdown");
        }
    }

    private async write(
        id: string,
        workerId: string,
        transition: Parameters<BackgroundRunRepository["recordTransition"]>[2],
    ): Promise<BackgroundRun> {
        const updated = await this.repository.recordTransition(id, workerId, transition);
        if (!updated) throw new RunInterrupt("lease_lost");
        return updated;
    }

    private async end(run: BackgroundRun, workerId: string, signal: AbortSignal, error: unknown): Promise<BackgroundRun | null> {
        // An abort explains whatever error the step raised while being aborted.
        const interrupt = error instanceof RunInterrupt
            ? error
            : signal.aborted && signal.reason instanceof RunInterrupt ? signal.reason : null;

        if (interrupt?.reason === "lease_lost") {
            console.warn(`[background-run] ${run.id}: lease lost at ${run.status}; another worker owns it now`);
            return null;
        }
        if (interrupt?.reason === "shutdown") {
            // Given back to the queue as it stands: the next worker resumes this very step.
            await this.repository.releaseLease(run.id, workerId, undefined, "worker shutdown").catch(() => false);
            return run;
        }
        if (error instanceof BackgroundRunDeferred && !interrupt) {
            await this.repository.releaseLease(run.id, workerId, new Date(Date.now() + error.retryAfterMs), error.message)
                .catch(() => false);
            return run;
        }

        if (isTerminalStatus(run.status)) return run;
        const cancelled = interrupt?.reason === "cancelled";
        const described = cancelled ? { code: "BACKGROUND_RUN_CANCELLED", message: "Cancelled by the owner." } : describe(error);
        if (!cancelled) {
            console.error(`[background-run] ${run.id} failed at ${run.status}: ${described.code} ${described.message}`);
        }
        const costEur = await this.steps.measureCostEur({ run, workerId, signal }).catch(() => run.costEur);
        const ended = await this.repository.recordTransition(run.id, workerId, {
            status: cancelled ? "cancelled" : "failed",
            phase: cancelled ? "cancelled" : "failed",
            expectedStatus: run.status,
            costEur,
            error: { ...described, step: run.status },
            detail: described.message,
        }).catch((writeError: unknown) => {
            console.error(`[background-run] ${run.id}: could not record the end of the run`, writeError);
            return null;
        });
        if (ended) await this.finished(ended);
        return ended;
    }

    private async finished(run: BackgroundRun): Promise<void> {
        if (run.status !== "done" && run.status !== "failed") return;
        try {
            await this.steps.onFinished?.(run);
        } catch (error) {
            console.error(`[background-run] ${run.id}: completion hook failed`, error);
        }
    }
}
