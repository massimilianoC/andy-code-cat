import { buildFullDoc, captureHtml } from "../../infra/capture/PuppeteerCaptureService";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

export type { CaptureFormat } from "../../infra/capture/PuppeteerCaptureService";

export class CapturePreviewSnapshot {
    constructor(
        private readonly previewSnapshotRepository: PreviewSnapshotRepository
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

        return captureHtml(html, format);
    }
}
