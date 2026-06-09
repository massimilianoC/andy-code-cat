import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import type { NormalizedDataset } from "./DatasetRuntime";

interface PersistedDatasetCache {
    version: 1;
    assetId: string;
    projectId: string;
    userId: string;
    mimeType: string;
    fileSize: number;
    storedFilename: string;
    cachedAt: string;
    dataset: NormalizedDataset;
}

function cacheFilename(projectId: string, assetId: string): string {
    return `dataset-cache-${projectId}-${assetId}.json`;
}

function isCacheValid(cache: PersistedDatasetCache, asset: ProjectAsset): boolean {
    return cache.version === 1
        && cache.assetId === asset.id
        && cache.projectId === asset.projectId
        && cache.userId === asset.userId
        && cache.mimeType === asset.mimeType
        && cache.fileSize === asset.fileSize
        && cache.storedFilename === asset.storedFilename;
}

export class DatasetCacheStore {
    constructor(private readonly storage: IFileStorage) {}

    async exists(asset: ProjectAsset): Promise<boolean> {
        const raw = await this.storage.readProfileData(asset.userId, cacheFilename(asset.projectId, asset.id));
        if (!raw) return false;
        try {
            const parsed = JSON.parse(raw.toString("utf8")) as PersistedDatasetCache;
            return isCacheValid(parsed, asset);
        } catch {
            return false;
        }
    }

    async read(asset: ProjectAsset): Promise<NormalizedDataset | null> {
        const raw = await this.storage.readProfileData(asset.userId, cacheFilename(asset.projectId, asset.id));
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw.toString("utf8")) as PersistedDatasetCache;
            if (!isCacheValid(parsed, asset)) {
                return null;
            }
            return parsed.dataset;
        } catch {
            return null;
        }
    }

    async write(asset: ProjectAsset, dataset: NormalizedDataset): Promise<void> {
        const payload: PersistedDatasetCache = {
            version: 1,
            assetId: asset.id,
            projectId: asset.projectId,
            userId: asset.userId,
            mimeType: asset.mimeType,
            fileSize: asset.fileSize,
            storedFilename: asset.storedFilename,
            cachedAt: new Date().toISOString(),
            dataset,
        };

        await this.storage.writeProfileData(
            asset.userId,
            cacheFilename(asset.projectId, asset.id),
            JSON.stringify(payload),
        );
    }
}
