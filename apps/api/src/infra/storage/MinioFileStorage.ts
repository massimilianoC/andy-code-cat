/**
 * MinioFileStorage — S3-compatible storage adapter for user/project media.
 *
 * Uploads and private profiling files are stored in MinIO.
 * Export, publish, and workspace folders still use the local filesystem so the
 * current ZIP/publish/OpenCode flows remain backward-compatible.
 */
import { Client } from "minio";
import path from "path";
import { env } from "../../config";
import { LocalFileStorage } from "./LocalFileStorage";
import type { IFileStorage } from "./IFileStorage";

function toPosixPath(...parts: string[]): string {
    return parts.filter(Boolean).join("/").replace(/\\+/g, "/");
}

function isVirtualMinioPath(filePath: string): boolean {
    return filePath.startsWith("minio://");
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export class MinioFileStorage implements IFileStorage {
    private readonly fallback = new LocalFileStorage();
    private readonly bucket = env.MINIO_BUCKET;
    private readonly rootPrefix = (env.MINIO_ROOT_PREFIX || "andy-code-cat").replace(/^\/+|\/+$/g, "");
    private readonly client = new Client({
        endPoint: env.MINIO_ENDPOINT,
        port: env.MINIO_PORT,
        useSSL: env.MINIO_USE_SSL,
        accessKey: env.MINIO_ACCESS_KEY,
        secretKey: env.MINIO_SECRET_KEY,
        region: env.MINIO_REGION,
    });
    private bucketReady?: Promise<void>;

    private virtualUri(key: string): string {
        return `minio://${this.bucket}/${key}`;
    }

    private keyFor(kind: string, ...parts: string[]): string {
        return toPosixPath(this.rootPrefix, kind, ...parts);
    }

    private parseVirtualPath(filePath: string): { bucket: string; key: string } {
        const trimmed = filePath.replace(/^minio:\/\//, "");
        const slashIndex = trimmed.indexOf("/");
        if (slashIndex < 0) {
            throw Object.assign(new Error("Invalid MinIO file path"), { statusCode: 500 });
        }
        return {
            bucket: trimmed.slice(0, slashIndex),
            key: trimmed.slice(slashIndex + 1),
        };
    }

    private async ensureBucketReady(): Promise<void> {
        if (!this.bucketReady) {
            this.bucketReady = (async () => {
                const exists = await this.client.bucketExists(this.bucket);
                if (!exists) {
                    await this.client.makeBucket(this.bucket, env.MINIO_REGION);
                }
            })();
        }
        await this.bucketReady;
    }

    uploadDirPath(userId: string, projectId: string): string {
        return this.virtualUri(this.keyFor("uploads", userId, projectId));
    }

    uploadFilePath(userId: string, projectId: string, storedFilename: string): string {
        return this.virtualUri(this.keyFor("uploads", userId, projectId, storedFilename));
    }

    async saveUpload(
        userId: string,
        projectId: string,
        storedFilename: string,
        buffer: Buffer,
        contentType?: string,
    ): Promise<string> {
        await this.ensureBucketReady();
        const key = this.keyFor("uploads", userId, projectId, storedFilename);
        await this.client.putObject(
            this.bucket,
            key,
            buffer,
            buffer.byteLength,
            contentType ? { "Content-Type": contentType } : undefined,
        );
        return this.virtualUri(key);
    }

    async deleteUpload(userId: string, projectId: string, storedFilename: string): Promise<void> {
        await this.ensureBucketReady();
        const key = this.keyFor("uploads", userId, projectId, storedFilename);
        try {
            await this.client.removeObject(this.bucket, key);
        } catch {
            // idempotent delete for missing objects
        }
    }

    async createReadStream(filePath: string): Promise<NodeJS.ReadableStream> {
        if (!isVirtualMinioPath(filePath)) {
            return this.fallback.createReadStream(filePath);
        }
        const { bucket, key } = this.parseVirtualPath(filePath);
        await this.ensureBucketReady();
        return this.client.getObject(bucket, key);
    }

    exportDirPath(userId: string, projectId: string, exportId: string): string {
        return this.fallback.exportDirPath(userId, projectId, exportId);
    }

    exportZipPath(userId: string, projectId: string, exportId: string): string {
        return this.fallback.exportZipPath(userId, projectId, exportId);
    }

    async writeExportFile(userId: string, projectId: string, exportId: string, filename: string, content: string): Promise<void> {
        return this.fallback.writeExportFile(userId, projectId, exportId, filename, content);
    }

    async deleteExportDir(userId: string, projectId: string, exportId: string): Promise<void> {
        return this.fallback.deleteExportDir(userId, projectId, exportId);
    }

    publishDirPath(publishId: string): string {
        return this.fallback.publishDirPath(publishId);
    }

    async writePublishFiles(publishId: string, files: Record<string, string>): Promise<string[]> {
        return this.fallback.writePublishFiles(publishId, files);
    }

    resolvePublishFile(publishId: string, relativePath: string): string | null {
        return this.fallback.resolvePublishFile(publishId, relativePath);
    }

    async deletePublishDir(publishId: string): Promise<void> {
        return this.fallback.deletePublishDir(publishId);
    }

    async copyPublishDir(srcId: string, destId: string): Promise<void> {
        return this.fallback.copyPublishDir(srcId, destId);
    }

    workspacePath(userId: string, projectId: string, jobId: string): string {
        return this.fallback.workspacePath(userId, projectId, jobId);
    }

    workspaceInputPath(userId: string, projectId: string, jobId: string): string {
        return this.fallback.workspaceInputPath(userId, projectId, jobId);
    }

    workspaceInputAssetsPath(userId: string, projectId: string, jobId: string): string {
        return this.fallback.workspaceInputAssetsPath(userId, projectId, jobId);
    }

    workspaceInputLayer1Path(userId: string, projectId: string, jobId: string): string {
        return this.fallback.workspaceInputLayer1Path(userId, projectId, jobId);
    }

    workspaceOutputPath(userId: string, projectId: string, jobId: string): string {
        return this.fallback.workspaceOutputPath(userId, projectId, jobId);
    }

    workspaceLogsPath(userId: string, projectId: string, jobId: string): string {
        return this.fallback.workspaceLogsPath(userId, projectId, jobId);
    }

    async writeWorkspaceFile(workspaceRoot: string, relativePath: string, content: string | Buffer): Promise<string> {
        return this.fallback.writeWorkspaceFile(workspaceRoot, relativePath, content);
    }

    async deleteWorkspaceDir(userId: string, projectId: string, jobId: string): Promise<void> {
        return this.fallback.deleteWorkspaceDir(userId, projectId, jobId);
    }

    profileDirPath(userId: string): string {
        return this.virtualUri(this.keyFor("profiles", userId));
    }

    async writeProfileData(userId: string, filename: string, data: Buffer | string): Promise<void> {
        await this.ensureBucketReady();
        const key = this.keyFor("profiles", userId, path.basename(filename));
        const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
        await this.client.putObject(this.bucket, key, payload, payload.byteLength);
    }

    async readProfileData(userId: string, filename: string): Promise<Buffer | null> {
        await this.ensureBucketReady();
        const key = this.keyFor("profiles", userId, path.basename(filename));
        try {
            const stream = await this.client.getObject(this.bucket, key);
            return await streamToBuffer(stream);
        } catch {
            return null;
        }
    }

    async deleteProfileData(userId: string, filename: string): Promise<void> {
        await this.ensureBucketReady();
        const key = this.keyFor("profiles", userId, path.basename(filename));
        try {
            await this.client.removeObject(this.bucket, key);
        } catch {
            // idempotent delete for missing objects
        }
    }

    async ensureDir(dirPath: string): Promise<void> {
        if (isVirtualMinioPath(dirPath)) return;
        return this.fallback.ensureDir(dirPath);
    }

    async fileExists(filePath: string): Promise<boolean> {
        if (!isVirtualMinioPath(filePath)) {
            return this.fallback.fileExists(filePath);
        }
        try {
            const { bucket, key } = this.parseVirtualPath(filePath);
            await this.ensureBucketReady();
            await this.client.statObject(bucket, key);
            return true;
        } catch {
            return false;
        }
    }

    async fileSize(filePath: string): Promise<number> {
        if (!isVirtualMinioPath(filePath)) {
            return this.fallback.fileSize(filePath);
        }
        const { bucket, key } = this.parseVirtualPath(filePath);
        await this.ensureBucketReady();
        const stat = await this.client.statObject(bucket, key);
        return stat.size;
    }
}
