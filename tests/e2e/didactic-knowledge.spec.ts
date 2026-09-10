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
        // E2E_KEEP_PROJECT leaves the project behind so its journal and cost rows can be read
        // directly; teardown cascades both away (DeleteProject.ts), which makes an after-the-fact
        // inspection impossible. Off by default — the suite must not accumulate projects.
        if (projectId && !process.env.E2E_KEEP_PROJECT) await deleteTestProject(page, projectId);
        if (process.env.E2E_KEEP_PROJECT) console.log(`E2E_KEEP_PROJECT: kept project ${projectId}`);
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

    test("uses the model the user selected, and refuses one that is not available", async ({ page }) => {
        // The rule this pins: a model the user picks is the model the request runs on. Didactic
        // Mode used to re-derive one from stored preferences, so the user chose a model in the
        // workspace header and paid for a different one.
        test.setTimeout(240_000);

        await loginTestUser(page);
        projectId = await createTestProject(page, `didactic-model-${Date.now()}`);
        const snapshotId = await createTestPreviewSnapshot(page, projectId, "didactic-model-v1");
        const token = await getAccessToken(page);

        const post = (body: Record<string, unknown>) => page.evaluate(
            async ({ apiUrl, token, projectId, body }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}/didactic/knowledge/generate`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                        "x-project-id": projectId,
                    },
                    body: JSON.stringify(body),
                });
                return { status: res.status, body: await res.text() };
            },
            { apiUrl: API_URL, token, projectId, body },
        );

        // An explicitly requested model the catalog does not offer must be refused, never swapped
        // for a working one — a silent substitution is the exact failure being prevented.
        const refused = await post({
            snapshotId,
            uiLanguage: "it",
            provider: "openrouter",
            model: "definitely/not-a-real-model",
        });
        expect(refused.status, `expected a refusal, got ${refused.body.slice(0, 300)}`).toBe(409);
        expect(refused.body).toContain("SELECTED_MODEL_UNAVAILABLE");

        // A model that IS offered must be the one the journal records.
        const chosen = await page.evaluate(
            async ({ apiUrl, token }) => {
                const res = await fetch(`${apiUrl}/v1/llm/providers`, { headers: { Authorization: `Bearer ${token}` } });
                const json = await res.json();
                const providers = json.providers ?? json;
                const openrouter = providers.find((p: { provider: string }) => p.provider === "openrouter");
                // Cheapest authorized model on the list (tests/config/authorized-test-models.json)
                // that this catalog actually offers, so the assertion does not fund an expensive run.
                const preferred = ["google/gemma-4-26b-a4b-it", "google/gemma-4-31b-it", "minimax/minimax-m3"];
                const active = (openrouter?.models ?? []).filter((m: { isActive: boolean }) => m.isActive);
                const pick = preferred.map((id) => active.find((m: { id: string }) => m.id === id)).find(Boolean);
                return pick?.id as string | undefined;
            },
            { apiUrl: API_URL, token },
        );
        test.skip(!chosen, "no authorized openrouter model is active in this catalog");

        const ok = await post({ snapshotId, uiLanguage: "it", provider: "openrouter", model: chosen });
        expect(ok.status, `generate failed: ${ok.body.slice(0, 400)}`).toBeLessThan(300);
        expect(JSON.parse(ok.body).knowledge.model, "the run must use the selected model, not a re-derived one")
            .toBe(chosen);
    });
});
