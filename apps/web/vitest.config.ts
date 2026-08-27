import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    // Mirrors tsconfig.json's "@/*" -> "./*" mapping. Modules under apps/web use the "@/"
    // convention throughout; without this alias, vitest fails to resolve them at import time
    // even when the test only exercises an unrelated export from the same file.
    resolve: {
        alias: {
            "@": path.resolve(__dirname),
        },
    },
    test: {
        globals: true,
        environment: "node",
        include: ["**/*.test.ts", "**/*.test.tsx"],
        exclude: ["node_modules", ".next"],
        testTimeout: 15000,
    },
});
