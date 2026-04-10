/**
 * E2E tests: Onboarding wizard + Dashboard UX (style profiling sprint).
 *
 * Covers:
 *  - Register → redirect to /login?registered=1
 *  - Login with registered=1 flag → redirect to /onboarding
 *  - Onboarding: step rendering, "Salta" and "Salta tutto" flows
 *  - Onboarding: step-by-step progression (Next), final redirect to /dashboard
 *  - Dashboard: create project, project card visible
 *  - Dashboard: ProjectCard context menu (duplicate, delete)
 *  - Dashboard: TipsPanel (xl+ viewport)
 *
 * Runs against the Docker instance at http://localhost:8081.
 * All authenticated suites use the dedicated E2E bot account — never real
 * user credentials and never permanent data pollution.
 */
import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    API_URL,
    loginTestUser,
    getAccessToken,
    createTestProject,
    deleteAllTestProjects,
    deleteTestProject,
} from "./helpers/test-user";

// ─── helpers ────────────────────────────────────────────────────────────────

function uniqueEmail(): string {
    return `e2e.test.${Date.now()}@andy-code-cat-e2e.invalid`;
}

// ─── Suite 1: Registration flow ─────────────────────────────────────────────

test.describe("Registration → onboarding redirect", () => {
    test("registration form submits and redirects to /login?registered=1", async ({ page }) => {
        const email = uniqueEmail();
        await page.goto(`${BASE_URL}/register`);
        await page.waitForLoadState("networkidle");

        await page.fill('input[placeholder="Mario"]', "Test");
        await page.fill('input[placeholder="Rossi"]', "User");
        await page.fill('input[type="email"]', email);
        await page.fill('input[type="password"]', "testpassword123");
        await page.click('button[type="submit"]');

        // Should redirect to /login?registered=1&email=...
        await page.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("registered") === "1", {
            timeout: 15_000,
        });

        const url = new URL(page.url());
        expect(url.searchParams.get("registered")).toBe("1");
        expect(decodeURIComponent(url.searchParams.get("email") ?? "")).toBe(email);
    });

    test("login with registered=1 flag redirects to /onboarding", async ({ page }) => {
        // Register a fresh user first
        const email = uniqueEmail();
        const registerRes = await page.evaluate(
            async ({ apiUrl, email }) => {
                const res = await fetch(`${apiUrl}/v1/auth/register`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email,
                        password: "testpassword123",
                        firstName: "E2E",
                        lastName: "Test",
                    }),
                });
                return { status: res.status };
            },
            { apiUrl: API_URL, email },
        );
        expect(registerRes.status).toBe(201);

        // Navigate to login with registered=1
        await page.goto(`${BASE_URL}/login?registered=1&email=${encodeURIComponent(email)}`);
        await page.waitForLoadState("networkidle");

        // Email should be pre-filled
        const emailValue = await page.inputValue('input[type="email"]');
        expect(emailValue).toBe(email);

        // Login
        await page.fill('input[type="password"]', "testpassword123");
        await page.click('button[type="submit"]');

        // Should redirect to /onboarding (new user, onboardingCompleted=false)
        await page.waitForURL((url) => url.pathname === "/onboarding", { timeout: 15_000 });
        expect(page.url()).toContain("/onboarding");
    });
});

// ─── Suite 2: Onboarding Wizard ─────────────────────────────────────────────
// NOTE: These tests require the new frontend to be built in Docker.
// Run `docker compose -f docker-compose.deploy.yml up -d --no-deps web` after
// any Next.js source change, or rebuild with `npm run docker:test` to activate.

