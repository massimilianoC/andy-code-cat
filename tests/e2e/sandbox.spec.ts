/**
 * E2E tests: Multi-tenant sandbox isolation (Double Sandbox model).
 *
 * Verifies that every project-scoped endpoint enforces ownership:
 *  - UserB cannot read, delete, moodboard, session-create, or duplicate
 *    a project owned by UserA — even when passing the correct projectId.
 *  - UserA can perform all those operations on their own project.
 *  - A project created with a preset has the preset's layoutTags in its moodboard.
 *  - Unauthenticated requests to sandbox routes return 401.
 *
 * Uses two dedicated bot accounts (bot / bot2) that are created on demand.
 * All projects are deleted in afterAll — no permanent pollution.
 *
 * Runs against the Docker stack at http://localhost:4000.
 */
import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    API_URL,
    loginTestUser,
    getAccessToken,
    createTestProject,
    deleteTestProject,
    deleteAllTestProjects,
    loginSecondTestUser,
    deleteAllBot2Projects,
} from "./helpers/test-user";

// ─── setup ──────────────────────────────────────────────────────────────────

let bot1Token = "";    // ownerA — bot@andy-code-cat-e2e.invalid
let bot2Token = "";    // ownerB — bot2@andy-code-cat-e2e.invalid
let bot1ProjectId = ""; // project owned by ownerA
let bot2ProjectId = ""; // project owned by ownerB

test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Authenticate bot1
    await loginTestUser(page);
    bot1Token = await getAccessToken(page);

    // Authenticate bot2
    bot2Token = await loginSecondTestUser(page);

    // Create a project for each bot so both sandboxes are populated
    bot1ProjectId = await createTestProject(page, "Sandbox-A-Project");

    // Temporarily inject bot2 token so createTestProject runs as bot2
    await page.evaluate((token: string) => {
        localStorage.setItem("pf_access_token", token);
    }, bot2Token);
    bot2ProjectId = await createTestProject(page, "Sandbox-B-Project");

    // Restore bot1 token
    await page.evaluate((token: string) => {
        localStorage.setItem("pf_access_token", token);
    }, bot1Token);

    await ctx.close();
});

test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await loginTestUser(page);
    await deleteAllTestProjects(page);

    // Retrieve bot1 token to ensure we can also clean up bot2
    bot2Token = bot2Token || (await loginSecondTestUser(page));
    await deleteAllBot2Projects(page, bot2Token);

    await ctx.close();
});

// ─── helpers ────────────────────────────────────────────────────────────────

/** Calls a project-scoped endpoint as an arbitrary token and returns the HTTP status. */
async function callProjectEndpoint(
    page: import("@playwright/test").Page,
    opts: {
        method: string;
        path: string;       // e.g. `/v1/projects/${id}/moodboard`
        projectId: string;  // value of x-project-id header
        token: string;
        body?: Record<string, unknown>;
    },
): Promise<number> {
    return page.evaluate(
        async ({ apiUrl, method, path, projectId, token, body }) => {
            const res = await fetch(`${apiUrl}${path}`, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    "x-project-id": projectId,
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            return res.status;
        },
        { apiUrl: API_URL, method: opts.method, path: opts.path, projectId: opts.projectId, token: opts.token, body: opts.body },
    );
}

// ─── Suite 1: bot1 can access its own project ────────────────────────────────

test.describe("Owner can access own project", () => {
    test.beforeEach(async ({ page }) => {
        await loginTestUser(page);
    });

    test("GET /v1/projects/:id with own token → 200", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "GET",
            path: `/v1/projects/${bot1ProjectId}`,
            projectId: bot1ProjectId,
            token: bot1Token,
        });
        expect(status).toBe(200);
    });

    test("GET /v1/projects/:id/moodboard with own token → 200", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "GET",
            path: `/v1/projects/${bot1ProjectId}/moodboard`,
            projectId: bot1ProjectId,
            token: bot1Token,
        });
        expect(status).toBe(200);
    });

    test("POST /v1/projects/:id/sessions with own token → 201", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "POST",
            path: `/v1/projects/${bot1ProjectId}/sessions`,
            projectId: bot1ProjectId,
            token: bot1Token,
        });
        expect(status).toBe(201);
    });
});

// ─── Suite 2: bot2 is denied from bot1's project ─────────────────────────────

test.describe("Cross-user sandbox — 403 enforcement", () => {
    test.beforeEach(async ({ page }) => {
        await loginTestUser(page);
    });

    test("GET /v1/projects/:id — bot2 token → 403", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "GET",
            path: `/v1/projects/${bot1ProjectId}`,
            projectId: bot1ProjectId,
            token: bot2Token,
        });
        expect(status).toBe(403);
    });

    test("GET /v1/projects/:id/moodboard — bot2 token → 403", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "GET",
            path: `/v1/projects/${bot1ProjectId}/moodboard`,
            projectId: bot1ProjectId,
            token: bot2Token,
        });
        expect(status).toBe(403);
    });

    test("PUT /v1/projects/:id/moodboard — bot2 token → 403", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "PUT",
            path: `/v1/projects/${bot1ProjectId}/moodboard`,
            projectId: bot1ProjectId,
            token: bot2Token,
            body: { inheritFromUser: false },
        });
        expect(status).toBe(403);
    });

    test("DELETE /v1/projects/:id — bot2 token → 403", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "DELETE",
            path: `/v1/projects/${bot1ProjectId}`,
            projectId: bot1ProjectId,
            token: bot2Token,
        });
        expect(status).toBe(403);
    });

    test("POST /v1/projects/:id/sessions — bot2 token → 403", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "POST",
            path: `/v1/projects/${bot1ProjectId}/sessions`,
            projectId: bot1ProjectId,
            token: bot2Token,
        });
        expect(status).toBe(403);
    });

    test("POST /v1/projects/:id/duplicate — bot2 token → 403", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "POST",
            path: `/v1/projects/${bot1ProjectId}/duplicate`,
            projectId: bot1ProjectId,
            token: bot2Token,
        });
        expect(status).toBe(403);
    });

    test("bot2 cannot use bot1's projectId in its own x-project-id header", async ({ page }) => {
        // bot1's project id injected as projectId header, but token is bot2's
        // The sandbox should deny because findByIdForUser(bot1ProjectId, bot2UserId) returns null
        const status = await callProjectEndpoint(page, {
            method: "GET",
            path: `/v1/projects/${bot1ProjectId}`,
            projectId: bot1ProjectId,
            token: bot2Token,
        });
        expect(status).toBe(403);
    });
});

