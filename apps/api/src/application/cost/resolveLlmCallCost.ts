/**
 * The one costing model for an LLM call.
 *
 * Costing a completion has always been three steps, in this order:
 *
 *   1. take the provider's own number when it gives one (`usage.cost`, USD);
 *   2. otherwise compute it from the per-model price table, which today only SiliconFlow needs
 *      because it is the only configured provider that does not report cost;
 *   3. hand both the tokens and that USD figure to `estimateCost`, which converts, applies markup,
 *      and marks the result `source: "provider"` or `source: "flat-rate"` so a reader can tell a
 *      measured cost from a guessed one.
 *
 * Those three steps were written out by hand at six call sites — `llmRoutes` twice,
 * `OptimizeImagePrompt`, `SuggestProjectImageIdea`, and the two didactic use cases, which skipped
 * steps 1 and 2 entirely and therefore billed every didactic generation at the flat rate while
 * recording a provider cost of zero. Six copies of a pricing rule is six places to fix a pricing
 * rule, and the one that was never fixed is the expensive one (AGENTS.md, Rule Zero).
 *
 * This module owns the rule. Call sites supply what they observed; they do not decide how it prices.
 */

import { env } from "../../config";
import { estimateCost, type CostEstimate, type LlmCapability } from "../llm/costPolicy";
import { getSiliconFlowPrice } from "../llm/siliconflowPricing";

export interface LlmTokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface ReadProviderCostInput {
    provider: string;
    modelId: string;
    /** The provider's `usage` object exactly as returned; `usage.cost` is read from it if present. */
    providerUsage?: unknown;
    usage: LlmTokenUsage;
    /**
     * A cost already extracted by the caller — the streaming path accumulates it from SSE chunks,
     * where there is no final `usage` object to read. Wins over everything below when present.
     */
    explicitCostUsd?: number;
}

/** The policy is read once, here, so no call site can quietly diverge on a rate. */
function policy() {
    return {
        textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
        imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
        videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
        usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
        providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
    };
}

/**
 * Step 1 and 2: what the call actually cost the provider, in USD, or `undefined` when nothing
 * can say. `undefined` is not zero — zero would claim the call was free, and the ledger would
 * record that claim.
 */
export function readProviderCostUsd(input: ReadProviderCostInput): number | undefined {
    if (typeof input.explicitCostUsd === "number" && Number.isFinite(input.explicitCostUsd)) {
        return input.explicitCostUsd;
    }

    // OpenRouter reports `usage.cost` in USD; some compatible providers send it as a string.
    const raw = (input.providerUsage as { cost?: unknown } | undefined)?.cost;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
        const parsed = parseFloat(raw);
        if (!Number.isNaN(parsed)) return parsed;
    }

    // SiliconFlow does not return cost at all, so it is priced from the per-model table.
    if (input.provider === "siliconflow") {
        const price = getSiliconFlowPrice(input.modelId);
        if (price && price.priceUnit === "per_m_tokens") {
            return (input.usage.promptTokens / 1_000_000) * price.input
                + (input.usage.completionTokens / 1_000_000) * price.output;
        }
    }

    return undefined;
}

export interface LlmCallCost {
    /** Undefined when neither the provider nor the price table could say. */
    providerCostUsd?: number;
    estimate: CostEstimate;
}

/**
 * All three steps. The result carries both figures because the ledger needs both: `providerCostUsd`
 * is what a third party charged, `estimate.amount` is what this platform records in EUR, and
 * `estimate.source` says which of the two the second one was derived from.
 */
export function resolveLlmCallCost(
    input: ReadProviderCostInput & { capability?: LlmCapability },
): LlmCallCost {
    const providerCostUsd = readProviderCostUsd(input);
    return {
        providerCostUsd,
        estimate: estimateCost(
            { capability: input.capability ?? "chat", tokenUsage: input.usage, providerCostUsd },
            policy(),
        ),
    };
}

/**
 * The EUR figure a user should be shown for a call, alongside the platform total.
 *
 * `providerCostEur` is the third-party charge converted at the configured rate — the same
 * conversion `CostTransactionService` performs when it writes the ledger row, so the number the UI
 * shows and the number the ledger stores cannot disagree.
 */
export function toUserFacingCost(cost: LlmCallCost): { providerCostEur: number; totalEur: number } {
    const rate = env.COST_POLICY_USD_TO_EUR_RATE ?? 0.92;
    return {
        providerCostEur: Number(((cost.providerCostUsd ?? 0) * rate).toFixed(6)),
        totalEur: cost.estimate.amount,
    };
}
