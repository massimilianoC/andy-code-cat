/**
 * The worker loop (BACKGROUND_RUNS.md §3.3): claims runs from the MongoDB queue up to the pool
 * size, keeps each lease alive with a heartbeat, turns a cancel request or a lost lease into an
 * abort of the run in flight, and on shutdown gives its runs back to the queue so the next worker
 * resumes them at the step they were in.
 */
import type { BackgroundRun } from "../../domain/entities/BackgroundRun";
import type { BackgroundRunRepository } from "../../domain/repositories/BackgroundRunRepository";
import { RunInterrupt, type BackgroundRunEngine } from "./BackgroundRunEngine";

export interface BackgroundRunWorkerOptions {
    workerId: string;
    /** Runs executed at once, whole installation — or how to read it (PlatformConfig) at each claim pass. */
    poolSize: number | (() => Promise<number>);
    leaseMs: number;
    pollMs: number;
    /** Called on every loop turn (the container health check reads it). */
    onTick?: () => void;
}

interface ActiveRun {
    controller: AbortController;
    heartbeat: NodeJS.Timeout;
    done: Promise<void>;
}

export class BackgroundRunWorker {
    private readonly active = new Map<string, ActiveRun>();
    private stopping = false;
    private loopPromise: Promise<void> | null = null;
    private wake: (() => void) | null = null;

    constructor(
        private readonly repository: BackgroundRunRepository,
        private readonly engine: BackgroundRunEngine,
        private readonly options: BackgroundRunWorkerOptions,
    ) { }

    start(): void {
        if (this.loopPromise) return;
        this.loopPromise = this.loop();
    }

    get activeRunIds(): string[] {
        return [...this.active.keys()];
    }

    /**
     * Stops claiming, interrupts the runs in flight (their leases are released so another worker
     * resumes them) and waits up to `graceMs` for them to settle.
     */
    async stop(graceMs: number): Promise<void> {
        this.stopping = true;
        this.wake?.();
        for (const run of this.active.values()) run.controller.abort(new RunInterrupt("shutdown"));
        const settled = Promise.all([...this.active.values()].map((run) => run.done));
        await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, graceMs))]);
        await this.loopPromise?.catch(() => undefined);
    }

    /** One pass: claim as many runs as the pool allows. Returns how many were claimed. */
    async tick(): Promise<number> {
        this.options.onTick?.();
        let claimed = 0;
        const poolSize = typeof this.options.poolSize === "function" ? await this.options.poolSize() : this.options.poolSize;
        while (!this.stopping && this.active.size < poolSize) {
            const now = new Date();
            if (await this.repository.countLeased(now) >= poolSize) break;
            const run = await this.repository.claimNext({ workerId: this.options.workerId, leaseMs: this.options.leaseMs, now });
            if (!run) break;
            claimed += 1;
            this.launch(run);
        }
        return claimed;
    }

    /** Resolves when every run this worker holds right now has settled (tests). */
    async drain(): Promise<void> {
        await Promise.all([...this.active.values()].map((run) => run.done));
    }

    private async loop(): Promise<void> {
        while (!this.stopping) {
            let claimed = 0;
            try {
                claimed = await this.tick();
            } catch (error) {
                console.error("[background-worker] claim failed", error);
            }
            if (this.stopping) break;
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, claimed > 0 ? 250 : this.options.pollMs);
                this.wake = () => { clearTimeout(timer); resolve(); };
            });
            this.wake = null;
        }
    }

    private launch(run: BackgroundRun): void {
        const controller = new AbortController();
        const heartbeatEvery = Math.max(1000, Math.floor(this.options.leaseMs / 3));
        const heartbeat = setInterval(() => {
            void this.repository.renewLease(run.id, this.options.workerId, this.options.leaseMs, new Date())
                .then((renewed) => {
                    if (controller.signal.aborted) return;
                    if (!renewed) controller.abort(new RunInterrupt("lease_lost"));
                    else if (renewed.cancelRequested) controller.abort(new RunInterrupt("cancelled"));
                })
                .catch((error: unknown) => console.error(`[background-worker] heartbeat failed for ${run.id}`, error));
        }, heartbeatEvery);

        console.log(`[background-worker] ${this.options.workerId} claimed ${run.id} at ${run.status} (attempt ${run.attempts})`);
        const done = this.engine.process(run, this.options.workerId, controller.signal)
            .then((ended) => {
                console.log(`[background-worker] ${run.id} left at ${ended?.status ?? "lease lost"}`);
            })
            .catch((error: unknown) => {
                console.error(`[background-worker] ${run.id} crashed`, error);
            })
            .finally(() => {
                clearInterval(heartbeat);
                this.active.delete(run.id);
                this.wake?.();
            });
        this.active.set(run.id, { controller, heartbeat, done });
    }
}
