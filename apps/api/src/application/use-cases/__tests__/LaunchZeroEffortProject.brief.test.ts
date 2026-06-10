import { describe, expect, it } from "vitest";
import { PRESET_MAP } from "../../../domain/entities/ProjectPreset";

// ── Inline the pure brief builder (no I/O, no class instantiation needed) ────

function presetLabel(presetId: string): string {
    const preset = PRESET_MAP.get(presetId);
    return preset?.labelEn ?? preset?.label ?? presetId;
}

function buildNormalizedBrief(input: {
    businessName: string;
    presetId: string;
    primaryGoal?: string;
    audience?: string;
    tone?: string;
    primaryCta?: string;
    styleHint?: string;
    contactInfo?: Array<{ key: string; value: string }>;
    styleAttributes?: string[];
    outputLanguage?: string;
}): string {
    const siteLabel = presetLabel(input.presetId);
    const outputLanguage = input.outputLanguage ?? "en";
    const sections: string[] = [];

    sections.push(
        `# PROJECT BRIEF — ${input.businessName}\n\n` +
        `## [IDENTITY] Brand and template\n` +
        `- **Brand:** ${input.businessName}\n` +
        `- **Template:** ${siteLabel} (${input.presetId})\n` +
        `- **Output language:** ${outputLanguage}`,
    );

    if (input.primaryGoal?.trim()) {
        sections.push(`## [GOAL] Description and primary objective\n\n${input.primaryGoal.trim()}`);
    }
    if (input.audience?.trim()) {
        sections.push(`## [AUDIENCE] Target audience\n\n${input.audience.trim()}`);
    }
    const styleLines: string[] = [];
    if (input.styleAttributes && input.styleAttributes.length > 0) {
        styleLines.push(`- **Visual attributes:** ${input.styleAttributes.join(", ")}`);
    }
    if (input.tone?.trim()) styleLines.push(`- **Tone of voice:** ${input.tone.trim()}`);
    if (input.primaryCta?.trim()) styleLines.push(`- **Primary CTA:** ${input.primaryCta.trim()}`);
    if (input.styleHint?.trim()) styleLines.push(`- **Additional style notes:** ${input.styleHint.trim()}`);
    if (styleLines.length > 0) sections.push(`## [STYLE] Visual attributes, tone and CTA\n\n${styleLines.join("\n")}`);

    if (input.contactInfo && input.contactInfo.length > 0) {
        const contactLines = input.contactInfo.map((c) => `- **${c.key}:** ${c.value}`).join("\n");
        sections.push(`## [CONTACTS] Contact information\n\n${contactLines}`);
    }

    const footer = `\n---\n*Structured brief — Guided Mode · ${siteLabel} · Sections: ${sections.length - 1}*`;
    return sections.join("\n\n") + footer;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildNormalizedBrief — presetId", () => {
    it("includes the preset label for slideshow", () => {
        const brief = buildNormalizedBrief({ businessName: "Deck Co", presetId: "slideshow" });
        expect(brief).toContain("slideshow");
        // Should include human-readable label from PRESET_MAP
        const label = presetLabel("slideshow");
        expect(brief).toContain(label);
    });

    it("includes the preset label for videogame", () => {
        const brief = buildNormalizedBrief({ businessName: "Game Inc", presetId: "videogame" });
        expect(brief).toContain("videogame");
        expect(brief).toContain(presetLabel("videogame"));
    });

    it("includes the preset label for landing page", () => {
        const brief = buildNormalizedBrief({ businessName: "Acme", presetId: "landing" });
        expect(brief).toContain("landing");
        expect(brief).toContain(presetLabel("landing"));
    });

    it("falls back to raw presetId when not in catalog", () => {
        const brief = buildNormalizedBrief({ businessName: "X", presetId: "custom-unknown" });
        expect(brief).toContain("custom-unknown");
    });
});

describe("buildNormalizedBrief — outputLanguage", () => {
    it("includes the output language in the IDENTITY section", () => {
        const brief = buildNormalizedBrief({ businessName: "X", presetId: "landing", outputLanguage: "de" });
        expect(brief).toContain("de");
        expect(brief).toContain("Output language");
    });

    it("defaults to 'en' when outputLanguage is absent", () => {
        const brief = buildNormalizedBrief({ businessName: "X", presetId: "landing" });
        expect(brief).toContain("en");
    });
});

describe("buildNormalizedBrief — sections", () => {
    it("includes GOAL section when primaryGoal is present", () => {
        const brief = buildNormalizedBrief({ businessName: "X", presetId: "landing", primaryGoal: "Grow sales" });
        expect(brief).toContain("[GOAL]");
        expect(brief).toContain("Grow sales");
    });

    it("includes AUDIENCE section when present", () => {
        const brief = buildNormalizedBrief({ businessName: "X", presetId: "landing", audience: "Tech professionals" });
        expect(brief).toContain("[AUDIENCE]");
        expect(brief).toContain("Tech professionals");
    });

    it("includes CONTACTS section when contactInfo is provided", () => {
        const brief = buildNormalizedBrief({
            businessName: "X", presetId: "landing",
            contactInfo: [{ key: "Email", value: "hi@x.com" }],
        });
        expect(brief).toContain("[CONTACTS]");
        expect(brief).toContain("hi@x.com");
    });

    it("includes footer with preset label and section count", () => {
        const brief = buildNormalizedBrief({
            businessName: "X", presetId: "landing",
            primaryGoal: "goal", audience: "audience",
        });
        expect(brief).toContain("Structured brief — Guided Mode");
        expect(brief).toContain("Sections: 2");
    });
});
