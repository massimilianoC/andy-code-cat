import { z } from "zod";
import { mediaKeySchema } from "./mediaManifest";

/**
 * Compact, human-inspectable summary of a single media directive and its outcome,
 * embedded in the snapshot so "what was requested vs what was produced" is visible
 * without joining the media_resolution_traces collection.
 */
export const mediaDirectiveSummarySchema = z.object({
    key: mediaKeySchema,
    role: z.string().max(40).optional(),
    semanticQuery: z.string().max(300).optional(),
    status: z.enum(["resolved", "fallback_resolved", "unresolved"]),
    provider: z.string().max(40).optional(),
    assetId: z.string().min(1).max(120).optional(),
    fallbackUsed: z.boolean().optional(),
});

export type MediaDirectiveSummary = z.infer<typeof mediaDirectiveSummarySchema>;

export const mediaResolutionMetadataSchema = z.object({
    version: z.literal("media-resolution-v1"),
    traceIds: z.array(z.string().min(1).max(120)).max(50),
    assetIds: z.array(z.string().min(1).max(120)).max(50),
    mediaKeys: z.array(mediaKeySchema).max(50),
    degraded: z.boolean(),
    /** Per-media directive + outcome summary (audit-friendly). Optional for backward compat. */
    directives: z.array(mediaDirectiveSummarySchema).max(50).optional(),
}).strict();

export type MediaResolutionMetadata = z.infer<typeof mediaResolutionMetadataSchema>;
