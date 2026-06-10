import type { DidacticArtifactKnowledge } from "../entities/DidacticArtifactKnowledge";

export interface DidacticArtifactKnowledgeRepository {
    /** Find knowledge for a specific project + snapshot. */
    findByProjectAndSnapshot(projectId: string, snapshotId: string): Promise<DidacticArtifactKnowledge | null>;

    /** Upsert knowledge (cache semantics — unique on {projectId, snapshotId}). */
    upsert(knowledge: DidacticArtifactKnowledge): Promise<DidacticArtifactKnowledge>;

    /** Delete knowledge for a snapshot (cleanup). */
    deleteBySnapshot(projectId: string, snapshotId: string): Promise<void>;
}