// ─── Suite 3: unauthenticated requests ───────────────────────────────────────

test.describe("Unauthenticated access → 401", () => {
    test.beforeEach(async ({ page }) => {
        await loginTestUser(page);
    });

    test("GET /v1/projects without token → 401", async ({ page }) => {
        const status = await page.evaluate(
            async ({ apiUrl }) => {
                const res = await fetch(`${apiUrl}/v1/projects`);
                return res.status;
            },
            { apiUrl: API_URL },
        );
        expect(status).toBe(401);
    });

    test("GET /v1/projects/:id without token → 401", async ({ page }) => {
        const status = await page.evaluate(
            async ({ apiUrl, projectId }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}`, {
                    headers: { "x-project-id": projectId },
                });
                return res.status;
            },
            { apiUrl: API_URL, projectId: bot1ProjectId },
        );
        expect(status).toBe(401);
    });

    test("POST /v1/projects/:id/sessions without token → 401", async ({ page }) => {
        const status = await page.evaluate(
            async ({ apiUrl, projectId }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}/sessions`, {
                    method: "POST",
                    headers: { "x-project-id": projectId, "Content-Type": "application/json" },
                });
                return res.status;
            },
            { apiUrl: API_URL, projectId: bot1ProjectId },
        );
        expect(status).toBe(401);
    });
});

// ─── Suite 4: missing x-project-id header → 400 ─────────────────────────────

test.describe("Missing x-project-id header → 400", () => {
    test.beforeEach(async ({ page }) => {
        await loginTestUser(page);
    });

    test("GET /v1/projects/:id without x-project-id → 400", async ({ page }) => {
        const status = await page.evaluate(
            async ({ apiUrl, token, projectId }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                return res.status;
            },
            { apiUrl: API_URL, token: bot1Token, projectId: bot1ProjectId },
        );
        expect(status).toBe(400);
    });
});

// ─── Suite 5: preset moodboard seeding (R2) ──────────────────────────────────

test.describe("Preset moodboard seeding (R2)", () => {
    let presetProjectId = "";

    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginTestUser(page);
        presetProjectId = await createTestProject(page, "Preset-E2E-Landing", "landing");
        await ctx.close();
    });

    test.afterAll(async ({ browser }) => {
        if (!presetProjectId) return;
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await loginTestUser(page);
        await deleteTestProject(page, presetProjectId);
        await ctx.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginTestUser(page);
    });

    test("project created with preset:landing has layoutTags in moodboard", async ({ page }) => {
        const data = await page.evaluate(
            async ({ apiUrl, token, projectId }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}/moodboard`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "x-project-id": projectId,
                    },
                });
                return res.json();
            },
            { apiUrl: API_URL, token: bot1Token, projectId: presetProjectId },
        );
        expect(data.moodboard).toBeDefined();
        expect(Array.isArray(data.moodboard.layoutTags)).toBe(true);
        expect(data.moodboard.layoutTags.length).toBeGreaterThan(0);
    });

    test("project created with preset:landing has a non-empty projectBrief", async ({ page }) => {
        const data = await page.evaluate(
            async ({ apiUrl, token, projectId }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}/moodboard`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "x-project-id": projectId,
                    },
                });
                return res.json();
            },
            { apiUrl: API_URL, token: bot1Token, projectId: presetProjectId },
        );
        expect(typeof data.moodboard.projectBrief).toBe("string");
        expect(data.moodboard.projectBrief.length).toBeGreaterThan(5);
    });

    test("GET /v1/presets returns catalog with landing preset", async ({ page }) => {
        const data = await page.evaluate(async (apiUrl) => {
            const res = await fetch(`${apiUrl}/v1/presets`);
            return res.json();
        }, API_URL);

        expect(Array.isArray(data.presets)).toBe(true);
        const ids = (data.presets as { id: string }[]).map((p) => p.id);
        expect(ids).toContain("landing");
    });
});

// ─── Suite 6: sandbox symmetry — bot1 vs bot2's project ──────────────────────

test.describe("Sandbox symmetry — bot1 denied from bot2's project", () => {
    test.beforeEach(async ({ page }) => {
        await loginTestUser(page);
    });

    test("bot1 cannot GET bot2's project → 403", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "GET",
            path: `/v1/projects/${bot2ProjectId}`,
            projectId: bot2ProjectId,
            token: bot1Token,
        });
        expect(status).toBe(403);
    });

    test("bot1 cannot DELETE bot2's project → 403", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "DELETE",
            path: `/v1/projects/${bot2ProjectId}`,
            projectId: bot2ProjectId,
            token: bot1Token,
        });
        expect(status).toBe(403);
    });

    test("bot1 cannot create a session in bot2's project → 403", async ({ page }) => {
        const status = await callProjectEndpoint(page, {
            method: "POST",
            path: `/v1/projects/${bot2ProjectId}/sessions`,
            projectId: bot2ProjectId,
            token: bot1Token,
        });
        expect(status).toBe(403);
    });
});
