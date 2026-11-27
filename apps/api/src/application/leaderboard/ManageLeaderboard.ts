import type { LeaderboardEntryDto, LeaderboardProjectSummaryDto, LeaderboardSubmitResultDto } from "@andy-code-cat/contracts";
import type { LeaderboardEntry, LeaderboardScope } from "../../domain/entities/LeaderboardEntry";
import type { LeaderboardRepository } from "../../domain/repositories/LeaderboardRepository";

/** A board keeps its best entries only: storage stays bounded however long a console runs. */
export const LEADERBOARD_ENTRIES_KEPT_PER_BOARD = 500;

export function toLeaderboardEntryDto(entry: LeaderboardEntry): LeaderboardEntryDto {
    return {
        id: entry.id,
        boardId: entry.boardId,
        player: entry.player,
        score: entry.score,
        createdAt: entry.createdAt.toISOString(),
    };
}

export class ManageLeaderboard {
    constructor(private readonly repository: LeaderboardRepository) { }

    async top(scope: LeaderboardScope, limit: number): Promise<LeaderboardEntryDto[]> {
        return (await this.repository.top(scope, limit)).map(toLeaderboardEntryDto);
    }

    async submit(scope: LeaderboardScope, input: { player: string; score: number }, topLimit: number): Promise<LeaderboardSubmitResultDto> {
        const entry = await this.repository.create(scope, { player: input.player.trim(), score: input.score });
        const rank = await this.repository.rankOf(scope, entry);
        await this.repository.prune(scope, LEADERBOARD_ENTRIES_KEPT_PER_BOARD);
        const top = await this.top(scope, topLimit);
        return { entry: toLeaderboardEntryDto(entry), rank, top };
    }

    /** One row per game of the owner that has at least one score on the board. */
    async summary(ownerUserId: string, boardId: string): Promise<LeaderboardProjectSummaryDto[]> {
        const rows = await this.repository.bestPerProject(ownerUserId, boardId);
        return rows.map((row) => ({
            projectId: row.projectId,
            boardId: row.boardId,
            entries: row.entries,
            best: { player: row.best.player, score: row.best.score, createdAt: row.best.createdAt.toISOString() },
        }));
    }

    async remove(scope: LeaderboardScope, entryId: string): Promise<boolean> {
        return this.repository.deleteById(scope, entryId);
    }
}
