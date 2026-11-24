import { randomUUID } from "crypto";
import type { Collection, Filter, UpdateFilter } from "mongodb";
import { BACKGROUND_RUN_TERMINAL_STATUSES } from "@andy-code-cat/contracts";
import { getDb } from "../db/mongo";
import {
    canTransition,
    type BackgroundRun,
    type BackgroundRunInput,
} from "../../domain/entities/BackgroundRun";
import type {
    BackgroundRunRepository,
    RecordBackgroundRunTransition,
} from "../../domain/repositories/BackgroundRunRepository";

const COLLECTION = "background_runs";
const TERMINAL = [...BACKGROUND_RUN_TERMINAL_STATUSES];

type BackgroundRunDocument = Omit<BackgroundRun, "id"> & { _id: string };

function toEntity(doc: BackgroundRunDocument): BackgroundRun {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest, lease: rest.lease ?? null };
}

/**
 * MongoDB queue for background runs (BACKGROUND_RUNS.md §3.3, §6.5): a run is claimed with one
 * atomic findOneAndUpdate that sets a lease; the holder renews it by heartbeat; an expired lease
 * makes the run claimable again and the step resumes from the stored outputs. Every write a
 * worker makes is conditional on still holding the lease.
 */
export class MongoBackgroundRunRepository implements BackgroundRunRepository {
    private async col(): Promise<Collection<BackgroundRunDocument>> {
        const db = await getDb();
        return db.collection<BackgroundRunDocument>(COLLECTION);
    }

    async ensureIndexes(): Promise<void> {
        const col = await this.col();
        await col.createIndex({ status: 1, notBefore: 1, createdAt: 1 }, { name: "claim_order" });
        await col.createIndex({ userId: 1, createdAt: -1 }, { name: "owner_recent" });
        await col.createIndex({ "lease.expiresAt": 1 }, { name: "lease_expiry" });
    }

