import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import AdmZip from "adm-zip";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";

const manifest = {
    version: "service-manifest-v1",
    forms: [{
        id: "contact",
        kind: "contact",
        title: "Richiedi informazioni",
        description: "Raccontaci cosa ti serve.",
        purposeKey: "contact-request",
        steps: [{
            id: "identity",
            title: "I tuoi dati",
            fields: [{
                id: "email",
                type: "email",
                label: "Email",
                required: true,
                autocomplete: "email",
                dataCategory: "contact",
            }],
        }, {
            id: "request",
            title: "La richiesta",
            fields: [{
                id: "message",
                type: "textarea",
                label: "Messaggio",
                required: true,
                maxLength: 600,
                dataCategory: "request",
            }],
        }],
        submitLabel: "Prepara email",
        successMessage: "Bozza pronta.",
        privacyNoticeRef: "project-default",
    }],
} as const;

function headers(token: string, projectId: string) {
    return {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    };
}

async function expectOk(response: APIResponse) {
    if (!response.ok()) {
        throw new Error(`HTTP ${response.status()}: ${await response.text()}`);
    }
    return response;
}

async function registerAndLogin(request: APIRequestContext, email: string) {
    const password = "E2e-Forms-Pass#2026";
    const registration = await request.post(`${API_URL}/v1/auth/register`, {
        data: { email, password, firstName: "Forms", lastName: "E2E" },
    });
    if (!registration.ok() && registration.status() !== 409) {
        throw new Error(`Registration failed: ${registration.status()} ${await registration.text()}`);
    }
    const login = await expectOk(await request.post(`${API_URL}/v1/auth/login`, {
        data: { email, password },
    }));
    return (await login.json()).accessToken as string;
}

