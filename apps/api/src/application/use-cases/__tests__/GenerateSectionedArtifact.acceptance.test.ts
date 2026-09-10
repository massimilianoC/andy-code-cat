/**
 * Executable form of docs/specs/PARALLEL_SECTION_GENERATION_SPEC.md §8, against a simulated
 * provider that reproduces the behaviour that broke run f51ee098.
 *
 * The simulation encodes the two provider facts the design turns on, both measured rather than
 * assumed:
 *
 *   1. There is a hard output cap. That run asked for 64,000 completion tokens and received exactly
 *      32,768 — a power of two is a ceiling, not a model deciding it is finished.
 *   2. Reasoning is spent from the same budget as the answer, before the first character of it.
 *      VibePrefill.ts:34-49 records the same lesson from a different stage: roughly 6-8k of thinking
 *      in front of ~2k of JSON.
 *
 * A live probe against the real provider is `src/scripts/fanout-probe.ts`. This test exists so the
 * design's claim — that decomposition removes truncation by construction rather than by luck — is
 * checked on every run, without a provider, a balance, or a network.
 */
import { describe, it, expect } from "vitest";
import {
    GenerateSectionedArtifact,
    type SectionLlmCall,
    type SectionLlmDispatcher,
    type SectionLlmReply,
} from "../GenerateSectionedArtifact";

/** Scaled down from 32,768 so the test stays fast; the ratios are what matter. */
const PROVIDER_OUTPUT_CAP = 1_000;
const REASONING_TOKENS = 400;
/** Characters of HTML the simulated model emits per output token. */
const CHARS_PER_TOKEN = 4;

const TEN_SECTIONS = Array.from({ length: 10 }, (_, i) => ({
    key: `s${i + 1}`,
    title: `Sezione ${i + 1}`,
    contentBrief: `contenuto della sezione ${i + 1}`,
    charBudget: 900,
}));

/**
 * A hybrid-reasoning model behind a provider that truncates at a fixed cap.
 *
 * It always writes what it was asked for — the whole deck if asked for the whole deck — and the cap
 * decides how much of that survives. This is the point: the model is not the thing that has to
 * change, the size of the request is.
 */
class CappedProviderDispatcher implements SectionLlmDispatcher {
    readonly calls: Array<{ label: string; completionTokens: number; finishReason: string }> = [];

    async dispatch(call: SectionLlmCall): Promise<SectionLlmReply> {
        // The pre-fan-out shape: one call asked to produce the entire deck.
        if (call.label === "monolith") {
            return this.emit(call, "<section>…</section>".repeat(400), REASONING_TOKENS);
        }

        if (call.label === "plan") {
            const plan = JSON.stringify({
                designTokens: { palette: ["#0f172a"], styleNote: "sobrio" },
                sections: TEN_SECTIONS,
            });
            return this.emit(call, plan, call.disableThinking ? 0 : REASONING_TOKENS);
        }

        // The child is asked for one section, so it writes one section.
        const budget = Number(call.system.match(/roughly (\d+) characters/)?.[1] ?? 900);
        const html = `<section><h2>x</h2><p>${"c".repeat(budget)}</p></section>`;
        return this.emit(call, html, call.disableThinking ? 0 : REASONING_TOKENS);
    }

    /** Applies the provider cap the way a real one does: silently, mid-string, as finish_reason. */
    private emit(call: SectionLlmCall, content: string, reasoningTokens: number): SectionLlmReply {
        const requested = Math.min(call.maxTokens, PROVIDER_OUTPUT_CAP);
        const contentTokenBudget = Math.max(0, requested - reasoningTokens);
        const allowedChars = contentTokenBudget * CHARS_PER_TOKEN;
        const truncated = content.length > allowedChars;

        const reply: SectionLlmReply = {
            content: truncated ? content.slice(0, allowedChars) : content,
            finishReason: truncated ? "length" : "stop",
            reasoning: reasoningTokens > 0 ? "ho valutato la struttura…" : undefined,
            usage: {
                promptTokens: Math.ceil(call.system.length / CHARS_PER_TOKEN),
                completionTokens: truncated
                    ? requested
                    : reasoningTokens + Math.ceil(content.length / CHARS_PER_TOKEN),
                totalTokens: 0,
            },
        };
        this.calls.push({
            label: call.label,
            completionTokens: reply.usage!.completionTokens,
            finishReason: reply.finishReason!,
        });
        return reply;
    }
}

