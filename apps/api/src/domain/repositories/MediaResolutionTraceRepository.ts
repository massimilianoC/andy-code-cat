import type { MediaResolutionTrace } from "../entities/MediaResolutionTrace";

export type CreateMediaResolutionTraceInput = Omit<MediaResolutionTrace, "id" | "createdAt">;

export interface MediaResolutionTraceRepository {
    createMany(input: CreateMediaResolutionTraceInput[]): Promise<MediaResolutionTrace[]>;
    attachSnapshot(projectId: string, traceIds: string[], snapshotId: string): Promise<void>;
    findLatestByMediaKey(input: { projectId: string; userId: string; mediaKey: string; snapshotId?: string }): Promise<MediaResolutionTrace | null>;
}
