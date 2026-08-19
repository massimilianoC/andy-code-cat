import { describe, expect, it, vi } from "vitest";
import { LaunchGodModePipeline } from "../LaunchGodModePipeline";

function makeIntake(overrides?: Partial<Record<string, unknown>>) {
    return {
        businessName: "Runner Lab",
        presetId: "landing",
        primaryGoal: "Un runner arcade completo.",
        audience: "Studenti e giocatori casual.",
        optimizationPolicy: "skip" as const,
        requestedProviderId: "siliconflow",
        requestedModelId: "MiniMaxAI/MiniMax-M2.5",
        ...overrides,
    };
}

describe("LaunchGodModePipeline", () => {
    it("composes LaunchZeroEffortProject + ResolvePipelineModelLock.createRun and attaches the canonical brief", async () => {
        const workspace = { jobId: "job-1", rootPath: "/tmp/job-1" };
        const launchZeroEffortProject = {
            execute: vi.fn(async () => ({
                conversationId: "conv-1",
                jobId: "job-1",
                normalizedBrief: "# PROJECT BRIEF — Runner Lab",
                suggestedNextActions: ["Review the brief."],
                workspace,
            })),
        };
        const draftRun = {
            id: "run-1",
            modelLock: {
                policy: "legacy",
                requested: { providerId: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", catalogRevision: "rev-1" },
                effective: { providerId: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5" },
                selectedAt: new Date().toISOString(),
                selectedBy: "user",
            },
        };
        const finalRun = { ...draftRun, canonicalBrief: { schemaVersion: "canonical-brief-v1" } };
        const resolvePipelineModelLock = {
            createRun: vi.fn(async () => draftRun),
        };
        const pipelineRunRepository = {
            attachCanonicalBrief: vi.fn(async () => finalRun),
        };

        const useCase = new LaunchGodModePipeline(
            launchZeroEffortProject as any,
            resolvePipelineModelLock as any,
            pipelineRunRepository as any,
        );

        const intake = makeIntake();
        const result = await useCase.execute({ userId: "user-1", projectId: "project-1", intake });

        expect(launchZeroEffortProject.execute).toHaveBeenCalledWith({
            userId: "user-1",
            projectId: "project-1",
            intake,
        });
        expect(resolvePipelineModelLock.createRun).toHaveBeenCalledWith({
            projectId: "project-1",
            ownerUserId: "user-1",
            conversationId: "conv-1",
            entryMode: "godmode",
            requestedProviderId: "siliconflow",
            requestedModelId: "MiniMaxAI/MiniMax-M2.5",
            optimizationPolicy: "skip",
        });
        expect(pipelineRunRepository.attachCanonicalBrief).toHaveBeenCalledWith(
            "run-1",
            expect.objectContaining({ schemaVersion: "canonical-brief-v1", content: expect.stringContaining("Runner Lab") }),
        );

        expect(result.pipelineRunId).toBe("run-1");
        expect(result.conversationId).toBe("conv-1");
        expect(result.jobId).toBe("job-1");
        expect(result.normalizedBrief).toBe("# PROJECT BRIEF — Runner Lab");
        expect(result.modelLock).toEqual(finalRun.modelLock);
        expect(result.workspace).toBe(workspace);
    });
});
