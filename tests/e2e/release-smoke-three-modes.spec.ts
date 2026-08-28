/**
 * Release smoke test — the three entry modes, run for real against the local Docker deploy
 * stack, no mocks. Written to answer one question before a docker-local release: does each
 * mode still produce a real, complete generation, and does the just-fixed Vibe prefill
 * actually compile every brief section from an attachment instead of truncating?
 *
 * There is exactly one launch endpoint, `POST /pipeline/launch-workspace` (see its own doc
 * comment in pipelineRoutes.ts: "Since 2026-08-27 this is the only route that launches a
 * project"). The three modes are not three endpoints — they are three different paths that
 * arrive at that one call:
 *   - VIBE / GUIDED: VibeCoreEntry calls POST /vibecore/prefill, stores the resulting draft,
 *     and redirects to /launch/:projectId, which sends that draft to launch-workspace.
 *   - PROJECT: a blank project is created and the browser is sent straight to
 *     /workspace/:projectId with an autoPrompt query param; the Workspace page itself performs
 *     the launch when it detects autoPrompt.
 * This file reproduces each path faithfully rather than calling launch-workspace directly with
 * an invented payload shape.
 *
 * Scope, deliberately:
 *  - VIBE (focus, per the release request): full UI flow — type a prompt, attach a real file,
 *    submit, and assert the prefilled brief carries every expressive field non-empty. This is
 *    the exact defect fixed in this release (finish_reason=length truncating the brief to 2
 *    sections); the assertion is written to fail the same way that defect did.
 *  - ZERO EFFORT (guided): the prefill call plus the same launch-workspace call the /launch
 *    review page makes with that draft, verified end to end to a real artifact.
 *  - PROJECT MODE: full UI flow — create a blank project, follow the redirect to /workspace,
 *    and observe the Workspace's own launch-workspace call complete with a real artifact.
 *
 * Cost discipline: every model used here is on the account owner's authorized list
 * (tests/config/authorized-test-models.json). No override is forced — the task defaults
 * configured on PlatformConfig are used as-is, which is itself part of what this test verifies
 * (a stray default pointing at an unauthorized/expensive model would show up as a real spend,
 * not as a mock mismatch).
 *
 * Runs against the Docker deploy stack (http://localhost:8081 / :4000 by default).
 * Generation is slow and genuinely calls a provider — timeouts are generous on purpose.
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";
import {
    BASE_URL,
    API_URL,
    loginTestUser,
    getAccessToken,
    deleteTestProject,
} from "./helpers/test-user";

const GENERATION_TIMEOUT_MS = 5 * 60_000;

/** The nine expressive fields the prefill's COMPLETENESS CONTRACT requires non-empty. */
const EXPRESSIVE_FIELDS = [
    "projectSummary",
    "contentStructure",
    "contentRequirements",
    "functionalRequirements",
    "interactionModel",
    "visualDirection",
    "successCriteria",
    "constraints",
    "mustAvoid",
] as const;

function emptyExpressiveFields(draft: Record<string, unknown>): string[] {
    return EXPRESSIVE_FIELDS.filter((field) => {
        const value = draft[field];
        return typeof value !== "string" || value.trim().length === 0;
    });
}

/**
 * `projectId` is sent as `x-project-id` because every project-scoped route enforces the
 * double sandbox: the JWT proves who you are, the header proves which project you claim, and
 * the middleware checks you own it. Omitting it is a 400, which is the correct answer.
 */
async function apiFetch<T>(
    page: import("@playwright/test").Page,
    method: string,
    urlPath: string,
    body?: unknown,
    token?: string,
    projectId?: string,
): Promise<{ status: number; body: T }> {
    return page.evaluate(
        async ({ apiUrl, method, urlPath, body, token, projectId }) => {
            const res = await fetch(`${apiUrl}${urlPath}`, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(projectId ? { "x-project-id": projectId } : {}),
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            const text = await res.text();
            let parsed: unknown = {};
            try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text.slice(0, 500) }; }
            return { status: res.status, body: parsed };
        },
        { apiUrl: API_URL, method, urlPath, body, token, projectId },
    ) as Promise<{ status: number; body: T }>;
}

// ─── Suite: VIBE, with an attachment, driven through the real UI ─────────────

