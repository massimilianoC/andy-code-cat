import { describe, expect, it, vi } from "vitest";

// GetPromptRegistry.ts -> taskPromptRegistry.ts -> VibeClassify.ts pulls in ../../../../config,
// which process.exit(1)s outside a real runtime env. Stub it exactly like VibeClassify.test.ts does.
vi.mock("../../../../config", () => ({
    env: {
        vibeClassifierEnabled: true,
        providerApiKeys: {},
        COST_POLICY_TEXT_EUR_PER_1K_TOKENS: 0.002,
        COST_POLICY_IMAGE_EUR_PER_ASSET: 0.02,
        COST_POLICY_VIDEO_EUR_PER_ASSET: 0.2,
        COST_POLICY_USD_TO_EUR_RATE: 0.92,
        COST_POLICY_PROVIDER_MARKUP_FACTOR: 1.2,
    },
}));

import { GetPromptRegistry } from "../GetPromptRegistry";
import {
    DEFAULT_PRODUCT_ATTACHMENT_POLICY,
    DEFAULT_PRODUCT_DOCUMENT_CONTEXT_POLICY,
    DEFAULT_PROMPT_TASK_SETTINGS,
} from "../../../../domain/entities/PlatformConfig";

describe("GetPromptRegistry", () => {
    it("policyDefaults deep-equals the real PlatformConfig default policy constants", async () => {
        const result = await new GetPromptRegistry().execute();
        expect(result.policyDefaults.attachmentPolicy).toEqual(DEFAULT_PRODUCT_ATTACHMENT_POLICY);
        expect(result.policyDefaults.documentContextPolicy).toEqual(DEFAULT_PRODUCT_DOCUMENT_CONTEXT_POLICY);
    });

    it("returns one task DTO per DEFAULT_PROMPT_TASK_SETTINGS key, each with a defaultTextHash", async () => {
        const result = await new GetPromptRegistry().execute();
        const taskKeys = new Set(result.tasks.map((task) => task.key));
        for (const key of Object.keys(DEFAULT_PROMPT_TASK_SETTINGS)) {
            expect(taskKeys.has(key), `missing task DTO for "${key}"`).toBe(true);
        }
        for (const task of result.tasks) {
            expect(task.defaultTextHash).toMatch(/^sha256:[0-9a-f]{16}$/);
        }
    });

    it("tasks without an operator slot expose an empty slots array and no operatorSlotId", async () => {
        const result = await new GetPromptRegistry().execute();
        for (const key of ["zero_effort_generate", "vibe_mode_generate", "god_mode_generate"]) {
            const task = result.tasks.find((t) => t.key === key);
            expect(task).toBeDefined();
            expect(task!.operatorSlotId).toBeUndefined();
            expect(task!.slots).toHaveLength(0);
        }
    });
});
