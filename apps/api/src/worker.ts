/**
 * Background-run worker process (docs/specs/BACKGROUND_RUNS.md §3.3).
 *
 * Same image as the API, different command (`node apps/api/dist/worker.js`): long runs never
 * compete with API requests, and either side can be redeployed without killing the other's work.
 * SIGTERM/SIGINT stop claiming, interrupt the runs in flight and give their leases back, so the
 * next worker resumes each run at the step it was in.
 */
import { hostname } from "os";
import { randomUUID } from "crypto";
import { writeFileSync } from "fs";
import { env } from "./config";
import { getDb } from "./infra/db/mongo";
import { MongoBackgroundRunRepository } from "./infra/repositories/MongoBackgroundRunRepository";
import { BackgroundRunEngine } from "./application/background/BackgroundRunEngine";
import { BackgroundRunWorker } from "./application/background/BackgroundRunWorker";
import { composeBackgroundRunSteps } from "./background/composeBackgroundRunSteps";
import { backgroundRunLimitsReader } from "./application/background/backgroundRunLimits";
import { MongoPlatformConfigRepository } from "./infra/repositories/MongoPlatformConfigRepository";
import { SystemNotifier } from "./application/services/SystemNotifier";
import { MongoSystemNotificationRepository } from "./infra/repositories/MongoSystemNotificationRepository";
import { installProcessSafetyNet } from "./composition/processSafetyNet";

installProcessSafetyNet("background-worker");

/** Touched on every loop turn; the container health check fails when it goes stale. */
export const WORKER_ALIVE_FILE = "/tmp/background-worker.alive";
const SHUTDOWN_GRACE_MS = 8_000;

async function main(): Promise<void> {
    await getDb();
    const repository = new MongoBackgroundRunRepository();
    await repository.ensureIndexes();

    const workerId = `${hostname()}-${randomUUID().slice(0, 8)}`;
    // Pool and cost ceiling are read from PlatformConfig at every use (superadmin → Background runs).
    const limits = backgroundRunLimitsReader(new MongoPlatformConfigRepository());
    // The completion notices are written by this process, not by the API's notification routes.
    SystemNotifier.configure(new MongoSystemNotificationRepository());
    const engine = new BackgroundRunEngine(repository, composeBackgroundRunSteps(repository), {
        maxCostEur: async () => (await limits()).maxCostEur,
        maxAttempts: env.BACKGROUND_RUN_MAX_ATTEMPTS,
    });
    const worker = new BackgroundRunWorker(repository, engine, {
        workerId,
        poolSize: async () => (await limits()).poolSize,
        leaseMs: env.BACKGROUND_RUN_LEASE_MS,
        pollMs: env.BACKGROUND_RUN_POLL_MS,
        onTick: () => {
            try {
                writeFileSync(WORKER_ALIVE_FILE, new Date().toISOString());
            } catch {
                // the health check will report it
            }
        },
    });

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[background-worker] ${signal}: stopping, releasing ${worker.activeRunIds.length} run(s)`);
        await worker.stop(SHUTDOWN_GRACE_MS);
        const db = await getDb();
        await db.client.close().catch(() => undefined);
        process.exit(0);
    };
    process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
    process.on("SIGINT", () => { void shutdown("SIGINT"); });

    worker.start();
    console.log(
        `[background-worker] ${workerId} started — pool ${(await limits()).poolSize}, `
        + `lease ${env.BACKGROUND_RUN_LEASE_MS}ms, poll ${env.BACKGROUND_RUN_POLL_MS}ms, `
        + `cost ceiling €${(await limits()).maxCostEur} per run (${(await limits()).source})`,
    );
}

main().catch((error) => {
    console.error("Cannot start background worker", error);
    process.exit(1);
});
