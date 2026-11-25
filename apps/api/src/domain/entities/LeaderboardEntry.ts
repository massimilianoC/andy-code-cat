/**
 * Mandatory scope of every leaderboard read and write. There is no query without all three: the
 * repository contract takes the scope as a whole, never as optional filters.
 */
export interface LeaderboardScope {
    ownerUserId: string;
    projectId: string;
    boardId: string;
}

export interface LeaderboardEntry extends LeaderboardScope {
    id: string;
    player: string;
    score: number;
    createdAt: Date;
}
