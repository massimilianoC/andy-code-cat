import type { NewVibeIntake, VibeIntake } from "../entities/VibeIntake";

export type VibeIntakeRecord = VibeIntake;

export interface VibeIntakeRepository {
    /**
     * Records the submission. Called BEFORE the classifier dispatches, so a request that dies early
     * still proves it was made — which is question 1 of
     * docs/specs/SESSION_RECONSTRUCTION_CERTIFICATE.md §3.
     */
    record(intake: NewVibeIntake): Promise<VibeIntakeRecord>;

    /** Names a journal row this intake produced. Append-only; ids accumulate as stages complete. */
    appendPromptExecutionLogId(id: string, promptExecutionLogId: string): Promise<void>;

    listByWorkSession(workSessionId: string, userId: string): Promise<VibeIntakeRecord[]>;
}
