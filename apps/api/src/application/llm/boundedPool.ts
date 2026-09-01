/**
 * Bounded-concurrency awaiter for the section fan-out
 * (docs/specs/PARALLEL_SECTION_GENERATION_SPEC.md §3.3, §8.1).
 *
 * Why not `Promise.all`: it is unbounded on both axes that matter here.
 *
 *   - Concurrency. A ten-way burst at one provider draws 429s, which the chat route already has to
 *     surface as LLM_PROVIDER_RATE_LIMIT. Rate-limiting ourselves into failure would be a strange
 *     way to make generation faster.
 *   - Failure. `Promise.all` rejects on the first failure and abandons the rest; a fan-out must
 *     collect what succeeded, because nine sections and one labelled gap is a result, while nine
 *     discarded sections is not.
 *
 * And one axis `allSettled` still does not cover: a task that never returns. The run carries a
 * wall-clock ceiling, so a straggler is abandoned rather than allowed to extend the run past it —
 * "guaranteed result, bounded time" means the ceiling wins and the section degrades.
 */

export interface BoundedPoolOptions {
    /** Maximum tasks in flight at once. */
    concurrency: number;
    /** Per-task ceiling. A task still running at this point is abandoned and reported as timed out. */
    taskTimeoutMs?: number;
    /**
     * Whole-run ceiling. Once passed, tasks not yet STARTED are never started and are reported as
     * skipped. Tasks already in flight keep their own per-task ceiling — killing work already paid
     * for buys nothing.
     */
    totalTimeoutMs?: number;
}

export type BoundedPoolOutcome<T> =
    | { status: "fulfilled"; index: number; value: T; durationMs: number }
    | { status: "rejected"; index: number; reason: Error; durationMs: number }
    | { status: "timeout"; index: number; durationMs: number }
    | { status: "skipped"; index: number };

export interface BoundedPoolResult<T> {
    outcomes: BoundedPoolOutcome<T>[];
    durationMs: number;
    /** True when the whole-run ceiling stopped tasks from being started. */
    hitTotalTimeout: boolean;
}

function timeout(ms: number): { promise: Promise<never>; cancel: () => void } {
    let handle: NodeJS.Timeout;
    const promise = new Promise<never>((_resolve, reject) => {
        handle = setTimeout(() => reject(new Error(`task exceeded ${ms}ms`)), ms);
    });
    return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * Runs `tasks` with at most `concurrency` in flight, in completion order, never rejecting.
 *
 * Outcomes are returned in task order (`outcomes[i]` describes `tasks[i]`), so a caller can line
 * them up against whatever it fanned out from without carrying its own bookkeeping.
 *
 * `onSettled` fires as each task lands — this is what lets a section reach the user the moment it is
 * ready instead of waiting for its siblings, which is the whole reason the fan-out replaces a
 * separate progress-inspector feature.
 */
export async function runBoundedPool<T>(
    tasks: Array<() => Promise<T>>,
    options: BoundedPoolOptions,
    onSettled?: (outcome: BoundedPoolOutcome<T>) => void,
): Promise<BoundedPoolResult<T>> {
    const startedAt = Date.now();
    const concurrency = Math.max(1, Math.floor(options.concurrency));
    const outcomes = new Array<BoundedPoolOutcome<T>>(tasks.length);
    let hitTotalTimeout = false;
    let next = 0;

    const settle = (outcome: BoundedPoolOutcome<T>) => {
        outcomes[outcome.index] = outcome;
        onSettled?.(outcome);
    };

    const totalExpired = () =>
        options.totalTimeoutMs != null && Date.now() - startedAt >= options.totalTimeoutMs;

    async function worker(): Promise<void> {
        for (;;) {
            const index = next++;
            const task = tasks[index];
            if (task === undefined) return;

            // Checked at pick-up rather than at dispatch: a task the ceiling has already passed
            // should never start, but one that started before it is left to its own timeout.
            if (totalExpired()) {
                hitTotalTimeout = true;
                settle({ status: "skipped", index });
                continue;
            }

            const taskStartedAt = Date.now();
            const guard = options.taskTimeoutMs != null ? timeout(options.taskTimeoutMs) : null;
            try {
                const value = guard
                    ? await Promise.race([task(), guard.promise])
                    : await task();
                settle({ status: "fulfilled", index, value, durationMs: Date.now() - taskStartedAt });
            } catch (error) {
                const durationMs = Date.now() - taskStartedAt;
                const isTimeout =
                    options.taskTimeoutMs != null && durationMs >= options.taskTimeoutMs;
                if (isTimeout) {
                    settle({ status: "timeout", index, durationMs });
                } else {
                    settle({
                        status: "rejected",
                        index,
                        reason: error instanceof Error ? error : new Error(String(error)),
                        durationMs,
                    });
                }
            } finally {
                guard?.cancel();
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
    );

    return { outcomes, durationMs: Date.now() - startedAt, hitTotalTimeout };
}
