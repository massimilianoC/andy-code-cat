import type { LeaderboardEntry, LeaderboardScope } from "../entities/LeaderboardEntry";

export interface LeaderboardRepository {
    create(scope: LeaderboardScope, entry: { player: string; score: number }): Promise<LeaderboardEntry>;
    /** Highest scores first; ties go to the earliest entry. */
    top(scope: LeaderboardScope, limit: number): Promise<LeaderboardEntry[]>;
    /** 1-based position of an entry on its board, by the same ordering as top(). */
    rankOf(scope: LeaderboardScope, entry: LeaderboardEntry): Promise<number>;
    deleteById(scope: LeaderboardScope, entryId: string): Promise<boolean>;
    /** Keeps the best `keep` entries of a board and deletes the rest. Returns how many were removed. */
    prune(scope: LeaderboardScope, keep: number): Promise<number>;
    /** Every board of a project, for project deletion. Still scoped to the owner. */
    deleteAllForProject(ownerUserId: string, projectId: string): Promise<number>;
}
