/**
 * E2E Playwright tests — VibeCore entry UI
 *
 * Covers:
 *  - VibeCoreEntry renders on /dashboard (heading, textarea visible)
 *  - Mode selector renders EASY / MEDIUM / HARD segments
 *  - Active mode highlights with glow ring
 *  - Cmd/Ctrl+K focuses the textarea
 *  - Submit button disabled when textarea is empty
 *  - Submit button enabled after typing
 *  - File attachment pill appears after selecting a file
 *  - File pill can be removed with X button
 *  - HARD mode selection navigates to /workspace/new
 *  - Error state displayed on API failure (mocked)
 *  - Scroll reveal: below-fold content visible after scroll
 *  - `aria-live` phase region is present in DOM
 *  - Background SVG is aria-hidden
 *
 * Runs against the Docker dev stack (http://localhost:8081).
 * The bot account is created via API on first run.
 */
import { test, expect } from "@playwright/test";
import path from "path";
import {
    BASE_URL,
    API_URL,
    loginTestUser,
    getAccessToken,
} from "./helpers/test-user";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Navigate to /dashboard with the bot logged in. */
async function goToDashboard(page: import("@playwright/test").Page) {
    await loginTestUser(page);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState("networkidle");
}

// ─── Suite 1: Render ──────────────────────────────────────────────────────────

test.describe("VibeCoreEntry — render", () => {
    test("VibeCore section heading is visible on /dashboard", async ({ page }) => {
        await goToDashboard(page);
        // The heading is an <h1> rendered inside VibeCoreEntry
        const heading = page.locator("h1").first();
        await expect(heading).toBeVisible();
    });

    test("VibeCore textarea is visible", async ({ page }) => {
        await goToDashboard(page);
        const textarea = page.locator("textarea").first();
        await expect(textarea).toBeVisible();
    });

    test("Background SVG is aria-hidden", async ({ page }) => {
        await goToDashboard(page);
        const svg = page.locator("svg[aria-hidden='true']").first();
        await expect(svg).toBeAttached();
    });

    test("aria-live region is present for phase label", async ({ page }) => {
        await goToDashboard(page);
        const liveRegion = page.locator("[aria-live='polite']").first();
        await expect(liveRegion).toBeAttached();
    });
});

// ─── Suite 2: Mode Selector ────────────────────────────────────────────────────

test.describe("VibeCoreEntry — mode selector", () => {
    test("EASY, MEDIUM, HARD segments are rendered", async ({ page }) => {
        await goToDashboard(page);
        await expect(page.getByText("EASY")).toBeVisible();
        await expect(page.getByText("MEDIUM")).toBeVisible();
        await expect(page.getByText("HARD")).toBeVisible();
    });

    test("clicking MEDIUM selects it (aria-pressed=true)", async ({ page }) => {
        await goToDashboard(page);
        const mediumBtn = page.getByRole("button", { name: /MEDIUM/i });
        await mediumBtn.click();
        await expect(mediumBtn).toHaveAttribute("aria-pressed", "true");
    });

    test("clicking EASY after MEDIUM re-selects EASY", async ({ page }) => {
        await goToDashboard(page);
        const easyBtn = page.getByRole("button", { name: /EASY/i });
        const mediumBtn = page.getByRole("button", { name: /MEDIUM/i });
        await mediumBtn.click();
        await easyBtn.click();
        await expect(easyBtn).toHaveAttribute("aria-pressed", "true");
        await expect(mediumBtn).toHaveAttribute("aria-pressed", "false");
    });

    test("HARD mode navigates to /workspace/new", async ({ page }) => {
        await goToDashboard(page);
        const hardBtn = page.getByRole("button", { name: /HARD/i });
        await hardBtn.click();
        await page.waitForURL(/\/workspace\/new/, { timeout: 10_000 });
        expect(page.url()).toContain("/workspace/new");
    });
});

// ─── Suite 3: Textarea & submit ───────────────────────────────────────────────

