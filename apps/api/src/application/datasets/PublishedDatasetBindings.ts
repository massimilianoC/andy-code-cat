import type { PublishedDatasetManifestDto, PublishedDatasetBindingDto } from "@andy-code-cat/contracts";
import type { PreviewSnapshotMetadata } from "../../domain/entities/PreviewSnapshot";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { LocalFileStorage } from "../../infra/storage/LocalFileStorage";
import { loadOrCreateDatasetRuntime } from "./DatasetLoader";

const LOCAL_RUNTIME_MAX_ROWS = 5000;
const LOCAL_RUNTIME_MAX_CELLS = 100_000;

function canWriteLocalRuntime(rowCount: number, columnCount: number): boolean {
    return rowCount <= LOCAL_RUNTIME_MAX_ROWS && rowCount * Math.max(columnCount, 1) <= LOCAL_RUNTIME_MAX_CELLS;
}

export async function buildPublishedDatasetBindingPackage(input: {
    publishId: string;
    projectId: string;
    userId: string;
    metadata?: PreviewSnapshotMetadata;
    assetRepository: ProjectAssetRepository;
    storage: LocalFileStorage;
}): Promise<{ files: Record<string, string>; limitations: string[]; writtenBindings: PublishedDatasetBindingDto[] }> {
    const dataDashboard = input.metadata?.dataDashboard;
    if (!dataDashboard || dataDashboard.datasetBindings.length === 0) {
        return { files: {}, limitations: [], writtenBindings: [] };
    }

    const files: Record<string, string> = {};
    const limitations: string[] = [];
    const writtenBindings: PublishedDatasetBindingDto[] = [];

    for (const binding of dataDashboard.datasetBindings) {
        const asset = await input.assetRepository.findById(binding.assetId, input.projectId, input.userId);
        if (!asset || asset.externalUrl) {
            limitations.push(`Binding "${binding.bindingId}" could not resolve the source asset and was skipped.`);
            continue;
        }

        const dataset = await loadOrCreateDatasetRuntime(input.storage, asset);
        if (!dataset) {
            limitations.push(`Binding "${binding.bindingId}" could not build a deterministic dataset runtime and was skipped.`);
            continue;
        }

        const publishedBinding: PublishedDatasetBindingDto = {
            bindingId: binding.bindingId,
            assetId: binding.assetId,
            originalName: asset.originalName,
            sourceFormat: dataset.sourceFormat,
            tableName: binding.tableName,
            runtimeMode: binding.runtimeMode,
            exposureClass: binding.exposureClass,
            limitations: [...(binding.limitations ?? [])],
        };

        const localRuntimeAllowed =
            binding.runtimeMode !== "backend_query" &&
            binding.exposureClass !== "backend_only" &&
            canWriteLocalRuntime(dataset.facts.rowCount, dataset.facts.columnCount);

        if (localRuntimeAllowed) {
            const runtimePath = `data/runtime-${binding.bindingId}.json`;
            files[runtimePath] = JSON.stringify(dataset);
            publishedBinding.publishedRuntimePath = runtimePath;
        } else {
            publishedBinding.limitations.push("Local published runtime omitted because the dataset exceeds current publish thresholds or the binding is backend-only.");
        }

        if (binding.exposureClass === "published_runtime_plus_source") {
            publishedBinding.limitations.push("Source-file publication is not implemented yet; only the normalized runtime sidecar is currently published.");
        }

        writtenBindings.push(publishedBinding);
    }

    if (writtenBindings.length === 0) {
        return { files: {}, limitations, writtenBindings: [] };
    }

    const manifest: PublishedDatasetManifestDto = {
        version: "dataset-bindings-v1",
        publishId: input.publishId,
        projectId: input.projectId,
        generatedAt: new Date().toISOString(),
        artifactKind: "data_dashboard",
        bindings: writtenBindings,
        dashboardDefinition: dataDashboard.dashboardDefinition,
        querySpecs: dataDashboard.querySpecs,
        chartSpecs: dataDashboard.chartSpecs,
        limitations,
    };

    files["data/manifest.json"] = JSON.stringify(manifest);
    return { files, limitations, writtenBindings };
}
