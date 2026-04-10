export interface LlmPromptConfig {
    id: string;
    projectId: string;
    enabled: boolean;
    responseFormatVersion: string;
    prePromptTemplate: string;
    createdAt: Date;
    updatedAt: Date;
}