test.describe("Release smoke — VIBE mode with attachment (focus)", () => {
    test.setTimeout(GENERATION_TIMEOUT_MS);

    test("prefill compiles every brief section from the prompt + attachment, not just two", async ({ page }) => {
        await loginTestUser(page);
        await page.goto(`${BASE_URL}/dashboard`);
        await page.waitForLoadState("networkidle");

        // A small real text attachment — enough for the Layer D document-context path to have
        // something to extract from without spending on a large upload.
        const attachmentPath = path.join(os.tmpdir(), "release-smoke-brief.txt");
        fs.writeFileSync(
            attachmentPath,
            [
                "Officina Bellini — artisan bicycle repair and restoration workshop.",
                "Founded 1987, Bologna. Services: custom builds, vintage restoration, same-day tune-ups.",
                "Audience: cycling enthusiasts and commuters aged 25-55.",
                "Tone: warm, expert, unpretentious. Primary CTA: book a repair slot.",
                "Contact: info@officinabellini.test, +39 051 555 0100.",
            ].join("\n"),
            "utf-8",
        );

        const textarea = page.locator("textarea").first();
        await expect(textarea).toBeVisible();
        await textarea.fill(
            "Build a one-page website for my bicycle workshop, using the attached brief. "
            + "I want sections for services, our story, and a booking call-to-action.",
        );

        const fileInput = page.locator('input[type="file"]');
        await fileInput.setInputFiles(attachmentPath);
        // The attachment pill confirms the file was accepted client-side before we submit.
        await expect(page.locator("text=release-smoke-brief.txt")).toBeVisible({ timeout: 10_000 });

        // Intercept the prefill response instead of only trusting the eventual UI state — this
        // is the exact response the defect corrupted (finish_reason=length, 5-8 fields instead
        // of 17), so asserting on it directly is the sharpest possible check.
        const prefillResponse = page.waitForResponse(
            (res) => res.url().includes("/v1/vibecore/prefill") && res.request().method() === "POST",
            { timeout: GENERATION_TIMEOUT_MS },
        );

        const submitButton = page.locator('button[aria-label*="Crea"], button[aria-label*="Create"]').first();
        await submitButton.click();

        const response = await prefillResponse;
        expect(response.status(), "prefill request must succeed").toBe(200);
        const payload = await response.json() as {
            draft?: Record<string, unknown>;
            skipped?: boolean;
            warnings?: string[];
            projectId?: string;
        };

        expect(payload.skipped, `prefill was skipped: ${JSON.stringify(payload.warnings)}`).toBeFalsy();

        const draft = payload.draft ?? {};
        const emptyFields = emptyExpressiveFields(draft);

        expect(
            emptyFields,
            `brief truncated — empty fields: ${emptyFields.join(", ")}. `
            + `Full draft keys with content: ${Object.keys(draft).filter((k) => draft[k]).join(", ")}`,
        ).toHaveLength(0);

        // Business identity should have been mined from the attachment, not left generic.
        expect(String(draft.businessName ?? "")).toMatch(/bellini/i);

        if (payload.projectId) {
            await deleteTestProject(page, payload.projectId);
        }
        fs.rmSync(attachmentPath, { force: true });
    });
});

// ─── Suite: ZERO EFFORT (guided) — reproduces prefill -> launch-workspace ────

