import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
process.env.LLM_TEMPLATE_SKILLS_ENABLED ??= "true";

let tmpRoot = "";

async function loadModules() {
    const [skills, composer] = await Promise.all([
        import("../templateSkillsLayer"),
        import("../systemPromptComposer"),
    ]);
    return { ...skills, ...composer };
}

function writeSkill(presetId: string, fileName: string, body: string) {
    const dir = path.join(tmpRoot, "by-template", presetId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), body, "utf8");
}

describe("Template Skills Layer S filesystem resolver", () => {
    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "andy-layer-s-"));
    });

    afterEach(() => {
        if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
        tmpRoot = "";
    });

    it("serializes every Markdown skill in the selected template folder deterministically", async () => {
        const { resolveFilesystemTemplateSkills } = await loadModules();
        writeSkill("landing", "z-second.md", "# Second\n\nSecond body");
        writeSkill("landing", "a-first.md", "# First\n\nFirst body");
        writeSkill("landing", "README.md", "# Folder notes\n\nNot injected");

        const resolved = resolveFilesystemTemplateSkills({
            presetId: "landing",
            rootPath: tmpRoot,
            maxChars: 10_000,
        });

        expect(resolved).not.toBeNull();
        expect(resolved!.documents.map((doc) => doc.id)).toEqual(["a-first", "z-second"]);
        expect(resolved!.layer).toContain("## LAYER S — TEMPLATE SKILLS");
        expect(resolved!.layer).toContain("Template id: landing");
        expect(resolved!.layer).toContain("Source: by-template/landing/a-first.md");
        expect(resolved!.layer).not.toContain("Folder notes");
    });

    it("drops whole skill files when the Layer S budget is full", async () => {
        const { resolveFilesystemTemplateSkills } = await loadModules();
        writeSkill("website", "a-small.md", "# Small\n\nFits");
        writeSkill("website", "b-large.md", "# Large\n\nThis content should not fit within the tiny budget.");

        const resolved = resolveFilesystemTemplateSkills({
            presetId: "website",
            rootPath: tmpRoot,
            maxChars: 130,
        });

        expect(resolved).not.toBeNull();
        expect(resolved!.documents.map((doc) => doc.id)).toEqual(["a-small"]);
        expect(resolved!.skipped).toContainEqual({ fileName: "b-large.md", reason: "budget_exceeded" });
        expect(resolved!.layer).toContain("Skills omitted by budget");
    });

    it("returns null for missing or invalid template ids", async () => {
        const { resolveFilesystemTemplateSkills } = await loadModules();
        expect(resolveFilesystemTemplateSkills({ presetId: "missing", rootPath: tmpRoot })).toBeNull();
        expect(() => resolveFilesystemTemplateSkills({ presetId: "../landing", rootPath: tmpRoot })).toThrow(
            "Invalid template skill preset id",
        );
    });

    it("is injected by the canonical composer as real Layer S content", async () => {
        const { resolveFilesystemTemplateSkills, composeSystemPromptWithLayers } = await loadModules();
        writeSkill("landing", "premium-landing-art-direction.md", "# Premium Landing\n\nMake it specific.");

        const resolved = resolveFilesystemTemplateSkills({
            presetId: "landing",
            rootPath: tmpRoot,
            maxChars: 10_000,
        });
        const composed = composeSystemPromptWithLayers({
            presetId: "landing",
            skillsLayer: resolved?.layer,
            sources: { S: "filesystem-template-skills:landing:premium-landing-art-direction" },
        });

        const layerS = composed.layers.find((layer) => layer.id === "S")!;
        expect(layerS.chars).toBeGreaterThan(0);
        expect(layerS.source).toBe("filesystem-template-skills:landing:premium-landing-art-direction");
        expect(composed.composed.slice(layerS.span[0], layerS.span[1])).toContain("PF_LAYER id=S");
        expect(composed.composed).toContain("Make it specific.");
    });
});
