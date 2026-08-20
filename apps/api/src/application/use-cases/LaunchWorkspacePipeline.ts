import type { LaunchWorkspacePipelineInput, PipelineModelLock } from "@andy-code-cat/contracts";
import type { LaunchGuidedProject } from "./LaunchGuidedProject";
import type { ResolvePipelineModelLock } from "./ResolvePipelineModelLock";
import type { PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";
import type { GenerationWorkspace } from "../../domain/entities/GenerationWorkspace";
import { buildCanonicalGenerationBrief } from "../prompting/buildCanonicalGenerationBrief";

/**
 * I12 of the SSOT program (see docs/SSOT_REFACTOR_PROGRESS.md). This is the first use case in
 * the whole program that actually calls `PipelineRunRepository.attachCanonicalBrief()` — the
 * `PipelineRun` aggregate has existed since I7 but nothing wrote a real run+brief pair until now.
 *
 * Deliberately COMPOSES rather than reimplements: `LaunchGuidedProject` (renamed from
 * `LaunchZeroEffortProject` by PR #58) still owns conversation creation, moodboard upsert and
 * workspace preparation. This use case only adds the two things Workspace entry needs on top — a
 * frozen `PipelineModelLock` (`ResolvePipelineModelLock.createRun()`) and the same canonical brief
 * envelope attached to that run for later stages (optimize/generate) to read back via
 * `pipelineRunId`.
 *
 * Named "Workspace" (not "GodMode") since 2026-08-19, matching the product-owner-approved rename
 * in PR #58 ("God Mode" -> "Workspace"); see `pipelineEntryModeSchema`'s doc comment in
 * `packages/contracts/src/pipelineRun.ts` for the full rationale.
 *
 * `LaunchWorkspacePipelineInput` is a structural superset of `GuidedLaunchInput` (same intake
 * fields plus requestedProviderId/requestedModelId/optimizationPolicy), so it can be passed
 * directly wherever a `GuidedLaunchInput` is expected.
 */
export class LaunchWorkspacePipeline {
    constructor(
        private readonly launchGuidedProject: LaunchGuidedProject,
        private readonly resolvePipelineModelLock: ResolvePipelineModelLock,
        private readonly pipelineRunRepository: PipelineRunRepository,
    ) { }

    async execute(input: {
        userId: string;
        projectId: string;
        intake: LaunchWorkspacePipelineInput;
    }): Promise<{
        pipelineRunId: string;
        conversationId: string;
        jobId: string;
        normalizedBrief: string;
        modelLock: PipelineModelLock;
        suggestedNextActions: string[];
        workspace: GenerationWorkspace;
    }> {
        const launched = await this.launchGuidedProject.execute({
            userId: input.userId,
            projectId: input.projectId,
            intake: input.intake,
        });

        const run = await this.resolvePipelineModelLock.createRun({
            projectId: input.projectId,
            ownerUserId: input.userId,
            conversationId: launched.conversationId,
            entryMode: "workspace",
            requestedProviderId: input.intake.requestedProviderId,
            requestedModelId: input.intake.requestedModelId,
            optimizationPolicy: input.intake.optimizationPolicy,
        });

        const brief = buildCanonicalGenerationBrief(input.intake);
        const finalRun = await this.pipelineRunRepository.attachCanonicalBrief(run.id, brief);

        return {
            pipelineRunId: finalRun.id,
            conversationId: launched.conversationId,
            jobId: launched.jobId,
            normalizedBrief: launched.normalizedBrief,
            modelLock: finalRun.modelLock,
            suggestedNextActions: launched.suggestedNextActions,
            workspace: launched.workspace,
        };
    }
}
