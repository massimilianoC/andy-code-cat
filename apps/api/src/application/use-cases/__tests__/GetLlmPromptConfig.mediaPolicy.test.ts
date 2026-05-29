import { describe, expect, it, vi } from "vitest";
import { GetLlmPromptConfig } from "../GetLlmPromptConfig";

describe("GetLlmPromptConfig media placeholder defaults", () => {
    it("returns a default editable prompt aligned with artifact media placeholders", async () => {
        const useCase = new GetLlmPromptConfig({
            findByProjectId: vi.fn(async () => null),
            upsertForProject: vi.fn(),
        } as any);

        const config = await useCase.execute("project-1");

        expect(config.prePromptTemplate).toContain("## IMAGES — platform media placeholders");
        expect(config.prePromptTemplate).toContain("asset://media/hero-main");
        expect(config.prePromptTemplate).toContain("data-media-key='hero-main'");
        expect(config.prePromptTemplate).toContain("media-manifest-v1");
        expect(config.prePromptTemplate).toContain("Never emit random/provider image URLs");
        expect(config.prePromptTemplate).not.toContain("LoremFlickr — semantic keyword images");
        expect(config.prePromptTemplate).not.toContain("https://loremflickr.com/<width>/<height>/<keyword>");
        expect(config.prePromptTemplate).not.toContain("https://picsum.photos/seed/<keyword>/<width>/<height>");
    });
});