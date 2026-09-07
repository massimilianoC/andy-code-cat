import { expect, test } from "@playwright/test";
import {
    API_URL,
    createTestPreviewSnapshot,
    createTestProject,
    deleteTestProject,
    getAccessToken,
    loginTestUser,
} from "./helpers/test-user";

/**
 * Didactic knowledge generation, end to end against the running stack.
 *
 * Written to retry a real failure rather than to describe a hypothetical one. On 2026-09-07 two
 * `didactic_knowledge_generate` runs failed at 10:51 with a bare `fetch failed`; the reason was an
 * expired certificate on the configured provider, and nothing in the product said so. The provider
 * has since been changed, and this is the check that the path actually works again — real HTTP,
 * real provider, real money, no mock anywhere in it.
 *
 * The artifact is seeded through the same endpoint the workspace uses rather than generated, so
 * the only model call in the test is the one under test.
 */

/** Small but genuinely explainable: the model has to find something to say about it. */
const ARTIFACT = {
    html: `<!doctype html><html><body><main>
<h1 id="title">Contatore</h1>
<button id="inc">Aggiungi</button>
<p>Totale: <span id="total">0</span></p>
</main></body></html>`,
    css: "main { padding: 2rem; font-family: sans-serif; } button { padding: .5rem 1rem; }",
    js: `const total = document.getElementById("total");
document.getElementById("inc").addEventListener("click", () => {
    total.textContent = String(Number(total.textContent) + 1);
});`,
};

test.describe("didactic knowledge", () => {
    let projectId: string;

    test.afterEach(async ({ page }) => {
        if (projectId) await deleteTestProject(page, projectId);
    });

    test("generates knowledge for a snapshot and reports why when it cannot", async ({ page }) => {
        // The generation is a live model call; 60s is not enough for it.
        test.setTimeout(240_000);

        await loginTestUser(page);
        projectId = await createTestProject(page, `didactic-${Date.now()}`);
        const snapshotId = await createTestPreviewSnapshot(page, projectId, "didactic-v1");

        const token = await getAccessToken(page);

        // Overwrite the helper's placeholder artifacts with something that has a mechanism to
        // explain — the helper's filler paragraph gives the model nothing to anchor to.
        const seeded = await page.evaluate(
            async ({ apiUrl, token, projectId, artifacts }) => {
                const headers = {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "x-project-id": projectId,
                };
                const conv = await fetch(`${apiUrl}/v1/projects/${projectId}/conversation`, { headers });
                const conversationId = (await conv.json()).conversation?.id;
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}/preview-snapshots`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        conversationId,
                        artifacts,
                        metadata: {
                            model: "e2e-didactic",
                            provider: "test",
                            finishReason: "manual-save",
                            structuredParseValid: true,
                        },
                        activate: true,
                    }),
                });
                return { status: res.status, id: (await res.json()).snapshot?.id };
            },
            { apiUrl: API_URL, token, projectId, artifacts: ARTIFACT },
        );
        expect(seeded.status, "seeding the snapshot must succeed before the test can mean anything").toBe(201);

        const result = await page.evaluate(
            async ({ apiUrl, token, projectId, snapshotId }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}/didactic/knowledge/generate`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                        "x-project-id": projectId,
                    },
                    body: JSON.stringify({ snapshotId, uiLanguage: "it" }),
                });
                return { status: res.status, body: await res.text() };
            },
            { apiUrl: API_URL, token, projectId, snapshotId: seeded.id ?? snapshotId },
        );

        // On failure the body is the diagnosis — print it, since that is the whole point of the
        // change this test accompanies.
        expect(result.status, `didactic generate returned ${result.status}: ${result.body.slice(0, 500)}`)
            .toBeLessThan(300);

        const knowledge = JSON.parse(result.body).knowledge;
        expect(knowledge.overview, "an overview the user can read").toBeTruthy();
        expect(Array.isArray(knowledge.topics)).toBe(true);
        expect(knowledge.topics.length, "at least one topic, or the panel is empty").toBeGreaterThan(0);
        expect(knowledge.snapshotId).toBe(seeded.id ?? snapshotId);

        // Asserted here and not after the test, because `deleteTestProject` cascades to both of
        // these (DeleteProject.ts) — checking them in teardown would find zero rows and prove
        // nothing. A generation that is not journalled is a generation nobody can cost or explain
        // afterwards (docs/specs/WORK_SESSION_TRACING_SPEC.md §2).
        const traced = await page.evaluate(
            async ({ apiUrl, token, projectId }) => {
                const headers = { Authorization: `Bearer ${token}`, "x-project-id": projectId };
                const usage = await fetch(`${apiUrl}/v1/projects/${projectId}/llm/prompt-usage-summary`, { headers });
                const cost = await fetch(`${apiUrl}/v1/projects/${projectId}/cost`, { headers });
                return { usage: await usage.json(), cost: await cost.json() };
            },
            { apiUrl: API_URL, token, projectId },
        );

        // The summary aggregates by provider/model and carries no taskKey, so the assertion is on
        // the shape it actually has: exactly this generation, with the tokens it really spent.
        expect(traced.usage.runs, "the generation must be journalled").toBeGreaterThanOrEqual(1);
        expect(traced.usage.totalTokens, "a journalled run with no tokens is a row nobody can cost")
            .toBeGreaterThan(0);
        expect(traced.usage.topModels?.[0]?.provider).toBe("openrouter");

        expect(JSON.stringify(traced.cost), "the run must appear in the project cost")
            .toContain("llm.didactic.knowledge");
    });
});
