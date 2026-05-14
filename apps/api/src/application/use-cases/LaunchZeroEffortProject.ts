import { randomUUID } from "crypto";
import type { ZeroEffortLaunchInput } from "@andy-code-cat/contracts";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import { PrepareGenerationWorkspace } from "./PrepareGenerationWorkspace";
import type { GenerationWorkspace } from "../../domain/entities/GenerationWorkspace";

function siteTypeLabel(siteType: ZeroEffortLaunchInput["siteType"]): string {
    switch (siteType) {
        case "portfolio":
            return "portfolio site";
        case "showcase":
            return "showcase site";
        case "business_site":
            return "business website";
        case "landing_page":
        default:
            return "landing page";
    }
}

function buildNormalizedBrief(input: ZeroEffortLaunchInput): string {
    const siteLabel = siteTypeLabel(input.siteType);
    const sections: string[] = [];

    // ── [IDENTITÀ] ──────────────────────────────────────────────────────────
    sections.push(
        `# BRIEF DI PROGETTO — ${input.businessName}\n\n` +
        `## [IDENTITÀ] Brand e tipo sito\n` +
        `- **Brand:** ${input.businessName}\n` +
        `- **Tipo sito:** ${siteLabel}`,
    );

    // ── [OBIETTIVO] ─────────────────────────────────────────────────────────
    if (input.primaryGoal?.trim()) {
        sections.push(
            `## [OBIETTIVO] Descrizione e obiettivo principale\n\n` +
            input.primaryGoal.trim(),
        );
    }

    // ── [AUDIENCE] ──────────────────────────────────────────────────────────
    if (input.audience?.trim()) {
        sections.push(
            `## [AUDIENCE] Target e pubblico di riferimento\n\n` +
            input.audience.trim(),
        );
    }

    // ── [STILE] ─────────────────────────────────────────────────────────────
    const styleLines: string[] = [];
    if (input.styleAttributes && input.styleAttributes.length > 0) {
        styleLines.push(`- **Attributi visivi:** ${input.styleAttributes.join(", ")}`);
    }
    if (input.tone?.trim()) {
        styleLines.push(`- **Tono di voce:** ${input.tone.trim()}`);
    }
    if (input.primaryCta?.trim()) {
        styleLines.push(`- **CTA principale:** ${input.primaryCta.trim()}`);
    }
    if (input.styleHint?.trim()) {
        styleLines.push(`- **Note stilistiche aggiuntive:** ${input.styleHint.trim()}`);
    }
    if (styleLines.length > 0) {
        sections.push(`## [STILE] Attributi visivi, tono e CTA\n\n${styleLines.join("\n")}`);
    }

    // ── [CONTATTI] ──────────────────────────────────────────────────────────
    if (input.contactInfo && input.contactInfo.length > 0) {
        const contactLines = input.contactInfo
            .map((c) => `- **${c.key}:** ${c.value}`)
            .join("\n");
        sections.push(`## [CONTATTI] Informazioni di contatto e dati salienti\n\n${contactLines}`);
    }

    const footer = `\n---\n*Brief strutturato Guided Mode · ${siteLabel} · Sezioni: ${sections.length - 1}*`;
    return sections.join("\n\n") + footer;
}

function buildStyleNotes(input: ZeroEffortLaunchInput): string | undefined {
    const parts = [
        input.tone ? `Tone: ${input.tone}` : undefined,
        input.primaryCta ? `CTA: ${input.primaryCta}` : undefined,
        input.styleHint ? `Style: ${input.styleHint}` : undefined,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(" • ") : undefined;
}

export class LaunchZeroEffortProject {
    constructor(
        private readonly moodboardRepository: ProjectMoodboardRepository,
        private readonly conversationRepository: ConversationRepository,
        private readonly prepareGenerationWorkspace: PrepareGenerationWorkspace,
    ) { }

    async execute(input: {
        userId: string;
        projectId: string;
        intake: ZeroEffortLaunchInput;
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
