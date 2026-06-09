import { buildFullDoc, captureHtml } from "../../infra/capture/PuppeteerCaptureService";
import { PRESET_MAP } from "../../domain/entities/ProjectPreset";
import type { ProjectPresetRepository } from "../../domain/repositories/ProjectPresetRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

export type { CaptureFormat } from "../../infra/capture/PuppeteerCaptureService";

export class CapturePreviewSnapshot {
    constructor(
        private readonly previewSnapshotRepository: PreviewSnapshotRepository,
        private readonly projectRepository: ProjectRepository,
        private readonly projectPresetRepository: ProjectPresetRepository,
    ) { }

    async execute(
        projectId: string,
        snapshotId: string,
        format: import("../../infra/capture/PuppeteerCaptureService").CaptureFormat
    ): Promise<Buffer> {
        const snapshot = await this.previewSnapshotRepository.findById(
            projectId,
            snapshotId
        );
        if (!snapshot) {
            throw Object.assign(new Error("Snapshot not found"), {
                statusCode: 404,
            });
        }

        const html = buildFullDoc(
            snapshot.artifacts.html,
            snapshot.artifacts.css,
            snapshot.artifacts.js
        );

        let outputSpec = undefined;
        if (format === "pdf") {
            const project = await this.projectRepository.findById(projectId);
            const presetId = project?.presetId;
            if (presetId) {
                const preset = await this.projectPresetRepository.findById(presetId).catch(() => null)
                    ?? PRESET_MAP.get(presetId)
                    ?? null;
                outputSpec = preset?.outputSpec;
            }
        }

        return captureHtml(html, format, { outputSpec });
    }
}