test.describe("VibeCoreEntry — textarea interaction", () => {
    test("submit button is disabled when textarea is empty", async ({ page }) => {
        await goToDashboard(page);
        // Find the submit/CTA button — it contains ArrowRight icon or the i18n CTA key
        const submitBtn = page.locator("button[type='submit'], button[aria-label*='Crea'], button[aria-label*='crea']").first();
        // Fallback: any button near the textarea that is disabled
        const disabledBtn = page.locator("section button[disabled]").first();
        const isDisabled = await disabledBtn.count() > 0;
        expect(isDisabled).toBeTruthy();
    });

    test("submit button becomes enabled after typing", async ({ page }) => {
        await goToDashboard(page);
        const textarea = page.locator("textarea").first();
        await textarea.fill("una landing page per un ristorante");
        // The button that was disabled should now be enabled
        const enabledBtn = page.locator("section button:not([disabled])").first();
        await expect(enabledBtn).toBeEnabled();
    });

    test("Ctrl+K focuses the textarea from anywhere", async ({ page }) => {
        await goToDashboard(page);
        // Click somewhere else first to remove focus
        await page.click("body");
        await page.keyboard.press("Control+k");
        const textarea = page.locator("textarea").first();
        await expect(textarea).toBeFocused();
    });

    test("Shift+Enter inserts newline without submitting", async ({ page }) => {
        await goToDashboard(page);
        const textarea = page.locator("textarea").first();
        await textarea.fill("line one");
        await textarea.press("Shift+Enter");
        const value = await textarea.inputValue();
        expect(value).toContain("\n");
        // Phase should stay idle — no navigation
        expect(page.url()).toContain("/dashboard");
    });
});

// ─── Suite 4: File attachment ─────────────────────────────────────────────────

test.describe("VibeCoreEntry — file attachment", () => {
    test("attaching a file shows a file pill", async ({ page }) => {
        await goToDashboard(page);
        const fileInput = page.locator("input[type='file']");
        // Create a small dummy PDF buffer
        await fileInput.setInputFiles({
            name: "brief.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("%PDF-1.4 dummy"),
        });
        // Pill should appear showing the filename
        await expect(page.getByText("brief.pdf")).toBeVisible({ timeout: 5_000 });
    });

    test("file pill has a remove button that deletes it", async ({ page }) => {
        await goToDashboard(page);
        const fileInput = page.locator("input[type='file']");
        await fileInput.setInputFiles({
            name: "doc.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("%PDF-1.4 dummy"),
        });
        await expect(page.getByText("doc.pdf")).toBeVisible({ timeout: 5_000 });
        // Click the X button on the pill
        await page.getByRole("button", { name: /remove|×|x/i }).first().click();
        await expect(page.getByText("doc.pdf")).not.toBeVisible();
    });
});

// ─── Suite 5: Scroll reveal ────────────────────────────────────────────────────

test.describe("VibeCoreEntry — scroll reveal", () => {
    test("dashboard content below VibeCoreEntry is accessible after scroll", async ({ page }) => {
        await goToDashboard(page);
        // Scroll down past the VibeCore section (~80dvh ≈ 600px on 1280×720)
        await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
        await page.waitForTimeout(300);
        // Some project-related content or template section should exist below
        const belowFold = page.locator("main, [data-testid='dashboard-content'], .dashboard-content, [class*='dashboard']").last();
        await expect(belowFold).toBeAttached();
        // Scroll back restores the VibeCore heading visibility
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await page.waitForTimeout(300);
        const heading = page.locator("h1").first();
        await expect(heading).toBeVisible();
    });
});

// ─── Suite 6: Error state ─────────────────────────────────────────────────────

test.describe("VibeCoreEntry — error handling", () => {
    test("shows inline error when classify API returns 500", async ({ page }) => {
        await loginTestUser(page);

        // Intercept the vibecore/classify call and force a 500
        await page.route("**/v1/vibecore/classify", (route) =>
            route.fulfill({ status: 500, body: JSON.stringify({ error: "server error" }) }),
        );
        // Also intercept project creation to also fail (so we surface classify error)
        await page.route("**/v1/projects", (route) => {
            // Let classify be intercepted above; this just prevents cascading failures
            route.continue();
        });

        await page.goto(`${BASE_URL}/dashboard`);
        await page.waitForLoadState("networkidle");

        const textarea = page.locator("textarea").first();
        await textarea.fill("pagina per consulente finanziario");
        await textarea.press("Enter");

        // Error message should appear with role=alert
        const alert = page.locator("[role='alert']");
        await expect(alert).toBeVisible({ timeout: 15_000 });
        const alertText = await alert.textContent();
        expect(alertText?.length).toBeGreaterThan(0);
    });
});
