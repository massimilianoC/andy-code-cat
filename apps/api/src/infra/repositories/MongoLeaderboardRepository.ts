import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { LeaderboardBoardSummary, LeaderboardEntry, LeaderboardProjectBest, LeaderboardProjectScope, LeaderboardScope } from "../../domain/entities/LeaderboardEntry";
import type { LeaderboardEntryListQuery, LeaderboardRepository } from "../../domain/repositories/LeaderboardRepository";

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

function projectFilter(scope: LeaderboardProjectScope) {
    return { ownerUserId: scope.ownerUserId, projectId: scope.projectId };
}

/** The caller's text is matched literally: every regex metacharacter is escaped. */
export function literalCaseInsensitivePattern(text: string): RegExp {
    return new RegExp(text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&"), "i");
}

let indexesReady: Promise<unknown> | null = null;

export class MongoLeaderboardRepository implements LeaderboardRepository {
    private async col(): Promise<Collection<LeaderboardDocument>> {
        const db = await getDb();
        const col = db.collection<LeaderboardDocument>(COLLECTION);
        indexesReady ??= Promise.all([
            col.createIndex(
                { ownerUserId: 1, projectId: 1, boardId: 1, score: -1, createdAt: 1 },
                { name: "leaderboard_scope_rank" },
            ),
            col.createIndex(
                { ownerUserId: 1, projectId: 1, createdAt: -1 },
                { name: "leaderboard_project_newest" },
            ),
        ]).catch((error) => {
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

    async prune(scope: LeaderboardScope, keep: number): Promise<number> {
        const col = await this.col();
        const cutoff = await col.find(scopeFilter(scope)).sort({ score: -1, createdAt: 1 }).skip(keep).project({ _id: 1 }).toArray();
        if (!cutoff.length) return 0;
        const result = await col.deleteMany({ ...scopeFilter(scope), _id: { $in: cutoff.map((doc) => doc._id) } });
        return result.deletedCount;
    }

    async bestPerProject(ownerUserId: string, boardId: string): Promise<LeaderboardProjectBest[]> {
        const col = await this.col();
        const rows = await col.aggregate<{ _id: string; entries: number; best: LeaderboardDocument }>([
            { $match: { ownerUserId, boardId } },
            { $sort: { projectId: 1, score: -1, createdAt: 1 } },
            { $group: { _id: "$projectId", entries: { $sum: 1 }, best: { $first: "$$ROOT" } } },
        ]).toArray();
        return rows.map((row) => ({ projectId: row._id, boardId, entries: row.entries, best: toEntity(row.best) }));
    }

    async boards(scope: LeaderboardProjectScope): Promise<LeaderboardBoardSummary[]> {
        const col = await this.col();
        const rows = await col.aggregate<{ _id: string; entries: number; lastWriteAt: Date }>([
            { $match: projectFilter(scope) },
            { $group: { _id: "$boardId", entries: { $sum: 1 }, lastWriteAt: { $max: "$createdAt" } } },
            { $sort: { _id: 1 } },
        ]).toArray();
        return rows.map((row) => ({ boardId: row._id, entries: row.entries, lastWriteAt: row.lastWriteAt }));
    }

    async listNewest(scope: LeaderboardProjectScope, query: LeaderboardEntryListQuery): Promise<{ items: LeaderboardEntry[]; total: number }> {
        const col = await this.col();
        const filter: Filter<LeaderboardDocument> = {
            ...projectFilter(scope),
            ...(query.boardId !== undefined ? { boardId: query.boardId } : {}),
            ...(query.playerContains ? { player: { $regex: literalCaseInsensitivePattern(query.playerContains) } } : {}),
        };
        const [docs, total] = await Promise.all([
            col.find(filter).sort({ createdAt: -1, _id: -1 }).skip(query.skip).limit(query.limit).toArray(),
            col.countDocuments(filter),
        ]);
        return { items: docs.map(toEntity), total };
    }

    async deleteInProject(scope: LeaderboardProjectScope, entryId: string): Promise<boolean> {
        const col = await this.col();
        const result = await col.deleteOne({ _id: entryId, ...projectFilter(scope) });
        return result.deletedCount === 1;
    }

    async clear(scope: LeaderboardProjectScope, boardId?: string): Promise<number> {
        const col = await this.col();
        const result = await col.deleteMany({ ...projectFilter(scope), ...(boardId !== undefined ? { boardId } : {}) });
        return result.deletedCount;
    }
}