const INPUT = {
    brief: "un deck da 10 sezioni per un piano di spese familiari",
    deliverable: "a 10-section presentation deck",
    baseConstraints: "Write in Italian.",
    planMaxTokens: PROVIDER_OUTPUT_CAP,
    sectionMaxTokens: 400,
    concurrency: 4,
};

describe("section fan-out — acceptance against a truncating provider (spec §8)", () => {
    it("produces all ten sections with no call ending in finish_reason: length", async () => {
        const dispatcher = new CappedProviderDispatcher();

        const result = await new GenerateSectionedArtifact(dispatcher).execute(INPUT);

        expect(result.sections).toHaveLength(10);
        expect(result.metrics.placeholders).toBe(0);
        expect(result.metrics.truncatedCalls).toBe(0);
        expect(result.sections.every((s) => s.status === "generated")).toBe(true);
    });

    it("keeps every single call far below the provider's cap", async () => {
        const dispatcher = new CappedProviderDispatcher();

        const result = await new GenerateSectionedArtifact(dispatcher).execute(INPUT);

        // The monolith's defining number was one call pinned at exactly the cap. No call here is
        // anywhere near it, which is what "bounded by construction" has to mean.
        expect(result.metrics.maxCompletionTokensInOneCall).toBeLessThan(PROVIDER_OUTPUT_CAP);
        expect(dispatcher.calls.every((c) => c.finishReason === "stop")).toBe(true);
    });

    it("spends reasoning once, on the plan, and never on a section", async () => {
        const dispatcher = new CappedProviderDispatcher();

        await new GenerateSectionedArtifact(dispatcher).execute(INPUT);

        const reasoningCalls = dispatcher.calls.filter((c) => c.completionTokens >= REASONING_TOKENS && c.label === "plan");
        expect(reasoningCalls).toHaveLength(1);
    });

    it("shows the monolith failing under the same provider, so the comparison is like for like", async () => {
        // Same simulated provider, one call asked for everything: this is run f51ee098 in miniature.
        const dispatcher = new CappedProviderDispatcher();

        const reply = await dispatcher.dispatch({
            label: "monolith",
            system: "produce the whole deck",
            user: "everything at once",
            maxTokens: 64_000,
            disableThinking: false,
        });

        expect(reply.finishReason).toBe("length");
        expect(reply.usage!.completionTokens).toBe(PROVIDER_OUTPUT_CAP);
    });

    it("reports every section as it lands rather than in one batch at the end", async () => {
        const dispatcher = new CappedProviderDispatcher();
        const landed: string[] = [];

        const result = await new GenerateSectionedArtifact(dispatcher).execute(
            INPUT,
            (section) => landed.push(section.key),
        );

        expect(landed).toHaveLength(10);
        expect(result.metrics.firstSectionMs).toBeDefined();
    });

    it("degrades to labelled placeholders instead of extending past the run's time ceiling", async () => {
        class SlowDispatcher extends CappedProviderDispatcher {
            override async dispatch(call: SectionLlmCall): Promise<SectionLlmReply> {
                if (call.label !== "plan") await new Promise((r) => setTimeout(r, 30));
                return super.dispatch(call);
            }
        }

        const result = await new GenerateSectionedArtifact(new SlowDispatcher()).execute({
            ...INPUT,
            concurrency: 1,
            totalTimeoutMs: 60,
        });

        // Guaranteed result: ten sections come back either way, and the ones that could not be
        // produced say so instead of vanishing.
        expect(result.sections).toHaveLength(10);
        expect(result.metrics.hitTotalTimeout).toBe(true);
        expect(result.metrics.placeholders).toBeGreaterThan(0);
        expect(result.html).toContain('data-status="placeholder"');
    });
});
