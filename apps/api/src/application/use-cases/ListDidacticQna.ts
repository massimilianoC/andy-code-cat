import type { DidacticQnaEntry } from "../../domain/entities/DidacticQnaEntry";
import type { DidacticQnaRepository } from "../../domain/repositories/DidacticQnaRepository";

interface Input {
    projectId: string;
    limit?: number;
}

export class ListDidacticQna {
    constructor(private repo: DidacticQnaRepository) {}

    async execute(input: Input): Promise<DidacticQnaEntry[]> {
        return this.repo.listByProject(input.projectId, input.limit ?? 100);
    }
}
