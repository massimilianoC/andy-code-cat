import { z } from "zod";

// ---------------------------------------------------------------------------
// Reusable tag array validator (max 5 tags per category)
// ---------------------------------------------------------------------------

const tagArraySchema = z.array(z.string().min(1).max(80)).max(5).default([]);

// ---------------------------------------------------------------------------
// Update schema — all fields optional
// ---------------------------------------------------------------------------

export const updateUserStyleProfileSchema = z.object({
    onboardingCompleted: z.boolean().optional(),
    onboardingStep: z.number().int().min(0).max(10).optional(),

    identityTags: tagArraySchema.optional(),
    sectorTags: tagArraySchema.optional(),
    audienceTags: tagArraySchema.optional(),
    visualTags: tagArraySchema.optional(),
    paletteTags: tagArraySchema.optional(),
    typographyTags: tagArraySchema.optional(),
    layoutTags: tagArraySchema.optional(),
    toneTags: tagArraySchema.optional(),
    referenceTags: tagArraySchema.optional(),
    featureTags: tagArraySchema.optional(),

    brandBio: z.string().max(500).optional(),
    preferredColorText: z.string().max(300).optional(),
});

export type UpdateUserStyleProfileInput = z.infer<typeof updateUserStyleProfileSchema>;

// ---------------------------------------------------------------------------
// DTO (response shape)
// ---------------------------------------------------------------------------

export interface UserStyleProfileDto {
    id: string;
    userId: string;
    onboardingCompleted: boolean;
    onboardingStep: number;

    identityTags: string[];
    sectorTags: string[];
    audienceTags: string[];
    visualTags: string[];
    paletteTags: string[];
    typographyTags: string[];
    layoutTags: string[];
    toneTags: string[];
    referenceTags: string[];
    featureTags: string[];

    brandBio?: string;
    preferredColorText?: string;

    updatedAt: string;
    createdAt: string;
}
