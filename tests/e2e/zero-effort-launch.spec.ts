import { test, expect } from "@playwright/test";
import { API_URL, createTestProject, deleteTestProject, getAccessToken, loginTestUser } from "./helpers/test-user";

test.describe("Zero Effort pipeline launch", () => {
    test("POST /v1/projects/:projectId/pipelines/zero-effort prepares a reusable workspace", async ({ page }) => {
        await loginTestUser(page);
        const projectId = await createTestProject(page, `Zero Effort ${Date.now()}`);

        try {
            const token = await getAccessToken(page);
            const result = await page.evaluate(
                async ({ apiUrl, token, projectId }) => {
                    const res = await fetch(`${apiUrl}/v1/projects/${projectId}/pipelines/zero-effort`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                            "x-project-id": projectId,
                        },
                        body: JSON.stringify({
                            businessName: "Acme Studio",
                            siteType: "landing_page",
                            primaryGoal: "Generate more inbound leads for design services",
                            audience: "Small companies looking for a premium brand refresh",
                            tone: "clear and premium",
                            primaryCta: "Book a discovery call",
                            styleHint: "minimal with strong contrast",
                        }),
                    });

                    return {
                        status: res.status,
                        body: await res.json(),
                    };
                },
                { apiUrl: API_URL, token, projectId },
            );

            expect(result.status).toBe(201);
            expect(result.body.mode).toBe("zero-effort");
            expect(result.body.status).toBe("prepared");
            expect(result.body.projectId).toBe(projectId);
            expect(typeof result.body.conversationId).toBe("string");
            expect(typeof result.body.jobId).toBe("string");
            expect(result.body.normalizedBrief).toContain("Acme Studio");
            expect(Array.isArray(result.body.suggestedNextActions)).toBe(true);
            expect(Array.isArray(result.body.workspace.files)).toBe(true);
        } finally {
            await deleteTestProject(page, projectId);
        }
    });
});
