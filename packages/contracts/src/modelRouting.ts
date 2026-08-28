import { z } from "zod";

/**
 * Model routing / selection contracts for the future `PipelineRun` aggregate (I5 of the SSOT
 * program — see docs/specs/SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md,
 * section 2.1/2.2, and docs/SSOT_REFACTOR_PROGRESS.md's U1/U2 sequencing).
 *
 * IMPORTANT — this is deliberately NOT the same type as the already-merged, already-tested
 * `ModelSelectionDecision` in apps/api/src/application/llm/modelSelection.ts. That type is the
 * pure, zero-behavior-change pin-down of TODAY's per-call-site resolution cascades (profile:
 * "vibe-cascade" | "optimizer-cascade"; fields requested/effective/providerSource/modelSource/
 * honoredRequest/policy/blocked/providerCatalog). It is a characterization safety net, not a
 * public contract, and nothing in this batch touches it.
 *
 * The type below is the future, richer, aggregate-level decision record that U2's
 * `ResolveModelSelectionDecision` will produce once the `PipelineRun` aggregate exists — it
 * models states (explicit capability exceptions, an audit trail, a frozen catalog revision)
 * that do not exist in today's resolver at all. Converging the two is explicitly future work
 * (U2), not this increment: nothing in apps/api or apps/web consumes this contracts-level type
 * yet. Do not add a second, competing "current-cascade" type here — extend
 * apps/api's modelSelection.ts for that, or converge it into this file only when U2 actually
 * replaces the call sites.
 */

export const modelSelectionSourceSchema = z.enum([
    "pipeline-run-lock",
    "user-request-override",
    "capability-exception",
    "task-setting",
    "catalog-role-default",
    "catalog-first-active",
    "hardcoded-fallback",
]);
export type ModelSelectionSource = z.infer<typeof modelSelectionSourceSchema>;

export const modelSelectionPolicySchema = z.enum(["legacy", "strict", "allow-explicit-capability-exception"]);
export type ModelSelectionPolicy = z.infer<typeof modelSelectionPolicySchema>;

export const modelSelectionOutcomeSchema = z.enum(["exact", "explicit-exception", "substituted", "blocked"]);
export type ModelSelectionOutcome = z.infer<typeof modelSelectionOutcomeSchema>;

export const modelSelectionBlockCodeSchema = z.enum([
    "MODEL_LOCK_UNAVAILABLE",
    "MODEL_LOCK_CAPABILITY_MISMATCH",
    "MODEL_LOCK_PROVIDER_INACTIVE",
    "MODEL_LOCK_PROVIDER_KEY_MISSING",
    "NO_ACTIVE_PROVIDER",
]);
export type ModelSelectionBlockCode = z.infer<typeof modelSelectionBlockCodeSchema>;

export interface ModelSelectionTrailEntry {
    rule: ModelSelectionSource;
    providerId?: string;
    modelId?: string;
    accepted: boolean;
    reason?: string;
}

export const modelSelectionTrailEntrySchema = z.object({
    rule: modelSelectionSourceSchema,
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    accepted: z.boolean(),
    reason: z.string().optional(),
}) satisfies z.ZodType<ModelSelectionTrailEntry>;

export interface ModelSelectionDecision {
    version: "model-selection-v1";
    policy: ModelSelectionPolicy;
    requested: { providerId?: string; modelId?: string; source: ModelSelectionSource; catalogRevision: string };
    effective?: { providerId: string; modelId: string; source: ModelSelectionSource };
    outcome: ModelSelectionOutcome;
    trail: ModelSelectionTrailEntry[];
    exception?: { capability: string; reason: string; approvedBy: string; approvedAt: string };
    blockedReason?: ModelSelectionBlockCode;
    decidedAt: string;
}

export const modelSelectionDecisionSchema = z.object({
    version: z.literal("model-selection-v1"),
    policy: modelSelectionPolicySchema,
    requested: z.object({
        providerId: z.string().min(1).optional(),
        modelId: z.string().min(1).optional(),
        source: modelSelectionSourceSchema,
        catalogRevision: z.string().min(1),
    }),
    effective: z
        .object({
            providerId: z.string().min(1),
            modelId: z.string().min(1),
            source: modelSelectionSourceSchema,
        })
        .optional(),
    outcome: modelSelectionOutcomeSchema,
    trail: z.array(modelSelectionTrailEntrySchema),
    exception: z
        .object({
            capability: z.string().min(1),
            reason: z.string().min(1),
            approvedBy: z.string().min(1),
            approvedAt: z.string().min(1),
        })
        .optional(),
    blockedReason: modelSelectionBlockCodeSchema.optional(),
    decidedAt: z.string().min(1),
}) satisfies z.ZodType<ModelSelectionDecision>;
