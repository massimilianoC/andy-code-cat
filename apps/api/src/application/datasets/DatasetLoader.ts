import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import { DatasetCacheStore } from "./DatasetCacheStore";
import type { NormalizedDataset } from "./DatasetRuntime";
import { normalizeDatasetBuffer } from "./DatasetRuntime";

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export async function loadOrCreateDatasetRuntime(
    storage: IFileStorage,
    asset: ProjectAsset,
): Promise<NormalizedDataset | null> {
    const cache = new DatasetCacheStore(storage);
    const cached = await cache.read(asset);
    if (cached) {
        return cached;
    }

    if (asset.externalUrl) {
        return null;
    }

    const filePath = storage.uploadFilePath(asset.userId, asset.projectId, asset.storedFilename);
    const stream = await storage.createReadStream(filePath);
    const buffer = await streamToBuffer(stream);
    const dataset = await normalizeDatasetBuffer(buffer, asset.mimeType);
    if (!dataset) {
        return null;
    }

    await cache.write(asset, dataset);
    return dataset;
}
