import type { DidacticQnaEntry } from "../entities/DidacticQnaEntry";

export interface DidacticQnaRepository {
    /** List Q&A entries for a project, newest first. */
    listByProject(projectId: string, limit?: number): Promise<DidacticQnaEntry[]>;

    /** Insert a new Q&A entry. */
    insert(entry: DidacticQnaEntry): Promise<DidacticQnaEntry>;
}
