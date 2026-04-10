/**
 * Admin script: block (or unblock) a user account and invalidate all their sessions.
 *
 * Lookup by one of:
 *   --email owner@example.com
 *   --user-id <mongoId>
 *   --subdomain <slug>     (e.g. "mia-pizzeria" — matches site_deployments.customSlug)
 *
 * Flags:
 *   --unblock              reverse the operation (re-enable the account)
 *
 * Usage examples (inside the API container):
 *   node apps/api/dist/scripts/block-user.js --subdomain mia-pizzeria
 *   node apps/api/dist/scripts/block-user.js --email customer@example.com --unblock
 *   node apps/api/dist/scripts/block-user.js --user-id 663f1a2b3c4d5e6f7a8b9c0d
 *
 * SSH one-liner:
 *   docker exec andy-code-cat-api node apps/api/dist/scripts/block-user.js --subdomain mia-pizzeria
 */

import { config as loadEnv } from "dotenv";
import { getDb } from "../infra/db/mongo";
import { MongoUserRepository } from "../infra/repositories/MongoUserRepository";
import { MongoSessionRepository } from "../infra/repositories/MongoSessionRepository";

loadEnv();

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
function getArg(flag: string): string | undefined {
    const idx = process.argv.indexOf(flag);
    if (idx === -1) return undefined;
    return process.argv[idx + 1];
}

const email = getArg("--email");
const userId = getArg("--user-id");
const subdomain = getArg("--subdomain");
const unblock = process.argv.includes("--unblock");

if (!email && !userId && !subdomain) {
    console.error("ERROR: provide --email, --user-id, or --subdomain");
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
    const userRepo = new MongoUserRepository();
    const sessionRepo = new MongoSessionRepository();

    // 1. Resolve user identity
    let user = null as Awaited<ReturnType<typeof userRepo.findById>>;

    if (userId) {
        user = await userRepo.findById(userId);
    } else if (email) {
        user = await userRepo.findByEmail(email);
    } else if (subdomain) {
        // Look up via site_deployments.customSlug → userId
        const db = await getDb();
        const col = db.collection("site_deployments");
        const doc = await col.findOne<{ userId: string }>({ customSlug: subdomain });
        if (!doc) {
            console.error(`ERROR: No deployment found for subdomain "${subdomain}"`);
            process.exit(1);
        }
        user = await userRepo.findById(doc.userId);
    }

    if (!user) {
        console.error("ERROR: User not found");
        process.exit(1);
    }

    const targetState = !unblock;   // true = block, false = unblock

    if (user.isBlocked === targetState) {
        console.log(`No change needed — user "${user.email}" isBlocked is already ${targetState}`);
        process.exit(0);
    }

    // 2. Set isBlocked flag
    await userRepo.setBlocked(user.id, targetState);
    console.log(`${targetState ? "BLOCKED" : "UNBLOCKED"} user: ${user.email} (${user.id})`);

    // 3. If blocking, nuke all sessions so refresh tokens stop working immediately
    if (targetState) {
        const deleted = await sessionRepo.deleteAllByUserId(user.id);
        console.log(`Deleted ${deleted} session(s) for user ${user.email}`);
    }

    process.exit(0);
}

run().catch((err) => {
    console.error("block-user failed:", err);
    process.exit(1);
});
