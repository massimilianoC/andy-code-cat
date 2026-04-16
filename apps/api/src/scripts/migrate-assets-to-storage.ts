import fs from "fs/promises";
import path from "path";

process.env.MONGODB_URI ??= "mongodb://localhost:27018/andy-code-cat";
process.env.JWT_ACCESS_SECRET ??= "local-storage-migrate-access-secret-123456";
process.env.JWT_REFRESH_SECRET ??= "local-storage-migrate-refresh-secret-123456";
process.env.STORAGE_ADAPTER ??= "local";

interface AssetRecord {
    _id: string;
    userId: string;
    projectId: string;
    storedFilename: string;
    externalUrl?: string;
}

function hasFlag(flag: string): boolean {
    const normalized = flag.replace(/^--/, "").replace(/-/g, "_");
    return process.argv.includes(flag)
        || process.argv.includes(`--${normalized}`)
        || process.env[`npm_config_${normalized}`] === "true"
        || process.env[`npm_config_${normalized}`] === "1";
}

async function walkFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(current: string): Promise<void> {
        let entries: string[] = [];
        try {
            entries = await fs.readdir(current);
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry);
            const stat = await fs.stat(full).catch(() => null);
            if (!stat) continue;
            if (stat.isDirectory()) {
                await walk(full);
            } else {
                out.push(full);
            }
        }
    }
    await walk(root);
    return out;
}

async function main() {
    const dryRun = hasFlag("--dry-run");
    const [{ env }, { getDb }, { LocalFileStorage }, { getFileStorage }] = await Promise.all([
        import("../config"),
        import("../infra/db/mongo"),
        import("../infra/storage/LocalFileStorage"),
        import("../infra/storage/StorageFactory"),
    ]);
    const localStorage = new LocalFileStorage();
    const targetStorage = getFileStorage();

    const db = await getDb();
    const assets = await db.collection<AssetRecord>("project_assets")
        .find({ storedFilename: { $ne: "" }, externalUrl: { $exists: false } })
        .toArray();

    let migrated = 0;
    let skippedExisting = 0;
    let missingLocal = 0;
    let profileMigrated = 0;

    for (const asset of assets) {
        const localPath = localStorage.uploadFilePath(asset.userId, asset.projectId, asset.storedFilename);
        const localExists = await localStorage.fileExists(localPath);
        if (!localExists) {
            missingLocal += 1;
            continue;
        }

        const targetPath = targetStorage.uploadFilePath(asset.userId, asset.projectId, asset.storedFilename);
        if (await targetStorage.fileExists(targetPath)) {
            skippedExisting += 1;
            continue;
        }

        if (!dryRun) {
            const buffer = await fs.readFile(localPath);
            await targetStorage.saveUpload(asset.userId, asset.projectId, asset.storedFilename, buffer);
        }
        migrated += 1;
    }

    const profilesRoot = path.join(env.DATA_DIR, "profiles");
    const profileFiles = await walkFiles(profilesRoot);
    for (const fullPath of profileFiles) {
        const rel = path.relative(profilesRoot, fullPath);
        const parts = rel.split(path.sep);
        const userId = parts.shift();
        const filename = parts.join("_");
        if (!userId || !filename) continue;

        const already = await targetStorage.readProfileData(userId, filename);
        if (already) continue;

        if (!dryRun) {
            const buffer = await fs.readFile(fullPath);
            await targetStorage.writeProfileData(userId, filename, buffer);
        }
        profileMigrated += 1;
    }

    console.log(JSON.stringify({
        status: "ok",
        adapter: env.STORAGE_ADAPTER,
        dryRun,
        assetRecordsSeen: assets.length,
        migrated,
        skippedExisting,
        missingLocal,
        profileMigrated,
    }, null, 2));

    process.exit(0);
}

main().catch((error) => {
    console.error("Storage migration failed:", error instanceof Error ? error.message : error);
    process.exit(1);
});
