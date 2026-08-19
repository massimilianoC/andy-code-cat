import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { PipelineRun } from "../../domain/entities/PipelineRun";
import { assertStatusTransition } from "../../domain/entities/PipelineRun";
import type {
    NewPipelineRun,
    PipelineRunRecord,
    PipelineRunRepository,
} from "../../domain/repositories/PipelineRunRepository";
import type {
    CanonicalBriefEnvelope,
    ModelSelectionBlockCode,
    PipelineStage,
    PipelineStageExecutionRef,
} from "@andy-code-cat/contracts";

const COLLECTION = "pipeline_runs";

interface PipelineRunDocument {
    _id: string;
    projectId: string;
    ownerUserId: string;
    conversationId?: string;
    entryMode: PipelineRun["entryMode"];
    modelLock: PipelineRun["modelLock"];
    optimizationPolicy: PipelineRun["optimizationPolicy"];
    canonicalBrief?: CanonicalBriefEnvelope;
    status: PipelineRun["status"];
    stages: PipelineStageExecutionRef[];
    blocked?: { code: ModelSelectionBlockCode; stage: PipelineStage; at: Date };
    createdAt: Date;
    updatedAt: Date;
}

function toEntity(doc: PipelineRunDocument): PipelineRun {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoPipelineRunRepository implements PipelineRunRepository {
    private async col(): Promise<Collection<PipelineRunDocument>> {
        const db = await getDb();
        return db.collection<PipelineRunDocument>(COLLECTION);
    }

    async create(run: NewPipelineRun): Promise<PipelineRunRecord> {
        const col = await this.col();
        const now = new Date();
        const doc: PipelineRunDocument = {
            _id: randomUUID(),
            projectId: run.projectId,
            ownerUserId: run.ownerUserId,
            conversationId: run.conversationId,
            entryMode: run.entryMode,
            modelLock: run.modelLock,
            optimizationPolicy: run.optimizationPolicy,
            canonicalBrief: run.canonicalBrief,
            status: "draft",
            stages: [],
            createdAt: now,
            updatedAt: now,
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async findByIdForUser(id: string, userId: string): Promise<PipelineRunRecord | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: id, ownerUserId: userId } as Filter<PipelineRunDocument>);
        return doc ? toEntity(doc) : null;
    }

    async listByProject(projectId: string, userId: string): Promise<PipelineRunRecord[]> {
        const col = await this.col();
        const docs = await col
            .find({ projectId, ownerUserId: userId } as Filter<PipelineRunDocument>)
            .sort({ createdAt: -1 })
            .toArray();
        return docs.map(toEntity);
    }

    async appendStage(runId: string, stage: PipelineStageExecutionRef): Promise<PipelineRunRecord> {
        const col = await this.col();
        const updated = await col.findOneAndUpdate(
            { _id: runId } as Filter<PipelineRunDocument>,
            { $push: { stages: stage }, $set: { updatedAt: new Date() } },
            { returnDocument: "after" },
        );
        if (!updated) {
            throw new Error(`PipelineRun not found: ${runId}`);
        }
        return toEntity(updated);
    }

    async setStatus(
        runId: string,
        status: PipelineRun["status"],
        detail?: { code: ModelSelectionBlockCode; stage: PipelineStage },
    ): Promise<PipelineRunRecord> {
        const col = await this.col();
        const current = await col.findOne({ _id: runId } as Filter<PipelineRunDocument>);
        if (!current) {
            throw new Error(`PipelineRun not found: ${runId}`);
        }

        assertStatusTransition(current.status, status, detail);

        const now = new Date();
        const updated = await col.findOneAndUpdate(
            { _id: runId } as Filter<PipelineRunDocument>,
            {
                $set: {
                    status,
                    updatedAt: now,
                    ...(detail ? { blocked: { code: detail.code, stage: detail.stage, at: now } } : {}),
                },
            },
            { returnDocument: "after" },
        );
        if (!updated) {
            throw new Error(`PipelineRun not found: ${runId}`);
        }
        return toEntity(updated);
    }

    async attachCanonicalBrief(runId: string, brief: CanonicalBriefEnvelope): Promise<PipelineRunRecord> {
        const col = await this.col();
        const updated = await col.findOneAndUpdate(
            { _id: runId } as Filter<PipelineRunDocument>,
            { $set: { canonicalBrief: brief, updatedAt: new Date() } },
            { returnDocument: "after" },
        );
        if (!updated) {
            throw new Error(`PipelineRun not found: ${runId}`);
        }
        return toEntity(updated);
    }
}
