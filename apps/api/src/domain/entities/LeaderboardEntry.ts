/**
 * Mandatory scope of every leaderboard read and write. There is no query without all three: the
 * repository contract takes the scope as a whole, never as optional filters.
 */
export interface LeaderboardScope extends LeaderboardProjectScope {
    boardId: string;
}

/** Every board of one project of one owner: the scope of the owner's data panel and of deletion. */
export interface LeaderboardProjectScope {
    ownerUserId: string;
    projectId: string;
}

export interface LeaderboardBoardSummary {
    boardId: string;
    entries: number;
    lastWriteAt: Date;
}

/** Best entry of one board of one project: a row of the owner's Arcade shelf. */
export interface LeaderboardProjectBest {
    projectId: string;
    boardId: string;
    entries: number;
    best: LeaderboardEntry;
}

export interface LeaderboardEntry extends LeaderboardScope {
    id: string;
    player: string;
    score: number;
    createdAt: Date;
}