    async create(input: { userId: string; projectId: string; input: BackgroundRunInput }): Promise<BackgroundRun> {
        const col = await this.col();
        const now = new Date();
        const doc: BackgroundRunDocument = {
            _id: randomUUID(),
            userId: input.userId,
            projectId: input.projectId,
            status: "queued",
            input: input.input,
            outputs: {},
            transitions: [{ status: "queued", phase: "completed", at: now }],
            lease: null,
            attempts: 0,
            cancelRequested: false,
            costEur: 0,
            createdAt: now,
            updatedAt: now,
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async findByIdForUser(id: string, userId: string): Promise<BackgroundRun | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: id, userId } as Filter<BackgroundRunDocument>);
        return doc ? toEntity(doc) : null;
    }

    async listForUser(userId: string, limit: number): Promise<BackgroundRun[]> {
        const col = await this.col();
        const docs = await col.find({ userId } as Filter<BackgroundRunDocument>).sort({ createdAt: -1 }).limit(limit).toArray();
        return docs.map(toEntity);
    }

    async countActiveForUser(userId: string): Promise<number> {
        const col = await this.col();
        return col.countDocuments({ userId, status: { $nin: TERMINAL } } as Filter<BackgroundRunDocument>);
    }

    async countLeased(now: Date): Promise<number> {
        const col = await this.col();
        return col.countDocuments({ status: { $nin: TERMINAL }, "lease.expiresAt": { $gt: now } } as Filter<BackgroundRunDocument>);
    }

    async deleteById(id: string, userId: string): Promise<boolean> {
        const col = await this.col();
        const result = await col.deleteOne({ _id: id, userId } as Filter<BackgroundRunDocument>);
        return result.deletedCount === 1;
    }

    async claimNext(input: { workerId: string; leaseMs: number; now: Date }): Promise<BackgroundRun | null> {
        const col = await this.col();
        const { now } = input;
        const doc = await col.findOneAndUpdate(
            {
                status: { $nin: TERMINAL },
                $and: [
                    { $or: [{ lease: null }, { "lease.expiresAt": { $lte: now } }] },
                    { $or: [{ notBefore: { $exists: false } }, { notBefore: null }, { notBefore: { $lte: now } }] },
                ],
            } as Filter<BackgroundRunDocument>,
            {
                $set: {
                    lease: { workerId: input.workerId, expiresAt: new Date(now.getTime() + input.leaseMs), heartbeatAt: now },
                    updatedAt: now,
                },
                $unset: { notBefore: "" },
                $inc: { attempts: 1 },
            } as UpdateFilter<BackgroundRunDocument>,
            { sort: { createdAt: 1 }, returnDocument: "after" },
        );
        return doc ? toEntity(doc) : null;
    }

    async renewLease(id: string, workerId: string, leaseMs: number, now: Date): Promise<BackgroundRun | null> {
        const col = await this.col();
        const doc = await col.findOneAndUpdate(
            { _id: id, "lease.workerId": workerId, status: { $nin: TERMINAL } } as Filter<BackgroundRunDocument>,
            { $set: { "lease.expiresAt": new Date(now.getTime() + leaseMs), "lease.heartbeatAt": now } } as UpdateFilter<BackgroundRunDocument>,
            { returnDocument: "after" },
        );
        return doc ? toEntity(doc) : null;
    }

    async releaseLease(id: string, workerId: string, notBefore?: Date, detail?: string): Promise<boolean> {
        const col = await this.col();
        const now = new Date();
        const current = await col.findOne({ _id: id, "lease.workerId": workerId } as Filter<BackgroundRunDocument>);
        if (!current) return false;
        const result = await col.updateOne(
            { _id: id, "lease.workerId": workerId } as Filter<BackgroundRunDocument>,
            {
                $set: { lease: null, updatedAt: now, ...(notBefore ? { notBefore } : {}) },
                $push: { transitions: { status: current.status, phase: "deferred", at: now, workerId, detail } },
            } as UpdateFilter<BackgroundRunDocument>,
        );
        return result.modifiedCount === 1;
    }

    async recordTransition(id: string, workerId: string, transition: RecordBackgroundRunTransition): Promise<BackgroundRun | null> {
        const statusChanges = transition.status !== transition.expectedStatus;
        if (statusChanges && !canTransition(transition.expectedStatus, transition.status)) {
            throw new Error(`Illegal background run transition ${transition.expectedStatus} → ${transition.status}`);
        }
        const col = await this.col();
        const now = new Date();
        const terminal = TERMINAL.includes(transition.status as (typeof TERMINAL)[number]);
        const set: Record<string, unknown> = { status: transition.status, updatedAt: now };
        for (const [key, value] of Object.entries(transition.outputs ?? {})) {
            if (value !== undefined) set[`outputs.${key}`] = value;
        }
        if (transition.costEur !== undefined) set.costEur = transition.costEur;
        if (transition.error) set.error = transition.error;
        if (terminal) {
            set.finishedAt = now;
            set.lease = null;
        }
        if (transition.phase === "started" && transition.expectedStatus === "queued") set.startedAt = now;
        const unset = transition.phase === "completed" || terminal ? { progress: "" } : undefined;

        const doc = await col.findOneAndUpdate(
            { _id: id, "lease.workerId": workerId, status: transition.expectedStatus } as Filter<BackgroundRunDocument>,
            {
                $set: set,
                ...(unset ? { $unset: unset } : {}),
                $push: {
                    transitions: {
                        status: transition.loggedAs ?? transition.status,
                        phase: transition.phase,
                        at: now,
                        workerId,
                        ...(transition.detail ? { detail: transition.detail } : {}),
                    },
                },
            } as UpdateFilter<BackgroundRunDocument>,
            { returnDocument: "after" },
        );
        return doc ? toEntity(doc) : null;
    }

    async recordProgress(id: string, workerId: string, progress: { generatedChars: number }, now: Date): Promise<boolean> {
        const col = await this.col();
        const result = await col.updateOne(
            { _id: id, "lease.workerId": workerId, status: { $nin: TERMINAL } } as Filter<BackgroundRunDocument>,
            { $set: { progress: { generatedChars: progress.generatedChars, updatedAt: now } } } as UpdateFilter<BackgroundRunDocument>,
        );
        return result.matchedCount === 1;
    }

    async requestCancel(id: string, userId: string, now: Date): Promise<BackgroundRun | null> {
        const col = await this.col();
        // A queued run nobody holds stops here and now.
        const cancelledNow = await col.findOneAndUpdate(
            {
                _id: id,
                userId,
                status: "queued",
                $or: [{ lease: null }, { "lease.expiresAt": { $lte: now } }],
            } as Filter<BackgroundRunDocument>,
            {
                $set: { status: "cancelled", cancelRequested: true, lease: null, finishedAt: now, updatedAt: now },
                $push: { transitions: { status: "cancelled", phase: "cancelled", at: now, detail: "cancelled by the owner before start" } },
            } as UpdateFilter<BackgroundRunDocument>,
            { returnDocument: "after" },
        );
        if (cancelledNow) return toEntity(cancelledNow);
        // Anything else that is not finished is flagged; the worker stops it.
        const flagged = await col.findOneAndUpdate(
            { _id: id, userId, status: { $nin: TERMINAL } } as Filter<BackgroundRunDocument>,
            { $set: { cancelRequested: true, updatedAt: now } } as UpdateFilter<BackgroundRunDocument>,
            { returnDocument: "after" },
        );
        if (flagged) return toEntity(flagged);
        return this.findByIdForUser(id, userId);
    }
}
