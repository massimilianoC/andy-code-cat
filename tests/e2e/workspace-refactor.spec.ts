import { expect, test, type Page } from "@playwright/test";
import {
    API_URL,
    BASE_URL,
    createTestProject,
    deleteTestProject,
    getAccessToken,
    loginTestUser,
} from "./helpers/test-user";

const HORIZONTAL_SPLIT_COOKIE = "andy-code-cat_workspace_split";
const VERTICAL_SPLIT_COOKIE = "andy-code-cat_chat_vsplit";

async function openWorkspace(page: Page, projectId: string): Promise<void> {
    const response = await page.goto(`${BASE_URL}/workspace/${projectId}`, {
        waitUntil: "domcontentloaded",
    });

    expect(response?.status()).toBe(200);
    await expect(page.locator(".workspace-shell")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".workspace-chat-panel")).toBeVisible({ timeout: 15_000 });
}

async function expectPersistedLayout(page: Page): Promise<void> {
    await expect(page.locator(".workspace-shell")).toHaveAttribute(
        "style",
        /grid-template-columns:\s*60% 8px/,
    );
    await expect(page.locator(".workspace-chat-messages")).toHaveAttribute(
        "style",
        /height:\s*85%/,
    );
}

async function getPipelineHandoffFixture(page: Page, projectId: string) {
    const token = await getAccessToken(page);
    return page.evaluate(async ({ apiUrl, token, projectId }) => {
        const headers = {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        };
        const [conversationResponse, providersResponse] = await Promise.all([
            fetch(`${apiUrl}/v1/projects/${projectId}/conversation`, { headers }),
            fetch(`${apiUrl}/v1/llm/providers`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (!conversationResponse.ok || !providersResponse.ok) {
            throw new Error(`Unable to prepare handoff fixture: conversation=${conversationResponse.status}, providers=${providersResponse.status}`);
        }

        const conversation = await conversationResponse.json();
        const catalog = await providersResponse.json();
        const provider = catalog.providers.find((item: { provider: string }) => item.provider === catalog.activeProvider)
            ?? catalog.providers[0];
        const model = provider?.models.find((item: { isActive: boolean; isDefault: boolean; role: string }) =>
            item.isActive && item.isDefault && item.role === "dialogue")
            ?? provider?.models.find((item: { isActive: boolean; isDefault: boolean }) => item.isActive && item.isDefault)
            ?? provider?.models.find((item: { isActive: boolean }) => item.isActive);
        if (!conversation.conversation?.id || !provider?.provider || !model?.id) {
            throw new Error("Unable to resolve conversation or active default model");
        }
        return {
            conversationId: conversation.conversation.id as string,
            provider: provider.provider as string,
            model: model.id as string,
        };
    }, { apiUrl: API_URL, token, projectId });
}

test.describe("Workspace refactor characterization", () => {
    test.describe.configure({ mode: "serial" });

    let projectId: string | null = null;

    test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await loginTestUser(page);
        projectId = await createTestProject(page, `E2E Workspace Refactor ${Date.now()}`);
        await context.close();
    });

    test.afterAll(async ({ browser }) => {
        if (!projectId) return;

        const context = await browser.newContext();
        const page = await context.newPage();
        await loginTestUser(page);
        await deleteTestProject(page, projectId);
        await context.close();
    });

    test("renders the authenticated workspace without client provider errors", async ({ page }) => {
        await loginTestUser(page);

        const pageErrors: string[] = [];
        const providerErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("console", (message) => {
            if (
                message.type() === "error" &&
                message.text().includes("must be used within a Workspace")
            ) {
                providerErrors.push(message.text());
            }
        });

        expect(projectId).not.toBeNull();
        await openWorkspace(page, projectId!);

        await expect(page.locator("body")).not.toContainText("Application error");
        expect(pageErrors).toEqual([]);
        expect(providerErrors).toEqual([]);
    });

    test("preserves the pre-refactor split boundaries after reload", async ({ page }) => {
        await loginTestUser(page);
        await page.evaluate(
            ({ horizontalCookie, verticalCookie }) => {
                document.cookie = `${horizontalCookie}=60; path=/`;
                document.cookie = `${verticalCookie}=85; path=/`;
            },
            {
                horizontalCookie: HORIZONTAL_SPLIT_COOKIE,
                verticalCookie: VERTICAL_SPLIT_COOKIE,
            },
        );

        expect(projectId).not.toBeNull();
        await openWorkspace(page, projectId!);
        await expectPersistedLayout(page);

        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator(".workspace-shell")).toBeVisible({ timeout: 15_000 });
        await expectPersistedLayout(page);
    });

    test("automatically starts generation after a Zero Effort God Mode handoff", async ({ page }) => {
        await loginTestUser(page);
        expect(projectId).not.toBeNull();

        const fixture = await getPipelineHandoffFixture(page, projectId!);
        const handoffPrompt = `E2E God Mode handoff ${Date.now()}`;
        let streamedPrompt: string | null = null;

        await page.route(`**/v1/projects/${projectId}/llm/chat-preview/stream`, async (route) => {
            streamedPrompt = (route.request().postDataJSON() as { message?: string }).message ?? null;
            const result = {
                reply: "E2E handoff accepted",
                provider: fixture.provider,
                model: fixture.model,
                durationMs: 1,
                simulated: true,
            };
            await route.fulfill({
                status: 200,
                contentType: "text/event-stream",
                body: `data: ${JSON.stringify({ type: "done", result })}\n\n`,
            });
        });

        await page.evaluate(
            ({ conversationId, prompt }) => sessionStorage.setItem(`pipeline_handoff_${conversationId}`, prompt),
            { conversationId: fixture.conversationId, prompt: handoffPrompt },
        );
        const query = new URLSearchParams({
            conv: fixture.conversationId,
            skipAutoOptimize: "1",
            preferredProvider: fixture.provider,
            preferredModel: fixture.model,
        });
        await page.goto(`${BASE_URL}/workspace/${projectId}?${query.toString()}`, { waitUntil: "domcontentloaded" });

        await expect(page.locator(".workspace-shell")).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => streamedPrompt, { timeout: 15_000 }).toBe(handoffPrompt);
        await expect.poll(() => page.evaluate(
            (conversationId) => sessionStorage.getItem(`pipeline_handoff_${conversationId}`),
            fixture.conversationId,
        )).toBeNull();
    });
});
