import { randomUUID } from "crypto";

process.env.MONGODB_URI ??= "mongodb://localhost:27018/andy-code-cat";
process.env.JWT_ACCESS_SECRET ??= "local-storage-probe-access-secret-123456";
process.env.JWT_REFRESH_SECRET ??= "local-storage-probe-refresh-secret-123456";
process.env.STORAGE_ADAPTER ??= "local";

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

async function main() {
    const [{ env }, { getFileStorage }] = await Promise.all([
        import("../config"),
        import("../infra/storage/StorageFactory"),
    ]);
    const storage = getFileStorage();
    const userId = "probe-user";
    const projectId = "probe-project";
    const filename = `probe-${randomUUID()}.txt`;
    const body = Buffer.from(
        JSON.stringify({
            probe: true,
            adapter: env.STORAGE_ADAPTER,
            at: new Date().toISOString(),
        }, null, 2),
        "utf-8"
    );

    const savedPath = await storage.saveUpload(userId, projectId, filename, body);
    const exists = await storage.fileExists(savedPath);
    if (!exists) {
        throw new Error(`Probe file was not found after save: ${savedPath}`);
    }

    const size = await storage.fileSize(savedPath);
    const stream = await storage.createReadStream(savedPath);
    const roundTrip = await streamToBuffer(stream);
    if (roundTrip.toString("utf-8") !== body.toString("utf-8")) {
        throw new Error("Round-trip read mismatch during storage probe");
    }

    await storage.deleteUpload(userId, projectId, filename);

    console.log(JSON.stringify({
        status: "ok",
        adapter: env.STORAGE_ADAPTER,
        savedPath,
        bytes: size,
    }, null, 2));
}

main().catch((error) => {
    console.error("Storage probe failed:", error instanceof Error ? error.message : error);
    process.exit(1);
});
