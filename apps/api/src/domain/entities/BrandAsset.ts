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
    | "custom";

export type BrandAssetPolicy = "must_use" | "prefer" | "optional";
export type BrandAssetValueType = "asset_ref" | "text" | "color_list" | "url";

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
    isActive: boolean;
    priority: number;
    createdAt: Date;
    updatedAt: Date;
}

export type CreateBrandAssetInput = Omit<BrandAsset, "id" | "createdAt" | "updatedAt">;
export type UpdateBrandAssetInput = Partial<
    Pick<BrandAsset, "role" | "customRoleLabel" | "policy" | "textValue" | "description" | "isActive" | "priority">
>;
