import type { LeaderboardEntry } from "../../domain/entities/LeaderboardEntry";
import type {
    ProjectDataCapability,
    ProjectDataGroupSummary,
    ProjectDataListQuery,
    ProjectDataRecord,
    ProjectDataScope,
} from "../../domain/projectData/ProjectDataCapability";
import type { LeaderboardRepository } from "../../domain/repositories/LeaderboardRepository";

function toRecord(entry: LeaderboardEntry): ProjectDataRecord {
    return {
        id: entry.id,
        groupId: entry.boardId,
        createdAt: entry.createdAt,
        data: { player: entry.player, score: entry.score },
    };
}

/**
 * Arcade leaderboards as project data: one group per board, one record per stored score.
 * The owner and project come from the scope only; the repository spreads them into every filter.
 */
export class LeaderboardProjectData implements ProjectDataCapability {
    readonly id = "leaderboard";
    readonly label = "Leaderboards";

    constructor(private readonly repository: LeaderboardRepository) { }

    async groups(scope: ProjectDataScope): Promise<ProjectDataGroupSummary[]> {
        const boards = await this.repository.boards(scope);
        return boards.map((board) => ({ id: board.boardId, label: board.boardId, records: board.entries, lastWriteAt: board.lastWriteAt }));
    }

    async list(scope: ProjectDataScope, query: ProjectDataListQuery): Promise<{ items: ProjectDataRecord[]; total: number }> {
        const { items, total } = await this.repository.listNewest(scope, {
            boardId: query.groupId,
            playerContains: query.search || undefined,
            skip: (query.page - 1) * query.limit,
            limit: query.limit,
        });
        return { items: items.map(toRecord), total };
    }

    async exportRecords(scope: ProjectDataScope, groupId: string | undefined, max: number): Promise<ProjectDataRecord[]> {
        const { items } = await this.repository.listNewest(scope, { boardId: groupId, skip: 0, limit: max });
        return items.map(toRecord);
    }

    deleteRecord(scope: ProjectDataScope, recordId: string): Promise<boolean> {
        return this.repository.deleteInProject(scope, recordId);
    }

    clear(scope: ProjectDataScope, groupId?: string): Promise<number> {
        return this.repository.clear(scope, groupId);
    }
}
