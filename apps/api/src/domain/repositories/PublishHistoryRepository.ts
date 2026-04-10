import type { PublishHistoryEntry } from "../entities/PublishHistory";

export interface PublishHistoryRepository {
    record(entry: Omit<PublishHistoryEntry, "id">): Promise<PublishHistoryEntry>;
    findByProjectId(projectId: string, limit?: number): Promise<PublishHistoryEntry[]>;
}