test.describe.serial("declarative form runtime", () => {
    let projectId = "";
    let token = "";

    test.beforeEach(async ({ request }) => {
        const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        token = await registerAndLogin(request, `forms-${runId}@andy-code-cat-e2e.invalid`);
        const projectResponse = await expectOk(await request.post(`${API_URL}/v1/projects`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { name: `Form runtime E2E ${runId}`, presetId: "form" },
        }));
        projectId = (await projectResponse.json()).project.id as string;
    });

    test.afterEach(async ({ request }) => {
        if (projectId) {
            await request.delete(`${API_URL}/v1/projects/${projectId}`, {
                headers: headers(token, projectId),
            });
        }
    });

    test("owner configuration, Layer V, snapshot, preview, publish and ZIP stay coherent", async ({ page, request }) => {
        const initialSettings = {
            enabled: true,
            mode: "mailto",
            recipientEmail: "owner-v1@example.test",
            privacyNotice: {
                version: "2026-07-14",
                url: "https://example.test/privacy",
                controllerName: "Example SRL",
                contactEmail: "privacy@example.test",
            },
        };

        await expectOk(await request.put(`${API_URL}/v1/projects/${projectId}/services/forms`, {
            headers: headers(token, projectId),
            data: initialSettings,
        }));

        const otherToken = await registerAndLogin(
            request,
            `forms-other-${Date.now()}@andy-code-cat-e2e.invalid`,
        );
        const denied = await request.get(`${API_URL}/v1/projects/${projectId}/services/forms`, {
            headers: headers(otherToken, projectId),
        });
        expect(denied.status()).toBe(403);

        const promptResponse = await expectOk(await request.get(
            `${API_URL}/v1/projects/${projectId}/llm/prompt-preview?uiLanguage=it`,
            { headers: headers(token, projectId) },
        ));
        const prompt = await promptResponse.json();
        const layerV = prompt.layers.find((layer: { id: string }) => layer.id === "V");
        const layerS = prompt.layers.find((layer: { id: string }) => layer.id === "S");
        expect(layerV.chars).toBeGreaterThan(0);
        expect(prompt.effectiveSystemPrompt.slice(layerV.span[0], layerV.span[1])).toContain("serviceManifest");
        expect(prompt.effectiveSystemPrompt.slice(layerS.span[0], layerS.span[1])).not.toContain("recipientEmail");
        expect(prompt.effectiveSystemPrompt).not.toContain(initialSettings.recipientEmail);

        const conversationResponse = await expectOk(await request.get(
            `${API_URL}/v1/projects/${projectId}/conversation`,
            { headers: headers(token, projectId) },
        ));
        const conversationId = (await conversationResponse.json()).conversation.id as string;

        const snapshotResponse = await expectOk(await request.post(
            `${API_URL}/v1/projects/${projectId}/preview-snapshots`,
            {
                headers: headers(token, projectId),
                data: {
                    conversationId,
                    artifacts: {
                        html: "<main><section><div data-pf-form-id='contact'></div></section></main>",
                        css: "body{font-family:sans-serif}",
                        js: "",
                    },
                    serviceManifest: manifest,
                    metadata: { structuredParseValid: true },
                    activate: true,
                },
            },
        ));
        const snapshot = (await snapshotResponse.json()).snapshot;
        expect(snapshot.artifacts.html).toContain("data-pf-form-runtime");
        expect(snapshot.artifacts.js).not.toContain(initialSettings.recipientEmail);
        expect(snapshot.artifacts.html).toContain(initialSettings.recipientEmail);
        expect(snapshot.runtimePlan.version).toBe("runtime-plan-v1");
        expect(snapshot.runtimePlan.assets.map((asset: { fileName: string }) => asset.fileName)).toContain("pf-forms-mailto.v1.js");

        const updatedSettings = { ...initialSettings, recipientEmail: "owner-v2@example.test" };
        await expectOk(await request.put(`${API_URL}/v1/projects/${projectId}/services/forms`, {
            headers: headers(token, projectId),
            data: updatedSettings,
        }));

        const refreshedResponse = await expectOk(await request.get(
            `${API_URL}/v1/projects/${projectId}/preview-snapshots/${snapshot.id}`,
            { headers: headers(token, projectId) },
        ));
        const refreshed = (await refreshedResponse.json()).snapshot;
        expect(refreshed.artifacts.html).toContain(updatedSettings.recipientEmail);
        expect(refreshed.artifacts.html).not.toContain(initialSettings.recipientEmail);
        expect(refreshed.artifacts.js).toBe("");

        const deploymentResponse = await expectOk(await request.post(
            `${API_URL}/v1/projects/${projectId}/publish`,
            { headers: headers(token, projectId), data: { snapshotId: snapshot.id } },
        ));
        const deployment = await deploymentResponse.json();

        const publishedHtmlResponse = await expectOk(await request.get(`${API_URL}${deployment.url}`));
        const publishedHtml = await publishedHtmlResponse.text();
        expect(publishedHtml.indexOf("pf-runtime-core.v1.js")).toBeLessThan(publishedHtml.indexOf("pf-forms-mailto.v1.js"));
        expect(publishedHtml).not.toContain(updatedSettings.recipientEmail);
        const publishedConfigResponse = await expectOk(await request.get(
            `${API_URL}${deployment.url.replace(/\/?$/, "/")}pf-runtime-config.v1.js`,
        ));
        expect(await publishedConfigResponse.text()).toContain(updatedSettings.recipientEmail);

        await page.goto(`${API_URL}${deployment.url}`);
        await page.evaluate(() => {
            (window as unknown as { capturedMailto?: Record<string, unknown> }).capturedMailto = undefined;
            document.addEventListener("pf:mailto", (event) => {
                event.preventDefault();
                const detail = (event as CustomEvent<Record<string, unknown>>).detail;
                (window as unknown as { capturedMailto?: Record<string, unknown> }).capturedMailto = detail;
            });
        });
        await page.getByLabel("Email").fill("visitor@example.test");
        await page.getByRole("button", { name: "Continua" }).click();
        await expect(page.getByText("Passaggio 2 di 2")).toBeVisible();
        await page.getByLabel("Messaggio").fill("Vorrei maggiori informazioni");
        await page.getByRole("button", { name: "Prepara email" }).click();
        const mailtoEvent = await page.waitForFunction(() => (
            window as unknown as { capturedMailto?: Record<string, unknown> }
        ).capturedMailto || null).then((handle) => handle.jsonValue() as Promise<Record<string, unknown>>);
        expect(mailtoEvent).toMatchObject({
            version: "pf-event-v1",
            formId: "contact",
            mode: "mailto",
            status: "draft-requested",
        });
        expect(JSON.stringify(mailtoEvent)).not.toContain(updatedSettings.recipientEmail);
        expect(JSON.stringify(mailtoEvent)).not.toContain("visitor@example.test");
        await expect(page.getByRole("status")).toContainText("Verifica la tua app email");

        const exportResponse = await expectOk(await request.post(
            `${API_URL}/v1/projects/${projectId}/export/layer1`,
            { headers: headers(token, projectId), data: { snapshotId: snapshot.id, conversationId } },
        ));
        const exportRecord = await exportResponse.json();
        expect(exportRecord.filesIncluded).toContain("serviceManifest.json");
        const zipResponse = await expectOk(await request.get(
            `${API_URL}/v1/exports/${exportRecord.id}/download`,
            { headers: { Authorization: `Bearer ${token}` } },
        ));
        const zip = new AdmZip(await zipResponse.body());
        expect(zip.getEntry("serviceManifest.json")).not.toBeNull();
        expect(zip.getEntry("pf-runtime-core.v1.js")).not.toBeNull();
        expect(zip.getEntry("pf-forms-ui.v1.js")).not.toBeNull();
        expect(zip.getEntry("pf-forms-mailto.v1.js")).not.toBeNull();
        expect(zip.readAsText("pf-runtime-config.v1.js")).toContain(updatedSettings.recipientEmail);

        await expectOk(await request.delete(
            `${API_URL}/v1/projects/${projectId}/publish/${deployment.id}`,
            { headers: headers(token, projectId) },
        ));
    });

    test("invalid generated JavaScript cannot disable preview services or pass activation/publish gates", async ({ page, request }) => {
        await expectOk(await request.put(`${API_URL}/v1/projects/${projectId}/services/forms`, {
            headers: headers(token, projectId),
            data: {
                enabled: true,
                mode: "mailto",
                recipientEmail: "owner@example.test",
                privacyNotice: {
                    version: "2026-07-15",
                    url: "https://example.test/privacy",
                    controllerName: "Example SRL",
                    contactEmail: "privacy@example.test",
                },
            },
        }));
        const conversationResponse = await expectOk(await request.get(
            `${API_URL}/v1/projects/${projectId}/conversation`,
            { headers: headers(token, projectId) },
        ));
        const conversationId = (await conversationResponse.json()).conversation.id as string;
        const invalidJs = `const artifactStarted = true;\n/* mediaManifest */ { "version": "media-manifest-v1" }`;
        const createResponse = await expectOk(await request.post(
            `${API_URL}/v1/projects/${projectId}/preview-snapshots`,
            {
                headers: headers(token, projectId),
                data: {
                    conversationId,
                    artifacts: {
                        html: "<main><div data-pf-form-id='contact'></div></main>",
                        css: "",
                        js: invalidJs,
                    },
                    serviceManifest: manifest,
                    metadata: { structuredParseValid: true },
                    activate: false,
                },
            },
        ));
        const snapshot = (await createResponse.json()).snapshot;
        await page.setContent(`<!doctype html><html><head><style>${snapshot.artifacts.css}</style></head><body>${snapshot.artifacts.html}<script>${snapshot.artifacts.js}<\/script></body></html>`);
        await expect(page.locator("form[data-pf-form-id='contact']")).toHaveAttribute("data-pf-mounted", "true");

        const activateResponse = await request.post(
            `${API_URL}/v1/projects/${projectId}/preview-snapshots/${snapshot.id}/activate`,
            { headers: headers(token, projectId), data: { conversationId } },
        );
        expect(activateResponse.status()).toBe(422);
        expect(await activateResponse.text()).toContain("artifacts.js");

        const publishResponse = await request.post(`${API_URL}/v1/projects/${projectId}/publish`, {
            headers: headers(token, projectId),
            data: { snapshotId: snapshot.id },
        });
        expect(publishResponse.status()).toBe(422);
        expect(await publishResponse.text()).toContain("artifacts.js");
    });
});
