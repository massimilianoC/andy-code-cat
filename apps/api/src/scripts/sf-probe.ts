/**
 * sf-probe.ts — SiliconFlow model probe script
 *
 * Runs a minimal inference on every text/image/embedding model available in your
 * SiliconFlow account and produces a coverage & discovery report.
 *
 * What it does:
 *  1. Fetches the live model list from /v1/models
 *  2. For each text model: sends one chat/completions call (max_tokens=5)
 *  3. For each embedding model: sends one /v1/embeddings call
 *  4. For each image-gen model: sends one /v1/images/generations call (steps=1, n=1)
 *  5. Checks response headers for any cost indicators (x-request-cost, x-credits, etc.)
 *  6. Saves the full raw report to docs/cost-providers/sf-probe-<date>.json
 *  7. Prints a coverage diff: models not in siliconflowPricing.ts
 *
 * Usage:
 *   cd apps/api && npx tsx src/scripts/sf-probe.ts
 *   Or from monorepo root: npm run sf:probe -w apps/api
 *
 * Env vars:
 *   SILICONFLOW_API_KEY  — required
 *   SILICONFLOW_BASE_URL — optional, defaults to https://api.siliconflow.com/v1
 *   SF_PROBE_DELAY_MS    — optional ms between calls, defaults to 800
 *   SF_PROBE_MAX_TOKENS  — output tokens per chat call, defaults to 400
 *   SF_PROBE_IMAGES      — set to "1" to also probe image-gen models (costs money!)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

// ── Load env from monorepo root ──────────────────────────────────────────────
// Use process.cwd() as primary (script is run from monorepo root via npx tsx@latest)
// Fall back to __dirname resolution in case it runs from apps/api/
function findMonorepoRoot(): string {
    const cwd = process.cwd();
    // If cwd contains package.json with workspaces, it's likely the root
    if (fs.existsSync(path.join(cwd, "package.json")) && fs.existsSync(path.join(cwd, "docker-compose.yml"))) {
        return cwd;
    }
    // Fallback: walk up from __dirname
    try {
        return path.resolve(__dirname, "../../../..");
    } catch {
        return cwd;
    }
}

const monorepoRoot = findMonorepoRoot();
dotenv.config({ path: path.join(monorepoRoot, ".env") });

const API_KEY = process.env.SILICONFLOW_API_KEY?.trim() ?? "";
const BASE_URL = (process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.com/v1").replace(/\/$/, "");
const DELAY_MS = parseInt(process.env.SF_PROBE_DELAY_MS ?? "800", 10);
const MAX_TOKENS = parseInt(process.env.SF_PROBE_MAX_TOKENS ?? "400", 10);
const PROBE_IMAGES = process.env.SF_PROBE_IMAGES === "1";
const REPORT_DIR = path.join(monorepoRoot, "docs", "cost-providers");

if (!API_KEY) {
    console.error("❌  SILICONFLOW_API_KEY is not set. Add it to .env at the monorepo root.");
    process.exit(1);
}

// ── Known prices table (from siliconflowPricing.ts) for coverage diff ───────
// Duplicated here so the script runs standalone without the TS import chain.
const KNOWN_MODEL_IDS = new Set([
    "deepseek-ai/DeepSeek-V3.2", "deepseek-ai/DeepSeek-V3.2-Exp",
    "deepseek-ai/DeepSeek-V3.1-Terminus", "deepseek-ai/DeepSeek-V3.1",
    "deepseek-ai/DeepSeek-R1", "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", "deepseek-ai/DeepSeek-V3",
    "Qwen/Qwen3-32B", "Qwen/Qwen3-14B", "Qwen/Qwen3-8B", "Qwen/QwQ-32B",
    "Qwen/Qwen3-235B-A22B-Instruct-2507", "Qwen/Qwen3-235B-A22B-Thinking-2507",
    "Qwen/Qwen3-30B-A3B-Instruct-2507", "Qwen/Qwen3-30B-A3B-Thinking-2507",
    "Qwen/Qwen3-Coder-480B-A35B-Instruct", "Qwen/Qwen3-Coder-480B-A35B",
    "Qwen/Qwen3-Coder-30B-A3B-Instruct", "Qwen/Qwen3-Coder-30B-A3B-Instruct-2507",
    "Qwen/Qwen3-VL-235B-A22B-Instruct", "Qwen/Qwen3-VL-235B-A22B-Thinking",
    "Qwen/Qwen3-VL-32B-Instruct", "Qwen/Qwen3-VL-32B-Thinking",
    "Qwen/Qwen3-VL-30B-A3B-Instruct", "Qwen/Qwen3-VL-30B-A3B-Thinking",
    "Qwen/Qwen3-VL-8B-Instruct",
    "Qwen/Qwen2.5-72B-Instruct", "Qwen/Qwen2.5-VL-72B-Instruct",
    "Qwen/Qwen2.5-VL-32B-Instruct", "Qwen/Qwen2.5-VL-7B-Instruct",
    "Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen2.5-32B-Instruct", "Qwen/Qwen2.5-Coder-32B-Instruct",
    "zai-org/GLM-5.1", "zai-org/GLM-5V-Turbo", "zai-org/GLM-5",
    "zai-org/GLM-4.7", "zai-org/GLM-4.6", "zai-org/GLM-4.6V",
    "zai-org/GLM-4.5-Air", "zai-org/GLM-4.5V", "THUDM/glm-4-9b-chat",
    "moonshotai/Kimi-K2-Instruct", "moonshotai/Kimi-K2-Instruct-0905", "moonshotai/Kimi-K2.5",
    "MiniMaxAI/MiniMax-M2.5",
    "tencent/Hunyuan-A13B-Instruct",
    "openai/gpt-oss-120b", "openai/gpt-oss-20b",
    "nex-agi/DeepSeek-V3.1-Nex-N1",
    "inclusionAI/Ling-flash-2.0", "inclusionAI/Ring-flash-2.0",
    "stepfun-ai/Step-3.5-Flash",
    "ByteDance-Seed/Seed-OSS-36B-Instruct",
    "baidu/ERNIE-4.5-300B-A47B",
    "BAAI/bge-m3", "BAAI/bge-large-en-v1.5",
    "Qwen/Qwen3-Embedding-8B", "Qwen/Qwen3-Embedding-4B", "Qwen/Qwen3-Embedding-0.6B",
    "black-forest-labs/FLUX.1-dev", "black-forest-labs/FLUX.1-schnell",
    "black-forest-labs/FLUX.1-Kontext-pro", "black-forest-labs/FLUX.1-Kontext-dev",
    "black-forest-labs/FLUX.1-Kontext-max", "black-forest-labs/FLUX.2-pro", "black-forest-labs/FLUX.2-flex",
    "black-forest-labs/FLUX-1.1-pro", "black-forest-labs/FLUX-1.1-pro-Ultra",
    "Wan-AI/Wan2.2-I2V-A14B", "Wan-AI/Wan2.2-T2V-A14B",
    "Qwen/Qwen-Image", "Qwen/Qwen-Image-Edit", "Tongyi-MAI/Z-Image-Turbo",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };
}

function costHeaders(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of headers.entries()) {
        const lk = k.toLowerCase();
        if (lk.includes("cost") || lk.includes("credit") || lk.includes("balance") ||
            lk.includes("usage") || lk.includes("ratelimit") || lk.includes("quota")) {
            out[k] = v;
        }
    }
    return out;
}

type ModelType = "chat" | "embedding" | "image" | "audio" | "unknown";

function classifyModel(id: string): ModelType {
    const l = id.toLowerCase();
    if (l.includes("flux") || l.includes("stable-diffusion") || l.includes("image") ||
        l.includes("kolors") || l.includes("z-image") || l.includes("wan") ||
        l.includes("cogvideo") || l.includes("kling") || l.includes("hunyuan-video") ||
        l.includes("janus")) return "image";
    if (l.includes("whisper") || l.includes("speech") || l.includes("tts") ||
        l.includes("audio")) return "audio";
    if (l.includes("bge") || l.includes("embed") || l.includes("e5-")) return "embedding";
    return "chat";
}

type ProbeResult = {
    id: string;
    type: ModelType;
    inKnownTable: boolean;
    status: "ok" | "error" | "skipped";
    httpStatus?: number;
    inputTokens?: number;
    outputTokens?: number;
    costHeaders: Record<string, string>;
    /** Any 'usage' or cost fields returned by the API response body */
    usageBody?: unknown;
    error?: string;
    latencyMs?: number;
};

