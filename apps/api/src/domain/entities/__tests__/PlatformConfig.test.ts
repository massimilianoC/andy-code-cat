import { describe, expect, it } from "vitest";

import { resolvePromptTaskSettingFromConfig } from "../PlatformConfig";

describe("resolvePromptTaskSettingFromConfig", () => {
    it("uses a rich-output budget for zero-effort prompt optimization", () => {
        const task = resolvePromptTaskSettingFromConfig(null, "default", "zero_effort_optimize");

        expect(task.maxCompletionTokens).toBe(32000);
    });

    it("upgrades the persisted legacy zero-effort optimizer budget", () => {
        const task = resolvePromptTaskSettingFromConfig({
            governanceByProduct: {
                default: {
                    promptTaskSettings: {
                        zero_effort_optimize: {
                            maxCompletionTokens: 1200,
                        },
                    },
                },
            },
        } as any, "default", "zero_effort_optimize");

        expect(task.maxCompletionTokens).toBe(32000);
    });

    it("preserves an explicit non-legacy zero-effort optimizer budget", () => {
        const task = resolvePromptTaskSettingFromConfig({
            governanceByProduct: {
                default: {
                    promptTaskSettings: {
                        zero_effort_optimize: {
                            maxCompletionTokens: 16000,
                        },
                    },
                },
            },
        } as any, "default", "zero_effort_optimize");

        expect(task.maxCompletionTokens).toBe(16000);
    });

    it("uses a rich-output budget for optimize_user_prompt (full creative-brief rewrite)", () => {
        const task = resolvePromptTaskSettingFromConfig(null, "default", "optimize_user_prompt");

        expect(task.maxCompletionTokens).toBe(32000);
    });

    it("upgrades the persisted legacy optimize_user_prompt budget", () => {
        const task = resolvePromptTaskSettingFromConfig({
            governanceByProduct: {
                default: {
                    promptTaskSettings: {
                        optimize_user_prompt: {
                            maxCompletionTokens: 1200,
                        },
                    },
                },
            },
        } as any, "default", "optimize_user_prompt");

        expect(task.maxCompletionTokens).toBe(32000);
    });

    it("preserves an explicit non-legacy optimize_user_prompt budget", () => {
        const task = resolvePromptTaskSettingFromConfig({
            governanceByProduct: {
                default: {
                    promptTaskSettings: {
                        optimize_user_prompt: {
                            maxCompletionTokens: 18000,
                        },
                    },
                },
            },
        } as any, "default", "optimize_user_prompt");

        expect(task.maxCompletionTokens).toBe(18000);
    });
});
