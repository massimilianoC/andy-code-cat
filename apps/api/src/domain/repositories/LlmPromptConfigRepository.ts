import type { LlmPromptConfig } from "../entities/LlmPromptConfig";

export interface LlmPromptConfigRepository {
    findByProjectId(projectId: string): Promise<LlmPromptConfig | null>;
    upsertForProject(
        projectId: string,
        config: {
            enabled: boolean;
            responseFormatVersion: string;
            prePromptTemplate: string;
        }
    ): Promise<LlmPromptConfig>;
}
