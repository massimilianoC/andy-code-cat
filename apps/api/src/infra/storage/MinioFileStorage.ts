/**
 * MinioFileStorage — S3-compatible storage adapter (stub).
 *
 * This is a future-ready stub. All methods throw "not implemented" until
 * the MinIO client is configured and connected.
 *
 * To enable: set STORAGE_ADAPTER=minio in env and configure MINIO_* vars.
 */
import type { IFileStorage } from "./IFileStorage";

export class MinioFileStorage implements IFileStorage {
    private notImplemented(): never {
        throw Object.assign(new Error("MinIO storage adapter not yet implemented"), {
            statusCode: 501,
        });
    }

    uploadDirPath(_userId: string, _projectId: string): string { this.notImplemented(); }
    uploadFilePath(_userId: string, _projectId: string, _storedFilename: string): string { this.notImplemented(); }
    async saveUpload(_userId: string, _projectId: string, _storedFilename: string, _buffer: Buffer): Promise<string> { this.notImplemented(); }
    async deleteUpload(_userId: string, _projectId: string, _storedFilename: string): Promise<void> { this.notImplemented(); }

    exportDirPath(_userId: string, _projectId: string, _exportId: string): string { this.notImplemented(); }
    exportZipPath(_userId: string, _projectId: string, _exportId: string): string { this.notImplemented(); }
    async writeExportFile(_userId: string, _projectId: string, _exportId: string, _filename: string, _content: string): Promise<void> { this.notImplemented(); }
    async deleteExportDir(_userId: string, _projectId: string, _exportId: string): Promise<void> { this.notImplemented(); }

    publishDirPath(_publishId: string): string { this.notImplemented(); }
    async writePublishFiles(_publishId: string, _files: Record<string, string>): Promise<string[]> { this.notImplemented(); }
    resolvePublishFile(_publishId: string, _relativePath: string): string | null { this.notImplemented(); }
    async deletePublishDir(_publishId: string): Promise<void> { this.notImplemented(); }
    async copyPublishDir(_srcId: string, _destId: string): Promise<void> { this.notImplemented(); }

    workspacePath(_userId: string, _projectId: string, _jobId: string): string { this.notImplemented(); }
    workspaceInputPath(_userId: string, _projectId: string, _jobId: string): string { this.notImplemented(); }
    workspaceInputAssetsPath(_userId: string, _projectId: string, _jobId: string): string { this.notImplemented(); }
    workspaceInputLayer1Path(_userId: string, _projectId: string, _jobId: string): string { this.notImplemented(); }
    workspaceOutputPath(_userId: string, _projectId: string, _jobId: string): string { this.notImplemented(); }
    workspaceLogsPath(_userId: string, _projectId: string, _jobId: string): string { this.notImplemented(); }
    async writeWorkspaceFile(_workspaceRoot: string, _relativePath: string, _content: string | Buffer): Promise<string> { this.notImplemented(); }
    async deleteWorkspaceDir(_userId: string, _projectId: string, _jobId: string): Promise<void> { this.notImplemented(); }

    profileDirPath(_userId: string): string { this.notImplemented(); }
    async writeProfileData(_userId: string, _filename: string, _data: Buffer | string): Promise<void> { this.notImplemented(); }
    async readProfileData(_userId: string, _filename: string): Promise<Buffer | null> { this.notImplemented(); }
    async deleteProfileData(_userId: string, _filename: string): Promise<void> { this.notImplemented(); }

    async ensureDir(_dirPath: string): Promise<void> { this.notImplemented(); }
    async fileExists(_filePath: string): Promise<boolean> { this.notImplemented(); }
    async fileSize(_filePath: string): Promise<number> { this.notImplemented(); }
}
