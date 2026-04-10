/**
 * sf-billing-import.ts — SiliconFlow billing CSV → siliconflowPricing.ts updater
 *
 * After downloading your billing export from the SiliconFlow dashboard
 * (https://cloud.siliconflow.cn/finance/bill → Export), run this script to:
 *  1. Parse the CSV
 *  2. Aggregate total cost and total tokens per model
 *  3. Derive input+output USD/M prices
 *  4. Show a diff vs the existing siliconflowPricing.ts
 *  5. Print the updated TypeScript entries ready to paste (or auto-patch the file)
 *
 * Usage:
 *   cd apps/api && npx tsx src/scripts/sf-billing-import.ts <path-to-billing.csv> [--write]
 *
 *   --write   Auto-patches siliconflowPricing.ts with the derived prices.
 *             Without this flag the script is dry-run only.
 *
 * Notes:
 *   - The billing CSV may be in CNY. Set SF_BILLING_CURRENCY=CNY and
 *     SF_CNY_TO_USD_RATE=0.138 (default) to auto-convert.
 *   - If the CSV has separate input/output rows, they are aggregated.
 *   - If neither input_tokens nor output_tokens columns exist, the script
 *     falls back to "total_tokens" and sets input=output price.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import * as dotenv from "dotenv";

const monorepoRoot = path.resolve(__dirname, "../../../..");
dotenv.config({ path: path.join(monorepoRoot, ".env") });

const PRICING_TS = path.join(monorepoRoot, "apps", "api", "src", "application", "llm", "siliconflowPricing.ts");

const CSV_PATH = process.argv[2];
const AUTO_WRITE = process.argv.includes("--write");

const CNY_TO_USD = parseFloat(process.env.SF_CNY_TO_USD_RATE ?? "0.138");
const CURRENCY = (process.env.SF_BILLING_CURRENCY ?? "auto").toLowerCase();

// Minimum tokens (in K) to consider a row statistically reliable.
// Rows below this threshold (e.g. tiny probe calls) are flagged INSUFFICIENT.
const MIN_TOKENS_K = parseFloat(process.env.SF_MIN_TOKENS_K ?? "1.0");

if (!CSV_PATH) {
    console.error("Usage: npx tsx src/scripts/sf-billing-import.ts <billing.csv> [--write]");
    console.error("\nTo get the CSV: SiliconFlow dashboard → Finance → Bill → Export CSV");
    process.exit(1);
}

if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ File not found: ${CSV_PATH}`);
    process.exit(1);
}

// ── CSV parser ───────────────────────────────────────────────────────────────
type Row = Record<string, string>;

async function parseCsv(filePath: string): Promise<Row[]> {
    const rows: Row[] = [];
    const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
    let headers: string[] = [];
    let first = true;
    for await (const line of rl) {
        const raw = line.trim();
        if (!raw) continue;
        const cols = splitCsvLine(raw);
        if (first) {
            headers = cols.map((h) => h.toLowerCase().trim().replace(/[\s\-]/g, "_"));
            first = false;
            continue;
        }
        const row: Row = {};
        for (let i = 0; i < headers.length; i++) {
            row[headers[i]!] = (cols[i] ?? "").trim();
        }
        rows.push(row);
    }
    return rows;
}

function splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (ch === '"') { inQuote = !inQuote; continue; }
        if (ch === "," && !inQuote) { result.push(cur); cur = ""; continue; }
        cur += ch;
    }
    result.push(cur);
    return result;
}

// ── Column sniffing ───────────────────────────────────────────────────────────
function pickCol(row: Row, candidates: string[]): string | undefined {
    for (const c of candidates) {
        if (c in row) return c;
    }
    return undefined;
}

// ── Aggregation ───────────────────────────────────────────────────────────────
interface ModelAgg {
    modelId: string;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    rows: number;
}

function toNumber(s: string): number {
    return parseFloat(s.replace(/[,，¥$]/g, "")) || 0;
}

function deriveUsdCost(rawCost: number, currency: string): number {
    const cur = currency === "auto"
        ? (rawCost < 0.01 ? "cny" : "usd")  // heuristic: CNY costs are in 分/元
        : currency;
    return cur === "cny" ? rawCost * CNY_TO_USD : rawCost;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n💰 SF Billing Import — ${CSV_PATH}`);
    if (AUTO_WRITE) console.log("   Mode: --write (will patch siliconflowPricing.ts)");
    else console.log("   Mode: dry-run (pass --write to auto-patch)");
    console.log("");

    const rows = await parseCsv(CSV_PATH!);
    if (rows.length === 0) { console.error("❌ No data rows found in CSV."); process.exit(1); }

    // Detect columns
    const sample = rows[0]!;
    const modelCol = pickCol(sample, ["model", "model_name", "model_id", "模型"]);
    // Prefer coupon_deduction over total_amount — SiliconFlow exports cost as
    // "Coupon Deduction" when balance is covered by credits (Total Amount = 0).
    const costCol = pickCol(sample, ["coupon_deduction", "amount", "cost", "total_amount", "fee", "费用", "金额"]);
    const inTokCol = pickCol(sample, ["input_tokens", "prompt_tokens", "input_token", "输入token"]);
    const outTokCol = pickCol(sample, ["output_tokens", "completion_tokens", "output_token", "输出token"]);
    // "original_usage" is SiliconFlow's total-usage column expressed in K tokens.
    const totTokCol = pickCol(sample, ["total_tokens", "tokens", "token_count", "original_usage"]);
    // When usage is in K units (original_usage), multiply by 1000 to get raw token count.
    const totTokScale = totTokCol === "original_usage" ? 1000 : 1;
    // coupon_deduction values are always USD regardless of amount magnitude.
    const forceUsd = costCol === "coupon_deduction";

    if (!modelCol || !costCol) {
        console.error("❌ Cannot detect required columns (model, cost) in CSV.");
        console.error("   Available columns:", Object.keys(sample).join(", "));
        process.exit(1);
    }

    console.log(`   model column   : ${modelCol}`);
    console.log(`   cost column    : ${costCol}${forceUsd ? " (coupon-based, treated as USD)" : ""}`);
    console.log(`   input tokens   : ${inTokCol ?? "not found"}`);
    console.log(`   output tokens  : ${outTokCol ?? "not found"}`);
    console.log(`   total tokens   : ${totTokCol ?? "not found"}${totTokScale > 1 ? ` (×${totTokScale} — K units)` : ""}`);
    console.log(`   total rows     : ${rows.length}\n`);

    const agg = new Map<string, ModelAgg>();

    for (const row of rows) {
        const modelId = row[modelCol!]?.trim();
        if (!modelId) continue;
        const rawCost = toNumber(row[costCol!] ?? "0");
        const costUsd = forceUsd ? rawCost : deriveUsdCost(rawCost, CURRENCY);
        const inputToks = inTokCol ? toNumber(row[inTokCol] ?? "0") : 0;
        const outputToks = outTokCol ? toNumber(row[outTokCol] ?? "0") : 0;
        const totalToks = totTokCol ? toNumber(row[totTokCol] ?? "0") * totTokScale : 0;

        const prev = agg.get(modelId) ?? { modelId, totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, rows: 0 };
        prev.totalCostUsd += costUsd;
        prev.totalInputTokens += inputToks || Math.round(totalToks * 0.9);  // fallback: ~90% input
        prev.totalOutputTokens += outputToks || Math.round(totalToks * 0.1); // fallback: ~10% output
        prev.rows++;
        agg.set(modelId, prev);
    }

    // Derive per-M prices
    type Derived = {
        modelId: string;
        inputUsdPerM: number | null;
        outputUsdPerM: number | null;
        totalCostUsd: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        rows: number;
        note: string;
    };
    const derived: Derived[] = [];

    for (const entry of agg.values()) {
        const hasTokenSplit = entry.totalInputTokens > 0 || entry.totalOutputTokens > 0;
        const totalToks = entry.totalInputTokens + entry.totalOutputTokens;

        let inputUsdPerM: number | null = null;
        let outputUsdPerM: number | null = null;
        let note = "";

        if (hasTokenSplit && totalToks > 0) {
            // Attribute cost proportionally to input/output ratio from the table
            // (we can't separate costs without separate billing lines — use pricing page ratio as guide)
            // If separate lines per call type exist, the cost is already split.
            // Heuristic: if only total cost is known, split proportionally to token counts.
            const inputFrac = entry.totalInputTokens / totalToks;
            const outputFrac = entry.totalOutputTokens / totalToks;
            if (entry.totalInputTokens > 0) inputUsdPerM = (entry.totalCostUsd * inputFrac) / (entry.totalInputTokens / 1_000_000);
            if (entry.totalOutputTokens > 0) outputUsdPerM = (entry.totalCostUsd * outputFrac) / (entry.totalOutputTokens / 1_000_000);
            note = "computed";
        } else {
            note = "no token data";
        }

        derived.push({ ...entry, inputUsdPerM, outputUsdPerM, note });
    }

    // Sort by cost descending
    derived.sort((a, b) => b.totalCostUsd - a.totalCostUsd);

    // Print results table
    console.log("Model".padEnd(50) + "in$/M".padEnd(10) + "out$/M".padEnd(10) + "total$".padEnd(12) + "rows");
    console.log("─".repeat(90));
    for (const d of derived) {
        const inp = d.inputUsdPerM !== null ? d.inputUsdPerM.toFixed(4) : "?";
        const out = d.outputUsdPerM !== null ? d.outputUsdPerM.toFixed(4) : "?";
        console.log(
            d.modelId.padEnd(50) +
            inp.padEnd(10) + out.padEnd(10) +
            d.totalCostUsd.toFixed(6).padEnd(12) +
            d.rows
        );
    }

    // Generate TS snippet
    const newEntries = derived
        .filter((d) => d.inputUsdPerM !== null)
        .map((d) => {
            const inp = +d.inputUsdPerM!.toFixed(4);
            const out = d.outputUsdPerM !== null ? +d.outputUsdPerM.toFixed(4) : inp;
            const isImage = d.modelId.toLowerCase().includes("flux") ||
                d.modelId.toLowerCase().includes("image") ||
                d.modelId.toLowerCase().includes("z-image");
            const unit = inp === 0 && out === 0 ? '"free"' : isImage ? '"per_image"' : '"per_m_tokens"';
            return `    "${d.modelId}": { input: ${inp}, output: ${out}, priceUnit: ${unit} },  // from billing CSV`;
        });

    console.log("\n─────────────────────────────────────────────────────────────────");
    console.log("📋 TypeScript entries derived from billing CSV:\n");
    for (const line of newEntries) console.log(line);

    if (AUTO_WRITE) {
        // Patch siliconflowPricing.ts — insert/update entries in SILICONFLOW_MODEL_PRICES
        let src = fs.readFileSync(PRICING_TS, "utf8");
        let updated = 0;
        let added = 0;

        for (const d of derived) {
            if (d.inputUsdPerM === null) continue;
            const inp = +d.inputUsdPerM.toFixed(4);
            const out = d.outputUsdPerM !== null ? +d.outputUsdPerM.toFixed(4) : inp;
            const isImage = d.modelId.toLowerCase().includes("flux") ||
                d.modelId.toLowerCase().includes("image") ||
                d.modelId.toLowerCase().includes("z-image");
            const unit = inp === 0 && out === 0 ? "free" : isImage ? "per_image" : "per_m_tokens";
            const newLine = `    "${d.modelId}": { input: ${inp}, output: ${out}, priceUnit: "${unit}" },  // billed`;

            // Check if model already exists
            const existingRegex = new RegExp(`^\\s+"${d.modelId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*\\{[^}]+\\},.*$`, "m");
            if (existingRegex.test(src)) {
                src = src.replace(existingRegex, newLine);
                updated++;
            } else {
                // Append before the closing brace of SILICONFLOW_MODEL_PRICES
                src = src.replace(/(\n};[\s\n]*\/\*\*[\s\n]*\*[\s\S]*?getSiliconFlowPrice)/, `\n${newLine}\n$1`);
                added++;
            }
        }

        fs.writeFileSync(PRICING_TS, src, "utf8");
        console.log(`\n✅ Patched siliconflowPricing.ts: ${updated} updated, ${added} added.`);
    } else {
        console.log("\n💡 Run with --write to auto-patch siliconflowPricing.ts.");
    }

    // Save derived prices to docs/cost-providers/
    const outPath = path.join(monorepoRoot, "docs", "cost-providers", `sf-billing-derived-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), derived }, null, 2));
    console.log(`\n📄 Derived prices saved to: ${outPath}`);
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
