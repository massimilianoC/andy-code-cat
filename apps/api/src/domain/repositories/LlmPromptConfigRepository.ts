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

    /** Remove the prompt configuration of a project (project deletion). */
    deleteByProjectId(projectId: string): Promise<number>;
}
