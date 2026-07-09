import fs from "fs";
import path from "path";
import { env } from "../../config";

const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MARKDOWN_FILE_PATTERN = /\.md$/i;
const EXCLUDED_MARKDOWN = new Set(["README.md"]);

export interface TemplateSkillDocument {
    id: string;
    fileName: string;
    relativePath: string;
    body: string;
}

export interface ResolvedTemplateSkillsLayer {
    presetId: string;
    folderPath: string;
    documents: TemplateSkillDocument[];
    skipped: Array<{ fileName: string; reason: "budget_exceeded" | "empty" }>;
    layer: string;
}

export function resolveTemplateSkillFolder(root: string, presetId: string): string {
    if (!PRESET_ID_PATTERN.test(presetId)) {
        throw new Error(`Invalid template skill preset id: ${presetId}`);
    }

    return path.resolve(root, "by-template", presetId);
}

export function buildTemplateSkillsLayer(input: {
    presetId: string;
    folderPath: string;
    rootPath: string;
    documents: TemplateSkillDocument[];
    skipped: ResolvedTemplateSkillsLayer["skipped"];
}): string {
    if (input.documents.length === 0) return "";

    const lines: string[] = [
        "## LAYER S — TEMPLATE SKILLS",
        "",
        `Template id: ${input.presetId}`,
        "Selection source: filesystem by-template folder",
        "Apply these skill manuals as template-specific craft guidance. They complement Layer B; they do not override Layer A platform rules, Layer B viewport mode, Layer E response format, or the output budget policy.",
        "",
    ];

    for (const document of input.documents) {
        lines.push(
            `### Skill ${document.id}`,
            `Source: ${document.relativePath}`,
            "",
            document.body.trim(),
            "",
        );
    }

    if (input.skipped.length > 0) {
        lines.push(
            "### Skills omitted by budget",
            ...input.skipped.map((entry) => `- ${entry.fileName}: ${entry.reason}`),
        );
    }

    return lines.join("\n").trim();
}

export function resolveFilesystemTemplateSkills(input: {
    presetId?: string | null;
    rootPath?: string;
    maxChars?: number;
    enabled?: boolean;
}): ResolvedTemplateSkillsLayer | null {
    if (input.enabled === false || !env.templateSkillsEnabled) return null;
    if (!input.presetId) return null;

    const rootPath = path.resolve(input.rootPath ?? env.templateSkillsRoot);
    const folderPath = resolveTemplateSkillFolder(rootPath, input.presetId);
    if (!fs.existsSync(folderPath)) return null;

    const maxChars = input.maxChars ?? env.LLM_TEMPLATE_SKILLS_MAX_CHARS;
    const files = fs.readdirSync(folderPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => MARKDOWN_FILE_PATTERN.test(name))
        .filter((name) => !EXCLUDED_MARKDOWN.has(name))
        .sort((a, b) => a.localeCompare(b));

    const documents: TemplateSkillDocument[] = [];
    const skipped: ResolvedTemplateSkillsLayer["skipped"] = [];
    let usedChars = 0;

    for (const fileName of files) {
        const absolutePath = path.join(folderPath, fileName);
        const body = fs.readFileSync(absolutePath, "utf8").trim();
        if (!body) {
            skipped.push({ fileName, reason: "empty" });
            continue;
        }

        const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, "/");
        const id = fileName.replace(/\.md$/i, "");
        const projected = body.length + id.length + relativePath.length + 64;
        if (usedChars + projected > maxChars) {
            skipped.push({ fileName, reason: "budget_exceeded" });
            continue;
        }

        documents.push({ id, fileName, relativePath, body });
        usedChars += projected;
    }

    const layer = buildTemplateSkillsLayer({
        presetId: input.presetId,
        folderPath,
        rootPath,
        documents,
        skipped,
    });

    if (!layer) return null;
    return {
        presetId: input.presetId,
        folderPath,
        documents,
        skipped,
        layer,
    };
}
