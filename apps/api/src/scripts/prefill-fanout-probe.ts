/**
 * prefill-fanout-probe.ts — is it faster to build the Zero Effort brief with N focused calls
 * instead of one?
 *
 * Answers a question the section fan-out did not: that one was about TRUNCATION, and prefill never
 * truncates — it produces ~2k tokens against a 32k ceiling. This is about LATENCY, measured at
 * 13-21s for a single prefill call, and whether splitting it shortens or lengthens that.
 *
 * Two risks it exists to measure rather than argue about:
 *
 *   1. Coherence. VibePrefill.ts:28-49 records that the nineteen fields are written in a deliberate
 *      order, the expressive ones last, because each is informed by what came before. Splitting them
 *      into independent calls removes that ordering. The probe reports how many fields each strategy
 *      filled, which is a proxy for completeness — it is NOT a measure of quality, and nothing here
 *      claims otherwise.
 *   2. Thinking. Waiting for N reasoning models in parallel may be slower than waiting for one, not
 *      faster: the wall clock is the SLOWEST of the group, not the average. Every strategy is run
 *      with thinking on and off so the two effects can be told apart.
 *
 * Usage:
 *   FANOUT_PROVIDER=openrouter FANOUT_MODEL=deepseek/deepseek-v4-pro \
 *     npx tsx src/scripts/prefill-fanout-probe.ts
 *
 * Talks to a live provider and costs money — it deliberately runs the same brief several times.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

import { buildChatCompletionRequestBody } from "../application/llm/chatRequestAdapter";
import { runBoundedPool } from "../application/llm/boundedPool";

const monorepoRoot = fs.existsSync(path.join(process.cwd(), "docker-compose.yml"))
    ? process.cwd()
    : path.resolve(__dirname, "../../../..");
for (const candidate of [".env", ".env.docker"]) {
    const file = path.join(monorepoRoot, candidate);
    if (fs.existsSync(file)) dotenv.config({ path: file });
}

const PROVIDER = (process.env.FANOUT_PROVIDER?.trim() || "openrouter").toLowerCase();
const MODEL = process.env.FANOUT_MODEL?.trim() || "deepseek/deepseek-v4-pro";
const BASE_URL = (PROVIDER === "openrouter"
    ? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"
    : process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.com/v1").replace(/\/$/, "");
const API_KEY = (PROVIDER === "openrouter"
    ? process.env.OPEN_ROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY
    : process.env.SILICONFLOW_API_KEY)?.trim() ?? "";

if (!API_KEY) {
    console.error(`No API key for ${PROVIDER}. Set it in .env or .env.docker.`);
    process.exit(1);
}

/**
 * The run this probe reproduces, loaded from a real recorded prefill rather than invented.
 *
 * Comparing against a synthetic request would measure the probe's own prompt; comparing against a
 * row from the journal measures the pipeline as it actually runs, and gives a baseline that was paid
 * for once already — its wall clock, tokens and output are facts, not a control run.
 *
 * Produce the file with the mongosh snippet in this script's commit message, or point BASELINE at
 * any export with the same shape.
 */
interface Baseline {
    projectId: string;
    projectName?: string;
    model: string;
    provider: string;
    systemPrompt: string;
    userPrompt: string;
    recordedRaw: string;
    recordedUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    recordedMs?: number;
}

const BASELINE_PATH = process.env.BASELINE
    ?? path.join(monorepoRoot, "debug", "prefill-baseline.json");
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as Baseline;
const REQUEST = baseline.userPrompt;

/**
 * The nineteen fields, grouped by what informs what.
 *
 * Grouped rather than one call per field: nineteen calls would pay nineteen prompt overheads to
 * save latency that is already bounded by the slowest of them. These five are the coarsest split
 * that still separates concerns that do not need each other.
 */
const GROUPS: Array<{ name: string; fields: string[] }> = [
    { name: "cosa", fields: ["businessName", "presetId", "primaryGoal", "audience", "projectSummary", "outputLanguage", "contactInfo"] },
    { name: "contenuto", fields: ["contentStructure", "contentRequirements", "functionalRequirements", "interactionModel"] },
    { name: "forma", fields: ["tone", "primaryCta", "styleHint", "visualDirection", "styleAttributes", "successCriteria", "constraints", "mustAvoid"] },
];

const ALL_FIELDS = GROUPS.flatMap((g) => g.fields);

interface CallResult {
    label: string;
    ms: number;
    promptTokens: number;
    completionTokens: number;
    fields: Record<string, unknown>;
    error?: string;
}

