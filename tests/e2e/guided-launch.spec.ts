import { test, expect } from "@playwright/test";
import { API_URL, createTestProject, deleteTestProject, getAccessToken, loginTestUser } from "./helpers/test-user";

/**
 * The guided launch has one HTTP entry point. This spec used to exercise
 * POST /pipelines/guided, which launched without creating a PipelineRun — so the suite was
 * certifying the uncertified path while the UI ran the other one. Rewritten 2026-08-27 onto
 * /pipeline/launch-workspace, with the removed routes pinned as gone so they cannot come back
 * by accident.
 */
test.describe("Guided Mode pipeline launch", () => {
    const intake = {
        businessName: "Acme Studio",
        presetId: "landing",
        primaryGoal: "Generate more inbound leads for design services",
        audience: "Small companies looking for a premium brand refresh",
        tone: "clear and premium",
        primaryCta: "Book a discovery call",
        styleHint: "minimal with strong contrast",
        optimizationPolicy: "skip",
    };

    test("POST /v1/projects/:projectId/pipeline/launch-workspace prepares a reusable workspace on a certified run", async ({ page }) => {
        await loginTestUser(page);
        const projectId = await createTestProject(page, `Guided Mode ${Date.now()}`);

        try {
            const token = await getAccessToken(page);
            const result = await page.evaluate(
                async ({ apiUrl, token, projectId, intake }) => {
                    const res = await fetch(`${apiUrl}/v1/projects/${projectId}/pipeline/launch-workspace`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                            "x-project-id": projectId,
                        },
                        body: JSON.stringify(intake),
                    });

                    return { status: res.status, body: await res.json() };
                },
                { apiUrl: API_URL, token, projectId, intake },
            );

            expect(result.status).toBe(201);
            expect(result.body.mode).toBe("workspace");
            expect(result.body.status).toBe("prepared");
            expect(result.body.projectId).toBe(projectId);
            expect(typeof result.body.conversationId).toBe("string");
            expect(typeof result.body.jobId).toBe("string");
            expect(result.body.normalizedBrief).toContain("Acme Studio");
            expect(Array.isArray(result.body.suggestedNextActions)).toBe(true);
            expect(Array.isArray(result.body.workspace.files)).toBe(true);

            // What separates this path from the one it replaced: a real run, with the model
            // frozen up front, so the workspace re-derives both from the run rather than from
            // whatever the client happened to hand it.
            expect(typeof result.body.pipelineRunId).toBe("string");
            expect(result.body.pipelineRunId.length).toBeGreaterThan(0);
            expect(result.body.modelLock?.effective?.providerId).toBeTruthy();
            expect(result.body.modelLock?.effective?.modelId).toBeTruthy();
        } finally {
            await deleteTestProject(page, projectId);
        }
    });

    test("the legacy launch routes are gone, so one user action cannot take two paths", async ({ page }) => {
        await loginTestUser(page);
        const projectId = await createTestProject(page, `Guided Legacy ${Date.now()}`);

        try {
            const token = await getAccessToken(page);
            const statuses = await page.evaluate(
                async ({ apiUrl, token, projectId, intake }) => {
                    const paths = [
                        "pipelines/guided",
                        "pipelines/zero-effort",
                        "pipelines/execute",
                    ];
                    const out: Record<string, number> = {};
                    for (const path of paths) {
                        const res = await fetch(`${apiUrl}/v1/projects/${projectId}/${path}`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${token}`,
                                "x-project-id": projectId,
                            },
                            body: JSON.stringify(intake),
                        });
                        out[path] = res.status;
                    }
                    const config = await fetch(`${apiUrl}/v1/projects/${projectId}/pipelines/zero-effort/config`, {
                        headers: { Authorization: `Bearer ${token}`, "x-project-id": projectId },
                    });
                    out["pipelines/zero-effort/config"] = config.status;
                    return out;
                },
                { apiUrl: API_URL, token, projectId, intake },
            );

            expect(statuses["pipelines/guided"]).toBe(404);
            expect(statuses["pipelines/zero-effort"]).toBe(404);
            expect(statuses["pipelines/execute"]).toBe(404);
            expect(statuses["pipelines/zero-effort/config"]).toBe(404);
        } finally {
            await deleteTestProject(page, projectId);
        }
    });

    test("the guided config endpoint survives — the wizard still reads its provider routing from it", async ({ page }) => {
        await loginTestUser(page);
        const projectId = await createTestProject(page, `Guided Config ${Date.now()}`);

        try {
            const token = await getAccessToken(page);
            const result = await page.evaluate(
                async ({ apiUrl, token, projectId }) => {
                    const res = await fetch(`${apiUrl}/v1/projects/${projectId}/pipelines/guided/config`, {
                        headers: { Authorization: `Bearer ${token}`, "x-project-id": projectId },
                    });
                    return { status: res.status, body: await res.json() };
                },
                { apiUrl: API_URL, token, projectId },
            );

            expect(result.status).toBe(200);
            expect(result.body.generate).toBeTruthy();
        } finally {
            await deleteTestProject(page, projectId);
        }
    });
});
