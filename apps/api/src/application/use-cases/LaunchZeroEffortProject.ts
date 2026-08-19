import { randomUUID } from "crypto";
import type { ZeroEffortLaunchInput } from "@andy-code-cat/contracts";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import { PrepareGenerationWorkspace } from "./PrepareGenerationWorkspace";
import type { GenerationWorkspace } from "../../domain/entities/GenerationWorkspace";
import { buildCanonicalGenerationBrief } from "../prompting/buildCanonicalGenerationBrief";

/**
 * Thin string accessor kept for existing callers/tests that only need the brief text.
 * The actual brief-building logic lives in `buildCanonicalGenerationBrief` (I9 of the SSOT
 * program) — see that module's doc comment for why this used to be duplicated client-side.
 */
export function buildNormalizedBrief(input: ZeroEffortLaunchInput): string {
    return buildCanonicalGenerationBrief(input).content;
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
