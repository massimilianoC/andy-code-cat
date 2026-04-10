/**
 * migrate-db-rename.ts
 *
 * Renames the MongoDB database from an old name to the current configured name
 * (MONGODB_DB_NAME, default "andy-code-cat").
 *
 * MongoDB has no native "rename database" command. This script copies every
 * collection — document by document in batches — from the source database to
 * the target database, then verifies the counts, and finally drops the source
 * database once everything is verified.
 *
 * Usage:
 *
 *   # Migrate from "pageforge" (default source) to current MONGODB_DB_NAME:
 *   npm run migrate:db -w apps/api
 *
 *   # Migrate from a different old name:
 *   MIGRATE_DB_FROM=old-name npm run migrate:db -w apps/api
 *
 *   # Dry-run (no writes, only logs what would happen):
 *   MIGRATE_DB_DRY_RUN=true npm run migrate:db -w apps/api
 *
 * Environment variables (all optional):
 *   MIGRATE_DB_FROM      — source db name to migrate from (default: "pageforge")
 *   MIGRATE_DB_DRY_RUN   — set to "true" to skip all writes
 *   MONGODB_URI          — connection string (falls back to config)
 *   MONGODB_DB_NAME      — target db name (falls back to config)
 */

import { config as loadEnv } from "dotenv";
import { MongoClient } from "mongodb";

loadEnv();

const BATCH_SIZE = 500;

const SOURCE_DB_NAME = process.env.MIGRATE_DB_FROM?.trim() || "pageforge";
const TARGET_DB_NAME = process.env.MONGODB_DB_NAME?.trim() || "andy-code-cat";
const MONGODB_URI = process.env.MONGODB_URI?.trim() || "mongodb://localhost:27017";
const DRY_RUN = process.env.MIGRATE_DB_DRY_RUN === "true";

async function run(): Promise<void> {
    if (SOURCE_DB_NAME === TARGET_DB_NAME) {
        console.log(`Source and target are the same database "${SOURCE_DB_NAME}". Nothing to do.`);
        return;
    }

    console.log(`\n=== DB Migration${DRY_RUN ? " [DRY RUN]" : ""} ===`);
    console.log(`  FROM : ${SOURCE_DB_NAME}`);
    console.log(`  TO   : ${TARGET_DB_NAME}`);
    console.log(`  URI  : ${MONGODB_URI.replace(/:\/\/[^@]+@/, "://<credentials>@")}`);
    console.log();

    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();

    try {
        const sourceDb = client.db(SOURCE_DB_NAME);
        const targetDb = client.db(TARGET_DB_NAME);

        // Check source exists and has collections
        const sourceCollections = await sourceDb.listCollections().toArray();
        if (sourceCollections.length === 0) {
            console.log(`Source database "${SOURCE_DB_NAME}" does not exist or is empty. Nothing to migrate.`);
            return;
        }

        console.log(`Found ${sourceCollections.length} collection(s) in "${SOURCE_DB_NAME}":`);
        sourceCollections.forEach((c) => console.log(`  - ${c.name}`));
        console.log();

        const results: { collection: string; copied: number; verified: boolean }[] = [];

        for (const colInfo of sourceCollections) {
            const colName = colInfo.name;
            const sourceCol = sourceDb.collection(colName);
            const targetCol = targetDb.collection(colName);

            const totalDocs = await sourceCol.countDocuments();
            console.log(`Migrating "${colName}" — ${totalDocs} document(s) ...`);

            if (DRY_RUN) {
                results.push({ collection: colName, copied: totalDocs, verified: true });
                console.log(`  [dry-run] skipped`);
                continue;
            }

            // Drop target collection if it already exists (idempotent re-run)
            const targetExists = await targetDb
                .listCollections({ name: colName })
                .hasNext();
            if (targetExists) {
                const existingCount = await targetCol.countDocuments();
                if (existingCount === totalDocs) {
                    console.log(`  Already migrated (${existingCount} docs match). Skipping.`);
                    results.push({ collection: colName, copied: existingCount, verified: true });
                    continue;
                }
                console.log(`  Target collection exists but counts differ (${existingCount} vs ${totalDocs}). Dropping target and re-copying.`);
                await targetCol.drop();
            }

            // Copy indexes first
            const indexes = await sourceCol.indexes();
            for (const index of indexes) {
                if (index.name === "_id_") continue; // _id index is created automatically
                const { key, name, unique, sparse, expireAfterSeconds, background: _bg, ...rest } = index;
                try {
                    await targetCol.createIndex(key, { name, unique, sparse, expireAfterSeconds, ...rest });
                } catch {
                    console.warn(`  Warning: could not recreate index "${name}" on "${colName}"`);
                }
            }

            // Copy documents in batches
            let copied = 0;
            const cursor = sourceCol.find({});
            let batch: object[] = [];

            for await (const doc of cursor) {
                batch.push(doc);
                if (batch.length >= BATCH_SIZE) {
                    await targetCol.insertMany(batch, { ordered: false });
                    copied += batch.length;
                    batch = [];
                    process.stdout.write(`  ${copied}/${totalDocs}\r`);
                }
            }
            if (batch.length > 0) {
                await targetCol.insertMany(batch, { ordered: false });
                copied += batch.length;
            }

            // Verify
            const targetCount = await targetCol.countDocuments();
            const verified = targetCount === totalDocs;
            if (!verified) {
                console.error(`\n  ERROR: Count mismatch — source: ${totalDocs}, target: ${targetCount}`);
            } else {
                console.log(`  Done — ${copied} document(s) copied and verified.`);
            }

            results.push({ collection: colName, copied, verified });
        }

        // Summary
        console.log("\n=== Migration Summary ===");
        const allVerified = results.every((r) => r.verified);
        results.forEach((r) => {
            const status = r.verified ? "OK" : "FAILED";
            console.log(`  [${status}] ${r.collection}: ${r.copied} docs`);
        });

        if (!allVerified) {
            console.error("\nSome collections failed verification. NOT dropping source database.");
            process.exit(1);
        }

        if (!DRY_RUN) {
            console.log(`\nAll collections verified. Dropping source database "${SOURCE_DB_NAME}" ...`);
            await sourceDb.dropDatabase();
            console.log("Source database dropped.");
        }

        console.log("\nMigration complete.");
    } finally {
        await client.close();
    }
}

run().catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
});
