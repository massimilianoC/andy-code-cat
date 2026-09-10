import { describe, it, expect } from "vitest";
import { diffFormFields } from "../ZeroEffortForm";
import type { GuidedLaunchInput } from "@andy-code-cat/contracts";

const base = (over: Partial<GuidedLaunchInput> = {}): GuidedLaunchInput => ({
    presetId: "slideshow",
    primaryGoal: "presentare un piano di spese familiari",
    audience: "una famiglia",
    ...over,
} as GuidedLaunchInput);

describe("ZeroEffortForm — what the model proposed vs what the user decided", () => {
    it("reports nothing when the user accepted the prefill unchanged", () => {
        expect(diffFormFields(base(), base())).toEqual([]);
    });

    it("names every field the user changed", () => {
        const prefilled = base({ tone: "formale", audience: "una famiglia" });
        const confirmed = base({ tone: "diretto", audience: "una coppia" });

        expect(diffFormFields(prefilled, confirmed)).toEqual(["audience", "tone"]);
    });

    it("compares nested values by content, so a retyped identical list is not an edit", () => {
        const prefilled = base({ styleAttributes: ["sobrio", "editoriale"] });
        const confirmed = base({ styleAttributes: ["sobrio", "editoriale"] });

        expect(diffFormFields(prefilled, confirmed)).toEqual([]);
    });

    it("catches a change inside a nested list", () => {
        const prefilled = base({ styleAttributes: ["sobrio"] });
        const confirmed = base({ styleAttributes: ["sobrio", "caldo"] });

        expect(diffFormFields(prefilled, confirmed)).toEqual(["styleAttributes"]);
    });

    it("treats a field the user filled in from empty as an edit", () => {
        const confirmed = base({ primaryCta: "Prenota una consulenza" });

        expect(diffFormFields(base(), confirmed)).toEqual(["primaryCta"]);
    });

    it("reports nothing when there was no prefill to diff against", () => {
        // A form filled unaided has no model suggestion to differ from — that is not zero edits,
        // it is a question that does not apply.
        expect(diffFormFields(undefined, base({ tone: "diretto" }))).toEqual([]);
    });
});
