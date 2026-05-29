import type { LlmStructuredArtifacts } from "@andy-code-cat/contracts";
import { extractMediaPlaceholderKeys } from "./replaceMediaPlaceholders";

export interface UnresolvedMediaPlaceholderContext {
    operation: "publish" | "export" | "snapshot_activate";
    projectId: string;
    userId: string;
    snapshotId?: string;
}

export class UnresolvedMediaPlaceholderError extends Error {
    readonly statusCode = 409;

    constructor(
        readonly keys: string[],
        readonly context: UnresolvedMediaPlaceholderContext,
    ) {
        super(`Cannot ${context.operation.replace("_", " ")} while media placeholders are unresolved: ${keys.join(", ")}`);
        this.name = "UnresolvedMediaPlaceholderError";
    }
}

export function assertNoUnresolvedMediaPlaceholders(
    artifacts: Pick<LlmStructuredArtifacts, "html" | "css">,
    context: UnresolvedMediaPlaceholderContext,
): void {
    const keys = extractMediaPlaceholderKeys(artifacts);
    if (keys.length > 0) {
        throw new UnresolvedMediaPlaceholderError(keys, context);
    }
}
