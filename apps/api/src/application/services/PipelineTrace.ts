/**
 * Sequential, human-readable trace of the one generation path (AGENTS.md, Rule Zero).
 *
 * The platform's purpose is to make it knowable exactly what reached the LLM and why. Persisted
 * records (PipelineRun, PromptExecutionLog, promptingTrace) already hold that after the fact, but
 * reconstructing a run from three collections is not something anyone does while a bug is in
 * front of them. This writes the same story to stdout in order, so `docker compose logs api`
 * answers it directly.
 *
 * Deliberately plain `console.log`: it must survive a Mongo outage, a crash mid-request, and a
 * container that has just started. It never throws and never awaits.
 */

/** Ordered stages of one generation. Keep in sync with the pipeline's actual shape. */
export const PIPELINE_STEPS = [
    "launch",           // guided intake accepted, project + conversation prepared
    "model-lock",       // provider/model frozen on the run
    "canonical-brief",  // brief built and attached, content hashed
    "dispatch",         // lock re-validated against the live catalog
    "layers",           // system prompt composed from the layer registry
    "provider-call",    // request sent to the provider
    "result",           // outcome, usage, cost
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

function shortId(value: string | undefined): string {
    if (!value) return "--------";
    return value.length <= 8 ? value : value.slice(0, 8);
}

function formatDetail(detail: Record<string, unknown>): string {
    return Object.entries(detail)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(" ");
}

/**
 * Emit one step of the path.
 *
 * `runId` ties the lines together — grep it and you get the whole story of one generation in
 * order. Requests with no PipelineRun (a plain chat turn) still trace, keyed by conversation.
 */
export function tracePipeline(input: {
    runId?: string;
    conversationId?: string;
    projectId?: string;
    step: PipelineStep;
    detail?: Record<string, unknown>;
}): void {
    try {
        const index = PIPELINE_STEPS.indexOf(input.step) + 1;
        const key = shortId(input.runId ?? input.conversationId);
        const detail = input.detail ? formatDetail(input.detail) : "";
        // eslint-disable-next-line no-console
        console.log(
            `[pipeline ${key}] ${index}/${PIPELINE_STEPS.length} ${input.step.padEnd(15)} ${detail}`.trimEnd(),
        );
    } catch {
        // Tracing must never affect the request it is describing.
    }
}

/**
 * Layer-by-layer breakdown of the composed system prompt — the answer to "what exactly did the
 * model see". Sizes only: the full text is in the persisted trace and the Prompt tab, and dumping
 * 40 000 characters per request would make the log unreadable, which defeats the purpose.
 */
export function tracePromptLayers(input: {
    runId?: string;
    conversationId?: string;
    layers: ReadonlyArray<{ id: string; chars: number; source: string }>;
    totalChars: number;
}): void {
    try {
        const key = shortId(input.runId ?? input.conversationId);
        const present = input.layers.filter((layer) => layer.chars > 0);
        const skipped = input.layers.filter((layer) => layer.chars === 0).map((layer) => layer.id);
        const breakdown = present.map((layer) => `${layer.id}:${layer.chars}`).join(" ");
        const index = PIPELINE_STEPS.indexOf("layers") + 1;
        // eslint-disable-next-line no-console
        console.log(
            `[pipeline ${key}] ${index}/${PIPELINE_STEPS.length} layers          total=${input.totalChars} ~${Math.ceil(input.totalChars / 4)}tok | ${breakdown}${skipped.length ? ` | empty: ${skipped.join(",")}` : ""}`,
        );
    } catch {
        // never throw
    }
}
