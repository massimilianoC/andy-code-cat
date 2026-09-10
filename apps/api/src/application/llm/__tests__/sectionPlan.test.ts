import { describe, it, expect } from "vitest";
import { parseSectionPlan, MAX_CHAR_BUDGET, MIN_CHAR_BUDGET } from "../sectionPlan";

const validPlan = JSON.stringify({
    designTokens: { palette: ["#0f172a", "#f8fafc"], headingFont: "Inter", styleNote: "editorial" },
    sections: [
        { key: "intro", title: "Introduzione", contentBrief: "Presenta il piano", charBudget: 800 },
        { key: "budget", title: "Budget", contentBrief: "Spiega il budget mensile", charBudget: 1200 },
    ],
});

describe("parseSectionPlan", () => {
    it("parses a clean plan and reports that no repair was needed", () => {
        const parsed = parseSectionPlan(validPlan);

        expect(parsed).not.toBeNull();
        expect(parsed!.repaired).toBe(false);
        expect(parsed!.plan.sections).toHaveLength(2);
        expect(parsed!.plan.designTokens.palette).toEqual(["#0f172a", "#f8fafc"]);
    });

    it("recovers a plan the model wrapped in prose", () => {
        const parsed = parseSectionPlan(`Ecco il piano:\n\n${validPlan}\n\nSpero sia utile.`);

        expect(parsed!.plan.sections).toHaveLength(2);
    });

    it("recovers a plan cut off mid-way and flags it as repaired", () => {
        // A truncated plan is still usable, but the flag matters: sections the model meant to write
        // are simply absent, and no downstream retry can recover a section nobody knows about.
        const truncated = validPlan.slice(0, validPlan.length - 40);

        const parsed = parseSectionPlan(truncated);

        expect(parsed).not.toBeNull();
        expect(parsed!.repaired).toBe(true);
        expect(parsed!.plan.sections.length).toBeGreaterThanOrEqual(1);
    });

    it("drops a section with no brief rather than inventing one, and counts it", () => {
        const raw = JSON.stringify({
            sections: [
                { key: "a", title: "A", contentBrief: "dice qualcosa" },
                { key: "b", title: "B" },
            ],
        });

        const parsed = parseSectionPlan(raw);

        expect(parsed!.plan.sections).toHaveLength(1);
        expect(parsed!.droppedSections).toBe(1);
    });

    it("clamps a budget the model invented outside the allowed range", () => {
        const raw = JSON.stringify({
            sections: [
                { key: "a", title: "A", contentBrief: "x", charBudget: 999_999 },
                { key: "b", title: "B", contentBrief: "y", charBudget: 1 },
            ],
        });

        const parsed = parseSectionPlan(raw);

        expect(parsed!.plan.sections[0]!.charBudget).toBe(MAX_CHAR_BUDGET);
        expect(parsed!.plan.sections[1]!.charBudget).toBe(MIN_CHAR_BUDGET);
    });

    it("returns null when there is no plan to be found", () => {
        expect(parseSectionPlan("Non posso aiutarti con questo.")).toBeNull();
        expect(parseSectionPlan("")).toBeNull();
        expect(parseSectionPlan(JSON.stringify({ sections: [] }))).toBeNull();
    });
});
