import { describe, expect, it } from "vitest";

// ── Inline the helpers under test (pure functions, no side-effects) ───────────

function normalizeLang(raw?: string | null): string {
    if (!raw || typeof raw !== "string") return "en";
    const base = raw.trim().toLowerCase().split("-")[0];
    return /^[a-z]{2,8}$/.test(base ?? "") ? (base ?? "en") : "en";
}

const VALID_PRESET_IDS = new Set([
    "neutral", "landing", "website", "form", "manifesto",
    "slideshow", "keynote", "a4poster", "infographic",
    "videogame", "freerunner", "seriousgame", "game3d",
    "vr-aframe", "interactive-story",
]);

const SITE_TYPE_COMPAT: Record<string, string> = {
    landing_page: "landing",
    business_site: "website",
    portfolio: "neutral",
    showcase: "neutral",
};

interface ParsedDraft {
    businessName: string;
    presetId: string;
    outputLanguage: string;
    confidence: number;
}

function parsePrefillResponse(raw: string, prompt: string, uiLanguage?: string): ParsedDraft {
    let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;

    try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;

        const businessName = typeof parsed.businessName === "string" && parsed.businessName.trim()
            ? parsed.businessName.trim().slice(0, 120)
            : prompt.trim().slice(0, 64) || "Project";

        const rawPreset = typeof parsed.presetId === "string" ? parsed.presetId.trim()
            : typeof parsed.siteType === "string" ? parsed.siteType.trim() : "";
        const presetId: string = VALID_PRESET_IDS.has(rawPreset)
            ? rawPreset
            : (SITE_TYPE_COMPAT[rawPreset] ?? "landing");

        const outputLanguage = normalizeLang(
            typeof parsed.outputLanguage === "string" ? parsed.outputLanguage : uiLanguage
        );

        return { businessName, presetId, outputLanguage, confidence: 0.85 };
    } catch {
        return {
            businessName: prompt.trim().slice(0, 64) || "Project",
            presetId: "landing",
            outputLanguage: normalizeLang(uiLanguage),
            confidence: 0,
        };
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("parsePrefillResponse — presetId inference", () => {
    it("passes through a valid preset ID", () => {
        const raw = JSON.stringify({
            businessName: "Slide Co",
            presetId: "slideshow",
            primaryGoal: "A deck about AI",
            audience: "Tech investors",
            outputLanguage: "en",
        });
        const result = parsePrefillResponse(raw, "make a presentation about AI");
        expect(result.presetId).toBe("slideshow");
    });

    it("accepts all 15 catalog preset IDs", () => {
        const ids = [
            "neutral", "landing", "website", "form", "manifesto",
            "slideshow", "keynote", "a4poster", "infographic",
            "videogame", "freerunner", "seriousgame", "game3d",
            "vr-aframe", "interactive-story",
        ];
        for (const id of ids) {
            const raw = JSON.stringify({ businessName: "X", presetId: id, primaryGoal: "g", audience: "a", outputLanguage: "en" });
            expect(parsePrefillResponse(raw, "p").presetId).toBe(id);
        }
    });

    it("maps old siteType 'landing_page' to 'landing'", () => {
        const raw = JSON.stringify({ businessName: "X", siteType: "landing_page", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "p").presetId).toBe("landing");
    });

    it("maps old siteType 'business_site' to 'website'", () => {
        const raw = JSON.stringify({ businessName: "X", siteType: "business_site", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "p").presetId).toBe("website");
    });

    it("maps old siteType 'portfolio' to 'neutral'", () => {
        const raw = JSON.stringify({ businessName: "X", siteType: "portfolio", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "p").presetId).toBe("neutral");
    });

    it("falls back to 'landing' for unknown preset ID", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "nonexistent_type", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "p").presetId).toBe("landing");
    });

    it("falls back to 'landing' when presetId is missing", () => {
        const raw = JSON.stringify({ businessName: "X", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "p").presetId).toBe("landing");
    });
});

describe("parsePrefillResponse — outputLanguage inference", () => {
    it("returns LLM-inferred language when present", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a", outputLanguage: "de" });
        expect(parsePrefillResponse(raw, "p").outputLanguage).toBe("de");
    });

    it("falls back to uiLanguage when outputLanguage is missing from LLM", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a" });
        expect(parsePrefillResponse(raw, "p", "it").outputLanguage).toBe("it");
    });

    it("normalizes uppercase BCP-47 codes", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a", outputLanguage: "IT" });
        expect(parsePrefillResponse(raw, "p").outputLanguage).toBe("it");
    });

    it("strips subtag (e.g. pt-BR → pt)", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a", outputLanguage: "pt-BR" });
        expect(parsePrefillResponse(raw, "p").outputLanguage).toBe("pt");
    });

    it("falls back to 'en' for invalid language codes", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a", outputLanguage: "123" });
        expect(parsePrefillResponse(raw, "p").outputLanguage).toBe("en");
    });

    it("falls back to 'en' when both LLM and uiLanguage are absent", () => {
        const raw = JSON.stringify({ businessName: "X", presetId: "landing", primaryGoal: "g", audience: "a" });
        expect(parsePrefillResponse(raw, "p").outputLanguage).toBe("en");
    });
});

describe("parsePrefillResponse — malformed input", () => {
    it("returns defaults for invalid JSON", () => {
        const result = parsePrefillResponse("not json at all", "My project");
        expect(result.presetId).toBe("landing");
        expect(result.outputLanguage).toBe("en");
        expect(result.confidence).toBe(0);
    });

    it("strips markdown code fences before parsing", () => {
        const raw = "```json\n" + JSON.stringify({ businessName: "X", presetId: "slideshow", primaryGoal: "g", audience: "a", outputLanguage: "en" }) + "\n```";
        expect(parsePrefillResponse(raw, "p").presetId).toBe("slideshow");
    });

    it("uses prompt text as businessName fallback", () => {
        const raw = JSON.stringify({ presetId: "landing", primaryGoal: "g", audience: "a", outputLanguage: "en" });
        expect(parsePrefillResponse(raw, "My Consulting Studio").businessName).toBe("My Consulting Studio");
    });
});
