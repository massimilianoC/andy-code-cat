import type { AssetEnrichmentTrace } from "./AssetEnrichmentTrace";

export type BrandAssetScope = "platform" | "user" | "project";

export type BrandAssetRole =
    | "brand_logo"
    | "brand_logo_dark"
    | "brand_logo_light"
    | "client_logo"
    | "brand_hero"
    | "brand_pattern"
    | "brand_font_sample"
    | "brand_color_palette"
    | "company_name"
    | "brand_tagline"
    | "contact_email"
    | "contact_phone"
    | "contact_address"
    | "social_instagram"
    | "social_linkedin"
    | "social_website"
    | "legal_vat"
    // Reusable brand book / guidelines document (PDF, DOCX, TXT/MD) — analysed once,
    // injected as Layer D development context into every project.
    | "brand_document"
    | "custom";

export type BrandAssetPolicy = "must_use" | "prefer" | "optional";
/**
 * `document_ref` behaves like `asset_ref` for file storage but additionally carries a
 * pre-rendered Layer D enrichment fragment (`documentFragment`) computed once at upload/promote.
 */
export type BrandAssetValueType = "asset_ref" | "text" | "color_list" | "url" | "document_ref";

/** Lifecycle of the one-time enrichment for a `document_ref` brand asset. */
export type BrandAssetEnrichmentStatus = "pending" | "ready" | "failed" | "skipped";

export interface BrandAsset {
    id: string;
    scope: BrandAssetScope;
    ownerUserId?: string;
    projectId?: string;
    role: BrandAssetRole;
    customRoleLabel?: string;
    policy: BrandAssetPolicy;
    valueType: BrandAssetValueType;
    storedFilename?: string;
    originalName?: string;
    mimeType?: string;
    fileSize?: number;
    /** Set when the asset_ref was promoted from an existing ProjectAsset (no separate file copy). */
    promotedFromAssetId?: string;
    textValue?: string;
    description?: string;
    /**
     * Pre-rendered Layer D fragment for a `document_ref` asset. Computed ONCE at
     * upload (via AssetEnrichmentPipeline) or copied from the source ProjectAsset at
     * promote time. Injected verbatim into Layer D of every project — never recomputed.
     */
    documentFragment?: string;
    /** Full enrichment trace for a `document_ref` asset (optional; for re-render/debug). */
    enrichmentTrace?: AssetEnrichmentTrace | null;
    /** One-time enrichment lifecycle for `document_ref` assets. */
    enrichmentStatus?: BrandAssetEnrichmentStatus;
    isActive: boolean;
    priority: number;
    createdAt: Date;
    updatedAt: Date;
}

export type CreateBrandAssetInput = Omit<BrandAsset, "id" | "createdAt" | "updatedAt">;
export type UpdateBrandAssetInput = Partial<
    Pick<BrandAsset, "role" | "customRoleLabel" | "policy" | "textValue" | "description" | "isActive" | "priority"
        | "documentFragment" | "enrichmentTrace" | "enrichmentStatus">
>;
