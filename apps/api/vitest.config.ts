import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.ts"],
        testTimeout: 15000,
        // MongoMemoryServer downloads a real mongod binary on first run (E2E
        // route tests under src/presentation/http/routes/__tests__), which can
        // take well past the 10s vitest default hook timeout.
        hookTimeout: 60000,
    },
});
