import type { LlmPromptConfig } from "../../domain/entities/LlmPromptConfig";
import type { LlmPromptConfigRepository } from "../../domain/repositories/LlmPromptConfigRepository";

export class SetLlmPromptConfig {
    constructor(private readonly repository: LlmPromptConfigRepository) { }

    async execute(input: {
        projectId: string;
        enabled: boolean;
        responseFormatVersion: string;
        prePromptTemplate: string;
    }): Promise<LlmPromptConfig> {
        return this.repository.upsertForProject(input.projectId, {
            enabled: input.enabled,
            responseFormatVersion: input.responseFormatVersion,
            prePromptTemplate: input.prePromptTemplate,
        });
    }
}
