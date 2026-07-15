import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:8081";

export default defineConfig({
    testDir: "./tests/e2e",
    outputDir: "./tests/test-results",
    timeout: 60_000,
    retries: 0,
    reporter: [["list"], ["html", { open: "never", outputFolder: "tests/e2e/report" }]],
    use: {
        baseURL,
        headless: true,
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
