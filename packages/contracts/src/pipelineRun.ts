import { z } from "zod";
import {
    modelSelectionBlockCodeSchema,
    modelSelectionDecisionSchema,
    modelSelectionPolicySchema,
    type ModelSelectionBlockCode,
    type ModelSelectionDecision,
    type ModelSelectionPolicy,
} from "./modelRouting";

/**
 * `PipelineRun` aggregate contracts (I5 of the SSOT program — see
 * docs/specs/SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md, section 3,
 * and docs/SSOT_REFACTOR_PROGRESS.md's U1/U3 sequencing).
 *
 * Additive and unconsumed in this batch: nothing in apps/api or apps/web imports these types
 * yet. They exist so later increments (U2 onward) have a single vocabulary to build against.
 *
 * Naming note: `packages/contracts/src/pipeline.ts` already exists and owns the Zero-Effort
 * intake zod schema (`zeroEffortLaunchSchema`, `executeProjectPipelineSchema`, etc.) consumed
 * by apps/api/src/presentation/http/routes/pipelineRoutes.ts and
 * apps/api/src/application/use-cases/LaunchZeroEffortProject.ts today. This file is
 * deliberately named `pipelineRun.ts` (not a rename of `pipeline.ts`) and does not touch or
 * restructure it. No exported name below collides with `pipeline.ts`'s exports.
 */

/**
 * "workspace" was previously named "godmode" — renamed 2026-08-19 to align with the
 * product-owner-approved terminology in PR #58 ("God Mode" -> "Workspace"). The literal was
 * renamed before PipelineRun became the sole live launch path.
 */
export const pipelineEntryModeSchema = z.enum(["vibe", "zero-effort", "workspace"]);
export type PipelineEntryMode = z.infer<typeof pipelineEntryModeSchema>;

export const pipelineRunStatusSchema = z.enum([
    "draft",
    "ready_for_generation",
    "running",
    "completed",
    "failed",
    "blocked",
    "cancelled",
]);
export type PipelineRunStatus = z.infer<typeof pipelineRunStatusSchema>;

export const optimizationPolicySchema = z.enum(["skip", "explicit-user-request", "enabled"]);
export type OptimizationPolicy = z.infer<typeof optimizationPolicySchema>;

export const pipelineStageSchema = z.enum([
    "vibe_classify",
    "vibe_prefill",
    "brief_build",
    "optimize",
    "generate",
    "focused_edit",
]);
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

// ── Model lock ───────────────────────────────────────────────────────────────

export interface PipelineModelLock {
    policy: ModelSelectionPolicy;
    requested: { providerId: string; modelId: string; catalogRevision: string };
    effective: { providerId: string; modelId: string };
    selectedAt: string;
    selectedBy: "user" | "admin-default" | "catalog-proposal";
}

export const pipelineModelLockSchema = z.object({
    policy: modelSelectionPolicySchema,
    requested: z.object({
        providerId: z.string().min(1),
        modelId: z.string().min(1),
        catalogRevision: z.string().min(1),
    }),
    effective: z.object({
        providerId: z.string().min(1),
        modelId: z.string().min(1),
    }),
    selectedAt: z.string().min(1),
    selectedBy: z.enum(["user", "admin-default", "catalog-proposal"]),
}) satisfies z.ZodType<PipelineModelLock>;

// ── Canonical brief ──────────────────────────────────────────────────────────

export interface CanonicalBriefEnvelope {
    schemaVersion: "canonical-brief-v1";
    content: string;
    contentHash: string;
    provenance: string[];
    sourceFields: Record<string, unknown>;
    builtAt: string;
}

export const canonicalBriefEnvelopeSchema = z.object({
    schemaVersion: z.literal("canonical-brief-v1"),
    content: z.string(),
    contentHash: z.string().min(1),
    provenance: z.array(z.string()),
    sourceFields: z.record(z.string(), z.unknown()),
    builtAt: z.string().min(1),
}) satisfies z.ZodType<CanonicalBriefEnvelope>;

// ── Stage execution reference ───────────────────────────────────────────────

export const pipelineStageExecutionStatusSchema = z.enum([
    "resolved",
    "dispatched",
    "completed",
    "failed",
    "blocked",
    "skipped",
]);
export type PipelineStageExecutionStatus = z.infer<typeof pipelineStageExecutionStatusSchema>;

export interface PipelineStageExecutionRef {
    stage: PipelineStage;
    taskKey: string;
    promptExecutionId?: string;
    decision: ModelSelectionDecision;
    status: PipelineStageExecutionStatus;
    startedAt: string;
    completedAt?: string;
}

export const pipelineStageExecutionRefSchema = z.object({
    stage: pipelineStageSchema,
    taskKey: z.string().min(1),
    promptExecutionId: z.string().min(1).optional(),
    decision: modelSelectionDecisionSchema,
    status: pipelineStageExecutionStatusSchema,
    startedAt: z.string().min(1),
    completedAt: z.string().min(1).optional(),
}) satisfies z.ZodType<PipelineStageExecutionRef>;

