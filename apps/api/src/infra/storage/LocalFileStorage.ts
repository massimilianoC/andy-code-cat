import fs from "fs/promises";
import path from "path";
import { env } from "../../config";
import type { IFileStorage } from "./IFileStorage";

function dataRoot(): string {
    return env.DATA_DIR;
}

function uploadsRoot(): string {
    return path.join(dataRoot(), "uploads");
}

function exportsRoot(): string {
    return path.join(dataRoot(), "exports");
}

function workspacesRoot(): string {
    return path.join(dataRoot(), "workspaces");
}

function wwwRoot(): string {
    return path.join(dataRoot(), "www");
}

function profilesRoot(): string {
    return path.join(dataRoot(), "profiles");
}

export class LocalFileStorage implements IFileStorage {
    /** Absolute path for a user+project upload directory. */
    uploadDirPath(userId: string, projectId: string): string {
        return path.join(uploadsRoot(), userId, projectId);
    }

    /** Absolute path for an uploaded asset file. storedFilename is system-generated, never user input. */
    uploadFilePath(userId: string, projectId: string, storedFilename: string): string {
        return path.join(this.uploadDirPath(userId, projectId), storedFilename);
    }

    /** Absolute path for an export's working directory. */
    exportDirPath(userId: string, projectId: string, exportId: string): string {
        return path.join(exportsRoot(), userId, projectId, exportId);
    }

    /** Absolute path for an export ZIP file. */
    exportZipPath(userId: string, projectId: string, exportId: string): string {
        return path.join(exportsRoot(), userId, projectId, `${exportId}.zip`);
    }

    async ensureDir(dirPath: string): Promise<void> {
        await fs.mkdir(dirPath, { recursive: true });
    }

    async saveUpload(
        userId: string,
        projectId: string,
        storedFilename: string,
        buffer: Buffer
    ): Promise<string> {
        const dir = this.uploadDirPath(userId, projectId);
        await this.ensureDir(dir);
        const filePath = path.join(dir, storedFilename);
        await fs.writeFile(filePath, buffer);
        return filePath;
    }

    async deleteUpload(userId: string, projectId: string, storedFilename: string): Promise<void> {
        const filePath = this.uploadFilePath(userId, projectId, storedFilename);
        try {
            await fs.unlink(filePath);
        } catch (err: unknown) {
            // If file is already gone, ignore (idempotent delete).
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
    }

    async writeExportFile(
        userId: string,
        projectId: string,
        exportId: string,
        filename: string,
        content: string
    ): Promise<void> {
        const dir = this.exportDirPath(userId, projectId, exportId);
        await this.ensureDir(dir);
        await fs.writeFile(path.join(dir, filename), content, "utf-8");
    }

    async deleteExportDir(userId: string, projectId: string, exportId: string): Promise<void> {
        const dir = this.exportDirPath(userId, projectId, exportId);
        try {
            await fs.rm(dir, { recursive: true, force: true });
        } catch {
            // best effort
        }
    }

    async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async fileSize(filePath: string): Promise<number> {
        const stat = await fs.stat(filePath);
        return stat.size;
    }

    // -----------------------------------------------------------------------
    // Publish paths — /data/www/{publishId}/
    // publishId is a validated short alphanumeric string, never user input.
    // -----------------------------------------------------------------------

    /** Absolute path for a published site directory. */
    publishDirPath(publishId: string): string {
        return path.join(wwwRoot(), publishId);
    }

    /** Write all publish files (index.html, style.css, script.js) to the publish directory. */
    async writePublishFiles(publishId: string, files: Record<string, string>): Promise<string[]> {
        const dir = this.publishDirPath(publishId);
        await this.ensureDir(dir);
        const written: string[] = [];
        for (const [filename, content] of Object.entries(files)) {
            await fs.writeFile(path.join(dir, filename), content, "utf-8");
            written.push(filename);
        }
        return written;
    }

    /** Resolve a file path within a publish directory. Returns null if it would escape the root. */
    resolvePublishFile(publishId: string, relativePath: string): string | null {
        const dir = this.publishDirPath(publishId);
        const resolved = path.resolve(dir, relativePath);
        // Path traversal guard
        if (!resolved.startsWith(path.resolve(dir))) return null;
        return resolved;
    }

    /** Delete an entire publish directory. */
    async deletePublishDir(publishId: string): Promise<void> {
        const dir = this.publishDirPath(publishId);
        try {
            await fs.rm(dir, { recursive: true, force: true });
        } catch {
            // best effort
        }
    }

    /** Copy all files from srcId publish dir to destId publish dir (used for slug rename). */
    async copyPublishDir(srcId: string, destId: string): Promise<void> {
        const src = this.publishDirPath(srcId);
        const dest = this.publishDirPath(destId);
        await this.ensureDir(dest);
        await fs.cp(src, dest, { recursive: true });
    }

    // -----------------------------------------------------------------------
    // Workspace paths — double sandbox + jobId isolation
    // All paths: /data/workspaces/{userId}/{projectId}/{jobId}/
    // -----------------------------------------------------------------------

    /** Root of the workspace for a specific job. */
    workspacePath(userId: string, projectId: string, jobId: string): string {
        return path.join(workspacesRoot(), userId, projectId, jobId);
    }

    /** Where user assets and platform artifacts are copied as OpenCode input. */
    workspaceInputPath(userId: string, projectId: string, jobId: string): string {
        return path.join(this.workspacePath(userId, projectId, jobId), "input");
    }

    /** Sub-directory for project assets copied from user uploads or platform store. */
    workspaceInputAssetsPath(userId: string, projectId: string, jobId: string): string {
        return path.join(this.workspaceInputPath(userId, projectId, jobId), "assets");
    }

    /** Sub-directory for Layer 1 HTML/CSS/JS artifacts. */
    workspaceInputLayer1Path(userId: string, projectId: string, jobId: string): string {
        return path.join(this.workspaceInputPath(userId, projectId, jobId), "layer1");
    }

    /** Where OpenCode generates the Astro project output. */
    workspaceOutputPath(userId: string, projectId: string, jobId: string): string {
        return path.join(this.workspacePath(userId, projectId, jobId), "output");
    }

    /** Where OpenCode stdout/stderr logs are captured. */
    workspaceLogsPath(userId: string, projectId: string, jobId: string): string {
        return path.join(this.workspacePath(userId, projectId, jobId), "logs");
    }

    /**
     * Write a file in the workspace using a relative path from the workspace root.
     * The relative path must not escape the workspace root.
     */
    async writeWorkspaceFile(
        workspaceRoot: string,
        relativePath: string,
        content: string | Buffer
    ): Promise<string> {
        const resolved = path.resolve(workspaceRoot, relativePath);
        // Path traversal guard
        if (!resolved.startsWith(path.resolve(workspaceRoot))) {
            throw Object.assign(new Error("Invalid workspace path"), { statusCode: 400 });
        }
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, content);
        return resolved;
    }

