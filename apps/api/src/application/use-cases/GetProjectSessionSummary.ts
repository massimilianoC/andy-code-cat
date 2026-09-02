import type { VibeIntakeRepository } from "../../domain/repositories/VibeIntakeRepository";
import type { PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";

export interface ProjectSessionSummary {
    /** The prompt as the user typed it in Vibe. Absent for projects that never went through it. */
    userPrompt?: string;
    /** The canonical brief that drove generation, with the hash that certifies it. */
    brief?: string;
    briefContentHash?: string;
    attachments: Array<{
        assetId?: string;
        filename?: string;
        mimeType?: string;
        sizeBytes?: number;
    }>;
}

/**
 * What is worth copying out of a project, and what was attached to it.
 *
 * Exists because the dashboard's "copy prompt" copied the wrong thing: it read
 * `prePromptTemplate` from the LLM config — the *template*, identical across every project — while
 * the two things a user actually wants are their own words and the brief those words became.
 *
 * Neither was reachable before the tracing work: the Vibe prompt lived only in an HTTP request body,
 * and the dashboard fell back to a 250-character excerpt of the template cached in `localStorage`,
 * which is per-browser and disappears on another device. Both now have durable owners, so this reads
 * them rather than reconstructing anything.
 *
 * Returns what exists and says nothing about what does not: a project created directly in workspace
 * has no Vibe prompt, and that is a legitimate absence rather than a failure.
 */
export class GetProjectSessionSummary {
    constructor(
        private readonly vibeIntakeRepository: VibeIntakeRepository,
        private readonly pipelineRunRepository: PipelineRunRepository,
    ) { }

    async execute(projectId: string, userId: string): Promise<ProjectSessionSummary> {
        const [intakes, runs] = await Promise.all([
            this.vibeIntakeRepository.listByProject(projectId, userId).catch(() => []),
            this.pipelineRunRepository.listByProject(projectId, userId).catch(() => []),
        ]);

        // The most recent intake, because a user who re-prompts on the same project means the later
        // words: copying the first attempt would hand back something they already discarded.
        const intake = intakes[intakes.length - 1];
        // The most recent run that actually carries a brief. Runs without one are drafts that never
        // reached brief_build, and skipping them is what keeps this from returning an empty string
        // that looks like a brief.
        const run = [...runs].reverse().find((r) => r.canonicalBrief?.content);

        return {
            userPrompt: intake?.prompt,
            brief: run?.canonicalBrief?.content,
            briefContentHash: run?.canonicalBrief?.contentHash,
            attachments: intake?.attachments ?? [],
        };
    }
}
