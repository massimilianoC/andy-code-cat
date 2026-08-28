import { z } from "zod";
import { llmFocusContextSchema } from "./llm";
import { mediaResolutionMetadataSchema } from "./mediaResolution";
import { dataDashboardArtifactMetadataSchema } from "./datasetBindings";
import { serviceManifestSchema, type ServiceManifestV1 } from "./serviceManifest";
import type { RuntimePlanV1 } from "./runtimePlan";

// ─────────────────────────────────────────────────────────────────────────────
// The artifact contract — single source of truth.
//
// Every layer that names the shape of a preview snapshot derives it from the schemas
// below: the API domain entity, the HTTP response DTO, and the web client. Before this
// consolidation the same shape was hand-written in four places (this schema, the DTO
// underneath it, PreviewSnapshotMetadata in the API domain entity, and twice inside
// apps/web/lib/api/snapshots.ts) and they had drifted apart:
//
//   - promptingTrace.promptConfigId was declared and sent by the web client but never
//     declared here, so zod stripped it from every write and no stored version has it;
//   - wysiwygSessionId and promptExecutionId existed here but not in the DTO.
//
// A shape written down four times is a shape that is wrong in three of them. Add fields
// here and let inference carry them outward — per AL-031, introducing a second place to
// declare an artifact's shape is an architectural change, not a convenience.
// ─────────────────────────────────────────────────────────────────────────────

/** sha256, lowercase hex. The certification primitive shared with CanonicalBriefEnvelope. */
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * AL-041 — the code returned when a write declares a base the server does not consider
 * current. The client re-synchronises on this code; it must never retry the write blindly.
 */
export const ARTIFACT_BASE_STALE = "ARTIFACT_BASE_STALE";

export const previewArtifactsSchema = z.object({
    html: z.string().max(10000000),
    css: z.string().max(500000),
    js: z.string().max(500000),
});

export const previewSnapshotTokenUsageSchema = z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
});

/**
 * Diagnostic text is truncated, never rejected.
 *
 * These fields describe what happened; they are not the artifact. A hard `.max()` on them means a
 * generation that SUCCEEDED can fail to be saved because its own trace was too long to describe —
 * which is exactly what happened on 2026-08-27: a run with four enriched documents composed a
 * 13.851-token system prompt (~55.000 chars), the model produced a complete page, and the snapshot
 * write was refused with VALIDATION_ERROR. No version, and then "No snapshot found to publish".
 *
 * A cap that can destroy the thing it describes is the wrong shape of cap. These truncate instead,
 * so the record shrinks and the artifact survives.
 */
const truncatedTrace = (limit: number) => z.string().transform((value) => value.slice(0, limit));

export const previewSnapshotPromptingTraceSchema = z.object({
    originalUserMessage: truncatedTrace(50000),
    /** MongoDB _id of the llm_prompt_configs document used to build the pipeline wrapper. */
    promptConfigId: z.string().max(120).optional(),
    prePromptTemplate: truncatedTrace(50000).optional(),
    effectiveSystemPrompt: truncatedTrace(200000).optional(),
});

export const previewSnapshotMetadataSchema = z.object({
    model: z.string().max(200).optional(),
    provider: z.string().max(120).optional(),
    durationMs: z.number().int().nonnegative().optional(),
    finishReason: z.string().max(120).optional(),
    structuredParseValid: z.boolean().optional(),
    rawResponse: truncatedTrace(300000).optional(),
    wysiwygSessionId: z.string().max(100).optional(),
    /** Free-text label the user gave the WYSIWYG commit. Declared here rather than cast
     *  in at the write site, which is how it existed outside the contract until now. */
    wysiwygDescription: z.string().max(500).optional(),
    // AL-026: immutable link from a version to the prompt execution that produced it. The id
    // already exists (llmChatPreviewResponse.promptExecutionId); this is only the storage side —
    // nothing generates it here, it is simply never dropped on the way into the snapshot.
    promptExecutionId: z.string().max(100).optional(),
    /**
     * AL-039 — sha256 over the canonical artifacts exactly as persisted. Written by the
     * server in CreatePreviewSnapshot; a value supplied by a client is ignored, because a
     * hash the writer chooses certifies nothing. It is also why the client must echo this
     * value back rather than recompute one: the artifacts the API *returns* are compiled
     * for the runtime (forms, inline preview) and legitimately differ from the stored ones.
     */
    contentHash: contentHashSchema.optional(),
    tokenUsage: previewSnapshotTokenUsageSchema.optional(),
    promptingTrace: previewSnapshotPromptingTraceSchema.optional(),
    mediaResolution: mediaResolutionMetadataSchema.optional(),
    dataDashboard: dataDashboardArtifactMetadataSchema.optional(),
});

export const createPreviewSnapshotSchema = z.object({
    conversationId: z.string().min(1),
    sourceMessageId: z.string().min(1).optional(),
    parentSnapshotId: z.string().min(1).optional(),
    /**
     * AL-040 — the contentHash of the version this write was derived from, as the client
     * received it. Paired with parentSnapshotId it states, in full: "I read version X, it
     * hashed to H, and this is my edit of it." The server verifies that claim before
     * accepting (AL-041). Optional only so that versions stored before AL-039 — which carry
     * no stored hash to compare against — remain editable.
     */
    baseContentHash: contentHashSchema.optional(),
    artifacts: previewArtifactsSchema,
    serviceManifest: serviceManifestSchema.optional(),
    rawLlmResponse: z.string().max(500000).optional(),
    focusContext: llmFocusContextSchema.optional(),
    metadata: previewSnapshotMetadataSchema.optional(),
    activate: z.boolean().default(true),
});

export const activatePreviewSnapshotSchema = z.object({
    conversationId: z.string().min(1).optional(),
});

export type CreatePreviewSnapshotInput = z.infer<typeof createPreviewSnapshotSchema>;
/** What a client sends. Differs from the inferred output only in that "activate" is
 *  optional (the schema defaults it) — clients must not have to restate defaults. */
export type CreatePreviewSnapshotRequest = z.input<typeof createPreviewSnapshotSchema>;
export type ActivatePreviewSnapshotInput = z.infer<typeof activatePreviewSnapshotSchema>;

export type PreviewArtifactsDto = z.infer<typeof previewArtifactsSchema>;
export type PreviewSnapshotMetadataDto = z.infer<typeof previewSnapshotMetadataSchema>;
export type PreviewSnapshotFocusContextDto = z.infer<typeof llmFocusContextSchema>;

export interface PreviewSnapshotDto {
    id: string;
    projectId: string;
    conversationId: string;
    sourceMessageId?: string;
    parentSnapshotId?: string;
    isActive: boolean;
    artifacts: PreviewArtifactsDto;
    serviceManifest?: ServiceManifestV1;
    /** Present on responses that compile the artifact for a delivery target. */
    runtimePlan?: RuntimePlanV1;
    focusContext?: PreviewSnapshotFocusContextDto;
    metadata?: PreviewSnapshotMetadataDto;
    /** Stored key for the background-generated thumbnail; absent until the job completes. */
    thumbnailPath?: string;
    createdAt: string;
    activatedAt?: string;
}
