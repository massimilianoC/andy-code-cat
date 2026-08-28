import { describe, expect, it } from "vitest";
import {
    ARTIFACT_BASE_STALE,
    createPreviewSnapshotSchema,
    previewSnapshotMetadataSchema,
} from "../preview";

/**
 * The artifact shape is declared once. It used to be written down four times — this schema,
 * PreviewSnapshotDto, the API domain entity, and twice in the web client — and the copies had
 * drifted: the web client declared and sent `promptingTrace.promptConfigId`, which this schema
 * never declared, so zod stripped it from every write and no stored version carried it.
 *
 * These tests pin the fields that drift is known to have cost, so a future copy of the shape
 * fails here rather than silently losing data again.
 */
describe("preview snapshot contract — single source of truth", () => {
    const artifacts = { html: "<main></main>", css: "", js: "" };

    it("keeps promptConfigId on the prompting trace instead of stripping it on write", () => {
        const parsed = createPreviewSnapshotSchema.parse({
            conversationId: "c1",
            artifacts,
            metadata: {
                promptingTrace: {
                    originalUserMessage: "build me a page",
                    promptConfigId: "cfg-1",
                    prePromptTemplate: "…",
                },
            },
        });

        expect(parsed.metadata?.promptingTrace?.promptConfigId).toBe("cfg-1");
    });

    it("keeps the fields the write path depends on: session, execution, description", () => {
        const parsed = previewSnapshotMetadataSchema.parse({
            wysiwygSessionId: "session-1",
            wysiwygDescription: "EDIT Light",
            promptExecutionId: "exec-1",
        });

        expect(parsed).toMatchObject({
            wysiwygSessionId: "session-1",
            wysiwygDescription: "EDIT Light",
            promptExecutionId: "exec-1",
        });
    });

    it("AL-039 — contentHash is a sha256 in lowercase hex, or absent", () => {
        expect(previewSnapshotMetadataSchema.parse({ contentHash: "a".repeat(64) }).contentHash)
            .toBe("a".repeat(64));
        expect(previewSnapshotMetadataSchema.safeParse({ contentHash: "A".repeat(64) }).success).toBe(false);
        expect(previewSnapshotMetadataSchema.safeParse({ contentHash: "abc" }).success).toBe(false);
        expect(previewSnapshotMetadataSchema.safeParse({}).success).toBe(true);
    });

    it("AL-040 — a write may declare the base it was derived from", () => {
        const parsed = createPreviewSnapshotSchema.parse({
            conversationId: "c1",
            artifacts,
            parentSnapshotId: "snapshot-1",
            baseContentHash: "f".repeat(64),
        });

        expect(parsed.parentSnapshotId).toBe("snapshot-1");
        expect(parsed.baseContentHash).toBe("f".repeat(64));
    });

    it("AL-040 — a malformed declaration is rejected rather than quietly ignored", () => {
        const result = createPreviewSnapshotSchema.safeParse({
            conversationId: "c1",
            artifacts,
            baseContentHash: "not-a-hash",
        });

        expect(result.success).toBe(false);
    });

    it("AL-041 — the refusal code is part of the contract, not a string typed twice", () => {
        expect(ARTIFACT_BASE_STALE).toBe("ARTIFACT_BASE_STALE");
    });

    it("activate defaults to true, so callers need not restate it", () => {
        expect(createPreviewSnapshotSchema.parse({ conversationId: "c1", artifacts }).activate).toBe(true);
    });
});

/**
 * A generation that succeeded must always be storable. These pin the fields where a hard cap
 * could otherwise reject the artifact because its own diagnostic trace was too long — the failure
 * observed on 2026-08-27, where a run with four enriched documents produced a complete page and
 * the snapshot write came back VALIDATION_ERROR, leaving nothing to publish.
 */
describe("preview snapshot contract — diagnostics never destroy the artifact", () => {
    const artifacts = { html: "<main></main>", css: "", js: "" };

    it("accepts a system prompt far past the old 50k cap, truncating it", () => {
        const huge = "x".repeat(120_000);

        const parsed = createPreviewSnapshotSchema.parse({
            conversationId: "c1",
            artifacts,
            metadata: { promptingTrace: { originalUserMessage: "go", effectiveSystemPrompt: huge } },
        });

        expect(parsed.metadata?.promptingTrace?.effectiveSystemPrompt).toHaveLength(120_000);
    });

    it("truncates rather than rejecting beyond the storage limit", () => {
        const beyond = "y".repeat(260_000);

        const parsed = createPreviewSnapshotSchema.parse({
            conversationId: "c1",
            artifacts,
            metadata: { promptingTrace: { originalUserMessage: "go", effectiveSystemPrompt: beyond } },
        });

        expect(parsed.metadata?.promptingTrace?.effectiveSystemPrompt).toHaveLength(200_000);
    });

    it("truncates an oversized raw response instead of failing the write", () => {
        const parsed = createPreviewSnapshotSchema.parse({
            conversationId: "c1",
            artifacts,
            metadata: { rawResponse: "z".repeat(400_000) },
        });

        expect(parsed.metadata?.rawResponse).toHaveLength(300_000);
    });

    it("a long user message no longer rejects the snapshot", () => {
        const result = createPreviewSnapshotSchema.safeParse({
            conversationId: "c1",
            artifacts,
            metadata: { promptingTrace: { originalUserMessage: "m".repeat(80_000) } },
        });

        expect(result.success).toBe(true);
    });
});
