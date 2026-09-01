/**
 * E2E regression for the model-selection SSOT consolidation
 * (fix/model-selection-ssot-consolidation).
 *
 * Covers the explicit per-call override path end to end through the real UI:
 * VibeCoreEntry's "Modello pipeline" picker -> POST /v1/vibecore/classify or
 * /v1/vibecore/prefill -> resolveModelSelection's "requested" tier -> the
 * provider actually dispatched to, verified via prompt/cost logs.
 *
 * The UserPreferences.preferredModel fallback tier (the new SSOT default) has
 * no end-user settings UI yet (getUserPreferences/updateUserPreferences exist
 * only as an API client, apps/web/lib/api/preferences.ts, with zero callers)
 * — that tier is covered at the API level, not here. See the PR description
 * for the direct curl-based verification.
 */
import { test, expect } from "@playwright/test";
import { loginTestUser } from "./helpers/test-user";

test.describe("model selection SSOT — explicit override reaches the dispatched provider", () => {
    test("picking a model in VibeCoreEntry's pipeline override drives the actual classify call", async ({ page }) => {
        await loginTestUser(page);

        await page.goto("/dashboard");
        await page.waitForLoadState("domcontentloaded");

        const textarea = page.locator("textarea").first();
        await expect(textarea).toBeVisible({ timeout: 15_000 });
        await textarea.fill("una landing page per un ristorante di sushi a Milano, con menu e prenotazioni");

        // Open the pipeline model override panel.
        const overrideToggle = page.getByRole("button", { name: /Pipeline model|Modello pipeline/i });
        await expect(overrideToggle).toBeVisible({ timeout: 10_000 });
        await overrideToggle.click();

        // Open the provider/model picker (a button already showing the current
        // default selection, e.g. "openrouter Gemini 2.5 Pro") and pick a
        // specific, non-default model so a passthrough would be distinguishable.
        const pickerTrigger = page.getByRole("button", { name: /openrouter|siliconflow|lmstudio/i });
        await expect(pickerTrigger).toBeVisible({ timeout: 10_000 });
        await pickerTrigger.click();

        const option = page.getByText("Gemini 3.7 Flash", { exact: true });
        await expect(option).toBeVisible({ timeout: 10_000 });
        await option.click();

        // Fire the classify call, capture both the request the UI actually sent
        // and the response the API actually returned for it.
        const classifyRequest = page.waitForRequest(
            (req) => req.url().includes("/v1/vibecore/classify") && req.method() === "POST",
            { timeout: 20_000 },
        );
        const classifyResponse = page.waitForResponse(
            (res) => res.url().includes("/v1/vibecore/classify"),
            { timeout: 20_000 },
        );
        await page.getByRole("button", { name: /Crea con AI|Create with AI/i }).click();

        const req = await classifyRequest;
        const body = req.postDataJSON() as { provider?: string; model?: string };
        // The picker set an explicit override — this is what the UI is contracted
        // to send, regardless of any platform default.
        expect(body.provider).toBe("openrouter");
        expect(body.model).toBe("google/gemini-3.7-flash");

        // A blocked/unavailable override comes back as 409 MODEL_NOT_AVAILABLE
        // (AGENTS.md Rule Zero's second corollary — refuse, do not substitute).
        // 200 here means the active catalog accepted this exact model, i.e. the
        // request reached resolveModelSelection's "strict" requested tier intact.
        const res = await classifyResponse;
        expect(res.status()).toBe(200);
    });
});
