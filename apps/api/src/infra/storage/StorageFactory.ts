/**
 * StorageFactory — returns the active IFileStorage implementation.
 *
 * Controlled by the validated STORAGE_ADAPTER env setting.
 * MinIO is now available for project/user media while local FS remains the
 * compatibility path for publish/export/workspace flows.
 */
import { env } from "../../config";
import type { IFileStorage } from "./IFileStorage";
import { LocalFileStorage } from "./LocalFileStorage";
import { MinioFileStorage } from "./MinioFileStorage";

let _instance: IFileStorage | null = null;

export function getFileStorage(): IFileStorage {
    if (_instance) return _instance;
    if (env.STORAGE_ADAPTER === "minio") {
        _instance = new MinioFileStorage();
    } else {
        _instance = new LocalFileStorage();
    }
    return _instance!;
}

/** Convenience singleton — same as getFileStorage() but typed as LocalFileStorage when needed. */
export const localFileStorage: LocalFileStorage = new LocalFileStorage();
