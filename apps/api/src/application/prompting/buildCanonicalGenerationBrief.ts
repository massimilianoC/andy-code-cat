import { createHash } from "crypto";
import type { CanonicalBriefEnvelope, GuidedLaunchInput } from "@andy-code-cat/contracts";
import { PRESET_MAP } from "../../domain/entities/ProjectPreset";

/**
 * I9 of the SSOT program (see docs/SSOT_REFACTOR_PROGRESS.md) — the single place that turns a
 * Zero-Effort/Guided-Mode intake into brief text. Before this, the server built one version
 * (`buildNormalizedBrief`, persisted as the conversation's first message and the moodboard's
 * `projectBrief`) and the launch page independently rebuilt a SECOND, differently-formatted
 * version client-side (`buildStructuredBrief`, deleted in this change) that the user actually
 * reviewed/edited and that was the text sent to the optimizer. The two could diverge — this is
 * the root cause the SSOT regression analysis labeled "P0 — two brief builders". Now there is
 * exactly one builder; the launch page uses this function's `.content` verbatim as the editable
 * brief instead of reconstructing its own.
 *
 * User-visible behavior change (documented, not accidental): section headers here are always
 * English, not localized via the client's i18n `t()` — the brief text sent to the LLM and shown
 * to the user must be identical, and only one of the two builders could own localization. English
 * was kept because it is what was ALREADY being persisted server-side (the client's localized
 * version was only ever shown for editing, never actually the source of truth for anything else).
 */
export function buildCanonicalGenerationBrief(input: GuidedLaunchInput): CanonicalBriefEnvelope {
    const preset = PRESET_MAP.get(input.presetId);
    const siteLabel = preset?.labelEn ?? preset?.label ?? input.presetId;
    const outputLanguage = input.outputLanguage ?? "en";
    const sections: string[] = [];
    const provenance: string[] = [];

    // ── [IDENTITY] ──────────────────────────────────────────────────────────
    provenance.push("IDENTITY");
    sections.push(
        `# PROJECT BRIEF — ${input.businessName}\n\n` +
        `## [IDENTITY] Brand and template\n` +
        `- **Brand:** ${input.businessName}\n` +
        `- **Template:** ${siteLabel} (${input.presetId})\n` +
        `- **Output language:** ${outputLanguage}`,
    );

    // The original request is the authority boundary. All inferred sections below
    // enrich it and must never be interpreted as permission to remove or weaken it.
    const sourceRequest = input.sourceRequest?.trim() || input.primaryGoal?.trim();
    if (sourceRequest) {
        provenance.push("SOURCE_REQUEST");
        sections.push(
            `## [SOURCE_REQUEST] Original user request — authoritative\n\n` +
            `${sourceRequest}\n\n` +
            `> Preserve every explicit fact, preference, requirement and prohibition above. ` +
            `Later sections are additive clarification only; on conflict, this source request wins.`,
        );
    }

    // ── [GOAL] ──────────────────────────────────────────────────────────────
    if (input.primaryGoal?.trim()) {
        provenance.push("GOAL");
        sections.push(
            `## [GOAL] Description and primary objective\n\n` +
            input.primaryGoal.trim(),
        );
    }

    // ── [AUDIENCE] ──────────────────────────────────────────────────────────
    if (input.audience?.trim()) {
        provenance.push("AUDIENCE");
        sections.push(
            `## [AUDIENCE] Target audience\n\n` +
            input.audience.trim(),
        );
    }

    const expressiveSections: Array<[string, string, string | undefined]> = [
        ["CONCEPT", "Project concept and value proposition", input.projectSummary],
        ["STRUCTURE", "Required content structure, screens and states", input.contentStructure],
        ["CONTENT", "Content, data, entities and asset requirements", input.contentRequirements],
        ["FUNCTIONS", "Functional requirements and behavior", input.functionalRequirements],
        ["INTERACTIONS", "Interaction model, controls and feedback", input.interactionModel],
        ["VISUAL_DIRECTION", "Visual and experiential direction", input.visualDirection],
        ["SUCCESS", "Completion and success criteria", input.successCriteria],
        ["CONSTRAINTS", "Constraints and compatibility requirements", input.constraints],
        ["MUST_AVOID", "Explicit exclusions and negative requirements", input.mustAvoid],
    ];
    for (const [key, title, value] of expressiveSections) {
        if (value?.trim()) {
            provenance.push(key);
            sections.push(`## [${key}] ${title}\n\n${value.trim()}`);
        }
    }

    // ── [STYLE] ─────────────────────────────────────────────────────────────
    const styleLines: string[] = [];
    if (input.styleAttributes && input.styleAttributes.length > 0) {
        styleLines.push(`- **Visual attributes:** ${input.styleAttributes.join(", ")}`);
    }
    if (input.tone?.trim()) {
        styleLines.push(`- **Tone of voice:** ${input.tone.trim()}`);
    }
    if (input.primaryCta?.trim()) {
        styleLines.push(`- **Primary CTA:** ${input.primaryCta.trim()}`);
    }
    if (input.styleHint?.trim()) {
        styleLines.push(`- **Additional style notes:** ${input.styleHint.trim()}`);
    }
    if (styleLines.length > 0) {
        provenance.push("STYLE");
        sections.push(`## [STYLE] Visual attributes, tone and CTA\n\n${styleLines.join("\n")}`);
    }

    // ── [CONTACTS] ──────────────────────────────────────────────────────────
    if (input.contactInfo && input.contactInfo.length > 0) {
        provenance.push("CONTACTS");
        const contactLines = input.contactInfo
            .map((c) => `- **${c.key}:** ${c.value}`)
            .join("\n");
        sections.push(`## [CONTACTS] Contact information\n\n${contactLines}`);
    }

    // ── [ATTACHMENTS] ───────────────────────────────────────────────────────
    if (input.attachmentNames && input.attachmentNames.length > 0) {
        provenance.push("ATTACHMENTS");
        const docList = input.attachmentNames.map((name) => `- ${name}`).join("\n");
        sections.push(`## [ATTACHMENTS] Reference documents provided\n\n${docList}`);
    }

    const footer = `\n---\n*Structured brief — Guided Mode · ${siteLabel} · Sections: ${sections.length - 1}*`;
    const content = sections.join("\n\n") + footer;

    return {
        schemaVersion: "canonical-brief-v1",
        content,
        contentHash: createHash("sha256").update(content).digest("hex"),
        provenance,
        sourceFields: { ...input },
        builtAt: new Date().toISOString(),
    };
}
