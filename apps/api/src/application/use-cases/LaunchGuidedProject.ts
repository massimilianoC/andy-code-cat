import { randomUUID } from "crypto";
import type { GuidedLaunchInput } from "@andy-code-cat/contracts";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import { PrepareGenerationWorkspace } from "./PrepareGenerationWorkspace";
import type { GenerationWorkspace } from "../../domain/entities/GenerationWorkspace";
import { PRESET_MAP } from "../../domain/entities/ProjectPreset";

function presetLabel(presetId: string): string {
    const preset = PRESET_MAP.get(presetId);
    return preset?.labelEn ?? preset?.label ?? presetId;
}

export function buildNormalizedBrief(input: GuidedLaunchInput): string {
    const siteLabel = presetLabel(input.presetId);
    const outputLanguage = (input as { outputLanguage?: string }).outputLanguage ?? "en";
    const sections: string[] = [];

    // ── [IDENTITY] ──────────────────────────────────────────────────────────
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
        sections.push(
            `## [SOURCE_REQUEST] Original user request — authoritative\n\n` +
            `${sourceRequest}\n\n` +
            `> Preserve every explicit fact, preference, requirement and prohibition above. ` +
            `Later sections are additive clarification only; on conflict, this source request wins.`,
        );
    }

    // ── [GOAL] ──────────────────────────────────────────────────────────────
    if (input.primaryGoal?.trim()) {
        sections.push(
            `## [GOAL] Description and primary objective\n\n` +
            input.primaryGoal.trim(),
        );
    }

    // ── [AUDIENCE] ──────────────────────────────────────────────────────────
    if (input.audience?.trim()) {
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
        if (value?.trim()) sections.push(`## [${key}] ${title}\n\n${value.trim()}`);
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
        sections.push(`## [STYLE] Visual attributes, tone and CTA\n\n${styleLines.join("\n")}`);
    }

    // ── [CONTACTS] ──────────────────────────────────────────────────────────
    if (input.contactInfo && input.contactInfo.length > 0) {
        const contactLines = input.contactInfo
            .map((c) => `- **${c.key}:** ${c.value}`)
            .join("\n");
        sections.push(`## [CONTACTS] Contact information\n\n${contactLines}`);
    }

    const footer = `\n---\n*Structured brief — Guided Mode · ${siteLabel} · Sections: ${sections.length - 1}*`;
    return sections.join("\n\n") + footer;
}

function buildStyleNotes(input: GuidedLaunchInput): string | undefined {
    const parts = [
        input.tone ? `Tone: ${input.tone}` : undefined,
        input.primaryCta ? `CTA: ${input.primaryCta}` : undefined,
        input.styleHint ? `Style: ${input.styleHint}` : undefined,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(" • ") : undefined;
}

export class LaunchGuidedProject {
    constructor(
        private readonly moodboardRepository: ProjectMoodboardRepository,
        private readonly conversationRepository: ConversationRepository,
        private readonly prepareGenerationWorkspace: PrepareGenerationWorkspace,
    ) { }

    async execute(input: {
        userId: string;
        projectId: string;
        intake: GuidedLaunchInput;
    }): Promise<{
        conversationId: string;
        jobId: string;
        normalizedBrief: string;
        suggestedNextActions: string[];
        workspace: GenerationWorkspace;
    }> {
        const normalizedBrief = buildNormalizedBrief(input.intake);
        const styleNotes = buildStyleNotes(input.intake);

        await this.moodboardRepository.upsert(input.projectId, input.userId, {
            inheritFromUser: true,
            projectBrief: normalizedBrief,
            targetBusiness: `${input.intake.businessName} — ${input.intake.audience}`,
            ...(styleNotes ? { styleNotes } : {}),
        });

        const conversation = await this.conversationRepository.create({
            projectId: input.projectId,
            userId: input.userId,
            title: `Guided Mode · ${input.intake.businessName}`,
            firstMessage: {
                role: "user",
                content: normalizedBrief,
            },
        });

        const jobId = randomUUID();
        const workspace = await this.prepareGenerationWorkspace.execute({
            userId: input.userId,
            projectId: input.projectId,
            jobId,
            conversationId: conversation.id,
        });

        return {
            conversationId: conversation.id,
            jobId,
            normalizedBrief,
            suggestedNextActions: [
                "Review the generated brief in Guided Mode if you want deeper control.",
                "Start the next automated generation stage from the prepared workspace.",
                "Add visual assets or a logo to improve the first output.",
            ],
            workspace,
        };
    }
}
