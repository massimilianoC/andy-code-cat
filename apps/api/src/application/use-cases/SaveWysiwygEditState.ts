import type { WysiwygEditSession } from "../../domain/entities/WysiwygEditSession";
import type { WysiwygEditSessionRepository } from "../../domain/repositories/WysiwygEditSessionRepository";

export class SaveWysiwygEditState {
    constructor(private readonly repo: WysiwygEditSessionRepository) { }

    async execute(input: {
        sessionId: string;
        projectId: string;
        html: string;
        css: string;
        js: string;
    }): Promise<WysiwygEditSession | null> {
        return this.repo.saveState(
            input.sessionId,
            input.projectId,
            input.html,
            input.css,
            input.js
        );
    }
}
