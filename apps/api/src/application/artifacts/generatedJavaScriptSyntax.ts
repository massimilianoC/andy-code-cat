import { Script } from "node:vm";

export class GeneratedJavaScriptSyntaxError extends Error {
    readonly statusCode = 422;
    readonly code = "INVALID_GENERATED_JAVASCRIPT";
    readonly diagnostic: { file: "artifacts.js"; line?: number; column?: number };

    constructor(cause: unknown) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        super(`Generated artifacts.js is not valid JavaScript: ${error.message}`);
        this.name = "GeneratedJavaScriptSyntaxError";
        const location = error.stack?.match(/artifacts\.js:(\d+)(?::(\d+))?/);
        this.diagnostic = {
            file: "artifacts.js",
            line: location?.[1] ? Number(location[1]) : undefined,
            column: location?.[2] ? Number(location[2]) : undefined,
        };
    }
}

/** Parses generated JavaScript without executing it. */
export function assertGeneratedJavaScriptSyntax(source: string): void {
    if (!source.trim()) return;
    try {
        new Script(source, { filename: "artifacts.js" });
    } catch (error) {
        throw new GeneratedJavaScriptSyntaxError(error);
    }
}

/**
 * Evidence, not just a verdict.
 *
 * `new Script(source)` either parses or it does not — the check is fully deterministic, the same
 * source always gives the same answer — so when it says no it can say exactly where. Returning only
 * "Unexpected token ')'" makes the user hunt through thirty thousand characters of generated code
 * for a bracket; returning the line number and the line itself makes it something they can paste
 * back into the chat and have fixed.
 */
export interface GeneratedJavaScriptDiagnosis {
    message: string;
    line?: number;
    column?: number;
    /** The offending source line, trimmed. Absent when the error carries no location. */
    sourceLine?: string;
}

/**
 * The same check, reported instead of thrown.
 *
 * `assertGeneratedJavaScriptSyntax` guards the STORAGE boundaries — snapshot, export, publish —
 * where refusing is right: a stored version whose scripts do not compile becomes a dead page and
 * the base of the next edit. But it was only ever called there, so a generation whose JavaScript
 * was broken came back to the client looking perfectly fine, and the user learned about it only
 * when the snapshot write was rejected — after paying for the generation, with nothing said.
 *
 * At the GENERATION boundary refusing would be worse than the defect: it would discard a complete
 * artifact, and ten minutes of work, over a missing bracket the user could ask the model to fix.
 * So this reports and the caller decides — one guard, two boundaries, opposite correct answers.
 */
export function describeGeneratedJavaScriptSyntaxError(source: string): GeneratedJavaScriptDiagnosis | undefined {
    try {
        assertGeneratedJavaScriptSyntax(source);
        return undefined;
    } catch (error) {
        const err = error instanceof GeneratedJavaScriptSyntaxError
            ? error
            : new GeneratedJavaScriptSyntaxError(error);
        const line = err.diagnostic.line;
        const sourceLine = line ? source.split(/\r?\n/)[line - 1]?.trim() : undefined;
        return {
            message: err.message,
            line,
            column: err.diagnostic.column,
            // Bounded: a generated line can be a whole minified function, and a diagnostic that
            // scrolls off the screen is no more useful than none.
            sourceLine: sourceLine ? sourceLine.slice(0, 240) : undefined,
        };
    }
}
