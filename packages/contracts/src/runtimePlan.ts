import { z } from "zod";

export const runtimeAssetSchema = z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),
    version: z.string().regex(/^v\d+$/),
    fileName: z.string().regex(/^pf-[a-z0-9.-]+\.js$/),
    kind: z.enum(["module", "config"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    dependencies: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,79}$/)).max(8),
}).strict();

export const runtimeCapabilitySchema = z.object({
    id: z.enum(["forms"]),
    mode: z.enum(["mailto"]),
    manifestVersion: z.literal("service-manifest-v1"),
}).strict();

/** Public, non-secret delivery plan prepared by the platform registry. */
export const runtimePlanSchema = z.object({
    version: z.literal("runtime-plan-v1"),
    capabilities: z.array(runtimeCapabilitySchema).max(16),
    assets: z.array(runtimeAssetSchema).max(32),
}).strict();

export type RuntimeAssetV1 = z.infer<typeof runtimeAssetSchema>;
export type RuntimeCapabilityV1 = z.infer<typeof runtimeCapabilitySchema>;
export type RuntimePlanV1 = z.infer<typeof runtimePlanSchema>;