// ── PipelineRun DTO ──────────────────────────────────────────────────────────

export interface PipelineRunDto {
    id: string;
    projectId: string;
    ownerUserId: string;
    conversationId?: string;
    entryMode: PipelineEntryMode;
    modelLock: PipelineModelLock;
    optimizationPolicy: OptimizationPolicy;
    canonicalBrief?: CanonicalBriefEnvelope;
    status: PipelineRunStatus;
    stages: PipelineStageExecutionRef[];
    blocked?: { code: ModelSelectionBlockCode; stage: PipelineStage; at: string };
    createdAt: string;
    updatedAt: string;
}

export const pipelineRunDtoSchema = z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    ownerUserId: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    entryMode: pipelineEntryModeSchema,
    modelLock: pipelineModelLockSchema,
    optimizationPolicy: optimizationPolicySchema,
    canonicalBrief: canonicalBriefEnvelopeSchema.optional(),
    status: pipelineRunStatusSchema,
    stages: z.array(pipelineStageExecutionRefSchema),
    blocked: z
        .object({
            code: modelSelectionBlockCodeSchema,
            stage: pipelineStageSchema,
            at: z.string().min(1),
        })
        .optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
}) satisfies z.ZodType<PipelineRunDto>;

// ── Run creation / launch requests ──────────────────────────────────────────

export const createPipelineRunSchema = z.object({
    projectId: z.string().min(1).max(120),
    entryMode: pipelineEntryModeSchema,
    conversationId: z.string().min(1).max(120).optional(),
    requestedProviderId: z.string().min(1).max(80).optional(),
    requestedModelId: z.string().min(1).max(200).optional(),
    /**
     * Added in I7 (apps/api/src/presentation/http/routes/pipelineRunRoutes.ts) — the catalog
     * revision the client observed when the user picked requestedProviderId/requestedModelId.
     * I7's route persists this as-is into PipelineModelLock.requested.catalogRevision without
     * validating it against the live catalog (that validation is I8's ResolvePipelineModelLock
     * use case). Optional: a caller that omits it gets an "unvalidated" sentinel.
     */
    catalogRevision: z.string().min(1).max(200).optional(),
});
export type CreatePipelineRunInput = z.infer<typeof createPipelineRunSchema>;

export const launchWorkspaceSchema = z.object({
    projectId: z.string().min(1).max(120),
    conversationId: z.string().min(1).max(120).optional(),
    pipelineRunId: z.string().min(1).max(120).optional(),
    requestedProviderId: z.string().min(1).max(80).optional(),
    requestedModelId: z.string().min(1).max(200).optional(),
    optimizationPolicy: optimizationPolicySchema.default("skip"),
});
export type LaunchWorkspaceInput = z.infer<typeof launchWorkspaceSchema>;

/**
 * I12 of the SSOT program — the request shape for
 * POST /projects/:projectId/pipeline/launch-workspace (apps/api/src/presentation/http/routes/
 * pipelineRoutes.ts). Distinct from `launchWorkspaceSchema` above (which assumes a
 * conversation/run already exists and was defined in I5 as forward-looking, still unconsumed by
 * any route): this one launches from RAW intake, same shape as `zeroEffortLaunchSchema` in
 * `pipeline.ts` plus the model-lock/optimization-policy fields a server-owned launch needs to
 * freeze up front. Kept as its own schema (not extending zeroEffortLaunchSchema directly) to
 * avoid a cross-file schema dependency between pipeline.ts and pipelineRun.ts; apps/api validates
 * field-for-field parity in its own test.
 *
 * Named "Workspace" (not "GodMode") since 2026-08-19 — see pipelineEntryModeSchema's doc comment
 * above for the rename rationale.
 */
