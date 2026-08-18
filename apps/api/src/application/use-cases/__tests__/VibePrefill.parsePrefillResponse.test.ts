import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        vibeClassifierEnabled: true,
        providerApiKeys: {},
        COST_POLICY_TEXT_EUR_PER_1K_TOKENS: 0.002,
        COST_POLICY_IMAGE_EUR_PER_ASSET: 0.02,
        COST_POLICY_VIDEO_EUR_PER_ASSET: 0.2,
        COST_POLICY_USD_TO_EUR_RATE: 0.92,
        COST_POLICY_PROVIDER_MARKUP_FACTOR: 1.2,
    },
}));

import { PRESET_CATALOG } from "../../../domain/entities/ProjectPreset";
import { normalizeLang, parsePrefillResponse, resolvePrefillPresetId } from "../VibePrefill";

const BUG_PROMPT =
    "Build a unicycle company product website. React, Tailwind CSS, Framer Motion for all animations, Awwwards-level micro-interactions.";

describe("resolvePrefillPresetId — LLM-first precedence, no regex", () => {
    it("trusts the prefill LLM's specific preset over the classifier", () => {
        expect(resolvePrefillPresetId("website", "videogame")).toBe("website");
    });

    it("falls back to the classifier when the LLM collapses to neutral", () => {
        expect(resolvePrefillPresetId("neutral", "infographic")).toBe("infographic");
    });

    it("keeps neutral when there is no classifier pick", () => {
        expect(resolvePrefillPresetId("neutral", "")).toBe("neutral");
    });

    it("falls back to the classifier when the LLM emits nothing", () => {
        expect(resolvePrefillPresetId("", "slideshow")).toBe("slideshow");
    });

    it("falls back to neutral when neither side produced a preset", () => {
        expect(resolvePrefillPresetId("", "")).toBe("neutral");
    });

    it("falls back to neutral for an unknown LLM preset with no classifier (corrects the old stale 'landing' expectation)", () => {
        expect(resolvePrefillPresetId("nonexistent_type", "")).toBe("neutral");
    });

    it.each([
        ["landing_page", "landing"],
        ["business_site", "website"],
        ["portfolio", "neutral"],
    ])("maps legacy siteType %s -> %s", (siteType, expected) => {
        expect(resolvePrefillPresetId(siteType, "")).toBe(expected);
    });

    it("accepts every catalog preset id as an identity mapping", () => {
        for (const preset of PRESET_CATALOG) {
            expect(resolvePrefillPresetId(preset.id, "")).toBe(preset.id);
        }
    });
});

