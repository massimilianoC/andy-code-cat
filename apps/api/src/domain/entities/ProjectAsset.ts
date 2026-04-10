/**
 * Who created this asset:
 * - 'user_upload'       → user-uploaded via multipart/form-data HTTP route
 * - 'platform_generated' → created internally by the platform (Layer 1 export,
 *                          brief generation, etc.) — not limited by user quota
 */
export type AssetSource = "user_upload" | "platform_generated";

export interface ProjectAsset {
    id: string;
    projectId: string;
    userId: string;
    /** Original filename as provided by the user or platform (for display only). */
    originalName: string;
    /** Filename as stored on disk: `{assetId}-{safeFilename}`. Never derived from untrusted input. */
    storedFilename: string;
    mimeType: string;
    fileSize: number;
    /** Who produced this asset. Defaults to 'user_upload' for backwards compatibility. */
    source: AssetSource;
    /** Optional human-readable label (e.g. "Layer 1 HTML export", "Project brief"). */
    label?: string;
    /** Whether this asset is actively used in style context injection. */
    useInProject?: boolean;
    /** How the asset is intended to be used (inspiration board vs working material). */
    styleRole?: "inspiration" | "material";
    /** Free-text description of what this asset represents. */
    descriptionText?: string;
    /** External URL for link-only references (no file on disk). */
    externalUrl?: string;
    createdAt: Date;
}
