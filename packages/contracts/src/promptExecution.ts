import { z } from "zod";
import type { LlmPromptingTrace, LlmPromptingTraceLayer, LlmPromptingTraceMessage } from "./llm";
import { llmFocusContextSchema } from "./llm";
import type { ModelSelectionDecision } from "./modelRouting";
import { modelSelectionDecisionSchema } from "./modelRouting";
import type { PipelineStage } from "./pipelineRun";

/**
 * Canonical prompt-execution vocabulary (I4/I5 of the SSOT program — see
 * docs/specs/SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md).
 *
 * `LlmPromptingTrace` (./llm.ts) remains the canonical shape for "what prompt was actually
 * sent" — this file does not redefine it, it extends/reuses it so there is exactly one place
 * the shape is authored. Every other structural copy that used to exist in conversation.ts,
 * Conversation.ts, OptimizeUserPrompt.ts, and the apps/web api clients has been converged to
 * import from here (or from ./llm.ts directly).
 */

// ── Provider message ────────────────────────────────────────────────────────

/** A single message actually sent to the LLM provider. Identical shape to
 *  LlmPromptingTraceMessage (./llm.ts) — aliased, not re-declared. */
export type ProviderMessageDto = LlmPromptingTraceMessage;

export const providerMessageSchema = z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
});

// ── Prompt layer trace (structured system-prompt breakdown) ────────────────

export interface PromptLayerSegmentTrace {
    id: string;
    source: string;
    span: [number, number];
    contentHash?: string;
}

export const promptLayerSegmentSchema = z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    contentHash: z.string().optional(),
});

/**
 * One entry of the structured system-prompt layer breakdown. Extends
 * LlmPromptingTraceLayer (./llm.ts) — the base fields (id/key/label/source/chars/span) are
 * authored there; this adds the optional sub-segment breakdown used by a
 * PromptExecutionEnvelope. Change the base shape once, in ./llm.ts, and this follows.
 */
export interface PromptLayerTraceEntryDto extends LlmPromptingTraceLayer {
    segments?: PromptLayerSegmentTrace[];
}

export const promptLayerTraceEntrySchema = z.object({
    id: z.string().min(1),
    key: z.string().min(1),
    label: z.string().min(1),
    source: z.string().min(1),
    chars: z.number().int().nonnegative(),
    span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    segments: z.array(promptLayerSegmentSchema).optional(),
});

// ── Canonical zod schema for LlmPromptingTrace itself ───────────────────────

/**
 * The single zod schema for LlmPromptingTrace (./llm.ts). conversation.ts's
 * addMessageSchema used to hand-roll its own copy of this object (including its own
 * `promptingTraceLayerSchema`) — that copy has been replaced with an import of this schema.
 * Any future persistence/validation path for a prompting trace should import this too rather
 * than writing a new one.
 */
export const llmPromptingTraceSchema = z.object({
    originalUserMessage: z.string(),
    /** MongoDB _id of the llm_prompt_configs document active at the time of the call */
    promptConfigId: z.string().optional(),
    prePromptTemplate: z.string().optional(),
    effectiveSystemPrompt: z.string(),
    messagesSentToLlm: z.array(providerMessageSchema),
    focusContext: llmFocusContextSchema.optional(),
    /** Structured system-prompt layer breakdown, in composition order. Absent for legacy traces. */
    layers: z.array(promptLayerTraceEntrySchema).optional(),
}) satisfies z.ZodType<LlmPromptingTrace, z.ZodTypeDef, unknown>;

export type LlmPromptingTraceParsed = z.infer<typeof llmPromptingTraceSchema>;

// ── Prompt message block trace (per-message-block breakdown of the user turn) ──

export interface PromptMessageBlockTrace {
    role: "system" | "user" | "assistant";
    index: number;
    kind: "canonical-brief" | "history" | "focus-context" | "artifacts" | "section-context" | "raw";
    span: [number, number];
    source: string;
}

export const promptMessageBlockTraceSchema = z.object({
    role: z.enum(["system", "user", "assistant"]),
    index: z.number().int().nonnegative(),
    kind: z.enum(["canonical-brief", "history", "focus-context", "artifacts", "section-context", "raw"]),
    span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    source: z.string().min(1),
});

// ── Redactions ───────────────────────────────────────────────────────────────

export interface PromptRedaction {
    blockIndex: number;
    span: [number, number];
    reason: string;
}

export const promptRedactionSchema = z.object({
    blockIndex: z.number().int().nonnegative(),
    span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    reason: z.string().min(1),
});

// ── PromptExecutionEnvelope (I5) ────────────────────────────────────────────
//
// Not yet persisted or dispatched by anything (that's U4 in the SSOT program). This is the
// additive, unconsumed target shape for the durable proof of a single LLM dispatch.

export interface SafePromptExecutionFailure {
    code: string;
    message: string;
    providerStatus?: number;
}

export const safePromptExecutionFailureSchema = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    providerStatus: z.number().int().optional(),
});

export interface PromptExecutionEnvelope {
    id: string;
    version: "prompt-execution-v1";
    projectId: string;
    userId: string;
    pipelineRunId?: string;
    stage?: PipelineStage;
    taskKey: string;
    conversationId?: string;
    messageId?: string;
    snapshotId?: string;
    mode: "chat-preview" | "chat-preview-stream" | "focused-edit" | "preflight" | "background-task";
    status: "resolved" | "dispatched" | "completed" | "failed" | "cancelled";
    decision: ModelSelectionDecision;
    provider: string;
    model: string;
    messagesSentToProvider: ProviderMessageDto[];
    systemPrompt: string;
    layers: PromptLayerTraceEntryDto[];
    userBlocks: PromptMessageBlockTrace[];
    canonicalBriefHash?: string;
    inputFingerprint: string;
    payloadHash: string;
    idempotencyKey: string;
    redactions: PromptRedaction[];
    resolvedAt: string;
    dispatchedAt?: string;
    completedAt?: string;
    failure?: SafePromptExecutionFailure;
}

export const promptExecutionEnvelopeSchema = z.object({
    id: z.string().min(1),
    version: z.literal("prompt-execution-v1"),
    projectId: z.string().min(1),
    userId: z.string().min(1),
    pipelineRunId: z.string().min(1).optional(),
    stage: z
        .enum(["vibe_classify", "vibe_prefill", "brief_build", "optimize", "generate", "focused_edit"])
        .optional(),
    taskKey: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    snapshotId: z.string().min(1).optional(),
    mode: z.enum(["chat-preview", "chat-preview-stream", "focused-edit", "preflight", "background-task"]),
    status: z.enum(["resolved", "dispatched", "completed", "failed", "cancelled"]),
    decision: modelSelectionDecisionSchema,
    provider: z.string().min(1),
    model: z.string().min(1),
    messagesSentToProvider: z.array(providerMessageSchema),
    systemPrompt: z.string(),
    layers: z.array(promptLayerTraceEntrySchema),
    userBlocks: z.array(promptMessageBlockTraceSchema),
    canonicalBriefHash: z.string().optional(),
    inputFingerprint: z.string().min(1),
    payloadHash: z.string().min(1),
    idempotencyKey: z.string().min(1),
    redactions: z.array(promptRedactionSchema),
    resolvedAt: z.string().min(1),
    dispatchedAt: z.string().min(1).optional(),
    completedAt: z.string().min(1).optional(),
    failure: safePromptExecutionFailureSchema.optional(),
}) satisfies z.ZodType<PromptExecutionEnvelope>;
