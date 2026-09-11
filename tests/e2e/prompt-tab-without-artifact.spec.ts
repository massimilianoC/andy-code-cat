/**
 * The Prompt tab must show what was sent even when the model built nothing.
 *
 * Reproduces a production report of 2026-09-11, on a Project Mode project whose only replies were
 * chat-only (a question, correctly answered in words). The journal was complete — the work session
 * existed, the generate row carried its id, the detail endpoint returned every prompt body — and
 * the Prompt tab still showed nothing. The API access log settled it: across four loads of that
 * workspace the browser never once asked for `/work-sessions`. The tab rendered its content behind
 * `artifacts &&`, like the code tabs, so a turn without code never mounted the inspector at all.
 *
 * That is the turn whose prompt most needs reading, so this test makes one on purpose: a real
 * question, a real provider, then the Prompt tab. Real HTTP, no mock anywhere in it.
 */
import { expect, test } from "@playwright/test";
import { API_URL, BASE_URL, createTestProject, deleteTestProject, getAccessToken, loginTestUser } from "./helpers/test-user";

const QUESTION =
    "Che differenza c'è tra un sito one-page e un sito multipagina? Rispondi solo a parole in chat, non generare codice.";

test.describe("prompt tab", () => {
    let projectId: string | undefined;

    test.afterEach(async ({ page }) => {
        if (projectId && !process.env.E2E_KEEP_PROJECT) await deleteTestProject(page, projectId);
    });

    test("shows the journalled generation for a turn that produced no code", async ({ page }) => {
        test.setTimeout(300_000);

        await loginTestUser(page);
        projectId = await createTestProject(page, `prompt-tab-${Date.now()}`, "website");

        // The workspace sends autoPrompt through handleSend — the Project Mode chat path, which
        // opens the work session as part of the generation (llmRoutes resolveGenerationWorkSessionId).
        //
        // skipAutoOptimize=1 is not a convenience: it IS the reported case. The first production
        // turn went out raw (167 characters, no optimize row). With the optimizer on, the question
        // is rewritten into a build brief carrying the project's preset context, and the model
        // builds a site — measured on the first run of this test, which then passed for the wrong
        // reason.
        const generation = page.waitForResponse(
            (res) => /\/llm\/chat-preview/.test(res.url()) && res.request().method() === "POST",
            { timeout: 240_000 },
        );
        await page.goto(`${BASE_URL}/workspace/${projectId}?skipAutoOptimize=1&autoPrompt=${encodeURIComponent(QUESTION)}`);
        const response = await generation;
        expect(response.status(), "the generation itself must succeed").toBeLessThan(300);

        // The turn is settled when the page persists its outcome, not when the stream opens:
        // asserting "no code" earlier raced the artifact render on the first attempt. Whatever
        // the outcome — a reply, or the error card a non-JSON reply produces — it is written as a
        // conversation message, and any snapshot is saved before it (the message carries its id).
        // waitForResponse on a stream resolves at the headers, so this wait starts before the end.
        await page.waitForResponse(
            (res) => /\/conversations\/[^/]+\/messages$/.test(res.url()) && res.request().method() === "POST",
            { timeout: 240_000 },
        );

        // The precondition, measured on the API rather than read off a screen that may not have
        // caught up: this turn must really have produced no artifact, or the test is exercising
        // the path that already worked. A model is free to build anyway; that is reported as a
        // skip with the reason, never counted as a pass.
        const token = await getAccessToken(page);
        const snapshotCount = await page.evaluate(
            async ({ apiUrl, token, projectId }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}/preview-snapshots`, {
                    headers: { Authorization: `Bearer ${token}`, "x-project-id": projectId },
                });
                const body = await res.json();
                return (body.snapshots ?? body).length as number;
            },
            { apiUrl: API_URL, token, projectId },
        );
        test.skip(snapshotCount > 0, `precondition not met: the model built code (${snapshotCount} snapshot) — nothing about the no-artifact path was exercised`);
        await expect(page.getByText(/Nessun codice generato|No generated code/)).toBeVisible();

        await page.getByRole("button", { name: /PROMPT/ }).click();

        // The inspector mounted and read the journal: the Generation block carries the prompts
        // that were sent. Not asserted verbatim — auto-optimize may have rewritten the text, and
        // what was SENT is what this view must show.
        await expect(page.getByText("User prompt sent")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(/Nessuna attività registrata|No activity recorded/)).toHaveCount(0);

        // And the journal agrees with the screen: one session, one generate row inside it.
        const sessions = await page.evaluate(
            async ({ apiUrl, token, projectId }) => {
                const res = await fetch(`${apiUrl}/v1/projects/${projectId}/work-sessions`, {
                    headers: { Authorization: `Bearer ${token}`, "x-project-id": projectId },
                });
                return (await res.json()).sessions as Array<{ id: string; entryMode: string }>;
            },
            { apiUrl: API_URL, token, projectId },
        );
        expect(sessions.length, "the first generation opens exactly one session").toBe(1);
        expect(sessions[0]!.entryMode).toBe("workspace");
    });
});