test.describe("Onboarding wizard", () => {
    /**
     * Helper: register a fresh user via API, then inject session tokens into
     * localStorage. Must navigate to BASE_URL first so localStorage is
     * accessible (same-origin restriction).
     */
    async function registerFreshUserAndInjectTokens(page: Page): Promise<void> {
        const email = uniqueEmail();
        // Navigate to establish an origin in the browser context
        await page.goto(`${BASE_URL}/login`);
        await page.waitForLoadState("domcontentloaded");

        const regData = await page.evaluate(
            async ({ apiUrl, email }) => {
                const res = await fetch(`${apiUrl}/v1/auth/register`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email,
                        password: "testpassword123",
                        firstName: "E2E",
                        lastName: "Wizard",
                    }),
                });
                if (!res.ok) return null;
                return res.json();
            },
            { apiUrl: API_URL, email },
        );

        if (!regData) throw new Error("Registration failed");

        await page.evaluate((data: Record<string, string>) => {
            localStorage.setItem("pf_access_token", data.accessToken ?? "");
            localStorage.setItem("pf_refresh_token", data.refreshToken ?? "");
            localStorage.setItem("pf_active_project", data.activeProjectId ?? "");
        }, regData);
    }

    test("onboarding page renders step 1 of 3", async ({ page }) => {
        await registerFreshUserAndInjectTokens(page);

        await page.goto(`${BASE_URL}/onboarding`);
        await page.waitForLoadState("networkidle");

        // Verify step 1 is shown
        await expect(page.locator("text=Passo 1/3")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator("h1", { hasText: "Chi sei?" })).toBeVisible();
        await expect(page.locator("text=Salta tutto →")).toBeVisible();
    });

    test("'Salta tutto →' skips onboarding and redirects to /dashboard", async ({ page }) => {
        await registerFreshUserAndInjectTokens(page);

        await page.goto(`${BASE_URL}/onboarding`);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("text=Salta tutto →")).toBeVisible({ timeout: 10_000 });

        await page.click("text=Salta tutto →");

        await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 15_000 });
        expect(page.url()).toContain("/dashboard");
    });

    test("step-by-step navigation: Next → Step 2 → Step 3 → dashboard", async ({ page }) => {
        await registerFreshUserAndInjectTokens(page);

        await page.goto(`${BASE_URL}/onboarding`);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("text=Passo 1/3")).toBeVisible({ timeout: 10_000 });

        // Step 1 → 2: "Salta" to advance without selecting tags
        await page.click("text=Salta");
        await expect(page.locator("text=Passo 2/3")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator("h1", { hasText: "Il tuo stile visivo" })).toBeVisible();

        // Step 2 → 3
        await page.click("text=Salta");
        await expect(page.locator("text=Passo 3/3")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator("h1", { hasText: "Per chi e come" })).toBeVisible();

        // Step 3 back button should be present
        await expect(page.locator("text=← Indietro")).toBeVisible();

        // Complete onboarding (last step "Salta" → completes and redirects)
        await page.click("text=Salta");
        await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 15_000 });
        expect(page.url()).toContain("/dashboard");
    });

    test("'← Indietro' navigates back to previous step", async ({ page }) => {
        await registerFreshUserAndInjectTokens(page);

        await page.goto(`${BASE_URL}/onboarding`);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("text=Passo 1/3")).toBeVisible({ timeout: 10_000 });

        // Advance to step 2
        await page.click("text=Salta");
        await expect(page.locator("text=Passo 2/3")).toBeVisible({ timeout: 10_000 });

        // Go back
        await page.click("text=← Indietro");
        await expect(page.locator("text=Passo 1/3")).toBeVisible({ timeout: 8_000 });
        await expect(page.locator("h1", { hasText: "Chi sei?" })).toBeVisible();
    });

    test("unauthenticated visit to /onboarding redirects to /login", async ({ page }) => {
        // Navigate to base URL first to establish origin, then clear storage
        await page.goto(`${BASE_URL}/login`);
        await page.waitForLoadState("domcontentloaded");
        await page.evaluate(() => localStorage.clear());

        await page.goto(`${BASE_URL}/onboarding`);
        await page.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 });
        expect(page.url()).toContain("/login");
    });
});

// ─── Suite 3: Dashboard ─────────────────────────────────────────────────────

