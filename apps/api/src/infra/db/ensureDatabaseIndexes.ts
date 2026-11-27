import type { Db } from "mongodb";
import { env } from "../../config";
import { MongoProjectAssetRepository } from "../repositories/MongoProjectAssetRepository";
import { MongoExportRepository } from "../repositories/MongoExportRepository";
import { MongoSiteDeploymentRepository } from "../repositories/MongoSiteDeploymentRepository";
import { MongoBackgroundRunRepository } from "../repositories/MongoBackgroundRunRepository";

/** What the boot step did with the invariant indexes: created (or already there), or why not. */
export interface IndexReport {
    name: string;
    status: "ensured" | "skipped_duplicates" | "failed";
    /** For `skipped_duplicates`: how many values are held by more than one document. */
    duplicateValues?: number;
    /** Ids of the documents holding a duplicated value, for the operator to resolve. */
    duplicateDocumentIds?: string[];
    error?: string;
}

interface UniqueIndexSpec {
    name: string;
    collection: string;
    field: string;
    /** Only documents where the field is a string take part (legacy rows may lack it). */
    stringsOnly?: boolean;
    /** Values compared case-insensitively when looking for duplicates. */
    caseInsensitive?: boolean;
}

const UNIQUE_INDEXES: UniqueIndexSpec[] = [
    { name: "users_email_unique", collection: "users", field: "email", caseInsensitive: true },
    { name: "sessions_tokenId_unique", collection: "sessions", field: "tokenId", stringsOnly: true },
];

async function findDuplicates(db: Db, spec: UniqueIndexSpec): Promise<{ values: number; ids: string[] }> {
    const key = spec.caseInsensitive ? { $toLower: `$${spec.field}` } : `$${spec.field}`;
    const groups = await db.collection(spec.collection).aggregate<{ ids: unknown[] }>([
        { $match: { [spec.field]: { $type: "string" } } },
        { $group: { _id: key, ids: { $push: "$_id" }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
    ]).toArray();
    return { values: groups.length, ids: groups.flatMap((group) => group.ids.map(String)) };
}

async function ensureUniqueIndex(db: Db, spec: UniqueIndexSpec): Promise<IndexReport> {
    try {
        const duplicates = await findDuplicates(db, spec);
        if (duplicates.values > 0) {
            return { name: spec.name, status: "skipped_duplicates", duplicateValues: duplicates.values, duplicateDocumentIds: duplicates.ids };
        }
        await db.collection(spec.collection).createIndex({ [spec.field]: 1 }, {
            name: spec.name,
            unique: true,
            ...(spec.stringsOnly ? { partialFilterExpression: { [spec.field]: { $type: "string" } } } : {}),
        });
        return { name: spec.name, status: "ensured" };
    } catch (error) {
        return { name: spec.name, status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
}

async function ensureIndex(name: string, run: () => Promise<unknown>): Promise<IndexReport> {
    try {
        await run();
        return { name, status: "ensured" };
    } catch (error) {
        return { name, status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Submissions stored before retention existed have no `expiresAt`, so the TTL index never removes
 * them. They are dated from their own `createdAt` with the configured retention.
 */
export async function backfillFormSubmissionExpiry(db: Db, retentionDays: number): Promise<number> {
    const col = db.collection("form_submissions");
    await col.createIndex({ expiresAt: 1 }, { name: "form_submissions_retention", expireAfterSeconds: 0 });
    const result = await col.updateMany(
        { expiresAt: { $exists: false } },
        [{ $set: { expiresAt: { $add: [{ $ifNull: ["$createdAt", "$$NOW"] }, retentionDays * 24 * 60 * 60 * 1000] } } }],
    );
    if (result.modifiedCount > 0) {
        console.log(`[db-indexes] form_submissions: ${result.modifiedCount} record(s) given a retention date`);
    }
    return result.modifiedCount;
}

/**
 * The one boot step that guarantees the database indexes.
 *
 * Invariants that the code relies on are enforced here by the database: one account per email
 * (registration checks then inserts, which two concurrent requests can both pass), one session per
 * refresh-token id, and expired sessions removed by a TTL index.
 *
 * It never stops the API from starting. An index that cannot be created — because existing data
 * already violates it, or for any other reason — is reported in the log with what the operator has
 * to resolve, and the boot continues; the step runs again at the next start.
 */
export async function ensureDatabaseIndexes(db: Db): Promise<IndexReport[]> {
    const reports: IndexReport[] = [];
    for (const spec of UNIQUE_INDEXES) {
        reports.push(await ensureUniqueIndex(db, spec));
    }
    reports.push(await ensureIndex("sessions_expiresAt_ttl", () =>
        db.collection("sessions").createIndex({ expiresAt: 1 }, { name: "sessions_expiresAt_ttl", expireAfterSeconds: 0 })));
    reports.push(await ensureIndex("sessions_userId", () =>
        db.collection("sessions").createIndex({ userId: 1 }, { name: "sessions_userId" })));
    reports.push(await ensureIndex("project_assets", () => new MongoProjectAssetRepository().ensureIndexes()));
    reports.push(await ensureIndex("export_records", () => new MongoExportRepository().ensureIndexes()));
    reports.push(await ensureIndex("site_deployments", () => new MongoSiteDeploymentRepository().ensureIndexes()));
    reports.push(await ensureIndex("background_runs", () => new MongoBackgroundRunRepository().ensureIndexes()));
    reports.push(await ensureIndex("form_submissions_retention", () => backfillFormSubmissionExpiry(db, env.FORM_SUBMISSION_RETENTION_DAYS)));

    for (const report of reports) {
        if (report.status === "skipped_duplicates") {
            console.error(`[db-indexes] ${report.name} NOT created: ${report.duplicateValues} value(s) are held by more than one document. `
                + "Resolve them (merge or remove the extra documents), then restart.", { documentIds: report.duplicateDocumentIds });
        } else if (report.status === "failed") {
            console.error(`[db-indexes] ${report.name} could not be ensured`, { error: report.error });
        }
    }
    return reports;
}
