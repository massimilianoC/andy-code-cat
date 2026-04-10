/**
 * E2E test: preview panel must never be blank after a version switch.
 *
 * Runs against the Docker instance at http://localhost:8081.
 *
 * Uses the isolated E2E bot account -- real user data is never touched.
 * A dedicated test project is created in beforeAll and deleted in afterAll.
 */
import { test, expect, type Page } from "@playwright/test";
import {
    BASE_URL,
    API_URL,
    loginTestUser,
    createTestProject,
    deleteAllTestProjects,
} from "./helpers/test-user";

// --- helpers ---

/**
 * Navigates to the workspace for the given project id.
 */
async function openWorkspace(page: Page, projectId: string): Promise<void> {
    await page.goto(`${BASE_URL}/workspace/${projectId}`);
    await page.waitForLoadState("networkidle");
}

/**
 * Returns the srcdoc length of the preview iframe.
 * A blank preview has length 0 or a very short (< 50 char) srcdoc.
 */
async function getPreviewDocLength(page: Page): Promise<number> {
    return page.evaluate(() => {
        const iframe = document.querySelector<HTMLIFrameElement>("iframe.workspace-preview-iframe");
        return iframe?.srcdoc?.length ?? 0;
    });
}

/**
 * Waits until the preview iframe has a meaningful srcdoc (> 100 chars).
 */
async function waitForPreviewContent(page: Page, timeout = 8000): Promise<number> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const len = await getPreviewDocLength(page);
        if (len > 100) return len;
        await page.waitForTimeout(300);
    }
    return getPreviewDocLength(page);
}

// --- test suite ---

test.describe("Preview panel robustness", () => {
    let botProjectId: string | null = null;

    test.beforeAll(async ({ browser }) => {
        // Create a dedicated project for the bot user
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginTestUser(page);
        botProjectId = await createTestProject(page, `E2E Preview Test ${Date.now()}`);
        await ctx.close();
    });

    test.afterAll(async ({ browser }) => {
        // Remove all bot projects to keep the DB clean
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginTestUser(page);
        await deleteAllTestProjects(page);
        await ctx.close();
    });

    test("login and navigate to a workspace", async ({ page }) => {
        await loginTestUser(page);
        const url = page.url();
        expect(url).not.toContain("/login");
        console.log("After login URL:", url);
    });

    test("preview iframe loads with content on initial page load", async ({ page }) => {
        await loginTestUser(page);

        if (!botProjectId) {
            test.skip(true, "No bot project available");
            return;
        }

        await openWorkspace(page, botProjectId);

        // Wait for preview iframe to appear
        await page.waitForSelector("iframe.workspace-preview-iframe", { timeout: 15_000 }).catch(() => null);

        const len = await waitForPreviewContent(page, 10_000);
        console.log("Initial preview srcdoc length:", len);

        // Switch to PREVIEW tab if not already on it
        const previewTabBtn = page.locator("button", { hasText: /^PREVIEW$/i }).first();
        if (await previewTabBtn.count() > 0) {
            await previewTabBtn.click();
        }

        const finalLen = await waitForPreviewContent(page, 8000);
        console.log("Preview srcdoc length after tab click:", finalLen);
        expect(finalLen, "Preview iframe should have content on initial load").toBeGreaterThan(100);
    });

    test("preview remains populated after version switch (regression for blank-preview bug)", async ({ page }) => {
        await loginTestUser(page);

        if (!botProjectId) {
            test.skip(true, "No bot project available");
            return;
        }

        await openWorkspace(page, botProjectId);

        // Wait for snapshot panel button
        const snapshotTrigger = page.locator("button.secondary", { hasText: /^v\d/ }).first();
        const panelVisible = await snapshotTrigger.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
        if (!panelVisible) {
            test.skip(true, "No snapshot panel -- project has no versions yet");
            return;
        }

        // Switch to PREVIEW tab
        const previewTabBtn = page.locator("button", { hasText: /^PREVIEW$/i }).first();
        if (await previewTabBtn.count() > 0) await previewTabBtn.click();
        await page.waitForTimeout(500);

        const initialLen = await waitForPreviewContent(page, 10_000);
        console.log("Initial preview length:", initialLen);
        expect(initialLen, "Initial preview should have content").toBeGreaterThan(100);

        // Open snapshot dropdown
        await snapshotTrigger.click();
        await page.waitForTimeout(300);

        const versionItems = page.locator('[style*="cursor: pointer"]').filter({ hasText: /^v\d/ });
        const vCount = await versionItems.count();
        console.log("Version count in dropdown:", vCount);

        if (vCount < 2) {
            test.skip(true, "Need at least 2 versions to test switching");
            return;
        }

        const secondItem = versionItems.nth(1);
        const secondVersionText = await secondItem.textContent();
        console.log("Switching to:", secondVersionText?.trim());
        await secondItem.click();

        await page.waitForTimeout(500);

        const afterSwitchLen = await getPreviewDocLength(page);
        console.log("Immediately after switch, srcdoc length:", afterSwitchLen);

        const finalLen = await waitForPreviewContent(page, 6000);
        console.log("Final preview length after version switch:", finalLen);
        expect(finalLen, "Preview must NOT be blank after switching versions").toBeGreaterThan(100);

        // Switch back
        await page.locator("button.secondary", { hasText: /^v\d/ }).first().click();
        await page.waitForTimeout(300);
        const firstItem = page.locator('[style*="cursor: pointer"]').filter({ hasText: /^v\d/ }).first();
        await firstItem.click();
        await page.waitForTimeout(500);

        const backLen = await waitForPreviewContent(page, 6000);
        console.log("Preview length after switching back:", backLen);
        expect(backLen, "Preview must NOT be blank after switching back").toBeGreaterThan(100);
    });

    test("preview stays populated after page reload", async ({ page }) => {
        await loginTestUser(page);

        if (!botProjectId) {
            test.skip(true, "No bot project available");
            return;
        }

        await openWorkspace(page, botProjectId);

        const previewTabBtn = page.locator("button", { hasText: /^PREVIEW$/i }).first();
        if (await previewTabBtn.count() > 0) await previewTabBtn.click();

        await page.reload();
        await page.waitForLoadState("networkidle");

        if (await previewTabBtn.count() > 0) await previewTabBtn.click();

        const len = await waitForPreviewContent(page, 12_000);
        console.log("Preview length after page reload:", len);
        expect(len, "Preview should load content after page reload").toBeGreaterThan(100);
    });
});
