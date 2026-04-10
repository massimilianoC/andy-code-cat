/**
 * ExecutionLogger — fire-and-forget singleton for structured execution logging.
 *
 * Usage (non-blocking):
 *   ExecutionLogger.instance.emit({ projectId, domain: "llm", eventType: "llm_generation_complete", ... });
 *
 * The emit() method never throws — errors are swallowed after console.error so callers
 * on the critical path (LLM routes, snapshot routes) are never blocked or failed by a
 * logging side-effect.
 *
 * The singleton is initialised lazily on first access.  Infrastructure code (routes,
 * use-cases) should import and use `ExecutionLogger.instance` directly.
 */

import type { ExecutionLog } from "../../domain/entities/ExecutionLog";
import type { IExecutionLogRepository } from "../../domain/repositories/IExecutionLogRepository";
import { MongoExecutionLogRepository } from "../../infra/repositories/MongoExecutionLogRepository";

type EmitInput = Omit<ExecutionLog, "id" | "createdAt">;

export class ExecutionLogger {
    private static _instance: ExecutionLogger | null = null;

    /** Lazily-initialised singleton. */
    static get instance(): ExecutionLogger {
        if (!ExecutionLogger._instance) {
            ExecutionLogger._instance = new ExecutionLogger(new MongoExecutionLogRepository());
        }
        return ExecutionLogger._instance;
    }

    constructor(private readonly repo: IExecutionLogRepository) { }

    /**
     * Fire-and-forget log emission.
     * Returns void so callers cannot accidentally await it and block the request cycle.
     */
    emit(input: EmitInput): void {
        this.repo.emit(input).catch((err: unknown) => {
            console.error("[ExecutionLogger] Failed to persist log:", err);
        });
    }

    /**
     * Awaitable version — use only where you genuinely need the persisted record
     * (e.g. tests, admin batch scripts).
     */
    async emitAsync(input: EmitInput): Promise<ExecutionLog> {
        return this.repo.emit(input);
    }
}
