import { describe, expect, it } from "vitest";
import { buildCanonicalGenerationBrief } from "../buildCanonicalGenerationBrief";

function baseInput() {
    return {
        businessName: "Acme",
        presetId: "landing",
        primaryGoal: "Preserva esattamente questa richiesta.",
        audience: "Clienti",
    };
}

describe("buildCanonicalGenerationBrief", () => {
    it("returns a canonical-brief-v1 envelope with a stable sha256 contentHash", () => {
        const envelope = buildCanonicalGenerationBrief(baseInput());

        expect(envelope.schemaVersion).toBe("canonical-brief-v1");
        expect(envelope.content).toContain("[SOURCE_REQUEST]");
        expect(envelope.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(envelope.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // Deterministic: same input, same content, same hash.
        const again = buildCanonicalGenerationBrief(baseInput());
        expect(again.contentHash).toBe(envelope.contentHash);
        expect(again.content).toBe(envelope.content);
    });

    it("certifies a user-edited brief verbatim, hashed and marked USER_EDITED", () => {
        const edited = "# My own brief\n\nJust build a one page site.";
        const envelope = buildCanonicalGenerationBrief(baseInput(), edited);

        // The run must certify the text that will actually be sent, not a re-derivation of it.
        expect(envelope.content).toBe(edited);
        expect(envelope.provenance).toEqual(["USER_EDITED"]);
        expect(envelope.schemaVersion).toBe("canonical-brief-v1");
        expect(envelope.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(envelope.contentHash).not.toBe(buildCanonicalGenerationBrief(baseInput()).contentHash);
        // The intake that produced the text the user started from is still recoverable.
        expect(envelope.sourceFields).toMatchObject({ businessName: "Acme", presetId: "landing" });
    });

    it("ignores a blank override rather than certifying an empty brief", () => {
        const derived = buildCanonicalGenerationBrief(baseInput());
        expect(buildCanonicalGenerationBrief(baseInput(), "   ").content).toBe(derived.content);
        expect(buildCanonicalGenerationBrief(baseInput(), undefined).content).toBe(derived.content);
    });

    it("contentHash changes when the content changes", () => {
        const a = buildCanonicalGenerationBrief(baseInput());
        const b = buildCanonicalGenerationBrief({ ...baseInput(), primaryGoal: "Something else entirely." });
        expect(a.contentHash).not.toBe(b.contentHash);
    });

    it("provenance lists exactly the sections actually included", () => {
        const envelope = buildCanonicalGenerationBrief({
            ...baseInput(),
            projectSummary: "A concept.",
            constraints: "Must be responsive.",
        });
        expect(envelope.provenance).toEqual(["IDENTITY", "SOURCE_REQUEST", "GOAL", "AUDIENCE", "CONCEPT", "CONSTRAINTS"]);
    });

    it("includes an Attachments section only when attachmentNames is non-empty, and it is absent by default", () => {
        const without = buildCanonicalGenerationBrief(baseInput());
        expect(without.content).not.toContain("[ATTACHMENTS]");
        expect(without.provenance).not.toContain("ATTACHMENTS");

        const withAttachments = buildCanonicalGenerationBrief({
            ...baseInput(),
            attachmentNames: ["brand-guidelines.pdf", "logo.png"],
        });
        expect(withAttachments.content).toContain("[ATTACHMENTS]");
        expect(withAttachments.content).toContain("brand-guidelines.pdf");
        expect(withAttachments.content).toContain("logo.png");
        expect(withAttachments.provenance).toContain("ATTACHMENTS");
    });

    it("sourceFields echoes the raw intake for audit purposes", () => {
        const input = baseInput();
        const envelope = buildCanonicalGenerationBrief(input);
        expect(envelope.sourceFields.businessName).toBe("Acme");
        expect(envelope.sourceFields.presetId).toBe("landing");
    });

    it("always uses English section headers regardless of outputLanguage (documented I9 behavior)", () => {
        const envelope = buildCanonicalGenerationBrief({ ...baseInput(), outputLanguage: "it" });
        expect(envelope.content).toContain("## [GOAL] Description and primary objective");
        expect(envelope.content).toContain("**Output language:** it");
    });
});
