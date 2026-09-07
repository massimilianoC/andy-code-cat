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

    /**
     * Every intake for a project, oldest first. Project-scoped rather than session-scoped because
     * the dashboard asks "what did the user type for THIS project", which spans however many
     * sessions it took.
     */
    listByProject(projectId: string, userId: string): Promise<VibeIntakeRecord[]>;

    /** Delete-project cascade — removes every intake recorded for a project. Returns the number removed. */
    deleteByProject(projectId: string, userId: string): Promise<number>;
}
