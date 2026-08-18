// Minimal, conservative ESLint flat config for the API workspace.
//
// Goal: make `npm run lint` do something real without blocking on the large
// pre-existing codebase. typescript-eslint's "recommended" ruleset (not
// "strict") is used, and a handful of stylistic/noisy rules are downgraded
// to warnings so this can run in CI without failing the build on day one.
// Tighten this over time as the codebase is cleaned up incrementally.
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**"],
    },
    ...tseslint.configs.recommended,
    {
        rules: {
            // Common in this codebase (error handling, dynamic payloads, etc.) —
            // warn instead of error so `lint` reports real signal without
            // requiring a full rewrite as part of this hygiene pass.
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "@typescript-eslint/no-empty-object-type": "warn",
            "@typescript-eslint/no-require-imports": "warn",
        },
    },
);
