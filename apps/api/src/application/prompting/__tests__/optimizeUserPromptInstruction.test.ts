import { describe, expect, it } from "vitest";
import type { ProjectMoodboard } from "../../../domain/entities/ProjectMoodboard";
import {
    DEFAULT_OPTIMIZE_FOLLOW_UP_SYSTEM_TEMPLATE,
    DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE,
    buildOptimizeUserPromptRequest,
} from "../optimizeUserPromptInstruction";

const moodboard = {
    projectId: "p1",
    toneTags: ["confident"],
    audienceTags: ["investors"],
    featureTags: [],
    sectorTags: ["consulting"],
    projectBrief: "A ten-slide pitch deck certifying additional competencies.",
    targetBusiness: "Freelance consultants",
    styleNotes: "Dark background, generous whitespace.",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} as unknown as ProjectMoodboard;

describe("buildOptimizeUserPromptRequest", () => {
    describe("initial mode (opening brief)", () => {
        it("injects the full project context so the optimizer can enrich a bare brief", () => {
            const { systemPrompt, userPrompt } = buildOptimizeUserPromptRequest({
                rawPrompt: "a pitch deck about my certifications",
                projectName: "Massimiliano Camillucci",
                projectType: "Presentation / Pitch",
                moodboard,
                layerDContext: "Extracted from CV.pdf: 12 years of experience.",
            });

            expect(systemPrompt).toContain(DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE);
            expect(systemPrompt).toContain("AUTHORITATIVE BRIEF PRESERVATION");
            expect(userPrompt).toContain("A ten-slide pitch deck certifying additional competencies.");
            expect(userPrompt).toContain("Extracted from CV.pdf");
            expect(userPrompt).toContain("a pitch deck about my certifications");
        });

        it("is the default when no mode is passed — pre-existing callers are unaffected", () => {
            const withoutMode = buildOptimizeUserPromptRequest({ rawPrompt: "x", moodboard });
            const explicitInitial = buildOptimizeUserPromptRequest({ rawPrompt: "x", moodboard, mode: "initial" });

            expect(withoutMode).toEqual(explicitInitial);
        });
    });

    describe("follow-up mode (revision instruction mid-conversation)", () => {
        const followUp = () =>
            buildOptimizeUserPromptRequest({
                rawPrompt: "vedo solo immagini non vedo testo, vorrei anche testo sintetico con buon contrasto",
                projectName: "Massimiliano Camillucci",
                projectType: "Presentation / Pitch",
                moodboard,
                layerDContext: "Extracted from CV.pdf: 12 years of experience.",
                assets: [],
                mode: "follow-up",
            });

        it("never re-injects the project brief — that is what turned a short correction into a new brief", () => {
            const { userPrompt } = followUp();

            expect(userPrompt).not.toContain("A ten-slide pitch deck certifying additional competencies.");
            expect(userPrompt).not.toContain("Freelance consultants");
            expect(userPrompt).not.toContain("Dark background");
            expect(userPrompt).not.toContain("Extracted from CV.pdf");
        });

        it("keeps the user's instruction as the payload", () => {
            const { userPrompt } = followUp();

            expect(userPrompt).toContain("vedo solo immagini non vedo testo");
            expect(userPrompt).toContain("do not restate it");
        });

        it("uses the follow-up system template, which forbids restating the brief", () => {
            const { systemPrompt } = followUp();

            expect(systemPrompt).toBe(DEFAULT_OPTIMIZE_FOLLOW_UP_SYSTEM_TEMPLATE);
            expect(systemPrompt).toContain("Do NOT restate, summarize or reconstruct the project brief");
        });

        it("ignores an operator systemTemplate override, which is written for brief enrichment", () => {
            const { systemPrompt } = buildOptimizeUserPromptRequest({
                rawPrompt: "make the contrast stronger",
                mode: "follow-up",
                taskSettings: {
                    systemTemplate: "Rewrite the user's brief into a full production-ready project description.",
                } as never,
            });

            expect(systemPrompt).toBe(DEFAULT_OPTIMIZE_FOLLOW_UP_SYSTEM_TEMPLATE);
            expect(systemPrompt).not.toContain("production-ready project description");
        });

        it("stays short — the whole point is that it is one conversational turn, not a brief", () => {
            const initial = buildOptimizeUserPromptRequest({ rawPrompt: "make the contrast stronger", moodboard });
            const followUpResult = buildOptimizeUserPromptRequest({
                rawPrompt: "make the contrast stronger",
                moodboard,
                mode: "follow-up",
            });

            expect(followUpResult.userPrompt.length).toBeLessThan(initial.userPrompt.length);
        });
    });
});
