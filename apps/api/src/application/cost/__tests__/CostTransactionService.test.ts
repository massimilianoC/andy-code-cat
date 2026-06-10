import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        COST_POLICY_TEXT_EUR_PER_1K_TOKENS: 0.005,
        COST_POLICY_IMAGE_EUR_PER_ASSET: 0.1,
        COST_POLICY_VIDEO_EUR_PER_ASSET: 0.2,
        COST_POLICY_USD_TO_EUR_RATE: 0.92,
        COST_POLICY_PROVIDER_MARKUP_FACTOR: 1.1,
    },
}));

import { CostTransactionService } from "../CostTransactionService";
import { ResourceType } from "../../../domain/entities/CostTransaction";

function createService(dbRates: Record<string, unknown> | null = null) {
    const created: Array<Record<string, unknown>> = [];
    const repo = {
        create: vi.fn(async (input: Record<string, unknown>) => {
            created.push(input);
            return {
                id: "tx-1",
                createdAt: new Date(),
                ...input,
            };
        }),
    };
    const platformConfigRepo = {
        get: vi.fn(async () => (dbRates ? { costRates: dbRates } : null)),
    };

    return {
        service: new CostTransactionService(repo as any, platformConfigRepo as any),
        repo,
        created,
    };
}

function expectConsistentBreakdown(tx: Record<string, unknown>) {
    const providerCostEur = Number(tx.providerCostEur);
    const infraCostEur = Number(tx.infraCostEur);
    const platformMarkupEur = Number(tx.platformMarkupEur);
    const totalEur = Number(tx.totalEur);
    expect(Number((providerCostEur + infraCostEur + platformMarkupEur).toFixed(6))).toBe(totalEur);
}

describe("CostTransactionService", () => {
    it("computes a consistent provider-based breakdown from live rates", async () => {
        const { service, repo } = createService({
            usdToEurRate: 0.9,
            platformMarkupPct: 0.1,
            infraCostPct: 0.05,
            textEurPer1kTokens: 0.005,
            imageEurPerAsset: 0.1,
            videoEurPerAsset: 0.2,
            computeEurPerMs: 0.000001,
            storageEurPerGbMonth: 0.023,
        });

        const result = await service.recordAsync({
            userId: "user-1",
            projectId: "project-1",
            resourceType: ResourceType.LLM_CHAT,
            providerCostUsd: 10,
        });

        expect(repo.create).toHaveBeenCalledOnce();
        expect(result.providerCostEur).toBe(9);
        expect(result.infraCostEur).toBe(0.45);
        expect(result.platformMarkupEur).toBe(0.945);
        expect(result.totalEur).toBe(10.395);
        expectConsistentBreakdown(result as unknown as Record<string, unknown>);
    });

    it("preserves legacy provider-based precomputed totals while keeping the ledger row consistent", async () => {
        const { service } = createService({
            usdToEurRate: 0.9,
            platformMarkupPct: 0.1,
            infraCostPct: 0.05,
            textEurPer1kTokens: 0.005,
            imageEurPerAsset: 0.1,
            videoEurPerAsset: 0.2,
            computeEurPerMs: 0.000001,
            storageEurPerGbMonth: 0.023,
        });

        const result = await service.recordAsync({
            userId: "user-1",
            projectId: "project-1",
            resourceType: ResourceType.LLM_CHAT,
            providerCostUsd: 10,
            precomputedTotalEur: 9.9,
        });

        expect(result.providerCostEur).toBe(9);
        expect(result.infraCostEur).toBe(0.45);
        expect(result.platformMarkupEur).toBe(0.45);
        expect(result.totalEur).toBe(9.9);
        expectConsistentBreakdown(result as unknown as Record<string, unknown>);
    });

    it("treats legacy flat-rate precomputed values as base cost and computes the recorded total from policy", async () => {
        const { service } = createService({
            usdToEurRate: 0.92,
            platformMarkupPct: 0.1,
            infraCostPct: 0.05,
            textEurPer1kTokens: 0.005,
            imageEurPerAsset: 0.1,
            videoEurPerAsset: 0.2,
            computeEurPerMs: 0.000001,
            storageEurPerGbMonth: 0.023,
        });

        const result = await service.recordAsync({
            userId: "user-1",
            projectId: "project-1",
            resourceType: ResourceType.LLM_PROMPT_OPT,
            precomputedTotalEur: 5,
        });

        expect(result.providerCostEur).toBe(5);
        expect(result.infraCostEur).toBe(0.25);
        expect(result.platformMarkupEur).toBe(0.525);
        expect(result.totalEur).toBe(5.775);
        expectConsistentBreakdown(result as unknown as Record<string, unknown>);
    });

    it("applies fixed fees and per-type overrides consistently", async () => {
        const { service } = createService({
            usdToEurRate: 0.92,
            platformMarkupPct: 0.1,
            infraCostPct: 0.05,
            textEurPer1kTokens: 0.005,
            imageEurPerAsset: 0.1,
            videoEurPerAsset: 0.2,
            computeEurPerMs: 0.000001,
            storageEurPerGbMonth: 0.023,
            perType: {
                [ResourceType.IMAGE_GEN]: {
                    markupPct: 0.2,
                    infraPct: 0.1,
                    fixedFeeEur: 0.3,
                    assetRateEur: 0.5,
                },
            },
        });

        const result = await service.recordAsync({
            userId: "user-1",
            projectId: "project-1",
            resourceType: ResourceType.IMAGE_GEN,
            units: { imageCount: 2 },
        });

        expect(result.providerCostEur).toBe(1);
        expect(result.infraCostEur).toBe(0.1);
        expect(result.platformMarkupEur).toBe(0.52);
        expect(result.totalEur).toBe(1.62);
        expectConsistentBreakdown(result as unknown as Record<string, unknown>);
        expect(result.ratesSnapshot.fixedFeeEur).toBe(0.3);
    });
});