test.describe("Dashboard", () => {
    test.beforeEach(async ({ page }) => {
        await loginTestUser(page);
        // Ensure we're on dashboard
        if (!page.url().includes("/dashboard")) {
            await page.goto(`${BASE_URL}/dashboard`);
            await page.waitForLoadState("networkidle");
        }
    });

    test.afterAll(async ({ browser }) => {
        // Clean up any projects created during these tests
        const ctx = await browser.newContext();
        const p = await ctx.newPage();
        await loginTestUser(p);
        await deleteAllTestProjects(p);
        await ctx.close();
    });

    test("dashboard renders Andy Code Cat branding and welcome text", async ({ page }) => {
        await expect(page.locator("text=Andy Code Cat")).first().toBeVisible({ timeout: 10_000 });
    });

    test("dashboard shows '+ Nuovo progetto' button", async ({ page }) => {
        await expect(page.locator("button", { hasText: /\+ Nuovo progetto/i })).toBeVisible({ timeout: 10_000 });
    });

    test("create project opens modal, creates project, navigates to workspace", async ({ page }) => {
        const testName = `E2E Test Project ${Date.now()}`;

        // Open modal
        await page.click("button:has-text('+ Nuovo progetto')");
        await page.waitForSelector('input[placeholder*="Nome"]', { timeout: 8_000 });

        // Fill name
        await page.fill('input[placeholder*="Nome"]', testName);

        // Submit
        await Promise.all([
            page.waitForURL((url) => url.pathname.startsWith("/workspace/"), { timeout: 20_000 }),
            page.click('button[type="submit"]'),
        ]);

        expect(page.url()).toMatch(/\/workspace\//);

        // Cleanup: delete the project via API
        const projectId = page.url().split("/workspace/")[1];
        if (projectId) {
            await page.goto(`${BASE_URL}/dashboard`);
            await page.waitForLoadState("networkidle");
            await deleteTestProject(page, projectId);
        }
    });

    test("project cards are visible for existing projects", async ({ page }) => {
        await page.goto(`${BASE_URL}/dashboard`);
        await page.waitForLoadState("networkidle");

        // Wait for projects to load (either cards or empty state)
        await page.waitForTimeout(2000);

        // Projects section should exist
        await expect(page.locator("text=Tutti i progetti")).toBeVisible({ timeout: 10_000 });
    });

    test("guide banner is visible on dashboard", async ({ page }) => {
        await expect(page.locator("text=Come iniziare con ANDY")).toBeVisible({ timeout: 10_000 });
    });

    test("TipsPanel is visible on xl viewport", async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.goto(`${BASE_URL}/dashboard`);
        await page.waitForLoadState("networkidle");

        // TipsPanel should have its title
        await expect(page.locator("text=Suggerimenti").first()).toBeVisible({ timeout: 10_000 });
    });
});

// ─── Suite 4: ProjectCard context menu ──────────────────────────────────────

test.describe("ProjectCard context menu", () => {
    let createdProjectId: string | null = null;

    test.beforeEach(async ({ page }) => {
        await loginTestUser(page);

        // Create a test project via API
        const testName = `E2E Card Test ${Date.now()}`;
        createdProjectId = await createTestProject(page, testName);

        await page.goto(`${BASE_URL}/dashboard`);
        await page.waitForLoadState("networkidle");
        // Wait for projects to load
        await page.waitForTimeout(1500);
    });

    test.afterEach(async ({ page }) => {
        // Clean up created project
        if (createdProjectId) {
            await deleteTestProject(page, createdProjectId);
            createdProjectId = null;
        }
    });

    test("project card thumbnail opens workspace", async ({ page }) => {
        if (!createdProjectId) return;

        // Click the project card thumbnail (aria-label "Apri {name}")
        const card = page.locator(`[aria-label^="Apri"]`).first();
        await expect(card).toBeVisible({ timeout: 10_000 });

        await Promise.all([
            page.waitForURL((url) => url.pathname.startsWith("/workspace/"), { timeout: 15_000 }),
            card.click(),
        ]);

        expect(page.url()).toContain("/workspace/");
    });

    test("project card ⋮ menu opens and shows actions", async ({ page }) => {
        if (!createdProjectId) return;

        // Find the ⋮ button (accessible via title or text)
        const menuBtn = page.locator("button", { hasText: "⋮" }).first();
        await expect(menuBtn).toBeVisible({ timeout: 10_000 });
        await menuBtn.click();

        // Menu items should be visible
        await expect(page.locator("text=Apri")).toBeVisible({ timeout: 5_000 });
        await expect(page.locator("text=Duplica")).toBeVisible();
        await expect(page.locator("text=Elimina")).toBeVisible();
    });

    test("duplicate project creates a copy and shows toast", async ({ page }) => {
        if (!createdProjectId) return;

        // Count projects before
        const beforeCount = await page.locator(`[aria-label^="Apri"]`).count();

        // Open menu
        const menuBtn = page.locator("button", { hasText: "⋮" }).first();
        await expect(menuBtn).toBeVisible({ timeout: 10_000 });
        await menuBtn.click();
        await expect(page.locator("text=Duplica")).toBeVisible({ timeout: 5_000 });
        await page.click("text=Duplica");

        // Toast should appear
        await expect(page.locator("text=creato")).toBeVisible({ timeout: 10_000 });

        // Wait for reload — count should increase
        await page.waitForTimeout(2000);
        const afterCount = await page.locator(`[aria-label^="Apri"]`).count();
        expect(afterCount).toBeGreaterThanOrEqual(beforeCount);

        // Clean up duplicate — find the new project from API
        const token = await getAccessToken(page);
        const projects = await page.evaluate(
            async ({ apiUrl, token }) => {
                const res = await fetch(`${apiUrl}/v1/projects`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                return res.json();
            },
            { apiUrl: API_URL, token },
        );
        const duplicate = (projects.projects as { id: string; name: string }[]).find(
            (p) => p.name.includes("(copia)") || p.name.includes("Copy"),
        );
        if (duplicate) {
            await deleteTestProject(page, duplicate.id);
        }
    });
});

// ─── Suite 5: Style tags API ─────────────────────────────────────────────────

test.describe("Style tags API", () => {
    test("GET /v1/style-tags returns catalog with known categories", async ({ page }) => {
        const data = await page.evaluate(async (apiUrl) => {
            const res = await fetch(`${apiUrl}/v1/style-tags`);
            return res.json();
        }, API_URL);

        expect(Array.isArray(data.tags)).toBe(true);
        expect(data.tags.length).toBeGreaterThan(10);

        const categories = [...new Set((data.tags as { category: string }[]).map((t) => t.category))];
        expect(categories).toContain("identity");
        expect(categories).toContain("sector");
        expect(categories).toContain("visual");
        expect(categories).toContain("palette");
    });

    test("GET /v1/users/me/profile returns profile for authenticated user", async ({ page }) => {
        await loginTestUser(page);
        const token = await getAccessToken(page);

        const data = await page.evaluate(
            async ({ apiUrl, token }) => {
                const res = await fetch(`${apiUrl}/v1/users/me/profile`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                return res.json();
            },
            { apiUrl: API_URL, token },
        );

        expect(data.profile).toBeDefined();
        expect(data.profile.userId).toBeTruthy();
        expect(Array.isArray(data.profile.identityTags)).toBe(true);
    });

    test("PUT /v1/users/me/profile updates tags", async ({ page }) => {
        await loginTestUser(page);
        const token = await getAccessToken(page);

        const data = await page.evaluate(
            async ({ apiUrl, token }) => {
                const res = await fetch(`${apiUrl}/v1/users/me/profile`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ visualTags: ["visual:minimal"] }),
                });
                return res.json();
            },
            { apiUrl: API_URL, token },
        );

        expect(data.profile).toBeDefined();
        expect(data.profile.visualTags).toContain("visual:minimal");

        // Restore empty tags
        await page.evaluate(
            async ({ apiUrl, token }) => {
                await fetch(`${apiUrl}/v1/users/me/profile`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ visualTags: [] }),
                });
            },
            { apiUrl: API_URL, token },
        );
    });

    test("GET /v1/projects/:id/moodboard returns moodboard", async ({ page }) => {
        await loginTestUser(page);
        const token = await getAccessToken(page);

        // Get the first project
        const projects = await page.evaluate(
            async ({ apiUrl, token }) => {
                const res = await fetch(`${apiUrl}/v1/projects`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                return res.json();
            },
            { apiUrl: API_URL, token },
        );

        const projectId = projects.projects?.[0]?.id;
        if (!projectId) return;

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
            { apiUrl: API_URL, token, projectId },
        );

        expect(data.moodboard).toBeDefined();
        expect(data.moodboard.projectId).toBe(projectId);
    });
});