async function dispatch(label: string, system: string, user: string, thinking: boolean, maxTokens: number): Promise<CallResult> {
    const startedAt = Date.now();
    try {
        const res = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
            body: JSON.stringify(buildChatCompletionRequestBody({
                provider: PROVIDER,
                model: MODEL,
                maxTokens,
                temperature: 0.3,
                enableThinking: thinking,
                messages: [{ role: "system", content: system }, { role: "user", content: user }],
            })),
        });
        const json = await res.json() as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const raw = String(json.choices?.[0]?.message?.content ?? "");
        const match = raw.match(/\{[\s\S]*\}/);
        let fields: Record<string, unknown> = {};
        try { fields = match ? JSON.parse(match[0]) as Record<string, unknown> : {}; } catch { /* unparsed */ }
        return {
            label,
            ms: Date.now() - startedAt,
            promptTokens: json.usage?.prompt_tokens ?? 0,
            completionTokens: json.usage?.completion_tokens ?? 0,
            fields,
            error: res.ok ? undefined : `HTTP ${res.status}`,
        };
    } catch (error) {
        return {
            label, ms: Date.now() - startedAt, promptTokens: 0, completionTokens: 0, fields: {},
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function filled(fields: Record<string, unknown>): number {
    return ALL_FIELDS.filter((f) => {
        const v = fields[f];
        return v !== undefined && v !== null && String(v).trim().length > 0;
    }).length;
}

async function monolith(thinking: boolean) {
    // The real system prompt, byte for byte. Rewriting it would compare this probe's prompt against
    // the product's, which answers a question nobody asked.
    const system = baseline.systemPrompt;
    const startedAt = Date.now();
    const r = await dispatch("monolith", system, REQUEST, thinking, 16000);
    return { wall: Date.now() - startedAt, calls: [r], merged: r.fields };
}

async function fanout(thinking: boolean, concurrency: number) {
    const startedAt = Date.now();
    // Each group gets the SAME system prompt as the monolith, plus a narrowing instruction. That
    // isolates the variable under test — parallelism — from context reduction, which is a separate
    // question and would confound this one. It also makes the cost multiplication visible rather
    // than hiding it behind a trimmed prompt.
    const tasks = GROUPS.map((g) => async () => dispatch(
        `group:${g.name}`,
        `${baseline.systemPrompt}

---
VINCOLO AGGIUNTIVO: compila SOLO questi campi: ${g.fields.join(", ")}.
Rispondi con un oggetto JSON contenente esclusivamente quei campi.`,
        REQUEST,
        thinking,
        4000,
    ));
    const pool = await runBoundedPool(tasks, { concurrency, taskTimeoutMs: 180_000 });
    const calls = pool.outcomes.map((o) => o.status === "fulfilled"
        ? o.value
        : { label: "failed", ms: 0, promptTokens: 0, completionTokens: 0, fields: {}, error: o.status });
    // A group that fails leaves its fields empty rather than sinking the brief — the whole point of
    // collecting outcomes instead of racing them.
    const merged = Object.assign({}, ...calls.map((c) => c.fields)) as Record<string, unknown>;
    return { wall: Date.now() - startedAt, calls, merged };
}

function report(name: string, r: { wall: number; calls: CallResult[]; merged: Record<string, unknown> }) {
    const pt = r.calls.reduce((a, c) => a + c.promptTokens, 0);
    const ct = r.calls.reduce((a, c) => a + c.completionTokens, 0);
    const cost = ((pt + ct) / 1000) * 0.005; // CostTransactionService.ts:143 flat rate
    const failed = r.calls.filter((c) => c.error).length;
    console.log(
        `  ${name.padEnd(26)} ${String((r.wall / 1000).toFixed(1) + "s").padStart(8)}  ` +
        `calls=${String(r.calls.length).padStart(2)}  in=${String(pt).padStart(6)} out=${String(ct).padStart(6)}  ` +
        `EUR ${cost.toFixed(5)}  campi=${filled(r.merged)}/${ALL_FIELDS.length}` +
        (failed ? `  FALLITE=${failed}` : ""),
    );
    if (r.calls.length > 1) {
        const ok = r.calls.filter((c) => !c.error && c.promptTokens > 0);
        const slowest = Math.max(...r.calls.map((c) => c.ms));
        const fastest = Math.min(...r.calls.map((c) => c.ms));
        const perCallIn = ok.length ? Math.round(ok.reduce((a, c) => a + c.promptTokens, 0) / ok.length) : 0;
        // Per call, not summed. The summed figure reads as if the fan-out were sent a bigger prompt;
        // it is not — it is sent the SAME prompt N times, and that is the cost of parallelising.
        console.log(`  ${" ".repeat(26)} input/chiamata ${perCallIn} tok · più lenta ${(slowest / 1000).toFixed(1)}s · più veloce ${(fastest / 1000).toFixed(1)}s`);
    }
}

async function main() {
    console.log(`\nprefill fan-out probe — ${PROVIDER}/${MODEL}\n`);
    console.log("  strategia                       wall   chiamate      token          costo   completezza");
    console.log("  " + "-".repeat(94));

    // One pass, not two. `enableThinking` is honoured only by SiliconFlow (chatRequestAdapter), so
    // on any other provider running both states would pay twice to measure the same thing and
    // present the difference between two samples of noise as a finding.
    const thinking = PROVIDER === "siliconflow";
    console.log(`  thinking ${thinking ? "ON" : "OFF (il provider ignora il flag)"}
`);
    report("monolite (prompt reale)", await monolith(thinking));
    report("fan-out 3 gruppi (par. 3)", await fanout(thinking, 3));

    console.log("\n  Nota: 'completezza' conta i campi non vuoti. Non misura la QUALITÀ del brief,");
    console.log("  che è il rischio vero dello split e che nessun numero qui può stabilire.\n");
}

main().catch((error) => { console.error(error); process.exit(1); });
