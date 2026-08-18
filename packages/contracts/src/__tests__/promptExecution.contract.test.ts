import { describe, expect, it } from "vitest";
import type { LlmPromptingTrace } from "../llm";
import {
    llmPromptingTraceSchema,
    promptExecutionEnvelopeSchema,
    promptLayerSegmentSchema,
    promptLayerTraceEntrySchema,
    promptMessageBlockTraceSchema,
    promptRedactionSchema,
    providerMessageSchema,
    safePromptExecutionFailureSchema,
    type PromptExecutionEnvelope,
    type PromptLayerTraceEntryDto,
} from "../promptExecution";
import { modelSelectionDecisionSchema, type ModelSelectionDecision } from "../modelRouting";
import { pipelineStageExecutionRefSchema, pipelineRunDtoSchema, type PipelineStageExecutionRef } from "../pipelineRun";

// ── I4: valid-shape parsing for the new zod schemas ─────────────────────────

describe("providerMessageSchema", () => {
    it("parses a minimal system/user/assistant message", () => {
        for (const role of ["system", "user", "assistant"] as const) {
            expect(() => providerMessageSchema.parse({ role, content: "hello" })).not.toThrow();
        }
    });

    it("rejects an unknown role", () => {
        expect(() => providerMessageSchema.parse({ role: "tool", content: "x" })).toThrow();
    });
});

describe("promptLayerSegmentSchema / promptLayerTraceEntrySchema", () => {
    it("parses a layer entry without segments (legacy shape)", () => {
        const result = promptLayerTraceEntrySchema.parse({
            id: "layer-1",
            key: "brand",
            label: "Brand voice",
            source: "project-preset",
            chars: 120,
            span: [0, 120],
        });
        expect(result.segments).toBeUndefined();
    });

    it("parses a layer entry with segments", () => {
        const segment = promptLayerSegmentSchema.parse({
            id: "seg-1",
            source: "moodboard",
            span: [0, 40],
            contentHash: "sha256:abc123",
        });
        expect(segment.contentHash).toBe("sha256:abc123");

        const layer = promptLayerTraceEntrySchema.parse({
            id: "layer-1",
            key: "brand",
            label: "Brand voice",
            source: "project-preset",
            chars: 120,
            span: [0, 120],
            segments: [segment],
        });
        expect(layer.segments).toHaveLength(1);
    });
});

describe("llmPromptingTraceSchema", () => {
    it("parses a full trace (system+user+assistant history, layers, focusContext)", () => {
        const parsed = llmPromptingTraceSchema.parse({
            originalUserMessage: "make it blue",
            promptConfigId: "cfg-1",
            prePromptTemplate: "template",
            effectiveSystemPrompt: "You are a website builder.",
            messagesSentToLlm: [
                { role: "system", content: "You are a website builder." },
                { role: "assistant", content: "prior turn" },
                { role: "user", content: "make it blue" },
            ],
            layers: [
                { id: "l1", key: "brand", label: "Brand", source: "preset", chars: 10, span: [0, 10] },
            ],
        });
        expect(parsed.messagesSentToLlm).toHaveLength(3);
        expect(parsed.layers).toHaveLength(1);
    });

    it("parses the minimal required shape (no layers, no focusContext)", () => {
        expect(() =>
            llmPromptingTraceSchema.parse({
                originalUserMessage: "hi",
                effectiveSystemPrompt: "sys",
                messagesSentToLlm: [],
            }),
        ).not.toThrow();
    });

    it("rejects a trace missing effectiveSystemPrompt", () => {
        expect(() =>
            llmPromptingTraceSchema.parse({
                originalUserMessage: "hi",
                messagesSentToLlm: [],
            }),
        ).toThrow();
    });
});

describe("promptMessageBlockTraceSchema", () => {
    it("parses a valid block trace entry", () => {
        expect(() =>
            promptMessageBlockTraceSchema.parse({
                role: "user",
                index: 0,
                kind: "canonical-brief",
                span: [0, 100],
                source: "brief",
            }),
        ).not.toThrow();
    });

    it("rejects an invalid kind", () => {
        expect(() =>
            promptMessageBlockTraceSchema.parse({
                role: "user",
                index: 0,
                kind: "not-a-real-kind",
                span: [0, 100],
                source: "brief",
            }),
        ).toThrow();
    });
});

