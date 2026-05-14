/**
 * backfill-cost-transactions.ts
 *
 * One-time script to backfill cost_transactions from:
 *   1. prompt_execution_logs  (LLM chat / optimize-prompt / template-draft)
 *   2. project_assets         (image generation)
 *
 * Idempotent — skips rows already present in cost_transactions by checking
 * sourceRef.promptExecutionLogId / sourceRef.assetId.
 *
 * Run from monorepo root:
 *   npx tsx apps/api/src/scripts/backfill-cost-transactions.ts
 */

import path from "path";
import { config as loadEnv } from "dotenv";
import { MongoClient, type Db } from "mongodb";

loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadEnv({ path: path.resolve(__dirname, "../../../../.env.docker") });

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? "andy-code-cat";

if (!MONGODB_URI) {
    console.error("MONGODB_URI is not set. Make sure .env or .env.docker is present.");
    process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function generateTxId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
    return `TX-${date}-${rand}`;
}

// Rates used for back-computation when we have only the EUR total.
// These match the default env vars in config.ts.
const USD_TO_EUR = Number(process.env.COST_POLICY_USD_TO_EUR_RATE ?? 0.92);
const MARKUP_FACTOR = Number(process.env.COST_POLICY_PROVIDER_MARKUP_FACTOR ?? 1.1);

// Back-derive breakdown from a pre-computed EUR total.
function deriveBreakdown(totalEur: number) {
    const usdToEurRate = USD_TO_EUR;
    const platformMarkupPct = (MARKUP_FACTOR - 1) * 100; // e.g. 10%
    const infraCostPct = 5; // 5% — same default as CostTransactionService
    const providerCostEur = totalEur / MARKUP_FACTOR;
    const platformMarkupEur = totalEur - providerCostEur;
    const infraCostEur = providerCostEur * (infraCostPct / 100);

    return {
        providerCostUsd: providerCostEur / usdToEurRate,
        providerCostEur,
        infraCostEur,
        platformMarkupEur,
        totalEur,
        ratesSnapshot: {
            usdToEurRate,
            platformMarkupPct,
            infraCostPct,
            textEurPer1kTokens: Number(process.env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS ?? 0.005),
            imageEurPerAsset: Number(process.env.COST_POLICY_IMAGE_EUR_PER_ASSET ?? 0.1),
            videoEurPerAsset: Number(process.env.COST_POLICY_VIDEO_EUR_PER_ASSET ?? 0.2),
        },
    };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
    const client = new MongoClient(MONGODB_URI!);
    await client.connect();
    const db: Db = client.db(MONGODB_DB_NAME);

    const costCol = db.collection("cost_transactions");
    const logsCol = db.collection("prompt_execution_logs");
    const assetsCol = db.collection("project_assets");

    // Build an index for fast duplicate lookup
    await costCol.createIndex({ "sourceRef.promptExecutionLogId": 1 }, { sparse: true }).catch(() => { });
    await costCol.createIndex({ "sourceRef.assetId": 1 }, { sparse: true }).catch(() => { });

    let insertedLlm = 0;
    let skippedLlm = 0;
    let insertedImg = 0;
    let skippedImg = 0;

    // ── 1. Backfill from prompt_execution_logs ────────────────────────────────
    console.log("\n[1/2] Scanning prompt_execution_logs …");

    const logsCursor = logsCol.find({
        status: "succeeded",
        "costEstimate.amount": { $gt: 0 },
    });

    for await (const doc of logsCursor) {
        const logId = doc._id?.toString();

        // Skip if already backfilled
        const exists = await costCol.findOne({ "sourceRef.promptExecutionLogId": logId });
        if (exists) {
            skippedLlm++;
            continue;
        }

        const totalEur: number = doc.costEstimate?.amount ?? 0;
        if (!totalEur || !doc.userId || !doc.projectId) {
            skippedLlm++;
            continue;
        }

        // Determine resource type from taskKey
        const taskKey: string = doc.taskKey ?? "";
        let resourceType = "llm.chat";
        if (taskKey.includes("optimize")) resourceType = "llm.prompt_opt";
        else if (taskKey.includes("draft") || taskKey.includes("template")) resourceType = "llm.template_draft";
        else if (taskKey.includes("preprompt") || taskKey.includes("pre-prompt")) resourceType = "llm.preprompt";
        else if (taskKey.includes("background")) resourceType = "llm.background";

        const breakdown = deriveBreakdown(totalEur);
        const now = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt ?? Date.now());

        await costCol.insertOne({
            txId: generateTxId(),
            userId: doc.userId,
            projectId: doc.projectId,
            resourceType,
            resourceSubtype: doc.model ?? undefined,
            ...breakdown,
            units: {
                promptTokens: doc.usage?.promptTokens,
                completionTokens: doc.usage?.completionTokens,
                totalTokens: doc.usage?.totalTokens,
            },
            sourceRef: {
                promptExecutionLogId: logId,
                conversationId: doc.conversationId,
                sessionId: doc.sessionId,
            },
            meta: {
                provider: doc.provider,
                model: doc.model,
                taskKey: doc.taskKey,
                backfilled: true,
            },
            status: "settled",
            createdAt: now,
        });
        insertedLlm++;
    }

    console.log(`  LLM logs:  inserted=${insertedLlm}  skipped=${skippedLlm}`);

    // ── 2. Backfill from project_assets (image generation) ───────────────────
    console.log("\n[2/2] Scanning project_assets …");

    const assetsCursor = assetsCol.find({
        source: "platform_generated",
        generationStatus: "ready",
        "generationMetadata.cost.amount": { $gt: 0 },
    });

    for await (const doc of assetsCursor) {
        const assetId = doc._id?.toString();

        const exists = await costCol.findOne({ "sourceRef.assetId": assetId });
        if (exists) {
            skippedImg++;
            continue;
        }

        const totalEur: number = doc.generationMetadata?.cost?.amount ?? 0;
        if (!totalEur || !doc.userId || !doc.projectId) {
            skippedImg++;
            continue;
        }

        const breakdown = deriveBreakdown(totalEur);
        const now = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt ?? Date.now());

        await costCol.insertOne({
            txId: generateTxId(),
            userId: doc.userId,
            projectId: doc.projectId,
            resourceType: "image.gen",
            resourceSubtype: doc.generationMetadata?.model ?? undefined,
            ...breakdown,
            units: {
                imageCount: 1,
                promptTokens: doc.generationMetadata?.tokenUsage?.promptTokens,
                completionTokens: doc.generationMetadata?.tokenUsage?.completionTokens,
                totalTokens: doc.generationMetadata?.tokenUsage?.totalTokens,
            },
            sourceRef: {
                assetId,
            },
            meta: {
                provider: doc.generationMetadata?.provider,
                model: doc.generationMetadata?.model,
                imageSize: doc.generationMetadata?.imageSize,
                backfilled: true,
            },
            status: "settled",
            createdAt: now,
        });
        insertedImg++;
    }

    console.log(`  Image gen: inserted=${insertedImg}  skipped=${skippedImg}`);

    await client.close();

    const total = insertedLlm + insertedImg;
    console.log(`\nBackfill complete. Total transactions created: ${total}`);
    if (total === 0 && (skippedLlm + skippedImg) > 0) {
        console.log("All entries were already present in cost_transactions — nothing to do.");
    }
}

run().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
});
