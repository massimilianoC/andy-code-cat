/**
 * Intent tests for model governance.
 *
 * There was already a lot of coverage here — 18 characterization tests on
 * `resolveModelSelection`, 15 on `ResolvePipelineModelLock` — and three real defects still
 * shipped. This file exists because of WHY they got through, and it is deliberately written
 * in a different register from its neighbours.
 *
 *  - `modelSelection.characterization.test.ts` says of itself that it "pins TODAY's exact
 *    outputs" and "must never be fixed to change a row's expected output". It was doing its
 *    job perfectly while pinning the substitution bug in place. A characterization test
 *    cannot catch a defect it was written to describe.
 *  - `ResolvePipelineModelLock.test.ts` covers `dispatch()` thoroughly, including "blocks the
 *    run when the locked model has since been deactivated" — and covers `createRun()` with
 *    exactly two cases, both of which hand it a model that IS in the catalog. The entrance
 *    was never tested with the input that broke it.
 *  - `markAvailability()` — which silently un-approved operator-activated models on every
 *    unstable discovery poll — had no test at all.
 *
 * So these assert the PROMISE, in the words the promise is made in, not the mechanism:
 *
 *   1. A model is usable because an operator said so. Nothing else may decide that.
 *   2. A model the user picked is used, or the request is refused. It is never swapped.
 *   3. Discovery reports what a provider offers. It does not grant or revoke permission.
 *
 * If a future change makes one of these fail, the change is wrong — or the promise has been
 * renegotiated with the operator and this file gets rewritten first, on purpose.
 */

import { describe, expect, it, vi } from "vitest";
import { MODEL_NOT_AVAILABLE } from "@andy-code-cat/contracts";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";
import type { PipelineRun } from "../../../domain/entities/PipelineRun";
import type { NewPipelineRun, PipelineRunRepository } from "../../../domain/repositories/PipelineRunRepository";
import { ResolvePipelineModelLock } from "../ResolvePipelineModelLock";
import { resolveModelSelection } from "../../llm/modelSelection";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function model(id: string, isActive: boolean, isDefault = false) {
    return {
        id,
        provider: "siliconflow",
        role: "dialogue" as const,
        capabilities: ["chat"],
        isDefault,
        isFallback: false,
        isActive,
    };
}

/**
 * The catalog as it actually stood when the defect was reported: Kimi-K3 present but not
 * approved, DeepSeek-V4-Pro-0813 approved, and a default the cascade would otherwise reach for.
 */
