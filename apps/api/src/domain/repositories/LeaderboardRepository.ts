import type { LeaderboardBoardSummary, LeaderboardEntry, LeaderboardProjectBest, LeaderboardProjectScope, LeaderboardScope } from "../entities/LeaderboardEntry";

export interface LeaderboardEntryListQuery {
    /** One board, or every board of the project when undefined. */
    boardId?: string;
    /** Plain text, matched case-insensitively as a substring of the player name. Never a pattern. */
    playerContains?: string;
    skip: number;
    limit: number;
}

export interface LeaderboardRepository {
    create(scope: LeaderboardScope, entry: { player: string; score: number }): Promise<LeaderboardEntry>;
    /** Highest scores first; ties go to the earliest entry. */
    top(scope: LeaderboardScope, limit: number): Promise<LeaderboardEntry[]>;
    /** 1-based position of an entry on its board, by the same ordering as top(). */
    rankOf(scope: LeaderboardScope, entry: LeaderboardEntry): Promise<number>;
    deleteById(scope: LeaderboardScope, entryId: string): Promise<boolean>;
    /** Keeps the best `keep` entries of a board and deletes the rest. Returns how many were removed. */
    prune(scope: LeaderboardScope, keep: number): Promise<number>;

    /** The best entry of one board in every project of one owner, by the same ordering as top(). */
    bestPerProject(ownerUserId: string, boardId: string): Promise<LeaderboardProjectBest[]>;

    // ── Owner data panel (docs/specs/PROJECT_DATA_PANEL.md) ─────────────────────────────────────
    /** Every board of the project that holds at least one entry. */
    boards(scope: LeaderboardProjectScope): Promise<LeaderboardBoardSummary[]>;
    /** Newest first, with the total matching the same filter. */
    listNewest(scope: LeaderboardProjectScope, query: LeaderboardEntryListQuery): Promise<{ items: LeaderboardEntry[]; total: number }>;
    /** One entry of the project, whichever board it is on. */
    deleteInProject(scope: LeaderboardProjectScope, entryId: string): Promise<boolean>;
    /** One board, or every board of the project when boardId is undefined. Returns entries removed. */
    clear(scope: LeaderboardProjectScope, boardId?: string): Promise<number>;
}
