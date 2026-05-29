import { z } from "zod";

export const mediaKeySchema = z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "media key must be lowercase kebab-case");

export const mediaSourceStrategySchema = z.enum([
    "auto",
    "stock",
    "image_generation",
    "project_asset",
    "user_library",
]);

export const artifactMediaKindSchema = z.enum([
    "image",
    "background",
    "logo",
    "icon",
    "avatar",
    "decorative",
]);

export const artifactMediaRoleSchema = z.enum([
    "hero",
    "section",
    "card",
    "gallery",
    "testimonial",
    "avatar",
    "background",
    "logo",
    "icon",
    "decorative",
]);

// These schemas use .strip() (default) instead of .strict() so that LLM-generated
// manifests with extra fields are tolerated. Unknown keys are silently dropped.
export const artifactMediaConstraintsSchema = z.object({
    noText: z.boolean().optional(),
    noLogo: z.boolean().optional(),
    safeCrop: z.boolean().optional(),
    styleTags: z.array(z.string().min(1).max(80)).max(20).optional(),
    paletteHints: z.array(z.string().min(1).max(80)).max(20).optional(),
    avoid: z.array(z.string().min(1).max(120)).max(20).optional(),
});

export const artifactMediaContextSchema = z.object({
    pageSection: z.string().min(1).max(120).optional(),
    nearbyHeading: z.string().min(1).max(200).optional(),
    nearbyText: z.string().min(1).max(500).optional(),
    brandTone: z.string().min(1).max(160).optional(),
});

export const artifactMediaRequestSchema = z.object({
    key: mediaKeySchema,
    kind: artifactMediaKindSchema,
    role: artifactMediaRoleSchema,
    sourceStrategy: mediaSourceStrategySchema.default("auto"),
    semanticQuery: z.string().trim().min(1).max(300),
    generationPrompt: z.string().trim().min(1).max(1000).optional(),
    alt: z.string().trim().min(1).max(300),
    width: z.number().int().min(64).max(8192).optional(),
    height: z.number().int().min(64).max(8192).optional(),
    aspectRatio: z.number().positive().max(8).optional(),
    priority: z.number().int().min(0).max(100).default(0),
    constraints: artifactMediaConstraintsSchema.optional(),
    context: artifactMediaContextSchema.optional(),
});

export const artifactMediaManifestSchema = z.object({
    version: z.literal("media-manifest-v1"),
    requests: z.array(artifactMediaRequestSchema).min(1).max(50),
}).superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    manifest.requests.forEach((request, index) => {
        if (seen.has(request.key)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `duplicate media key: ${request.key}`,
                path: ["requests", index, "key"],
            });
        }
        seen.add(request.key);
    });
});

export type MediaSourceStrategy = z.infer<typeof mediaSourceStrategySchema>;
export type ArtifactMediaKind = z.infer<typeof artifactMediaKindSchema>;
export type ArtifactMediaRole = z.infer<typeof artifactMediaRoleSchema>;
export type ArtifactMediaRequest = z.infer<typeof artifactMediaRequestSchema>;
export type ArtifactMediaManifest = z.infer<typeof artifactMediaManifestSchema>;
