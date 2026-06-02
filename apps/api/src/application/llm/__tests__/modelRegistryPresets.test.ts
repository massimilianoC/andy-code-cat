import { describe, expect, it } from "vitest";

import { decorateSeedModel } from "../modelRegistryPresets";

function makeModel(id: string) {
    return {
        id,
        provider: "siliconflow",
        role: "dialogue" as const,
        capabilities: ["chat"],
        isDefault: true,
        isFallback: false,
        isActive: true,
    };
}

describe("decorateSeedModel", () => {
    it("adds a strict execution protocol for MiniMax models", () => {
        const model = decorateSeedModel(makeModel("MiniMaxAI/MiniMax-M3"));

        expect(model.promptTemplate).toContain("## MINIMAX EXECUTION PROTOCOL");
        expect(model.promptTemplate).toContain("Do not expose chain-of-thought");
        expect(model.promptTemplate).toContain("asset://media/<key>, style.css, and script.js");
    });

    it("does not duplicate the MiniMax protocol when a decorated model is refreshed", () => {
        const once = decorateSeedModel(makeModel("MiniMaxAI/MiniMax-M3"));
        const twice = decorateSeedModel(once);

        expect(twice.promptTemplate?.match(/## MINIMAX EXECUTION PROTOCOL/g)).toHaveLength(1);
    });
});