export const launchWorkspacePipelineSchema = z.object({
    businessName: z.string().trim().min(2).max(120),
    presetId: z.string().min(2).max(60).default("landing"),
    primaryGoal: z.string().trim().min(8).max(3000),
    audience: z.string().trim().min(3).max(1000),
    tone: z.string().trim().max(80).optional(),
    primaryCta: z.string().trim().max(120).optional(),
    styleHint: z.string().trim().max(1000).optional(),
    sourceRequest: z.string().trim().max(4000).optional(),
    projectSummary: z.string().trim().max(1600).optional(),
    contentStructure: z.string().trim().max(2400).optional(),
    contentRequirements: z.string().trim().max(2400).optional(),
    functionalRequirements: z.string().trim().max(2400).optional(),
    interactionModel: z.string().trim().max(1800).optional(),
    visualDirection: z.string().trim().max(1800).optional(),
    successCriteria: z.string().trim().max(1600).optional(),
    constraints: z.string().trim().max(1600).optional(),
    mustAvoid: z.string().trim().max(1200).optional(),
    contactInfo: z.array(z.object({ key: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(200) })).max(15).optional(),
    styleAttributes: z.array(z.string().trim().max(80)).max(20).optional(),
    outputLanguage: z.string().min(2).max(10).toLowerCase().optional(),
    attachmentNames: z.array(z.string().trim().max(200)).max(30).optional(),
    requestedProviderId: z.string().min(1).max(80).optional(),
    requestedModelId: z.string().min(1).max(200).optional(),
    optimizationPolicy: optimizationPolicySchema.default("skip"),
    /**
     * The brief text the user actually reviewed, when they edited the generated one.
     *
     * The guided wizard shows the canonical brief in an editor before launching. If the user
     * changes a word, the run must certify THAT text — a run whose canonicalBrief no longer
     * matches what gets sent certifies nothing. Omitted when the user did not edit, in which
     * case the server builds the brief from the intake fields as usual.
     */
    briefOverride: z.string().trim().min(1).max(40000).optional(),
});
export type LaunchWorkspacePipelineInput = z.infer<typeof launchWorkspacePipelineSchema>;

/**
 * Side-effect-free preview of the canonical brief. The guided wizard calls this to show the
 * brief for review BEFORE anything is created, so abandoning the wizard leaves no conversation,
 * no run and no project state behind. Same intake shape as the launch request minus the
 * launch-only fields.
 */
export const previewCanonicalBriefSchema = launchWorkspacePipelineSchema.omit({
    requestedProviderId: true,
    requestedModelId: true,
    optimizationPolicy: true,
    briefOverride: true,
});
export type PreviewCanonicalBriefInput = z.infer<typeof previewCanonicalBriefSchema>;

export interface LaunchWorkspacePipelineResultDto {
    mode: "workspace";
    status: "prepared";
    projectId: string;
    pipelineRunId: string;
    conversationId: string;
    jobId: string;
    normalizedBrief: string;
    modelLock: PipelineModelLock;
    suggestedNextActions: string[];
    workspace: import("./assets").GenerationWorkspaceDto;
}

// ── Server-derived model decision read model ────────────────────────────────

export const modelDecisionViewStateSchema = z.enum([
    "before-start",
    "running",
    "blocked",
    "exception",
    "completed",
    "legacy",
]);
export type ModelDecisionViewState = z.infer<typeof modelDecisionViewStateSchema>;

export interface ModelDecisionView {
    pipelineRunId?: string;
    state: ModelDecisionViewState;
    policy: ModelSelectionPolicy;
    requested: { providerId: string; modelId: string; displayName?: string; available: boolean };
    effective?: { providerId: string; modelId: string; displayName?: string };
    optimizationPolicy: OptimizationPolicy;
    canonicalBriefHash?: string;
    stages: Array<{
        stage: PipelineStage;
        taskKey: string;
        status: PipelineStageExecutionRef["status"];
        providerId?: string;
        modelId?: string;
        promptExecutionId?: string;
        costEur?: number;
    }>;
    blocked?: { code: ModelSelectionBlockCode; requestedProviderId: string; requestedModelId: string };
    exception?: { capability: string; reason: string; approvedAt: string };
    evidence: "server-execution-record" | "preflight" | "legacy-trace" | "none";
}

export const modelDecisionViewSchema = z.object({
    pipelineRunId: z.string().min(1).optional(),
    state: modelDecisionViewStateSchema,
    policy: modelSelectionPolicySchema,
    requested: z.object({
        providerId: z.string().min(1),
        modelId: z.string().min(1),
        displayName: z.string().optional(),
        available: z.boolean(),
    }),
    effective: z
        .object({
            providerId: z.string().min(1),
            modelId: z.string().min(1),
            displayName: z.string().optional(),
        })
        .optional(),
    optimizationPolicy: optimizationPolicySchema,
    canonicalBriefHash: z.string().optional(),
    stages: z.array(
        z.object({
            stage: pipelineStageSchema,
            taskKey: z.string().min(1),
            status: pipelineStageExecutionStatusSchema,
            providerId: z.string().min(1).optional(),
            modelId: z.string().min(1).optional(),
            promptExecutionId: z.string().min(1).optional(),
            costEur: z.number().nonnegative().optional(),
        }),
    ),
    blocked: z
        .object({
            code: modelSelectionBlockCodeSchema,
            requestedProviderId: z.string().min(1),
            requestedModelId: z.string().min(1),
        })
        .optional(),
    exception: z
        .object({
            capability: z.string().min(1),
            reason: z.string().min(1),
            approvedAt: z.string().min(1),
        })
        .optional(),
    evidence: z.enum(["server-execution-record", "preflight", "legacy-trace", "none"]),
}) satisfies z.ZodType<ModelDecisionView>;