function catalogAsReported(): LlmProviderCatalog {
    return {
        provider: "siliconflow",
        baseUrl: "https://llm.test/v1",
        apiType: "openai-compatible",
        authType: "none",
        isActive: true,
        models: [
            model("MiniMaxAI/MiniMax-M3", true, true),
            model("deepseek-ai/DeepSeek-V4-Pro-0813", true),
            model("moonshotai/Kimi-K3", false),
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

function fakeGetLlmCatalog(providers: LlmProviderCatalog[]) {
    return {
        execute: vi.fn(async () => ({
            source: "env" as const,
            providers,
            activeProvider: providers[0]?.provider ?? "siliconflow",
        })),
    };
}

class InMemoryPipelineRunRepository implements PipelineRunRepository {
    runs = new Map<string, PipelineRun>();
    private seq = 0;

    async create(run: NewPipelineRun): Promise<PipelineRun> {
        const id = `run-${++this.seq}`;
        const now = new Date();
        const entity: PipelineRun = { id, status: "draft", stages: [], createdAt: now, updatedAt: now, ...run };
        this.runs.set(id, entity);
        return entity;
    }
    async findByIdForUser(id: string, userId: string): Promise<PipelineRun | null> {
        const run = this.runs.get(id);
        return run && run.ownerUserId === userId ? run : null;
    }
    async listByProject(): Promise<PipelineRun[]> { return [...this.runs.values()]; }

    // Not exercised here — these tests never get past createRun — but the interface is the
    // contract, and a stub that lies about implementing it is a test that compiles by luck.
    async appendStage(): Promise<PipelineRun> { throw new Error("not used by these tests"); }
    async setStatus(): Promise<PipelineRun> { throw new Error("not used by these tests"); }
    async attachCanonicalBrief(): Promise<PipelineRun> { throw new Error("not used by these tests"); }
}

function subject(providers: LlmProviderCatalog[]) {
    const repository = new InMemoryPipelineRunRepository();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useCase = new ResolvePipelineModelLock(repository, fakeGetLlmCatalog(providers) as any);
    return { repository, useCase };
}

const baseRun = {
    projectId: "project-1",
    ownerUserId: "user-1",
    conversationId: "conv-1",
    entryMode: "vibe" as const,
    optimizationPolicy: "skip" as const,
};

// ── Promise 2: used, or refused — never swapped ───────────────────────────────

describe("a model the user picked is used, or the request is refused", () => {
    it("freezes the exact model the user chose when the operator has approved it", async () => {
        const { useCase } = subject([catalogAsReported()]);

        const run = await useCase.createRun({
            ...baseRun,
            requestedProviderId: "siliconflow",
            requestedModelId: "deepseek-ai/DeepSeek-V4-Pro-0813",
        });

        expect(run.modelLock.effective.modelId).toBe("deepseek-ai/DeepSeek-V4-Pro-0813");
        expect(run.modelLock.requested.modelId).toBe("deepseek-ai/DeepSeek-V4-Pro-0813");
        expect(run.modelLock.selectedBy).toBe("user");
    });

    it("refuses an unapproved choice instead of quietly running a different model", async () => {
        // This is the reported defect, verbatim: the operator selected Kimi-K3 and the whole
        // pipeline ran on DeepSeek-V4-Pro-0813, with the lock recording selectedBy "user".
        const { useCase, repository } = subject([catalogAsReported()]);

        await expect(useCase.createRun({
            ...baseRun,
            requestedProviderId: "siliconflow",
            requestedModelId: "moonshotai/Kimi-K3",
        })).rejects.toMatchObject({
            statusCode: 409,
            code: MODEL_NOT_AVAILABLE,
        });

        // And nothing was written: a refused request must not leave a run frozen on a
        // substitute that later stages would faithfully honour.
        expect(repository.runs.size).toBe(0);
    });

    it("names the model that was refused, so the client can re-sync and tell the user", async () => {
        const { useCase } = subject([catalogAsReported()]);

        await expect(useCase.createRun({
            ...baseRun,
            requestedProviderId: "siliconflow",
            requestedModelId: "moonshotai/Kimi-K3",
        })).rejects.toMatchObject({
            details: { requestedProvider: "siliconflow", requestedModel: "moonshotai/Kimi-K3" },
        });
    });

    it("refuses a provider that is switched off, not just a model", async () => {
        const offline = { ...catalogAsReported(), isActive: false };
        const { useCase } = subject([offline]);

        await expect(useCase.createRun({
            ...baseRun,
            requestedProviderId: "siliconflow",
            requestedModelId: "MiniMaxAI/MiniMax-M3",
        })).rejects.toMatchObject({ code: MODEL_NOT_AVAILABLE });
    });

    it("still cascades freely when nobody asked for anything", async () => {
        // The refusal must not turn unattended runs into failures: with no user choice there is
        // no promise to keep, and the catalog proposes as it always did.
        const { useCase } = subject([catalogAsReported()]);

        const run = await useCase.createRun(baseRun);

        expect(run.modelLock.selectedBy).toBe("catalog-proposal");
        expect(run.modelLock.effective.modelId).toBe("MiniMaxAI/MiniMax-M3");
    });
});

// ── Promise 1: approval is the operator's alone ───────────────────────────────

describe("only an operator decides whether a model may be used", () => {
    it("does not offer a model the operator has not approved, however healthy it looks", () => {
        const decision = resolveModelSelection({
            profile: "vibe-cascade",
            activeProviders: [catalogAsReported()],
            requestedProvider: "siliconflow",
            requestedModel: "moonshotai/Kimi-K3",
            fallbackProvider: "siliconflow",
            hardcodedFallbackModel: "MiniMaxAI/MiniMax-M3",
            requireOverrideInCatalog: true,
            gateOverrideOnOpenAiCompatible: false,
            policy: "strict",
        });

        expect(decision.blocked).toBeTruthy();
        expect(decision.honoredRequest).toBe(false);
    });

    it("honours approval without asking anything else of the model", () => {
        const decision = resolveModelSelection({
            profile: "vibe-cascade",
            activeProviders: [catalogAsReported()],
            requestedProvider: "siliconflow",
            requestedModel: "deepseek-ai/DeepSeek-V4-Pro-0813",
            fallbackProvider: "siliconflow",
            hardcodedFallbackModel: "MiniMaxAI/MiniMax-M3",
            requireOverrideInCatalog: true,
            gateOverrideOnOpenAiCompatible: false,
            policy: "strict",
        });

        expect(decision.blocked).toBeFalsy();
        expect(decision.effective.model).toBe("deepseek-ai/DeepSeek-V4-Pro-0813");
    });
});
