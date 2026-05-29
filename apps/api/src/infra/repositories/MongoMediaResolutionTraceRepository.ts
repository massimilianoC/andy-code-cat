import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { MediaResolutionTrace } from "../../domain/entities/MediaResolutionTrace";
import type {
    CreateMediaResolutionTraceInput,
    MediaResolutionTraceRepository,
} from "../../domain/repositories/MediaResolutionTraceRepository";

const COLLECTION = "media_resolution_traces";

type MediaResolutionTraceDocument = Omit<MediaResolutionTrace, "id"> & { _id: string };

function toEntity(doc: MediaResolutionTraceDocument): MediaResolutionTrace {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoMediaResolutionTraceRepository implements MediaResolutionTraceRepository {
    private async col(): Promise<Collection<MediaResolutionTraceDocument>> {
        const db = await getDb();
        const col = db.collection<MediaResolutionTraceDocument>(COLLECTION);

        await Promise.all([
            col.createIndex({ projectId: 1, createdAt: -1 }, { background: true }),
            col.createIndex({ projectId: 1, snapshotId: 1 }, { background: true }),
            col.createIndex({ projectId: 1, resolvedAssetId: 1 }, { background: true }),
            col.createIndex({ projectId: 1, mediaKey: 1, createdAt: -1 }, { background: true }),
            col.createIndex({ status: 1, createdAt: -1 }, { background: true }),
        ]);

        return col;
    }

    async createMany(input: CreateMediaResolutionTraceInput[]): Promise<MediaResolutionTrace[]> {
        if (input.length === 0) return [];

        const col = await this.col();
        const now = new Date();
        const docs: MediaResolutionTraceDocument[] = input.map((trace) => ({
            _id: randomUUID(),
            ...trace,
            createdAt: now,
        }));

        await col.insertMany(docs);
        return docs.map(toEntity);
    }

    async attachSnapshot(projectId: string, traceIds: string[], snapshotId: string): Promise<void> {
        if (traceIds.length === 0) return;

        const col = await this.col();
        await col.updateMany(
            { _id: { $in: traceIds }, projectId } as Filter<MediaResolutionTraceDocument>,
            { $set: { snapshotId } },
        );
    }

    async findLatestByMediaKey(input: { projectId: string; userId: string; mediaKey: string; snapshotId?: string }): Promise<MediaResolutionTrace | null> {
        const col = await this.col();
        const filter: Filter<MediaResolutionTraceDocument> = {
            projectId: input.projectId,
            userId: input.userId,
            mediaKey: input.mediaKey,
        };
        if (input.snapshotId) filter.snapshotId = input.snapshotId;

        const doc = await col.findOne(filter, { sort: { createdAt: -1 } });
        return doc ? toEntity(doc) : null;
    }
}
