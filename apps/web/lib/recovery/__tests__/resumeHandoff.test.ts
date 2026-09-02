import { describe, it, expect } from "vitest";
import { shouldOfferRecovery, buildResumeHandoff, RESUME_STORAGE_KEY } from "../resumeHandoff";
import type { ZeroEffortRecoveryStatus } from "@andy-code-cat/contracts";

const status = (over: Partial<ZeroEffortRecoveryStatus> = {}): ZeroEffortRecoveryStatus => ({
    recoverable: true,
    promptExecutionId: "pel-1",
    pipelineRunId: "run-1",
    conversationId: "conv-1",
    provider: "siliconflow",
    model: "zai-org/GLM-5.3",
    tokensUsed: 12_500,
    hasRawResponse: true,
    hasReasoningTrace: true,
    resumePrompt: "IL BRIEF\n\n---\nrisposta parziale…\n\nragionamento…",
    ...over,
});

describe("shouldOfferRecovery", () => {
    it("offers when the prefill failed and the server says there is material", () => {
        expect(shouldOfferRecovery(false, status())).toBe(true);
    });

    it("never offers when the prefill succeeded", () => {
        // There is nothing to recover from a call that did what it was asked, however much its row
        // happens to carry.
        expect(shouldOfferRecovery(true, status())).toBe(false);
    });

    it("does not offer when the server says there is nothing to resume", () => {
        // An HTTP 402 or a bad key produced no partial work. Offering here would cost the user a
        // second paid call for nothing.
        expect(shouldOfferRecovery(false, status({ recoverable: false }))).toBe(false);
    });

    it("does not offer when the status call itself failed", () => {
        expect(shouldOfferRecovery(false, null)).toBe(false);
        expect(shouldOfferRecovery(false, undefined)).toBe(false);
    });

    it("trusts the server rather than re-deriving from the raw fields", () => {
        // Material is present, but the server said no. The client must not second-guess that: the
        // judgement lives where the journal row is.
        const rich = status({ recoverable: false, tokensUsed: 40_000, hasReasoningTrace: true });
        expect(shouldOfferRecovery(false, rich)).toBe(false);
    });
});

describe("buildResumeHandoff", () => {
    it("carries the assembled prompt, which is the whole point", () => {
        const { resumePrompt } = buildResumeHandoff(status());
        expect(resumePrompt).toContain("risposta parziale");
        expect(resumePrompt).toContain("ragionamento");
    });

    it("carries the ids that let the resumed run be journalled as a resumption", () => {
        const { query } = buildResumeHandoff(status());
        const q = new URLSearchParams(query);
        expect(q.get("conv")).toBe("conv-1");
        expect(q.get("pipelineRunId")).toBe("run-1");
        expect(q.get("resumeFrom")).toBe("pel-1");
    });

    it("does NOT pin the model when the user kept the one that failed", () => {
        // Echoing it back as an explicit override would pin the resumed run to the model that just
        // gave up, and would silently beat a platform default that may since have moved.
        const { query } = buildResumeHandoff(status(), { provider: "siliconflow", model: "zai-org/GLM-5.3" });
        const q = new URLSearchParams(query);
        expect(q.get("provider")).toBeNull();
        expect(q.get("model")).toBeNull();
    });

    it("pins the model when the user picked a different one", () => {
        const { query } = buildResumeHandoff(status(), { provider: "openrouter", model: "google/gemini-3.7-flash" });
        const q = new URLSearchParams(query);
        expect(q.get("provider")).toBe("openrouter");
        expect(q.get("model")).toBe("google/gemini-3.7-flash");
    });

    it("omits ids the server did not send rather than emitting empty ones", () => {
        const { query } = buildResumeHandoff(status({ conversationId: undefined, pipelineRunId: undefined }));
        expect(query).not.toContain("conv=");
        expect(query).not.toContain("pipelineRunId=");
        expect(new URLSearchParams(query).get("resumeFrom")).toBe("pel-1");
    });

    it("reports no resume prompt when the server sent none, instead of an empty string", () => {
        // The caller uses this to decide whether the workspace can continue the thinking or has to
        // restart it; an empty string would read as "present" and silently degrade the recovery.
        expect(buildResumeHandoff(status({ resumePrompt: undefined })).resumePrompt).toBeUndefined();
    });

    it("scopes the storage key per project", () => {
        expect(RESUME_STORAGE_KEY("p1")).not.toBe(RESUME_STORAGE_KEY("p2"));
    });
});