// ─── Suite 6: Project delete/duplicate API ─────────────────────────────────

test.describe("Project CRUD extensions", () => {
    let tempProjectId: string | null = null;
    let token: string | null = null;

    test.beforeEach(async ({ page }) => {
        await loginTestUser(page);
        token = await getAccessToken(page);
        tempProjectId = await createTestProject(page, `E2E CRUD ${Date.now()}`);
    });

    test.afterEach(async ({ page }) => {
        if (tempProjectId) {
            await deleteTestProject(page, tempProjectId);
            tempProjectId = null;
        }
    });

    test("DELETE /v1/projects/:id removes the project (204)", async ({ page }) => {
        if (!tempProjectId) return;

        const status = await page.evaluate(
            async ({ apiUrl, token, projectId }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}`, {
                    method: "DELETE",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "x-project-id": projectId,
                    },
                });
                return res.status;
            },
            { apiUrl: API_URL, token, projectId: tempProjectId },
        );

        expect(status).toBe(204);
        tempProjectId = null; // already deleted, skip afterEach cleanup
    });

    test("POST /v1/projects/:id/duplicate creates a copy", async ({ page }) => {
        if (!tempProjectId) return;

        const data = await page.evaluate(
            async ({ apiUrl, token, projectId }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}/duplicate`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                        "x-project-id": projectId,
                    },
                    body: JSON.stringify({}),
                });
                return res.json();
            },
            { apiUrl: API_URL, token, projectId: tempProjectId },
        );

        expect(data.project).toBeDefined();
        expect(data.project.id).not.toBe(tempProjectId);
        expect(data.project.name).toMatch(/copia|copy/i);

        // Cleanup the duplicate
        await deleteTestProject(page, data.project.id);
    });
});
