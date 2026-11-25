import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { LeaderboardEntry, LeaderboardScope } from "../../domain/entities/LeaderboardEntry";
import type { LeaderboardRepository } from "../../domain/repositories/LeaderboardRepository";

/**
 * One shared collection for every project's boards (PLATFORM_CAPABILITY_RUNTIME.md "Multi-tenant
 * data architecture"): no collection or database per project. Isolation comes from the scope,
 * which every method takes whole and spreads into every filter.
 */
const COLLECTION = "leaderboard_scores";

type LeaderboardDocument = Omit<LeaderboardEntry, "id"> & { _id: string };

function toEntity(doc: LeaderboardDocument): LeaderboardEntry {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

function scopeFilter(scope: LeaderboardScope) {
    return { ownerUserId: scope.ownerUserId, projectId: scope.projectId, boardId: scope.boardId };
}

let indexesReady: Promise<unknown> | null = null;

export class MongoLeaderboardRepository implements LeaderboardRepository {
    private async col(): Promise<Collection<LeaderboardDocument>> {
        const db = await getDb();
        const col = db.collection<LeaderboardDocument>(COLLECTION);
        indexesReady ??= col.createIndex(
            { ownerUserId: 1, projectId: 1, boardId: 1, score: -1, createdAt: 1 },
            { name: "leaderboard_scope_rank" },
        ).catch((error) => {
            indexesReady = null;
            throw error;
        });
        await indexesReady;
        return col;
    }

    async create(scope: LeaderboardScope, entry: { player: string; score: number }): Promise<LeaderboardEntry> {
        const col = await this.col();
        const doc: LeaderboardDocument = {
            _id: randomUUID(),
            ...scopeFilter(scope),
            player: entry.player,
            score: entry.score,
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async top(scope: LeaderboardScope, limit: number): Promise<LeaderboardEntry[]> {
        const col = await this.col();
        const docs = await col.find(scopeFilter(scope)).sort({ score: -1, createdAt: 1 }).limit(limit).toArray();
        return docs.map(toEntity);
    }

    async rankOf(scope: LeaderboardScope, entry: LeaderboardEntry): Promise<number> {
        const col = await this.col();
        const ahead = await col.countDocuments({
            ...scopeFilter(scope),
            $or: [
                { score: { $gt: entry.score } },
                { score: entry.score, createdAt: { $lt: entry.createdAt } },
            ],
        });
        return ahead + 1;
    }

    async deleteById(scope: LeaderboardScope, entryId: string): Promise<boolean> {
        const col = await this.col();
        const result = await col.deleteOne({ _id: entryId, ...scopeFilter(scope) });
        return result.deletedCount === 1;
    }

    async deleteAllForProject(ownerUserId: string, projectId: string): Promise<number> {
        const col = await this.col();
        const result = await col.deleteMany({ ownerUserId, projectId });
        return result.deletedCount;
    }

    async prune(scope: LeaderboardScope, keep: number): Promise<number> {
        const col = await this.col();
        const cutoff = await col.find(scopeFilter(scope)).sort({ score: -1, createdAt: 1 }).skip(keep).project({ _id: 1 }).toArray();
        if (!cutoff.length) return 0;
        const result = await col.deleteMany({ ...scopeFilter(scope), _id: { $in: cutoff.map((doc) => doc._id) } });
        return result.deletedCount;
    }
}