    /**
     * Copy a file from an absolute source path into the workspace.
     * destRelativePath is relative to workspaceRoot.
     */
    async copyToWorkspace(
        srcAbsPath: string,
        workspaceRoot: string,
        destRelativePath: string
    ): Promise<string> {
        const resolved = path.resolve(workspaceRoot, destRelativePath);
        if (!resolved.startsWith(path.resolve(workspaceRoot))) {
            throw Object.assign(new Error("Invalid workspace path"), { statusCode: 400 });
        }
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.copyFile(srcAbsPath, resolved);
        return resolved;
    }

    /** Delete an entire workspace directory (used for cleanup or rollback). */
    async deleteWorkspace(userId: string, projectId: string, jobId: string): Promise<void> {
        const wsPath = this.workspacePath(userId, projectId, jobId);
        try {
            await fs.rm(wsPath, { recursive: true, force: true });
        } catch {
            // best effort
        }
    }

    // -----------------------------------------------------------------------
    // IFileStorage compatibility alias
    // -----------------------------------------------------------------------

    async deleteWorkspaceDir(userId: string, projectId: string, jobId: string): Promise<void> {
        return this.deleteWorkspace(userId, projectId, jobId);
    }

    // -----------------------------------------------------------------------
    // User profile private storage — /data/profiles/{userId}/
    // -----------------------------------------------------------------------

    profileDirPath(userId: string): string {
        return path.join(profilesRoot(), userId);
    }

    async writeProfileData(userId: string, filename: string, data: Buffer | string): Promise<void> {
        const dir = this.profileDirPath(userId);
        await this.ensureDir(dir);
        await fs.writeFile(path.join(dir, filename), data);
    }

    async readProfileData(userId: string, filename: string): Promise<Buffer | null> {
        const filePath = path.join(this.profileDirPath(userId), filename);
        try {
            return await fs.readFile(filePath);
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw err;
        }
    }

    async deleteProfileData(userId: string, filename: string): Promise<void> {
        const filePath = path.join(this.profileDirPath(userId), filename);
        try {
            await fs.unlink(filePath);
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
    }

    // -----------------------------------------------------------------------
    // List all files recursively under a directory
    // -----------------------------------------------------------------------

    /** List all files recursively under a directory, returning absolute paths. */
    async listFilesRecursive(dir: string): Promise<string[]> {
        const results: string[] = [];
        const walk = async (current: string): Promise<void> => {
            let names: string[];
            try {
                names = await fs.readdir(current);
            } catch {
                return;
            }
            for (const name of names) {
                const full = path.join(current, name);
                let stat;
                try { stat = await fs.stat(full); } catch { continue; }
                if (stat.isDirectory()) {
                    await walk(full);
                } else {
                    results.push(full);
                }
            }
        };
        await walk(dir);
        return results;
    }
}

export const localFileStorage = new LocalFileStorage();
