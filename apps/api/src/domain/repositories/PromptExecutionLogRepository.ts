import type { PromptExecutionLog, PromptExecutionUsageSummary } from "../entities/PromptExecutionLog";

export interface PromptExecutionLogRepository {
    create(input: Omit<PromptExecutionLog, "id" | "createdAt">): Promise<PromptExecutionLog>;
    summarizeByProject(projectId: string, userId: string): Promise<PromptExecutionUsageSummary>;
    summarizeAll(): Promise<PromptExecutionUsageSummary>;
    listRecentByProject(projectId: string, userId: string, limit?: number): Promise<PromptExecutionLog[]>;
    listRecentAll(limit?: number): Promise<PromptExecutionLog[]>;
}
