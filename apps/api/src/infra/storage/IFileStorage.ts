/**
 * IFileStorage — abstract storage port.
 * LocalFileStorage (local FS) and MinioFileStorage (S3-compatible) both implement this.
 * Use StorageFactory to get the correct implementation from env.
 */
export interface IFileStorage {
    // --- Uploads ---
    uploadDirPath(userId: string, projectId: string): string;
    uploadFilePath(userId: string, projectId: string, storedFilename: string): string;
    saveUpload(userId: string, projectId: string, storedFilename: string, buffer: Buffer): Promise<string>;
    deleteUpload(userId: string, projectId: string, storedFilename: string): Promise<void>;

    // --- Exports ---
    exportDirPath(userId: string, projectId: string, exportId: string): string;
    exportZipPath(userId: string, projectId: string, exportId: string): string;
    writeExportFile(userId: string, projectId: string, exportId: string, filename: string, content: string): Promise<void>;
    deleteExportDir(userId: string, projectId: string, exportId: string): Promise<void>;

    // --- Published sites ---
    publishDirPath(publishId: string): string;
    writePublishFiles(publishId: string, files: Record<string, string>): Promise<string[]>;
    resolvePublishFile(publishId: string, relativePath: string): string | null;
    deletePublishDir(publishId: string): Promise<void>;
    /** Copy all files from srcId publish dir to destId publish dir (used for slug rename). */
    copyPublishDir(srcId: string, destId: string): Promise<void>;

    // --- Workspaces ---
    workspacePath(userId: string, projectId: string, jobId: string): string;
    workspaceInputPath(userId: string, projectId: string, jobId: string): string;
    workspaceInputAssetsPath(userId: string, projectId: string, jobId: string): string;
    workspaceInputLayer1Path(userId: string, projectId: string, jobId: string): string;
    workspaceOutputPath(userId: string, projectId: string, jobId: string): string;
    workspaceLogsPath(userId: string, projectId: string, jobId: string): string;
    writeWorkspaceFile(workspaceRoot: string, relativePath: string, content: string | Buffer): Promise<string>;
    deleteWorkspaceDir(userId: string, projectId: string, jobId: string): Promise<void>;

    // --- User profile private storage ---
    /** Root dir for private per-user profiling data. */
    profileDirPath(userId: string): string;
    writeProfileData(userId: string, filename: string, data: Buffer | string): Promise<void>;
    readProfileData(userId: string, filename: string): Promise<Buffer | null>;
    deleteProfileData(userId: string, filename: string): Promise<void>;

    // --- Utils ---
    ensureDir(dirPath: string): Promise<void>;
    fileExists(filePath: string): Promise<boolean>;
    fileSize(filePath: string): Promise<number>;
}