describe("promptRedactionSchema", () => {
    it("parses a valid redaction", () => {
        expect(() =>
            promptRedactionSchema.parse({ blockIndex: 0, span: [10, 20], reason: "PII" }),
        ).not.toThrow();
    });
});

describe("safePromptExecutionFailureSchema", () => {
    it("parses with and without providerStatus", () => {
        expect(() => safePromptExecutionFailureSchema.parse({ code: "TIMEOUT", message: "timed out" })).not.toThrow();
        expect(() =>
            safePromptExecutionFailureSchema.parse({ code: "PROVIDER_ERROR", message: "bad gateway", providerStatus: 502 }),
        ).not.toThrow();
    });
});

describe("modelSelectionDecisionSchema", () => {
    const validDecision: ModelSelectionDecision = {
        version: "model-selection-v1",
        policy: "strict",
        requested: {
            providerId: "siliconflow",
            modelId: "moonshotai/Kimi-K3",
            source: "user-request-override",
            catalogRevision: "rev-1",
        },
        effective: { providerId: "siliconflow", modelId: "moonshotai/Kimi-K3", source: "user-request-override" },
        outcome: "exact",
        trail: [
            { rule: "user-request-override", providerId: "siliconflow", modelId: "moonshotai/Kimi-K3", accepted: true },
        ],
        decidedAt: "2026-08-18T00:00:00.000Z",
    };

    it("parses a valid decision", () => {
        expect(() => modelSelectionDecisionSchema.parse(validDecision)).not.toThrow();
    });

    it("parses a blocked decision without an effective selection", () => {
        expect(() =>
            modelSelectionDecisionSchema.parse({
                version: "model-selection-v1",
                policy: "strict",
                requested: {
                    providerId: "siliconflow",
                    modelId: "moonshotai/Kimi-K3",
                    source: "user-request-override",
                    catalogRevision: "rev-1",
                },
                outcome: "blocked",
                trail: [],
                blockedReason: "MODEL_LOCK_UNAVAILABLE",
                decidedAt: "2026-08-18T00:00:00.000Z",
            }),
        ).not.toThrow();
    });

    it("rejects an invalid outcome value", () => {
        expect(() => modelSelectionDecisionSchema.parse({ ...validDecision, outcome: "maybe" })).toThrow();
    });
});

describe("pipelineRunDtoSchema / pipelineStageExecutionRefSchema", () => {
    const stage: PipelineStageExecutionRef = {
        stage: "generate",
        taskKey: "god_mode_generate",
        decision: {
            version: "model-selection-v1",
            policy: "legacy",
            requested: { source: "pipeline-run-lock", catalogRevision: "rev-1" },
            effective: { providerId: "siliconflow", modelId: "moonshotai/Kimi-K3", source: "pipeline-run-lock" },
            outcome: "exact",
            trail: [],
            decidedAt: "2026-08-18T00:00:00.000Z",
        },
        status: "completed",
        startedAt: "2026-08-18T00:00:00.000Z",
        completedAt: "2026-08-18T00:00:05.000Z",
    };

    it("parses a valid stage execution ref", () => {
        expect(() => pipelineStageExecutionRefSchema.parse(stage)).not.toThrow();
    });

    it("parses a valid pipeline run DTO", () => {
        expect(() =>
            pipelineRunDtoSchema.parse({
                id: "run-1",
                projectId: "proj-1",
                ownerUserId: "user-1",
                entryMode: "godmode",
                modelLock: {
                    policy: "strict",
                    requested: { providerId: "siliconflow", modelId: "moonshotai/Kimi-K3", catalogRevision: "rev-1" },
                    effective: { providerId: "siliconflow", modelId: "moonshotai/Kimi-K3" },
                    selectedAt: "2026-08-18T00:00:00.000Z",
                    selectedBy: "user",
                },
                optimizationPolicy: "skip",
                status: "completed",
                stages: [stage],
                createdAt: "2026-08-18T00:00:00.000Z",
                updatedAt: "2026-08-18T00:00:05.000Z",
            }),
        ).not.toThrow();
    });
});

