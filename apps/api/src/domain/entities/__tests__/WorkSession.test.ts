import { describe, it, expect } from "vitest";
import { assertWorkSessionTransition, type WorkSession } from "../WorkSession";

const session = (): WorkSession => ({
    id: "ws-1",
    userId: "u1",
    entryMode: "vibe",
    config: { uiLanguage: "it" },
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

    it("is a certificate: it carries no mode payload of its own", () => {
        const s = session();

        // A workspace-entry session has neither prompt nor attachments, so holding them here would
        // leave the field dead on a third of all sessions — and a user who re-prompts produces two
        // intakes where this shape could only hold one. Those belong to VibeIntake.
        expect(s).not.toHaveProperty("openingInput");
        expect(s).not.toHaveProperty("prompt");
        expect(s).not.toHaveProperty("attachments");
        // What a generation actually dispatched belongs to that run's PipelineRun.modelLock,
        // because the model can legitimately change mid-session.
        expect(s).not.toHaveProperty("modelLock");
        expect(s).not.toHaveProperty("requestedModel");
    });

    it("carries only session-scoped configuration, with a slot for settings that do not exist yet", () => {
        const s = session();
        s.config.options = { thinkingReport: true };

        expect(s.config.uiLanguage).toBe("it");
        expect(s.config.options).toEqual({ thinkingReport: true });
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
