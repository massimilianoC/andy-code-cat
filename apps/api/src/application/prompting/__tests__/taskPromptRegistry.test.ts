import { describe, expect, it, vi } from "vitest";

// VibeClassify.ts (imported transitively via taskPromptRegistry.ts) pulls in ../../config,
// which process.exit(1)s outside a real runtime env. Stub it exactly like VibeClassify.test.ts does.
vi.mock("../../../config", () => ({
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

import { DEFAULT_PROMPT_TASK_SETTINGS } from "../../../domain/entities/PlatformConfig";
import { buildClassifySystemPrompt } from "../../use-cases/VibeClassify";
import { VIBE_PREFILL_SYSTEM_PROMPT, VIBE_PREFILL_DATA_DASHBOARD_SYSTEM_PROMPT } from "../../use-cases/VibePrefill";
import { DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE } from "../optimizeUserPromptInstruction";
import { PROMPT_TASK_REGISTRY, getTaskDescriptor } from "../taskPromptRegistry";

describe("PROMPT_TASK_REGISTRY", () => {
    it("has a matching registry entry for every DEFAULT_PROMPT_TASK_SETTINGS key", () => {
        const registryKeys = new Set(PROMPT_TASK_REGISTRY.map((task) => task.key));
        for (const taskKey of Object.keys(DEFAULT_PROMPT_TASK_SETTINGS)) {
            expect(registryKeys.has(taskKey), `missing registry entry for "${taskKey}"`).toBe(true);
        }
    });

    it("getTaskDescriptor resolves every DEFAULT_PROMPT_TASK_SETTINGS key", () => {
        for (const taskKey of Object.keys(DEFAULT_PROMPT_TASK_SETTINGS)) {
            expect(getTaskDescriptor(taskKey), `getTaskDescriptor("${taskKey}") should not be undefined`).toBeDefined();
        }
    });

    it("returns undefined for an unknown key", () => {
        expect(getTaskDescriptor("not_a_real_task_key")).toBeUndefined();
    });

    it("vibe_intent_classify default text is byte-identical to the real backend classify prompt", () => {
        const descriptor = getTaskDescriptor("vibe_intent_classify");
        expect(descriptor).toBeDefined();
        expect(descriptor!.defaultText()).toBe(buildClassifySystemPrompt());
        expect(descriptor!.operatorSlotId).toBe("instruction");
    });

    it("vibe_intent_prefill default text is byte-identical to the real backend prefill prompt", () => {
        const descriptor = getTaskDescriptor("vibe_intent_prefill");
        expect(descriptor).toBeDefined();
        expect(descriptor!.defaultText()).toBe(VIBE_PREFILL_SYSTEM_PROMPT);
    });

    it("the data-dashboard prefill variant is reachable and byte-identical to the real backend prompt", () => {
        const descriptor = getTaskDescriptor("vibe_intent_prefill:data_dashboard");
        expect(descriptor).toBeDefined();
        expect(descriptor!.defaultText()).toBe(VIBE_PREFILL_DATA_DASHBOARD_SYSTEM_PROMPT);
    });

    it("zero_effort_optimize default text is byte-identical to DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE", () => {
        const descriptor = getTaskDescriptor("zero_effort_optimize");
        expect(descriptor).toBeDefined();
        expect(descriptor!.defaultText()).toBe(DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE);
    });

    it("zero_effort_generate, vibe_mode_generate and god_mode_generate have no operator slot", () => {
        for (const key of ["zero_effort_generate", "vibe_mode_generate", "god_mode_generate"]) {
            const descriptor = getTaskDescriptor(key);
            expect(descriptor, `missing descriptor for "${key}"`).toBeDefined();
            expect(descriptor!.operatorSlotId, `"${key}" must have no operator slot`).toBeUndefined();
            expect(descriptor!.slots, `"${key}" must have no slots`).toHaveLength(0);
        }
    });

    it("every task with an operatorSlotId has a matching slot in its slots array", () => {
        for (const task of PROMPT_TASK_REGISTRY) {
            if (task.operatorSlotId === undefined) continue;
            const match = task.slots.find((slot) => slot.id === task.operatorSlotId);
            expect(match, `task "${task.key}" declares operatorSlotId "${task.operatorSlotId}" but has no matching slot`).toBeDefined();
        }
    });
});
