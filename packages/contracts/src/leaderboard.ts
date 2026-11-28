import { z } from "zod";

/**
 * Leaderboard — the first persistent platform capability (docs/specs/ARCADE_MODE_MVP.md).
 *
 * A generated game never talks to the network. It calls `window.AndyArcade.submitScore(n)`, the
 * platform runtime hands the score to the Arcade shell, and the shell stores it here for the
 * project owner. Every stored entry is scoped to { ownerUserId, projectId, boardId }.
 */

export const LEADERBOARD_DEFAULT_BOARD_ID = "default";
export const LEADERBOARD_MAX_SCORE = 1_000_000_000;
export const LEADERBOARD_PLAYER_MAX_CHARS = 16;
export const LEADERBOARD_TOP_DEFAULT = 10;
export const LEADERBOARD_TOP_MAX = 50;

export const leaderboardBoardIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "Invalid board id");

export const submitLeaderboardScoreSchema = z.object({
    boardId: leaderboardBoardIdSchema.default(LEADERBOARD_DEFAULT_BOARD_ID),
    player: z.string()
        .trim()
        .min(1)
        .max(LEADERBOARD_PLAYER_MAX_CHARS)
        .regex(/^[\p{L}\p{N} ._-]+$/u, "Letters, digits, spaces and . _ - only"),
    score: z.number().int().min(0).max(LEADERBOARD_MAX_SCORE),
}).strict();

export type SubmitLeaderboardScoreInput = z.infer<typeof submitLeaderboardScoreSchema>;

export const listLeaderboardQuerySchema = z.object({
    boardId: leaderboardBoardIdSchema.default(LEADERBOARD_DEFAULT_BOARD_ID),
    limit: z.coerce.number().int().min(1).max(LEADERBOARD_TOP_MAX).default(LEADERBOARD_TOP_DEFAULT),
});

export interface LeaderboardEntryDto {
    id: string;
    boardId: string;
    player: string;
    score: number;
    createdAt: string;
}

/** Best score of one project's board, for the Arcade shelf (one request for every game). */
export interface LeaderboardProjectSummaryDto {
    projectId: string;
    boardId: string;
    entries: number;
    best: { player: string; score: number; createdAt: string };
}

export interface LeaderboardSubmitResultDto {
    entry: LeaderboardEntryDto;
    /** 1-based position of the new entry on its board. */
    rank: number;
    top: LeaderboardEntryDto[];
}
