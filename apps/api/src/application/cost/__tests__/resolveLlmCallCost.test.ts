import { beforeAll, describe, expect, it } from "vitest";

// config.ts validates the environment at import time and exits the process when it fails, so the
// module under test is loaded dynamically after these are in place (same pattern as
// promptTraceParity.test.ts).
process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";

type Mod = typeof import("../resolveLlmCallCost");
let readProviderCostUsd: Mod["readProviderCostUsd"];
let resolveLlmCallCost: Mod["resolveLlmCallCost"];
let toUserFacingCost: Mod["toUserFacingCost"];

beforeAll(async () => {
    ({ readProviderCostUsd, resolveLlmCallCost, toUserFacingCost } = await import("../resolveLlmCallCost"));
});

/**
 * The pricing rule, pinned in one place because it now lives in one place.
 *
 * The numbers in the OpenRouter fixtures are real: `usage.cost` 0.0000033 is what a 16-token
 * gpt-4o-mini call returned on 2026-09-07, and the string form is what compatible providers send
 * instead of a number.
 */

const USAGE = { promptTokens: 569, completionTokens: 4348, totalTokens: 4917 };

describe("readProviderCostUsd", () => {
    it("takes the provider's own number when it reports one", () => {
        expect(readProviderCostUsd({
            provider: "openrouter",
            modelId: "openai/gpt-4o-mini",
            providerUsage: { cost: 0.0000033, prompt_tokens: 14 },
            usage: USAGE,
        })).toBe(0.0000033);
    });

    it("accepts the string form some compatible providers send", () => {
        expect(readProviderCostUsd({
            provider: "openrouter",
            modelId: "x/y",
            providerUsage: { cost: "0.0421" },
            usage: USAGE,
        })).toBeCloseTo(0.0421, 6);
    });

    it("returns undefined, not zero, when nothing can price the call", () => {
        // Zero is a claim that the call was free, and the ledger would record that claim as fact.
        expect(readProviderCostUsd({
            provider: "lmstudio",
            modelId: "local/model",
            providerUsage: { prompt_tokens: 10 },
            usage: USAGE,
        })).toBeUndefined();
    });

    it("prefers an explicitly supplied figure over everything else", () => {
        // The streaming path accumulates cost from SSE chunks and has no final usage object.
        expect(readProviderCostUsd({
            provider: "openrouter",
            modelId: "x/y",
            providerUsage: { cost: 999 },
            usage: USAGE,
            explicitCostUsd: 0.5,
        })).toBe(0.5);
    });

    it("ignores a non-finite cost rather than poisoning the ledger with NaN", () => {
        expect(readProviderCostUsd({
            provider: "openrouter",
            modelId: "x/y",
            providerUsage: { cost: Number.NaN },
            usage: USAGE,
        })).toBeUndefined();
        expect(readProviderCostUsd({
            provider: "openrouter",
            modelId: "x/y",
            providerUsage: { cost: "not a number" },
            usage: USAGE,
        })).toBeUndefined();
    });
});

describe("resolveLlmCallCost", () => {
    it("marks a measured cost as provider-sourced", () => {
        const cost = resolveLlmCallCost({
            provider: "openrouter",
            modelId: "z-ai/glm-5.3",
            providerUsage: { cost: 0.02 },
            usage: USAGE,
        });
        expect(cost.providerCostUsd).toBe(0.02);
        expect(cost.estimate.source).toBe("provider");
        expect(cost.estimate.currency).toBe("EUR");
        expect(cost.estimate.amount).toBeGreaterThan(0);
    });

    it("falls back to the flat rate and says so", () => {
        // The distinction is the whole point: a reader must be able to tell a measured cost from
        // a guessed one, and before this the didactic path recorded guesses as if measured.
        const cost = resolveLlmCallCost({
            provider: "lmstudio",
            modelId: "local/model",
            providerUsage: {},
            usage: USAGE,
        });
        expect(cost.providerCostUsd).toBeUndefined();
        expect(cost.estimate.source).toBe("flat-rate");
        expect(cost.estimate.amount).toBeGreaterThan(0);
    });
});

describe("toUserFacingCost", () => {
    it("never reports zero for a call that was actually priced", () => {
        // The regression this exists for: the didactic panel returned
        // { providerCostEur: 0, totalEur: 0 } unconditionally, on the product's most expensive call.
        const shown = toUserFacingCost(resolveLlmCallCost({
            provider: "openrouter",
            modelId: "z-ai/glm-5.3",
            providerUsage: { cost: 0.0512 },
            usage: USAGE,
        }));
        expect(shown.providerCostEur).toBeGreaterThan(0);
        expect(shown.totalEur).toBeGreaterThan(0);
    });

    it("still reports the platform total when the provider gave no figure", () => {
        const shown = toUserFacingCost(resolveLlmCallCost({
            provider: "lmstudio",
            modelId: "local/model",
            providerUsage: {},
            usage: USAGE,
        }));
        expect(shown.providerCostEur).toBe(0);
        expect(shown.totalEur).toBeGreaterThan(0);
    });
});
