import { ExecutionLogger } from "../services/ExecutionLogger";

/** The execution-log line every failed LLM call leaves behind (generation and optimisation). */
export function emitLlmFailureLog(input: {
    projectId: string;
    durationMs: number;
    provider?: string;
    model?: string;
    code?: string;
    message: string;
    details?: unknown;
    isFocusedMode?: boolean;
}) {
    ExecutionLogger.instance.emit({
        projectId: input.projectId,
        domain: "llm",
        eventType: "llm_generation_failed",
        level: "error",
        status: "failure",
        durationMs: input.durationMs,
        metadata: {
            provider: input.provider,
            model: input.model,
            code: input.code,
            message: input.message,
            details: input.details,
            isFocusedMode: input.isFocusedMode,
        },
    });
}
