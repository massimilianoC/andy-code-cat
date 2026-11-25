import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type {
    FormSubmission,
    FormSubmissionGroup,
    FormSubmissionListQuery,
    FormSubmissionProjectScope,
    FormSubmissionScope,
    NewFormSubmission,
} from "../../domain/entities/FormSubmission";
import type { FormSubmissionRepository } from "../../domain/repositories/FormSubmissionRepository";

/**
 * One shared collection for every project's form submissions (PLATFORM_CAPABILITY_RUNTIME.md
 * "Multi-tenant data architecture"): never a collection or a database per project. Isolation comes
 * from the scope, which every method takes whole and spreads into every filter.
 */
const COLLECTION = "form_submissions";

type FormSubmissionDocument = Omit<FormSubmission, "id"> & { _id: string };

function toEntity(doc: FormSubmissionDocument): FormSubmission {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

function projectFilter(scope: FormSubmissionProjectScope, formId?: string): Filter<FormSubmissionDocument> {
    const filter: Filter<FormSubmissionDocument> = { ownerUserId: scope.ownerUserId, projectId: scope.projectId };
    if (formId !== undefined) filter.formId = formId;
    return filter;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Plain-text match against the string values of `fields`. The search text is escaped, so it is a
 * literal substring and never a pattern or a query operator.
 */
function searchClause(search: string) {
    return {
        $expr: {
            $gt: [{
                $size: {
                    $filter: {
                        input: { $objectToArray: "$fields" },
                        cond: {
                            $and: [
                                { $eq: [{ $type: "$$this.v" }, "string"] },
                                { $regexMatch: { input: "$$this.v", regex: escapeRegex(search), options: "i" } },
                            ],
                        },
                    },
                },
            }, 0],
        },
    };
}

let indexesReady: Promise<unknown> | null = null;

export class MongoFormSubmissionRepository implements FormSubmissionRepository {
    private async col(): Promise<Collection<FormSubmissionDocument>> {
        const db = await getDb();
        const col = db.collection<FormSubmissionDocument>(COLLECTION);
        indexesReady ??= col.createIndex(
            { ownerUserId: 1, projectId: 1, formId: 1, createdAt: -1 },
            { name: "form_submissions_scope_created" },
        ).catch((error) => {
            indexesReady = null;
            throw error;
        });
        await indexesReady;
        return col;
    }

    async create(scope: FormSubmissionScope, submission: NewFormSubmission): Promise<FormSubmission> {
        const col = await this.col();
        const doc: FormSubmissionDocument = {
            _id: randomUUID(),
            ownerUserId: scope.ownerUserId,
            projectId: scope.projectId,
            formId: scope.formId,
            publishId: submission.publishId,
            snapshotId: submission.snapshotId,
            fields: { ...submission.fields },
            privacyNoticeVersion: submission.privacyNoticeVersion,
            ipHash: submission.ipHash,
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async groups(scope: FormSubmissionProjectScope): Promise<FormSubmissionGroup[]> {
        const col = await this.col();
        const rows = await col.aggregate<{ _id: string; records: number; lastWriteAt: Date }>([
            { $match: projectFilter(scope) },
            { $group: { _id: "$formId", records: { $sum: 1 }, lastWriteAt: { $max: "$createdAt" } } },
            { $sort: { _id: 1 } },
        ]).toArray();
        return rows.map((row) => ({ formId: row._id, records: row.records, lastWriteAt: row.lastWriteAt }));
    }

    async list(scope: FormSubmissionProjectScope, query: FormSubmissionListQuery): Promise<{ items: FormSubmission[]; total: number }> {
        const col = await this.col();
        const search = query.search?.trim();
        const filter: Filter<FormSubmissionDocument> = search
            ? { ...projectFilter(scope, query.formId), ...searchClause(search) }
            : projectFilter(scope, query.formId);
        const [docs, total] = await Promise.all([
            col.find(filter).sort({ createdAt: -1, _id: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).toArray(),
            col.countDocuments(filter),
        ]);
        return { items: docs.map(toEntity), total };
    }

    async listNewest(scope: FormSubmissionProjectScope, formId: string | undefined, max: number): Promise<FormSubmission[]> {
        const col = await this.col();
        const docs = await col.find(projectFilter(scope, formId)).sort({ createdAt: -1, _id: -1 }).limit(max).toArray();
        return docs.map(toEntity);
    }

    async deleteById(scope: FormSubmissionProjectScope, submissionId: string): Promise<boolean> {
        const col = await this.col();
        const result = await col.deleteOne({ _id: submissionId, ...projectFilter(scope) });
        return result.deletedCount === 1;
    }

    async deleteMany(scope: FormSubmissionProjectScope, formId?: string): Promise<number> {
        const col = await this.col();
        const result = await col.deleteMany(projectFilter(scope, formId));
        return result.deletedCount;
    }
}
