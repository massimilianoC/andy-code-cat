import { describe, expect, it } from "vitest";
import { buildDidacticPrompt, DIDACTIC_OUTPUT_CONTRACT } from "../didacticPrompts";

/**
 * Pinned against a measured failure.
 *
 * On 2026-09-09 a didactic generation on an 18,736-token prompt returned one topic and one quiz
 * against a request for 6-10 and exactly 5. It was not truncated (`finish=stop`, 894 completion
 * tokens of a 16,000 budget) and it was not a parsing loss — the raw reply itself contained one of
 * each. The contract was stated once, in prose, at the tail of the user message, after up to
 * 240,000 characters of artifact.
 *
 * Cardinality cannot be imposed: `strict` JSON-schema mode does not support `minItems`/`maxItems`,
 * which is why ARTIFACT_RESPONSE_SCHEMA carries neither. So the contract is stated where a model
 * under long-context load still weights it, and verified afterwards. These tests keep both
 * statements present and keep them agreeing with the constant the verification uses.
 */

const ARTIFACTS = { html: "<main><h1>Hi</h1></main>", css: "main{padding:1rem}", js: "console.log(1);" };

function generate(uiLanguage: "it" | "en" = "it") {
    return buildDidacticPrompt({ mode: "generate", artifacts: ARTIFACTS, uiLanguage });
}

describe("buildDidacticPrompt — output contract", () => {
    it("states the required counts in the system message, not only at the tail of the user message", () => {
        const { system } = generate();
        expect(system).toContain(String(DIDACTIC_OUTPUT_CONTRACT.minTopics));
        expect(system).toContain(String(DIDACTIC_OUTPUT_CONTRACT.maxTopics));
        expect(system).toContain(String(DIDACTIC_OUTPUT_CONTRACT.quizzes));
    });

    it("still states the counts beside the shape they apply to", () => {
        const { user } = generate();
        expect(user).toContain(`${DIDACTIC_OUTPUT_CONTRACT.minTopics} to ${DIDACTIC_OUTPUT_CONTRACT.maxTopics} entries`);
        expect(user).toContain(`EXACTLY ${DIDACTIC_OUTPUT_CONTRACT.quizzes} entries`);
    });

    it("derives both statements from the one constant, so they cannot drift apart", () => {
        // The regression this guards: someone edits the prose and not the constant, and the
        // shortfall report then measures against a number the model was never given.
        const { system, user } = generate();
        for (const value of [DIDACTIC_OUTPUT_CONTRACT.minTopics, DIDACTIC_OUTPUT_CONTRACT.quizzes]) {
            expect(system.includes(String(value)) && user.includes(String(value))).toBe(true);
        }
    });

    it("does not put the generation contract into ask mode", () => {
        // Ask mode answers one question in markdown; demanding six topics there would be wrong.
        const { system } = buildDidacticPrompt({ mode: "ask", artifacts: ARTIFACTS, uiLanguage: "it", question: "why?" });
        expect(system).not.toContain("quizzes");
        expect(system).not.toContain(`${DIDACTIC_OUTPUT_CONTRACT.minTopics}-${DIDACTIC_OUTPUT_CONTRACT.maxTopics}`);
    });

    it("keeps the behaviour that was already correct", () => {
        // Regression guard for the parts of the prompt this change deliberately did not touch.
        const { system, user } = generate("en");
        expect(system).toContain("NEVER propose, rewrite, or output code");
        expect(system).toContain("Answer in English");
        expect(user).toContain("[INSTRUMENTED HTML]");
        expect(user).toContain("Do not invent pf-ids");
        expect(user).toContain("prompt_layer");
    });
});
