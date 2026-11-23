/**
 * Composition root of the background-run steps (like app.ts for the HTTP routes): the only place
 * that wires concrete repositories into what the worker executes.
 *
 * Phase 1 of docs/specs/BACKGROUND_RUNS.md ships the queue, the state machine and the worker
 * process; the steps themselves (the Vibe orchestrator) arrive in Phase 2. Until then a run that
 * reached the worker is refused explicitly, never left waiting or completed by something else.
 */
import { BackgroundRunStepError, type BackgroundRunSteps } from "../application/background/BackgroundRunEngine";

export function composeBackgroundRunSteps(): BackgroundRunSteps {
    return {
        async guard() {
            throw new BackgroundRunStepError(
                "BACKGROUND_RUN_STEPS_NOT_INSTALLED",
                "This release has the background-run queue but not its steps yet.",
            );
        },
        async execute() {
            return {};
        },
        async measureCostEur() {
            return 0;
        },
    };
}
