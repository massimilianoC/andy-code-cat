import type { PromptExecutionLog, PromptExecutionUsageSummary } from "../entities/PromptExecutionLog";

export interface PromptExecutionLogRepository {
    create(input: Omit<PromptExecutionLog, "id" | "createdAt">): Promise<PromptExecutionLog>;
    summarizeByProject(projectId: string, userId: string): Promise<PromptExecutionUsageSummary>;
}
