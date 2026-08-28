import type {
    PreviewArtifactsDto,
    PreviewSnapshotFocusContextDto,
    PreviewSnapshotMetadataDto,
    ServiceManifestV1,
} from "@andy-code-cat/contracts";

// The shape of an artifact version is declared once, in packages/contracts/src/preview.ts.
// This module names those shapes for the domain layer; it does not restate them. Re-typing
// them here is what let promptConfigId and promptExecutionId drift out of the stored record.

export type PreviewSnapshotArtifacts = PreviewArtifactsDto;

export type PreviewSnapshotFocusContext = PreviewSnapshotFocusContextDto;

export type PreviewSnapshotMetadata = PreviewSnapshotMetadataDto;

export interface PreviewSnapshot {
    id: string;
    projectId: string;
    conversationId: string;
    sourceMessageId?: string;
    parentSnapshotId?: string;
    isActive: boolean;
    artifacts: PreviewSnapshotArtifacts;
    /** Immutable declarative service definition paired with this artifact version. */
    serviceManifest?: ServiceManifestV1;
    focusContext?: PreviewSnapshotFocusContext;
    metadata?: PreviewSnapshotMetadata;
    /**
     * Stored path / key for the background-generated Puppeteer JPEG thumbnail.
     * Absent until the async job completes. Use the thumbnail API endpoint to serve it.
     */
    thumbnailPath?: string;
    createdAt: Date;
    activatedAt?: Date;
}