describe("parsePrefillResponse — presetId, no regex override", () => {
    it("REGRESSION — the bug prompt: LLM says website, no classifier context", () => {
        const raw = JSON.stringify({
            businessName: "Unicycle Co",
            presetId: "website",
            primaryGoal: "a".repeat(50),
            audience: "riders",
            outputLanguage: "en",
        });
        const result = parsePrefillResponse(raw, BUG_PROMPT, "en", null);
        expect(result.draft.presetId).toBe("website");
    });

    it("REGRESSION — the bug prompt: LLM says website even when the classifier said videogame", () => {
        const raw = JSON.stringify({
            businessName: "Unicycle Co",
            presetId: "website",
            primaryGoal: "a".repeat(50),
            audience: "riders",
            outputLanguage: "en",
        });
        const result = parsePrefillResponse(raw, BUG_PROMPT, "en", "videogame");
        expect(result.draft.presetId).toBe("website");
    });

    it("truncated-JSON partial recovery honours the same LLM-first precedence", () => {
        const raw = '{"businessName":"X","presetId":"website","primaryGoal":"aaaa';
        const result = parsePrefillResponse(raw, "p", "en", "videogame");
        expect(result.draft.presetId).toBe("website");
        // repairTruncatedJson recovers the complete businessName/presetId pair (the
        // half-written primaryGoal value is dropped, but nothing before it is lost) —
        // confidence 0.6, a step above the 0.4 last-resort regex-only path.
        expect(result.confidence).toBe(0.6);
    });

    it("falls all the way back to regex recovery when even repair can't produce valid JSON", () => {
        // The only value is fully written (closed quote) but there is no top-level comma
        // anywhere, so repairTruncatedJson has nothing safe to cut before and returns null —
        // the regex last-resort path runs instead.
        const raw = '{"businessName":"X, Y and Z Inc"';
        const result = parsePrefillResponse(raw, "fallback prompt", "en", null);
        expect(result.draft.businessName).toBe("X, Y and Z Inc");
        expect(result.confidence).toBe(0.4);
    });

    it("recovers every complete expressive field when truncated mid-way through a later field", () => {
        const full = {
            businessName: "Unicycle Co", presetId: "website", outputLanguage: "en",
            primaryGoal: "a".repeat(300), audience: "design-conscious riders",
            tone: "confident", primaryCta: "Explore the Machine",
            styleHint: "premium, dark, minimal",
            projectSummary: "a".repeat(300),
            contentStructure: "a".repeat(300),
            contentRequirements: "a".repeat(300),
        };
        const raw = JSON.stringify(full).slice(0, -1) + ',"functionalRequirements":"cut off mid-str';
        const result = parsePrefillResponse(raw, "unicycle prompt", "en", null);
        expect(result.confidence).toBe(0.6);
        expect(result.draft.presetId).toBe("website");
        expect(result.draft.tone).toBe("confident");
        expect(result.draft.primaryCta).toBe("Explore the Machine");
        expect(result.draft.styleHint).toBe("premium, dark, minimal");
        expect(result.draft.projectSummary).toBe(full.projectSummary);
        expect(result.draft.contentStructure).toBe(full.contentStructure);
        expect(result.draft.contentRequirements).toBe(full.contentRequirements);
        // The half-written field itself is correctly dropped, not corrupted into the draft.
        expect(result.draft.functionalRequirements).toBeUndefined();
    });

    it("passes through all nine expressive fields on a clean, complete response (regression for the empty-brief bug)", () => {
        const raw = JSON.stringify({
            businessName: "Unicycle Co", presetId: "website", outputLanguage: "en",
            primaryGoal: "a".repeat(50), audience: "design-conscious riders",
            tone: "confident", primaryCta: "Explore the Machine", styleHint: "premium, dark, minimal",
            projectSummary: "b".repeat(50), contentStructure: "c".repeat(50),
            contentRequirements: "d".repeat(50), functionalRequirements: "e".repeat(50),
            interactionModel: "f".repeat(50), visualDirection: "g".repeat(50),
            successCriteria: "h".repeat(50), constraints: "i".repeat(50), mustAvoid: "j".repeat(50),
        });
        const result = parsePrefillResponse(raw, BUG_PROMPT, "en", null);
        const expressiveFields = [
            "projectSummary", "contentStructure", "contentRequirements", "functionalRequirements",
            "interactionModel", "visualDirection", "successCriteria", "constraints", "mustAvoid",
        ] as const;
        for (const key of expressiveFields) {
            expect(result.draft[key]?.trim().length ?? 0).toBeGreaterThan(0);
        }
        expect(result.confidence).toBe(0.85);
    });

    it("passes through a valid preset ID", () => {
        const raw = JSON.stringify({
            businessName: "Slide Co",
            presetId: "slideshow",
            primaryGoal: "A deck about AI",
            audience: "Tech investors",
            outputLanguage: "en",
        });
        const result = parsePrefillResponse(raw, "make a presentation about AI");
        expect(result.draft.presetId).toBe("slideshow");
    });

    it("accepts all 16 catalog preset IDs", () => {
        for (const preset of PRESET_CATALOG) {
            const raw = JSON.stringify({ businessName: "X", presetId: preset.id, primaryGoal: "g", audience: "a", outputLanguage: "en" });
            expect(parsePrefillResponse(raw, "p").draft.presetId).toBe(preset.id);
        }
    });

    it("maps old siteType 'landing_page' to 'landing'", () => {
        const raw = JSON.stringify({ businessName: "X", siteType: "landing_page", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "p").draft.presetId).toBe("landing");
    });

    it("maps old siteType 'business_site' to 'website'", () => {
        const raw = JSON.stringify({ businessName: "X", siteType: "business_site", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "p").draft.presetId).toBe("website");
    });

    it("maps old siteType 'portfolio' to 'neutral'", () => {
        const raw = JSON.stringify({ businessName: "X", siteType: "portfolio", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "p").draft.presetId).toBe("neutral");
    });

    it("falls back to 'neutral' for unknown preset ID (was stale 'landing' before this fix)", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "nonexistent_type", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "p").draft.presetId).toBe("neutral");
    });

    it("falls back to the classifier's pick when presetId is missing from the LLM response", () => {
        const raw = JSON.stringify({ businessName: "X", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "p", "en", "infographic").draft.presetId).toBe("infographic");
    });
});

describe("parsePrefillResponse — outputLanguage inference", () => {
    it("returns LLM-inferred language when present", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a", outputLanguage: "de" });
        expect(parsePrefillResponse(raw, "p").draft.outputLanguage).toBe("de");
    });

    it("falls back to uiLanguage when outputLanguage is missing from LLM", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a" });
        expect(parsePrefillResponse(raw, "p", "it").draft.outputLanguage).toBe("it");
    });

    it("normalizes uppercase BCP-47 codes", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a", outputLanguage: "IT" });
        expect(parsePrefillResponse(raw, "p").draft.outputLanguage).toBe("it");
    });

    it("strips subtag (e.g. pt-BR -> pt)", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a", outputLanguage: "pt-BR" });
        expect(parsePrefillResponse(raw, "p").draft.outputLanguage).toBe("pt");
    });

    it("falls back to 'en' for invalid language codes", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a", outputLanguage: "123" });
        expect(parsePrefillResponse(raw, "p").draft.outputLanguage).toBe("en");
    });

    it("falls back to 'en' when both LLM and uiLanguage are absent", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a" });
        expect(parsePrefillResponse(raw, "p").draft.outputLanguage).toBe("en");
    });
});

describe("parsePrefillResponse — malformed input", () => {
    it("returns defaults for invalid JSON", () => {
        const result = parsePrefillResponse("not json at all", "My project");
        expect(result.draft.presetId).toBe("neutral");
        expect(result.draft.outputLanguage).toBe("en");
        expect(result.confidence).toBe(0);
    });

    it("strips markdown code fences before parsing", () => {
        const raw = "```json\n" + JSON.stringify({ businessName: "X", presetId: "slideshow", primaryGoal: "g", audience: "a", outputLanguage: "en" }) + "\n```";
        expect(parsePrefillResponse(raw, "p").draft.presetId).toBe("slideshow");
    });

    it("uses prompt text as businessName fallback", () => {
        const raw = JSON.stringify({ presetId: "landing", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "My Consulting Studio").draft.businessName).toBe("My Consulting Studio");
    });
});

describe("normalizeLang", () => {
    it("normalizes uppercase codes", () => {
        expect(normalizeLang("IT")).toBe("it");
    });

    it("strips subtags", () => {
        expect(normalizeLang("pt-BR")).toBe("pt");
    });

    it("defaults to 'en' for null/invalid input", () => {
        expect(normalizeLang(null)).toBe("en");
        expect(normalizeLang("123")).toBe("en");
    });
});
