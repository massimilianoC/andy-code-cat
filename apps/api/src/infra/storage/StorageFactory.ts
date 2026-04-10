/**
 * StorageFactory — returns the active IFileStorage implementation.
 *
 * Controlled by STORAGE_ADAPTER env var (default: "local").
 * Currently only "local" is fully implemented; "minio" is a stub.
 */
import type { IFileStorage } from "./IFileStorage";
import { LocalFileStorage } from "./LocalFileStorage";
import { MinioFileStorage } from "./MinioFileStorage";

let _instance: IFileStorage | null = null;

export function getFileStorage(): IFileStorage {
    if (_instance) return _instance;
    const adapter = process.env.STORAGE_ADAPTER ?? "local";
    if (adapter === "minio") {
        _instance = new MinioFileStorage();
    } else {
        _instance = new LocalFileStorage();
    }
    return _instance!;
}

/** Convenience singleton — same as getFileStorage() but typed as LocalFileStorage when needed. */
export const localFileStorage: LocalFileStorage = new LocalFileStorage();
