/**
 * CostTransactionService — fire-and-forget singleton for cost ledger writes.
 *
 * Usage (non-blocking):
 *   CostTransactionService.instance.record({ userId, projectId, resourceType, ... });
 *
 * `record()` never throws — errors are swallowed after console.error so callers
 * on the critical path (LLM routes, image routes) are never blocked by a ledger side-effect.
 *
 * Rate computation reads live PlatformConfig.costRates from DB (5-minute TTL cache),
 * falling back to env-var defaults when the DB is unavailable or no rates are configured.
 *
 * Per-type policies (PlatformCostRates.perType) override global rates for specific
 * ResourceType values, enabling fine-grained markup / infra / fixed-fee tuning
 * per transaction category.  Call invalidateRatesCache() after a PATCH /admin/cost/rates
 * to ensure the updated rates are applied immediately.
 */

import { randomUUID } from "crypto";
import { env } from "../../config";
import { MongoCostTransactionRepository } from "../../infra/repositories/MongoCostTransactionRepository";
import { MongoPlatformConfigRepository } from "../../infra/repositories/MongoPlatformConfigRepository";
import type { ICostTransactionRepository } from "../../domain/repositories/ICostTransactionRepository";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { CostTransaction, CostSourceRef, CostUnits, ResourceType, CostRatesSnapshot } from "../../domain/entities/CostTransaction";
import type { PlatformCostRates, ResourceTypeCostPolicy } from "../../domain/entities/PlatformConfig";

export interface RecordCostInput {
    userId: string;
    projectId: string;
    resourceType: ResourceType;
    /** e.g. model id, image size, task key */
    resourceSubtype?: string;
    /** USD charged by third-party provider (0 or undefined if local/internal) */
    providerCostUsd?: number;
    /** Pre-computed EUR total from estimateCost() — skips recomputation when provided */
    precomputedTotalEur?: number;
    units?: CostUnits;
    sourceRef?: CostSourceRef;
    meta?: Record<string, unknown>;
}

function generateTxId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    return `TX-${date}-${suffix}`;
}

/**
 * Resolve effective rates for a specific resource type.
 * Priority: per-type DB override > global DB rates > env-var defaults.
 */
function resolveRates(
    dbRates: PlatformCostRates | null,
    resourceType: string,
): {
    usdToEurRate: number;
    markupPct: number;
    infraPct: number;
    fixedFeeEur: number;
    textEurPer1kTokens: number;
    imageEurPerAsset: number;
    videoEurPerAsset: number;
} {
    // Global defaults: DB overrides env vars
    const usdToEurRate = dbRates?.usdToEurRate ?? env.COST_POLICY_USD_TO_EUR_RATE ?? 0.92;
    const markupFactor = env.COST_POLICY_PROVIDER_MARKUP_FACTOR ?? 1.1;
    const globalMarkupPct = dbRates?.platformMarkupPct ?? (markupFactor > 1 ? markupFactor - 1 : 0.1);
    const globalInfraPct = dbRates?.infraCostPct ?? 0.05;
    const globalTextRate = dbRates?.textEurPer1kTokens ?? env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS ?? 0.005;
    const globalImageRate = dbRates?.imageEurPerAsset ?? env.COST_POLICY_IMAGE_EUR_PER_ASSET ?? 0.1;
    const globalVideoRate = dbRates?.videoEurPerAsset ?? env.COST_POLICY_VIDEO_EUR_PER_ASSET ?? 0.2;

    // Per-type overrides
    const typePolicy = dbRates?.perType?.[resourceType] as ResourceTypeCostPolicy | undefined;

    return {
        usdToEurRate,
        markupPct:           typePolicy?.markupPct        ?? globalMarkupPct,
        infraPct:            typePolicy?.infraPct         ?? globalInfraPct,
        fixedFeeEur:         typePolicy?.fixedFeeEur      ?? 0,
        textEurPer1kTokens:  typePolicy?.tokenRateEurPer1k ?? globalTextRate,
        // For image / video types assetRateEur overrides the respective global rate
        imageEurPerAsset:    typePolicy?.assetRateEur     ?? globalImageRate,
        videoEurPerAsset:    typePolicy?.assetRateEur     ?? globalVideoRate,
    };
}

