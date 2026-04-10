/**
 * E2E test helpers — isolated bot account.
 *
 * The bot account (BOT_EMAIL / BOT_PASSWORD) is a dedicated user that only
 * exists for automated testing.  It is created on first use via the register
 * endpoint; subsequent calls simply log in.
 *
 * AUTH_BYPASS_EMAIL_VERIFICATION=true must be set in the running stack so the
 * bot account is immediately active after registration.
 */
import type { Page } from "@playwright/test";

export const BASE_URL = "http://localhost:8081";
export const API_URL = "http://localhost:4000";

const BOT_EMAIL = "bot@andy-code-cat-e2e.invalid";
const BOT_PASSWORD = "E2e-Bot-Pass#2024";

/* ─── registration / login ─────────────────────────────────────────────── */

/**
 * Registers the bot account if needed, then logs in and injects JWT tokens
 * into localStorage.  Safe to call in every beforeEach — idempotent.
 */
export async function loginTestUser(page: Page): Promise<void> {
    // Establish an origin so localStorage writes work
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");

    // Try to register (may return 409 if already exists — that's fine)
    await page.evaluate(
        async ({ apiUrl, email, password }) => {
            await fetch(`${apiUrl}/v1/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email,
                    password,
                    firstName: "E2E",
                    lastName: "Bot",
                }),
            });
        },
        { apiUrl: API_URL, email: BOT_EMAIL, password: BOT_PASSWORD },
    );

    // Login
    const tokens = await page.evaluate(
        async ({ apiUrl, email, password }) => {
            const res = await fetch(`${apiUrl}/v1/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            if (!res.ok) throw new Error(`Login failed: ${res.status}`);
            return res.json();
        },
        { apiUrl: API_URL, email: BOT_EMAIL, password: BOT_PASSWORD },
    );

    await page.evaluate((t: Record<string, string>) => {
        localStorage.setItem("pf_access_token", t.accessToken ?? "");
        localStorage.setItem("pf_refresh_token", t.refreshToken ?? "");
    }, tokens);
}

/* ─── token access ──────────────────────────────────────────────────────── */

/** Returns the current bot access token from localStorage. */
export async function getAccessToken(page: Page): Promise<string> {
    return page.evaluate(() => localStorage.getItem("pf_access_token") ?? "");
}

/* ─── project helpers ───────────────────────────────────────────────────── */

/**
 * Creates a project for the bot user via API.
 * @returns The created project ID.
 */
export async function createTestProject(
    page: Page,
    name: string,
    presetId?: string,
): Promise<string> {
    const token = await getAccessToken(page);
    const projectId = await page.evaluate(
        async ({ apiUrl, token, name, presetId }) => {
            const body: Record<string, unknown> = { name };
            if (presetId) body.presetId = presetId;
            const res = await fetch(`${apiUrl}/v1/projects`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`createTestProject failed: ${res.status}`);
            const data = await res.json();
            return data.project?.id ?? data.id;
        },
        { apiUrl: API_URL, token, name, presetId: presetId ?? null },
    );
    if (!projectId) throw new Error("createTestProject: no id returned");
    return projectId;
}

/**
 * Deletes a single project by ID using the bot's token.
 * Silently ignores 404 (already deleted).
 */
export async function deleteTestProject(page: Page, projectId: string): Promise<void> {
    const token = await getAccessToken(page);
    await page.evaluate(
        async ({ apiUrl, token, projectId }) => {
            await fetch(`${apiUrl}/v1/projects/${projectId}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "x-project-id": projectId,
                },
            });
        },
        { apiUrl: API_URL, token, projectId },
    );
}

/**
 * Deletes ALL projects owned by the bot user EXCEPT the "Default Project"
 * created at registration.  LoginUser requires at least one project to exist
 * (to bind the session), so we must always keep the default project alive.
 * Use in afterAll to leave the database clean.
 */
export async function deleteAllTestProjects(page: Page): Promise<void> {
    const token = await getAccessToken(page);
    const projects = await page.evaluate(
        async ({ apiUrl, token }) => {
            const res = await fetch(`${apiUrl}/v1/projects`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.projects as { id: string; name: string }[]) ?? [];
        },
        { apiUrl: API_URL, token },
    );
    for (const p of projects) {
        // Keep the default project so subsequent loginTestUser calls succeed
        if (p.name === "Default Project") continue;
        await deleteTestProject(page, p.id);
    }
}

/* ─── second-user helpers ────────────────────────────────────────────────── */

const BOT2_EMAIL = "bot2@andy-code-cat-e2e.invalid";
const BOT2_PASSWORD = "E2e-Bot2-Pass#2024";

/**
 * Registers (if needed) and logs in a *second* bot user —
 * used in sandbox isolation tests.
 * @returns The access token for bot2.
 */
export async function loginSecondTestUser(page: Page): Promise<string> {
    // Register (idempotent)
    await page.evaluate(
        async ({ apiUrl, email, password }) => {
            await fetch(`${apiUrl}/v1/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email,
                    password,
                    firstName: "E2E",
                    lastName: "Bot2",
                }),
            });
        },
        { apiUrl: API_URL, email: BOT2_EMAIL, password: BOT2_PASSWORD },
    );

    // Login
    const tokens = await page.evaluate(
        async ({ apiUrl, email, password }) => {
            const res = await fetch(`${apiUrl}/v1/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            if (!res.ok) throw new Error(`Bot2 login failed: ${res.status}`);
            return res.json();
        },
        { apiUrl: API_URL, email: BOT2_EMAIL, password: BOT2_PASSWORD },
    );

    return tokens.accessToken ?? "";
}

/**
 * Deletes ALL projects owned by bot2 except the default project.
 * Use in afterAll.
 */
export async function deleteAllBot2Projects(page: Page, bot2Token: string): Promise<void> {
    const projects = await page.evaluate(
        async ({ apiUrl, token }) => {
            const res = await fetch(`${apiUrl}/v1/projects`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.projects as { id: string; name: string }[]) ?? [];
        },
        { apiUrl: API_URL, token: bot2Token },
    );
    await page.evaluate(
        async ({ apiUrl, token, items }) => {
            for (const p of items) {
                if (p.name === "Default Project") continue;
                await fetch(`${apiUrl}/v1/projects/${p.id}`, {
                    method: "DELETE",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "x-project-id": p.id,
                    },
                });
            }
        },
        { apiUrl: API_URL, token: bot2Token, items: projects },
    );
}