// ── Probe functions ──────────────────────────────────────────────────────────
// Longer prompt (~100 tokens) to get meaningful billing data
const PROBE_PROMPT = `You are a helpful assistant. Please write a concise explanation \
(at least ${MAX_TOKENS} tokens) about the difference between supervised and unsupervised \
machine learning. Include examples of each approach and explain when to use them. \
Be thorough but clear.`;

async function probeChat(modelId: string): Promise<ProbeResult> {
    const base: Omit<ProbeResult, "status"> = {
        id: modelId, type: "chat", inKnownTable: KNOWN_MODEL_IDS.has(modelId), costHeaders: {}
    };
    const t0 = Date.now();
    try {
        const res = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
                model: modelId,
                messages: [{ role: "user", content: PROBE_PROMPT }],
                max_tokens: MAX_TOKENS,
                stream: false,
            }),
        });
        const latencyMs = Date.now() - t0;
        const ch = costHeaders(res.headers);
        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            return { ...base, status: "error", httpStatus: res.status, costHeaders: ch, error: errText.slice(0, 200), latencyMs };
        }
        const body = await res.json().catch(() => ({})) as {
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            [k: string]: unknown;
        };
        return {
            ...base,
            status: "ok",
            httpStatus: res.status,
            inputTokens: body.usage?.prompt_tokens,
            outputTokens: body.usage?.completion_tokens,
            costHeaders: ch,
            usageBody: body.usage,
            latencyMs,
        };
    } catch (e) {
        return { ...base, status: "error", costHeaders: {}, error: String(e), latencyMs: Date.now() - t0 };
    }
}

