import type { NewWorkSession, WorkSession, WorkSessionStatus } from "../entities/WorkSession";

export type WorkSessionRecord = WorkSession;

export interface WorkSessionRepository {
    open(session: NewWorkSession): Promise<WorkSessionRecord>;

    /**
     * Ownership-scoped finder (double sandbox) — mirrors `PipelineRunRepository.findByIdForUser`:
     * the `userId` filter is applied in the query, not as an application-layer afterthought.
     * Returns null both when the session does not exist and when it exists but belongs to someone
     * else; callers must not be able to tell the two apart.
     */
    findByIdForUser(id: string, userId: string): Promise<WorkSessionRecord | null>;

    /** A project's sessions, newest first. */
    listByProject(projectId: string, userId: string, limit?: number): Promise<WorkSessionRecord[]>;

    /**
     * A user's sessions, newest first — including the ones that never reached a project, which are
     * the interesting failures: a Vibe request that died before producing anything leaves no other
     * trace at all.
     */
    listByUser(userId: string, limit?: number): Promise<WorkSessionRecord[]>;

    /**
     * The still-open session for this project, if any.
     *
     * The fallback that keeps a chain joined when the client does not echo the session id back.
     * "Open" is the whole condition — a session that has produced its artifact is closed, so an open
     * one is by definition the intent currently in progress on that project. This is an explicit key
     * the client already pins its follow-up calls to, not a timestamp correlation, which the
     * certificate forbids.
     */
    findOpenByProject(projectId: string, userId: string): Promise<WorkSessionRecord | null>;

    /** Binds the session to the project it produced, once that project exists. */
    attachProject(id: string, projectId: string): Promise<WorkSessionRecord>;

    setStatus(id: string, status: WorkSessionStatus, failureReason?: string): Promise<WorkSessionRecord>;
}
