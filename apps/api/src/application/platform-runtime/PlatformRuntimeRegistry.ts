import { createHash } from "node:crypto";
import type { RuntimeAssetV1, RuntimePlanV1 } from "@andy-code-cat/contracts";
import { PF_FORMS_MAILTO_V1, PF_FORMS_UI_V1, PF_RUNTIME_CORE_V1 } from "./browserRuntimeAssets";

export interface PlatformRuntimeModule {
    id: string;
    version: `v${number}`;
    fileName: `pf-${string}.js`;
    dependencies: readonly string[];
    content: string;
}

export interface PlatformRuntimePackage {
    plan: RuntimePlanV1;
    files: Record<string, string>;
    tags: string;
}

const MODULES: readonly PlatformRuntimeModule[] = [
    { id: "runtime-core", version: "v1", fileName: "pf-runtime-core.v1.js", dependencies: [], content: PF_RUNTIME_CORE_V1 },
    { id: "forms-ui", version: "v1", fileName: "pf-forms-ui.v1.js", dependencies: ["runtime-core"], content: PF_FORMS_UI_V1 },
    { id: "forms-mailto", version: "v1", fileName: "pf-forms-mailto.v1.js", dependencies: ["runtime-core", "forms-ui"], content: PF_FORMS_MAILTO_V1 },
] as const;

const MODULE_BY_ID = new Map(MODULES.map((module) => [module.id, module]));

function sha256(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

function resolveModules(requestedIds: readonly string[]): PlatformRuntimeModule[] {
    const ordered: PlatformRuntimeModule[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string) => {
        if (visited.has(id)) return;
        if (visiting.has(id)) throw new Error(`Platform runtime dependency cycle at '${id}'`);
        const module = MODULE_BY_ID.get(id);
        if (!module) throw Object.assign(new Error(`Unsupported platform runtime module '${id}'`), { statusCode: 422 });
        visiting.add(id);
        module.dependencies.forEach(visit);
        visiting.delete(id);
        visited.add(id);
        ordered.push(module);
    };

    requestedIds.forEach(visit);
    return ordered;
}

function safeConfigSource(config: Record<string, unknown>): string {
    const json = JSON.stringify(config)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
    return `;window.PageForgeRuntime.configure(${json});`;
}

function inlineTag(asset: RuntimeAssetV1, content: string): string {
    const safe = content.replace(/<\/script/gi, "<\\/script");
    return `<script data-pf-runtime-module='${asset.id}' data-pf-runtime-sha256='${asset.sha256}'>${safe}</script>`;
}

function externalTag(asset: RuntimeAssetV1): string {
    return `<script data-pf-runtime-module='${asset.id}' src='${asset.fileName}?v=${asset.sha256.slice(0, 12)}'></script>`;
}

export function buildPlatformRuntimePackage(input: {
    moduleIds: readonly string[];
    publicConfig: Record<string, unknown>;
    delivery: "inline-preview" | "external-files";
}): PlatformRuntimePackage {
    const modules = resolveModules(input.moduleIds);
    const configContent = safeConfigSource(input.publicConfig);
    const configAsset: RuntimeAssetV1 = {
        id: "runtime-config",
        version: "v1",
        fileName: "pf-runtime-config.v1.js",
        kind: "config",
        sha256: sha256(configContent),
        dependencies: ["runtime-core"],
    };

    const moduleAssets: RuntimeAssetV1[] = modules.map((module) => ({
        id: module.id,
        version: module.version,
        fileName: module.fileName,
        kind: "module",
        sha256: sha256(module.content),
        dependencies: [...module.dependencies],
    }));
    const coreIndex = moduleAssets.findIndex((asset) => asset.id === "runtime-core");
    const assets = [...moduleAssets];
    assets.splice(coreIndex + 1, 0, configAsset);

    const contentById = new Map(modules.map((module) => [module.id, module.content]));
    contentById.set(configAsset.id, configContent);
    const files = Object.fromEntries(assets.map((asset) => [asset.fileName, contentById.get(asset.id)!]));
    const tags = assets.map((asset) => input.delivery === "inline-preview"
        ? inlineTag(asset, contentById.get(asset.id)!)
        : externalTag(asset)).join("\n");

    return {
        plan: {
            version: "runtime-plan-v1",
            capabilities: [{ id: "forms", mode: "mailto", manifestVersion: "service-manifest-v1" }],
            assets,
        },
        files,
        tags,
    };
}

export function injectRuntimeTags(html: string, tags: string): string {
    if (!tags || html.includes("data-pf-runtime-module='runtime-core'")) return html;
    if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tags}\n</body>`);
    return `${html}\n${tags}`;
}

/** Removes only scripts carrying the platform-owned runtime marker. */
export function stripPlatformRuntimeTags(html: string): string {
    return html.replace(
        /[ \t\r\n]*<script\b(?=[^>]*\bdata-pf-runtime-module\s*=)[^>]*>[\s\S]*?<\/script>\s*/gi,
        "",
    );
}
