import { ExecutionLogger } from "../services/ExecutionLogger";
import { resolveModelSelection, type ModelSelectionDecision, type ResolveModelSelectionInput } from "./modelSelection";

/**
 * I8 shadow-mode instrumentation (see docs/SSOT_REFACTOR_PROGRESS.md and
 * docs/specs/SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md).
 *
 * Computes what `policy: "strict"` would have decided for the exact same input already used
 * to make a real (`policy: "legacy"`) dispatch decision, and logs a divergence if the two
 * disagree. This is a pure observation mechanism: it NEVER changes what the caller actually
 * dispatches, never throws into the caller's control flow, and its own evaluation failure is
 * swallowed after logging so a bug here can never break the real request path.
 */

export interface ModelSelectionShadowContext {
    projectId: string;
    conversationId?: string;
    taskKey: string;
}

export function observeModelSelectionShadow(
    input: ResolveModelSelectionInput,
    legacyDecision: ModelSelectionDecision,
    context: ModelSelectionShadowContext,
): void {
    try {
        const strictDecision = resolveModelSelection({ ...input, policy: "strict" });

        const diverges =
            Boolean(strictDecision.blocked) ||
            strictDecision.effective.provider !== legacyDecision.effective.provider ||
            strictDecision.effective.model !== legacyDecision.effective.model;

        if (!diverges) return;

        ExecutionLogger.instance.emit({
            projectId: context.projectId,
            conversationId: context.conversationId,
            domain: "llm",
            eventType: "model_selection_shadow_divergence",
            level: "warn",
            status: "success",
            metadata: {
                taskKey: context.taskKey,
                legacyEffective: legacyDecision.effective,
                strictEffective: strictDecision.effective,
                strictBlocked: strictDecision.blocked,
            },
        });
    } catch (err) {
        console.error("[modelSelectionShadow] evaluation failed (dispatch unaffected):", err);
    }
}
