import type { PublishHistoryEntry } from "../entities/PublishHistory";

export interface PublishHistoryRepository {
    record(entry: Omit<PublishHistoryEntry, "id">): Promise<PublishHistoryEntry>;
    findByProjectId(projectId: string, limit?: number): Promise<PublishHistoryEntry[]>;
    /** Delete-project cascade — removes every history entry for a project. Returns the number removed. */
    deleteByProject(projectId: string): Promise<number>;
}
