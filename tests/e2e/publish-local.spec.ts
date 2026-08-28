import { expect, test } from "@playwright/test";
import {
    API_URL,
    BASE_URL,
    createTestProject,
    deleteTestProject,
    getAccessToken,
    loginTestUser,
} from "./helpers/test-user";

const PUBLIC_BASE_URL = process.env.E2E_PUBLIC_BASE_URL ?? "http://localhost";

test.describe("Local published-site front door", () => {
    test("serves a newly published page, stylesheet, script, and same-origin media through nginx", async ({ page }) => {
        await loginTestUser(page);
        const projectId = await createTestProject(page, `E2E Local Publish ${Date.now()}`);

        try {
            const token = await getAccessToken(page);
            const published = await page.evaluate(async ({ apiUrl, token, projectId }) => {
                const headers = {
                    Authorization: `Bearer ${token}`,
                    "x-project-id": projectId,
                };
                const gifBytes = Uint8Array.from(
                    atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="),
                    (char) => char.charCodeAt(0),
                );
                const form = new FormData();
                form.append("file", new File([gifBytes], "published-e2e.gif", { type: "image/gif" }));
                form.append("label", "Published E2E asset");
                const assetResponse = await fetch(`${apiUrl}/v1/projects/${projectId}/assets`, {
                    method: "POST",
                    headers,
                    body: form,
                });
                if (!assetResponse.ok) throw new Error(`Asset upload failed: ${assetResponse.status}`);
                const asset = (await assetResponse.json()).asset;

                const conversationResponse = await fetch(`${apiUrl}/v1/projects/${projectId}/conversation`, { headers });
                if (!conversationResponse.ok) throw new Error(`Conversation failed: ${conversationResponse.status}`);
                const conversationId = (await conversationResponse.json()).conversation?.id;
                if (!conversationId) throw new Error("Conversation ID is missing");

                const snapshotResponse = await fetch(`${apiUrl}/v1/projects/${projectId}/preview-snapshots`, {
                    method: "POST",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        conversationId,
                        artifacts: {
                            html: `<!doctype html><html><head><title>Published E2E</title></head><body><main data-e2e-publish-layout class="max-w-7xl flex gap-6 bg-ink text-cream p-6"><h1>Published E2E</h1><img data-e2e-publish-image src="${apiUrl}/p/media/${asset.id}" alt="E2E asset"></main></body></html>`,
                            css: ":root { --ink: #0A1628; --cream: #F5F1E8; }",
                            js: "window.__publishedE2e = true;",
                        },
                        metadata: { model: "e2e", provider: "test", finishReason: "manual-save", structuredParseValid: true },
                        activate: true,
                    }),
                });
                if (!snapshotResponse.ok) throw new Error(`Snapshot failed: ${snapshotResponse.status}`);

                const publishResponse = await fetch(`${apiUrl}/v1/projects/${projectId}/publish`, {
                    method: "POST",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });
                if (!publishResponse.ok) throw new Error(`Publish failed: ${publishResponse.status}`);
                const deployment = await publishResponse.json();
                return { publishId: deployment.publishId as string, assetId: asset.id as string };
            }, { apiUrl: API_URL, token, projectId });

            const publicUrl = `${PUBLIC_BASE_URL}/p/${published.publishId}/`;
            const cssResponse = page.waitForResponse((response) => response.url().includes(`/p/${published.publishId}/style.css`));
            const mediaResponse = page.waitForResponse((response) => response.url().endsWith(`/p/media/${published.assetId}`));
            const response = await page.goto(publicUrl, { waitUntil: "load" });

            expect(response?.status()).toBe(200);
            await expect(page.getByRole("heading", { name: "Published E2E" })).toBeVisible();
            await expect(page.locator("[data-e2e-publish-image]")).toHaveAttribute("src", `/p/media/${published.assetId}`);
            expect((await cssResponse).status()).toBe(200);
            expect((await mediaResponse).status()).toBe(200);
            await expect.poll(() => page.evaluate(() => (window as Window & { __publishedE2e?: boolean }).__publishedE2e)).toBe(true);
            await expect.poll(() => page.locator("[data-e2e-publish-layout]").evaluate((element) => ({
                display: getComputedStyle(element).display,
                gap: getComputedStyle(element).gap,
                backgroundColor: getComputedStyle(element).backgroundColor,
            }))).toEqual({
                display: "flex",
                gap: "24px",
                backgroundColor: "rgb(10, 22, 40)",
            });
        } finally {
            await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
            await loginTestUser(page);
            await deleteTestProject(page, projectId);
        }
    });
});