async function probeEmbedding(modelId: string): Promise<ProbeResult> {
    const base: Omit<ProbeResult, "status"> = {
        id: modelId, type: "embedding", inKnownTable: KNOWN_MODEL_IDS.has(modelId), costHeaders: {}
    };
    const t0 = Date.now();
    try {
        const res = await fetch(`${BASE_URL}/embeddings`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ model: modelId, input: "Hello world" }),
        });
        const latencyMs = Date.now() - t0;
        const ch = costHeaders(res.headers);
        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            return { ...base, status: "error", httpStatus: res.status, costHeaders: ch, error: errText.slice(0, 200), latencyMs };
        }
        const body = await res.json().catch(() => ({})) as { usage?: unknown;[k: string]: unknown };
        return { ...base, status: "ok", httpStatus: res.status, costHeaders: ch, usageBody: body.usage, latencyMs };
    } catch (e) {
        return { ...base, status: "error", costHeaders: {}, error: String(e), latencyMs: Date.now() - t0 };
    }
}

async function probeImage(modelId: string): Promise<ProbeResult> {
    const base: Omit<ProbeResult, "status"> = {
        id: modelId, type: "image", inKnownTable: KNOWN_MODEL_IDS.has(modelId), costHeaders: {}
    };
    const t0 = Date.now();
    try {
        const res = await fetch(`${BASE_URL}/images/generations`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
                model: modelId,
                prompt: "A red circle",
                n: 1,
                image_size: "256x256",
                num_inference_steps: 1,
            }),
        });
        const latencyMs = Date.now() - t0;
        const ch = costHeaders(res.headers);
        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            return { ...base, status: "error", httpStatus: res.status, costHeaders: ch, error: errText.slice(0, 200), latencyMs };
        }
        const body = await res.json().catch(() => ({}));
        return { ...base, status: "ok", httpStatus: res.status, costHeaders: ch, usageBody: body, latencyMs };
    } catch (e) {
        return { ...base, status: "error", costHeaders: {}, error: String(e), latencyMs: Date.now() - t0 };
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n🔍 SF Probe — ${BASE_URL}`);
    console.log(`   Max tokens per call : ${MAX_TOKENS}`);
    console.log(`   Delay between calls : ${DELAY_MS}ms`);
    console.log(`   Probe image models  : ${PROBE_IMAGES ? "YES (SF_PROBE_IMAGES=1)" : "no (skip)"}`);
    console.log(`   Monorepo root       : ${monorepoRoot}\n`);

    // 1. Fetch model list
    console.log("📋 Fetching model list...");
    const listRes = await fetch(`${BASE_URL}/models`, { headers: authHeaders() });
    if (!listRes.ok) {
        console.error(`❌ /models returned ${listRes.status}: ${await listRes.text()}`);
        process.exit(1);
    }
    const listBody = await listRes.json() as { data?: Array<{ id?: string; object?: string }> };
    const rawModels = (listBody.data ?? []).map((m) => String(m.id ?? "").trim()).filter(Boolean);
    console.log(`   Found ${rawModels.length} models in live list.\n`);

    const results: ProbeResult[] = [];

    for (const id of rawModels) {
        const type = classifyModel(id);
        const inTable = KNOWN_MODEL_IDS.has(id);
        process.stdout.write(`  [${type.padEnd(9)}] ${id.padEnd(55)} `);

        let result: ProbeResult;
        if (type === "chat") {
            result = await probeChat(id);
        } else if (type === "embedding") {
            result = await probeEmbedding(id);
        } else if (type === "image") {
            if (PROBE_IMAGES) {
                result = await probeImage(id);
            } else {
                result = { id, type, inKnownTable: inTable, status: "skipped", costHeaders: {} };
            }
        } else {
            result = { id, type, inKnownTable: inTable, status: "skipped", costHeaders: {} };
        }

        const icon = result.status === "ok" ? "✅" : result.status === "skipped" ? "⏭" : "❌";
        const tokens = result.inputTokens !== undefined
            ? `in=${result.inputTokens} out=${result.outputTokens}`
            : "";
        const costs = Object.keys(result.costHeaders).length > 0
            ? ` cost_hdrs=${JSON.stringify(result.costHeaders)}`
            : "";
        console.log(`${icon} ${result.httpStatus ?? "   "} ${tokens}${costs}`);

        if (!inTable && result.status === "ok") {
            console.log(`     ⚠️  NOT IN KNOWN TABLE — add to siliconflowPricing.ts`);
        }

        results.push(result);
        await sleep(DELAY_MS);
    }

    // 2. Generate report
    const dateTag = new Date().toISOString().slice(0, 10);
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        totalModels: rawModels.length,
        results,
        coverageGaps: results
            .filter((r) => !r.inKnownTable && r.status === "ok")
            .map((r) => r.id),
        retiredModels: [...KNOWN_MODEL_IDS].filter((id) => !rawModels.includes(id)),
        costHeadersFound: results
            .filter((r) => Object.keys(r.costHeaders).length > 0)
            .map((r) => ({ model: r.id, headers: r.costHeaders })),
    };

    const reportPath = path.join(REPORT_DIR, `sf-probe-${dateTag}.json`);
    try {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
        console.log(`\n📄 Report saved to: ${reportPath}`);
    } catch (e) {
        console.error(`\n⚠️  Could not save report JSON: ${e}`);
        console.error(`    REPORT_DIR resolved to: ${REPORT_DIR}`);
    }

    // 3. Print summary
    console.log("\n─────────────────────────────────────────────────────────────────");
    console.log("📊 Summary");
    console.log(`   Total live models : ${rawModels.length}`);
    console.log(`   OK (probed)       : ${results.filter(r => r.status === "ok").length}`);
    console.log(`   Errored           : ${results.filter(r => r.status === "error").length}`);
    console.log(`   Skipped           : ${results.filter(r => r.status === "skipped").length}`);
    console.log(`   Cost headers found: ${report.costHeadersFound.length}`);

    if (report.coverageGaps.length > 0) {
        console.log(`\n⚠️  COVERAGE GAPS — ${report.coverageGaps.length} models NOT in siliconflowPricing.ts:`);
        for (const id of report.coverageGaps) {
            console.log(`   "${id}": { input: ???, output: ???, priceUnit: "per_m_tokens" },`);
        }
        console.log("\n   → Add these to siliconflowPricing.ts with prices from siliconflow.com/pricing");
        console.log("   → Or run sf-billing-import.ts after downloading the billing CSV to derive prices.");
    } else {
        console.log("\n✅ All probed models are covered in siliconflowPricing.ts.");
    }

    if (report.retiredModels.length > 0) {
        console.log(`\n🗑  RETIRED/UNAVAILABLE — ${report.retiredModels.length} models in table but NOT in live list:`);
        for (const id of report.retiredModels) {
            console.log(`   "${id}"`);
        }
    }

    if (report.costHeadersFound.length > 0) {
        console.log(`\n💰 Cost headers found in responses:`);
        for (const { model, headers } of report.costHeadersFound) {
            console.log(`   ${model}: ${JSON.stringify(headers)}`);
        }
    } else {
        console.log("\nℹ️  No cost headers in API responses (SiliconFlow doesn't expose billing via API).");
        console.log("   To get real costs: download billing CSV from the SiliconFlow dashboard,");
        console.log("   then run: npx tsx src/scripts/sf-billing-import.ts <path-to-csv>");
    }

    console.log(`\n📄 Full report saved to: ${reportPath}`);
}

main().catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
});
