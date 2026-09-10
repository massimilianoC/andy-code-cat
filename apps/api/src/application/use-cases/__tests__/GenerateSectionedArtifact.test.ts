import { describe, it, expect } from "vitest";
import {
    GenerateSectionedArtifact,
    SectionPlanFailedError,
    type SectionLlmCall,
    type SectionLlmDispatcher,
    type SectionLlmReply,
} from "../GenerateSectionedArtifact";

const PLAN = JSON.stringify({
    designTokens: { palette: ["#000", "#fff"], styleNote: "sobrio" },
    sections: [
        { key: "intro", title: "Intro", contentBrief: "apri il discorso", charBudget: 600 },
        { key: "budget", title: "Budget", contentBrief: "spiega il budget", charBudget: 900 },
    ],
});

const INPUT = {
    brief: "un deck per una famiglia",
    deliverable: "a 2-section deck",
    baseConstraints: "Write in Italian.",
};

class ScriptedDispatcher implements SectionLlmDispatcher {
    readonly calls: SectionLlmCall[] = [];
    constructor(private readonly reply: (call: SectionLlmCall, nth: number) => Partial<SectionLlmReply>) { }

    async dispatch(call: SectionLlmCall): Promise<SectionLlmReply> {
        this.calls.push(call);
        const base = call.label.split("#")[0] ?? call.label;
        const nth = this.calls.filter((c) => c.label.startsWith(base)).length;
        return {
            content: "",
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            ...this.reply(call, nth),
        };
    }
}

const okSection = (key: string) => `<section data-section="${key}"><h2>ok</h2></section>`;

describe("GenerateSectionedArtifact", () => {
    it("plans once with reasoning on, then executes every section with reasoning off", async () => {
        const dispatcher = new ScriptedDispatcher((call) =>
            call.label === "plan" ? { content: PLAN } : { content: okSection("x") });

        const result = await new GenerateSectionedArtifact(dispatcher).execute(INPUT);

        const plan = dispatcher.calls.find((c) => c.label === "plan")!;
        const sections = dispatcher.calls.filter((c) => c.label.startsWith("section:"));

        expect(plan.disableThinking).toBe(false);
        expect(sections).toHaveLength(2);
        expect(sections.every((c) => c.disableThinking)).toBe(true);
        expect(result.sections.every((s) => s.status === "generated")).toBe(true);
    });

    it("hands every section the same design tokens instead of letting each reinterpret them", async () => {
        const dispatcher = new ScriptedDispatcher((call) =>
            call.label === "plan" ? { content: PLAN } : { content: okSection("x") });

        await new GenerateSectionedArtifact(dispatcher).execute(INPUT);

        const sections = dispatcher.calls.filter((c) => c.label.startsWith("section:"));
        expect(sections.every((c) => c.system.includes("#000") && c.system.includes("sobrio"))).toBe(true);
    });

    it("never sends the brief's source context to a child — the plan is the only carrier", async () => {
        const dispatcher = new ScriptedDispatcher((call) =>
            call.label === "plan" ? { content: PLAN } : { content: okSection("x") });

        await new GenerateSectionedArtifact(dispatcher).execute(INPUT);

        const sections = dispatcher.calls.filter((c) => c.label.startsWith("section:"));
        expect(sections.every((c) => !c.user.includes("un deck per una famiglia"))).toBe(true);
    });

    it("retries a truncated section with the concrete error and its own earlier reasoning", async () => {
        const dispatcher = new ScriptedDispatcher((call, nth) => {
            if (call.label === "plan") return { content: PLAN };
            if (nth === 1) {
                return { content: "<section>tronc", finishReason: "length", reasoning: "stavo pensando a…" };
            }
            return { content: okSection("x") };
        });

        const result = await new GenerateSectionedArtifact(dispatcher).execute(INPUT);

        const retries = dispatcher.calls.filter((c) => c.label.endsWith("#retry"));
        expect(retries).toHaveLength(2);
        expect(retries[0]!.user).toContain("finish_reason: length");
        expect(retries[0]!.user).toContain("stavo pensando a…");
        expect(result.sections.every((s) => s.status === "generated")).toBe(true);
        expect(result.sections.every((s) => s.attempts === 2)).toBe(true);
    });

    it("degrades an unrecoverable section to a labelled placeholder and still returns every section", async () => {
        const dispatcher = new ScriptedDispatcher((call) =>
            call.label === "plan" ? { content: PLAN } : { content: "", finishReason: "length" });

        const result = await new GenerateSectionedArtifact(dispatcher).execute(INPUT);

        expect(result.sections).toHaveLength(2);
        expect(result.sections.every((s) => s.status === "placeholder")).toBe(true);
        expect(result.sections.every((s) => s.degradedReason)).toBeTruthy();
        // The gap is visible in the artifact rather than silently missing from it.
        expect(result.html).toContain('data-status="placeholder"');
        expect(result.metrics.placeholders).toBe(2);
    });

    it("counts truncation even when a retry rescues the section", async () => {
        const dispatcher = new ScriptedDispatcher((call, nth) => {
            if (call.label === "plan") return { content: PLAN };
            if (nth === 1) return { content: "x", finishReason: "length" };
            return { content: okSection("x") };
        });

        const result = await new GenerateSectionedArtifact(dispatcher).execute(INPUT);

        expect(result.metrics.truncatedCalls).toBe(2);
        expect(result.metrics.calls).toBe(5); // 1 plan + 2 first attempts + 2 retries
    });

    it("fails loudly when the plan stage returns nothing usable", async () => {
        const dispatcher = new ScriptedDispatcher(() => ({ content: "Non posso aiutarti." }));

        await expect(new GenerateSectionedArtifact(dispatcher).execute(INPUT))
            .rejects.toBeInstanceOf(SectionPlanFailedError);
    });

    it("rejects a child that returned a whole document instead of a fragment", async () => {
        const dispatcher = new ScriptedDispatcher((call, nth) => {
            if (call.label === "plan") return { content: PLAN };
            if (nth === 1) return { content: "<html><body><section>tutto</section></body></html>" };
            return { content: okSection("x") };
        });

        const result = await new GenerateSectionedArtifact(dispatcher).execute(INPUT);

        const retries = dispatcher.calls.filter((c) => c.label.endsWith("#retry"));
        expect(retries[0]!.user).toContain("<html>/<head>/<body>");
        expect(result.sections.every((s) => s.status === "generated")).toBe(true);
    });
});
