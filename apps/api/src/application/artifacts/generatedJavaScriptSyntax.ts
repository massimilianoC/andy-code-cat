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