describe("promptExecutionEnvelopeSchema", () => {
    const envelope: PromptExecutionEnvelope = {
        id: "exec-1",
        version: "prompt-execution-v1",
        projectId: "proj-1",
        userId: "user-1",
        taskKey: "god_mode_generate",
        mode: "chat-preview",
        status: "completed",
        decision: {
            version: "model-selection-v1",
            policy: "legacy",
            requested: { source: "task-setting", catalogRevision: "rev-1" },
            effective: { providerId: "siliconflow", modelId: "moonshotai/Kimi-K3", source: "task-setting" },
            outcome: "exact",
            trail: [],
            decidedAt: "2026-08-18T00:00:00.000Z",
        },
        provider: "siliconflow",
        model: "moonshotai/Kimi-K3",
        messagesSentToProvider: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
        systemPrompt: "sys",
        layers: [],
        userBlocks: [],
        inputFingerprint: "fp-1",
        payloadHash: "hash-1",
        idempotencyKey: "idem-1",
        redactions: [],
        resolvedAt: "2026-08-18T00:00:00.000Z",
    };

    it("parses a minimal valid envelope", () => {
        expect(() => promptExecutionEnvelopeSchema.parse(envelope)).not.toThrow();
    });

    it("round-trips through parse without losing fields", () => {
        const parsed = promptExecutionEnvelopeSchema.parse(envelope);
        expect(parsed.id).toBe(envelope.id);
        expect(parsed.decision.effective?.modelId).toBe("moonshotai/Kimi-K3");
    });

    it("rejects a missing required field (idempotencyKey)", () => {
        const { idempotencyKey: _drop, ...withoutKey } = envelope;
        expect(() => promptExecutionEnvelopeSchema.parse(withoutKey)).toThrow();
    });
});

// ── I4: structural compatibility of the API-side and web-side trace shapes ──
//
// apps/api and apps/web cannot be imported from packages/contracts (contracts sits below
// both in the dependency direction — see AGENTS.md). Instead, this locks the *reduced* /
// *narrowed* shapes those workspaces derive from the canonical type (mirrored here, with a
// comment pointing at the real declaration) so a future field rename in LlmPromptingTrace or
// PromptLayerTraceEntryDto is caught at compile time in this package, before it ever reaches
// apps/api or apps/web.

describe("cross-workspace structural compatibility (compile-time)", () => {
    it("LlmPromptingTrace remains a superset of the optimizer's narrowed trace shape", () => {
        // Mirrors apps/api/src/application/use-cases/OptimizeUserPrompt.ts's `OptimizerTrace`
        // (Pick<LlmPromptingTrace, "originalUserMessage" | "effectiveSystemPrompt" | "messagesSentToLlm">)
        // and apps/web/lib/api/llm.ts's `OptimizePromptResult.promptingTrace` (the same Pick).
        type OptimizerTraceMirror = Pick<LlmPromptingTrace, "originalUserMessage" | "effectiveSystemPrompt" | "messagesSentToLlm">;

        const sample: OptimizerTraceMirror = {
            originalUserMessage: "hi",
            effectiveSystemPrompt: "sys",
            messagesSentToLlm: [{ role: "system", content: "sys" }],
        };

        // If this assignment ever fails to compile, OptimizerTrace's fields have drifted from
        // LlmPromptingTrace — the two are supposed to remain structurally identical for the
        // fields they share.
        const asCanonical: Pick<LlmPromptingTrace, "originalUserMessage" | "effectiveSystemPrompt" | "messagesSentToLlm"> = sample;
        expect(asCanonical.originalUserMessage).toBe("hi");
    });

    it("PromptLayerTraceEntryDto remains assignable to/from the canonical LlmPromptingTraceLayer shape", () => {
        // Mirrors apps/web/lib/api/llm.ts's `PromptLayerEntryDto` (an alias of this type).
        const withoutSegments: PromptLayerTraceEntryDto = {
            id: "l1",
            key: "brand",
            label: "Brand",
            source: "preset",
            chars: 10,
            span: [0, 10],
        };
        // The base fields (id/key/label/source/chars/span) must satisfy LlmPromptingTraceLayer
        // (packages/contracts/src/llm.ts) without the optional `segments` extension.
        const asLayer: LlmPromptingTrace["layers"] = [withoutSegments];
        expect(asLayer?.[0]?.id).toBe("l1");
    });
});