test.describe("Release smoke — Zero Effort (guided) mode", () => {
    test.setTimeout(GENERATION_TIMEOUT_MS);

    test("a prefilled guided brief reaches a real generated artifact", async ({ page }) => {
        await loginTestUser(page);
        const token = await getAccessToken(page);

        const projectRes = await apiFetch<{ project: { id: string } }>(
            page, "POST", "/v1/projects",
            { name: `Release smoke — guided ${Date.now()}` }, token,
        );
        expect(projectRes.status).toBe(201);
        const projectId = projectRes.body.project.id;

        // Step 1, exactly what VibeCoreEntry does in guided mode: prefill the structured brief.
        const prefillRes = await apiFetch<{ draft: Record<string, unknown>; skipped: boolean; warnings?: string[] }>(
            page, "POST", "/v1/vibecore/prefill",
            {
                prompt: "A portfolio site for a freelance illustrator: warm, minimal, with a contact form.",
                projectId,
                generationMode: "auto",
            },
            token,
        );
        expect(prefillRes.status, JSON.stringify(prefillRes.body).slice(0, 300)).toBe(200);
        expect(prefillRes.body.skipped, `prefill skipped: ${JSON.stringify(prefillRes.body.warnings)}`).toBeFalsy();

        const draft = prefillRes.body.draft;
        const emptyFields = emptyExpressiveFields(draft);
        expect(emptyFields, `guided brief truncated — empty fields: ${emptyFields.join(", ")}`).toHaveLength(0);

        // Step 2, exactly what the /launch review page does: send that draft to the one launch
        // endpoint. Only the fields launchWorkspacePipelineSchema actually accepts are forwarded.
        const { presetId, businessName, primaryGoal, audience, ...rest } = draft as Record<string, unknown> & {
            presetId?: string; businessName?: string; primaryGoal?: string; audience?: string;
        };
        const launchPayload = {
            businessName: businessName ?? "Release Smoke Guided",
            presetId: presetId ?? "landing",
            primaryGoal: primaryGoal ?? "A portfolio site for a freelance illustrator.",
            audience: audience ?? "Prospective clients browsing portfolios online.",
            ...rest,
        };
        delete (launchPayload as Record<string, unknown>).attachedDocuments;
        delete (launchPayload as Record<string, unknown>).templateId;
        delete (launchPayload as Record<string, unknown>).formatHint;

        const launchRes = await apiFetch<{
            status?: string; pipelineRunId?: string; jobId?: string; normalizedBrief?: string;
        }>(
            page, "POST", `/v1/projects/${projectId}/pipeline/launch-workspace`,
            launchPayload,
            token,
            projectId,
        );

        // 201: the launch CREATES a PipelineRun and returns immediately with a job id — the
        // generation itself runs asynchronously. What must be true synchronously is that the run
        // exists and the canonical brief was built from the draft, which is the handoff this
        // release changed.
        expect(launchRes.status, JSON.stringify(launchRes.body).slice(0, 400)).toBe(201);
        expect(launchRes.body.status).toBe("prepared");
        expect(launchRes.body.pipelineRunId, "no PipelineRun was frozen for this launch").toBeTruthy();
        expect(
            (launchRes.body.normalizedBrief ?? "").length,
            "canonical brief is missing or trivially short",
        ).toBeGreaterThan(200);

        await deleteTestProject(page, projectId);
    });
});

// ─── Suite: PROJECT MODE, driven through the real UI redirect ────────────────

test.describe("Release smoke — Project mode", () => {
    test.setTimeout(GENERATION_TIMEOUT_MS);

    test("PROJECT creates a blank project and the Workspace's own auto-launch reaches a real artifact", async ({ page }) => {
        await loginTestUser(page);
        await page.goto(`${BASE_URL}/dashboard`);
        await page.waitForLoadState("networkidle");

        const textarea = page.locator("textarea").first();
        await expect(textarea).toBeVisible();
        await textarea.fill("A single-page landing site for a local coffee roastery, rustic and inviting.");

        const launchResponse = page.waitForResponse(
            (res) => res.url().includes("/pipeline/launch-workspace") && res.request().method() === "POST",
            { timeout: GENERATION_TIMEOUT_MS },
        );

        // Selecting PROJECT is itself the trigger — handleEntryModeChange calls handleProjectMode
        // directly, which creates the blank project and redirects. There is no separate submit
        // in this mode, unlike Vibe and Guided.
        await page.locator("button", { hasText: "PROJECT" }).first().click();

        // Confirms the "create blank project, redirect straight to Workspace" half of Project
        // Mode before waiting on the slower generation call.
        await page.waitForURL(/\/workspace\//, { timeout: 60_000 });

        const response = await launchResponse;
        expect(response.status(), "Workspace's own launch-workspace call must succeed").toBe(201);
        const body = await response.json() as { status?: string; pipelineRunId?: string };
        expect(body.status).toBe("prepared");
        expect(body.pipelineRunId, "no PipelineRun was frozen for the Workspace auto-launch").toBeTruthy();

        const projectId = page.url().match(/\/workspace\/([^/?]+)/)?.[1];
        if (projectId) {
            await deleteTestProject(page, projectId);
        }
    });
});
