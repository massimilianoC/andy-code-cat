import { describe, it, expect } from "vitest";
import { assertWorkSessionTransition, type WorkSession } from "../WorkSession";

const session = (): WorkSession => ({
    id: "ws-1",
    userId: "u1",
    entryMode: "vibe",
    openingInput: {
        prompt: "un deck da 10 sezioni per una famiglia",
        attachments: [{ assetId: "a1", filename: "spese.pdf", mimeType: "application/pdf", sizeBytes: 12_000 }],
        requestedProvider: "siliconflow",
        requestedModel: "zai-org/GLM-5.3",
        uiLanguage: "it",
    },
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
});

describe("WorkSession", () => {
    it("opens without a project, because a Vibe session starts before one exists", () => {
        const s = session();

        expect(s.projectId).toBeUndefined();
        expect(s.entryMode).toBe("vibe");
    });

    it("keeps the user's own words and a pointer to each attachment, not a copy of it", () => {
        const s = session();

        expect(s.openingInput.prompt).toContain("un deck da 10 sezioni");
        expect(s.openingInput.attachments[0]!.assetId).toBe("a1");
        // The asset lives in its own collection and storage; duplicating its bytes here would be a
        // second copy of a fact that already has an owner.
        expect(s.openingInput.attachments[0]).not.toHaveProperty("content");
    });

    it("photographs the model the user chose at the start, as intent rather than authority", () => {
        const s = session();

        expect(s.openingInput.requestedModel).toBe("zai-org/GLM-5.3");
        // What a given generation actually dispatched is not here — it belongs to that run's
        // PipelineRun.modelLock, because the model can legitimately change mid-session.
        expect(s).not.toHaveProperty("modelLock");
        expect(s).not.toHaveProperty("effectiveModel");
    });

    it("carries a slot for options that do not exist yet, so adding one is not a migration", () => {
        const s = session();
        s.openingInput.options = { thinkingReport: true };

        expect(s.openingInput.options).toEqual({ thinkingReport: true });
    });

    it("allows every terminal outcome from open", () => {
        expect(() => assertWorkSessionTransition("open", "completed")).not.toThrow();
        expect(() => assertWorkSessionTransition("open", "failed")).not.toThrow();
        expect(() => assertWorkSessionTransition("open", "abandoned")).not.toThrow();
    });

    it("refuses to reopen a finished session", () => {
        // An edit after the fact belongs to a session that is still open, or starts its own —
        // reopening would make "what happened in this session" unanswerable.
        expect(() => assertWorkSessionTransition("completed", "open")).toThrow(/illegal status transition/);
        expect(() => assertWorkSessionTransition("failed", "completed")).toThrow(/illegal status transition/);
        expect(() => assertWorkSessionTransition("abandoned", "open")).toThrow(/illegal status transition/);
    });
});