function computeBreakdown(
    input: RecordCostInput,
    dbRates: PlatformCostRates | null,
): {
    providerCostEur: number;
    infraCostEur: number;
    platformMarkupEur: number;
    totalEur: number;
    ratesSnapshot: CostRatesSnapshot;
} {
    const rates = resolveRates(dbRates, input.resourceType);
    const fixedFeeEur = Number(rates.fixedFeeEur.toFixed(6));

    const ratesSnapshot: CostRatesSnapshot = {
        usdToEurRate:        rates.usdToEurRate,
        platformMarkupPct:   rates.markupPct,
        infraCostPct:        rates.infraPct,
        fixedFeeEur,
        textEurPer1kTokens:  rates.textEurPer1kTokens,
        imageEurPerAsset:    rates.imageEurPerAsset,
        videoEurPerAsset:    rates.videoEurPerAsset,
    };

    const providerCostEur = Number(((input.providerCostUsd ?? 0) * rates.usdToEurRate).toFixed(6));

    // Legacy compatibility: some call sites still pass a precomputed total from estimateCost().
    // Preserve those totals when they are provider-based, but back-fill the component fields so
    // the persisted ledger row remains internally consistent.
    if (input.precomputedTotalEur !== undefined && input.precomputedTotalEur > 0) {
        if (providerCostEur > 0) {
            const infraCostEur = Number((providerCostEur * rates.infraPct).toFixed(6));
            const totalEur = Number((input.precomputedTotalEur + fixedFeeEur).toFixed(6));
            const platformMarkupEur = Number((totalEur - providerCostEur - infraCostEur).toFixed(6));
            return { providerCostEur, infraCostEur, platformMarkupEur, totalEur, ratesSnapshot };
        }

        const baseCostEur = Number(input.precomputedTotalEur.toFixed(6));
        const derivedProviderCostEur = baseCostEur;
        const infraCostEur = Number((baseCostEur * rates.infraPct).toFixed(6));
        const platformMarkupEur = Number((((baseCostEur + infraCostEur) * rates.markupPct) + fixedFeeEur).toFixed(6));
        const totalEur = Number((baseCostEur + infraCostEur + platformMarkupEur).toFixed(6));
        return { providerCostEur: derivedProviderCostEur, infraCostEur, platformMarkupEur, totalEur, ratesSnapshot };
    }

    // Compute from scratch
    let baseCostEur = providerCostEur;

    if (baseCostEur === 0) {
        // Flat-rate fallback from units
        const tokens = input.units?.totalTokens ?? 0;
        const images = input.units?.imageCount ?? 0;
        const videoSec = input.units?.videoSeconds ?? 0;
        baseCostEur = Number((
            (tokens / 1000) * rates.textEurPer1kTokens +
            images * rates.imageEurPerAsset +
            (videoSec / 60) * rates.videoEurPerAsset
        ).toFixed(6));
    }

    const resolvedProviderCostEur = providerCostEur > 0 ? providerCostEur : baseCostEur;
    const infraCostEur = Number((baseCostEur * rates.infraPct).toFixed(6));
    const platformMarkupEur = Number((((baseCostEur + infraCostEur) * rates.markupPct) + fixedFeeEur).toFixed(6));
    const totalEur = Number((baseCostEur + infraCostEur + platformMarkupEur).toFixed(6));

    return { providerCostEur: resolvedProviderCostEur, infraCostEur, platformMarkupEur, totalEur, ratesSnapshot };
}

export class CostTransactionService {
    private static _instance: CostTransactionService | null = null;

    private _cachedRates: PlatformCostRates | null = null;
    private _ratesCachedAt = 0;
    private readonly RATES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    /** Lazily-initialised singleton. */
    static get instance(): CostTransactionService {
        if (!CostTransactionService._instance) {
            CostTransactionService._instance = new CostTransactionService(
                new MongoCostTransactionRepository(),
                new MongoPlatformConfigRepository(),
            );
        }
        return CostTransactionService._instance;
    }

    constructor(
        private readonly repo: ICostTransactionRepository,
        private readonly platformConfigRepo: PlatformConfigRepository,
    ) { }

    /**
     * Force a cache refresh on the next record() call.
     * Call after PATCH /admin/cost/rates to ensure updated rates are applied immediately.
     */
    invalidateRatesCache(): void {
        this._ratesCachedAt = 0;
    }

    /**
     * Fire-and-forget cost ledger write.
     * Returns void so callers cannot accidentally await it and block the request cycle.
     */
    record(input: RecordCostInput): void {
        this._recordAsync(input).catch((err: unknown) => {
            console.error("[CostTransactionService] Failed to persist cost transaction:", err);
        });
    }

    /**
     * Awaitable version — use in tests or admin batch scripts.
     */
    async recordAsync(input: RecordCostInput): Promise<CostTransaction> {
        return this._recordAsync(input);
    }

    private async _getRates(): Promise<PlatformCostRates | null> {
        const now = Date.now();
        // Return cached rates if still fresh
        if (this._cachedRates && now - this._ratesCachedAt < this.RATES_CACHE_TTL_MS) {
            return this._cachedRates;
        }
        // Refresh from DB; silently fall back to whatever is cached (or null → env-var defaults)
        try {
            const config = await this.platformConfigRepo.get();
            if (config?.costRates) {
                this._cachedRates = config.costRates;
                this._ratesCachedAt = Date.now();
            }
        } catch {
            // non-fatal — env-var defaults are used
        }
        return this._cachedRates;
    }

    private async _recordAsync(input: RecordCostInput): Promise<CostTransaction> {
        const dbRates = await this._getRates();
        const { providerCostEur, infraCostEur, platformMarkupEur, totalEur, ratesSnapshot } = computeBreakdown(input, dbRates);

        return this.repo.create({
            txId: generateTxId(),
            userId: input.userId,
            projectId: input.projectId,
            resourceType: input.resourceType,
            resourceSubtype: input.resourceSubtype,
            providerCostUsd: input.providerCostUsd ?? 0,
            providerCostEur,
            infraCostEur,
            platformMarkupEur,
            totalEur,
            ratesSnapshot,
            units: input.units ?? {},
            sourceRef: input.sourceRef ?? {},
            meta: input.meta ?? {},
            status: "settled",
        });
    }
}
