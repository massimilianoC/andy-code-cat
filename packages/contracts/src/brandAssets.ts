import { z } from "zod";

export const BRAND_ASSET_ROLES = [
    "brand_logo", "brand_logo_dark", "brand_logo_light",
    "client_logo", "brand_hero", "brand_pattern", "brand_font_sample",
    "brand_color_palette",
    "company_name", "brand_tagline",
    "contact_email", "contact_phone", "contact_address",
    "social_instagram", "social_linkedin", "social_website",
    "legal_vat", "custom",
] as const;

export const BRAND_ASSET_POLICIES = ["must_use", "prefer", "optional"] as const;
export const BRAND_ASSET_VALUE_TYPES = ["asset_ref", "text", "color_list", "url"] as const;
export const BRAND_ASSET_SCOPES = ["platform", "user", "project"] as const;

export const createBrandAssetTextSchema = z.object({
    role: z.enum(BRAND_ASSET_ROLES),
    customRoleLabel: z.string().max(80).optional(),
    policy: z.enum(BRAND_ASSET_POLICIES).default("prefer"),
    valueType: z.enum(["text", "color_list", "url"] as const),
    textValue: z.string().min(1).max(2000),
    description: z.string().max(200).optional(),
    isActive: z.boolean().default(true),
    priority: z.number().int().min(0).max(999).default(0),
});

export const promoteBrandAssetSchema = z.object({
    role: z.enum(BRAND_ASSET_ROLES),
    customRoleLabel: z.string().max(80).optional(),
    policy: z.enum(BRAND_ASSET_POLICIES).default("prefer"),
    description: z.string().max(200).optional(),
    isActive: z.boolean().default(true),
    priority: z.number().int().min(0).max(999).default(0),
    sourceAssetId: z.string().uuid(),
});

export const updateBrandAssetSchema = z.object({
    role: z.enum(BRAND_ASSET_ROLES).optional(),
    customRoleLabel: z.string().max(80).optional(),
    policy: z.enum(BRAND_ASSET_POLICIES).optional(),
    textValue: z.string().max(2000).optional(),
    description: z.string().max(200).optional(),
    isActive: z.boolean().optional(),
    priority: z.number().int().min(0).max(999).optional(),
});

export type CreateBrandAssetTextInput = z.infer<typeof createBrandAssetTextSchema>;
export type PromoteBrandAssetInput = z.infer<typeof promoteBrandAssetSchema>;
export type UpdateBrandAssetContractInput = z.infer<typeof updateBrandAssetSchema>;

export interface BrandAssetDto {
    id: string;
    scope: typeof BRAND_ASSET_SCOPES[number];
    ownerUserId?: string;
    projectId?: string;
    role: typeof BRAND_ASSET_ROLES[number];
    customRoleLabel?: string;
    policy: typeof BRAND_ASSET_POLICIES[number];
    valueType: typeof BRAND_ASSET_VALUE_TYPES[number];
    originalName?: string;
    mimeType?: string;
    fileSize?: number;
    textValue?: string;
    description?: string;
    isActive: boolean;
    priority: number;
    downloadUrl?: string;
    createdAt: string;
    updatedAt: string;
}
