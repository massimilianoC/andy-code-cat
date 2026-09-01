/**
 * Plan → per-section fan-out → assemble
 * (docs/specs/PARALLEL_SECTION_GENERATION_SPEC.md §6).
 *
 * Replaces one long call that ends when the provider cuts it off with N short calls that each end
 * because the model finished. The recorded failure this exists to remove: run f51ee098 spent
 * 10m 29s, stopped at exactly 32,768 completion tokens — the provider's output cap — and was
 * journalled as `succeeded` while the deck was visibly incomplete.
 *
 * The model is resolved ONCE by the caller and passed in. That is deliberate: a fan-out is one
 * generation, so the pipeline's model lock is consumed by the run that owns it and every child
 * inherits the same effective model rather than re-resolving per call (§3.1). Re-resolving per
 * child is exactly how a fan-out would end up dispatching several different models under one
 * user-visible generation.
 */

import { runBoundedPool, type BoundedPoolOutcome } from "../llm/boundedPool";
import {
    parseSectionPlan,
    SECTION_PLAN_OUTPUT_CONTRACT,
    type PlannedSection,
    type SectionDesignTokens,
    type SectionPlan,
} from "../llm/sectionPlan";

// ── Provider port ────────────────────────────────────────────────────────────

export interface SectionLlmCall {
    system: string;
    user: string;
    maxTokens: number;
    /**
     * Reasoning is charged from the same completion budget as the answer, so a hybrid model can
     * exhaust a section's budget thinking before it emits any HTML. Planning is where thinking
     * earns its cost; executing a decided section is not.
     */
    disableThinking: boolean;
    /** Human-readable, for traces: "plan", "section:hero", "section:hero#retry". */
    label: string;
}

export interface SectionLlmReply {
    content: string;
    finishReason?: string;
    reasoning?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface SectionLlmDispatcher {
    dispatch(call: SectionLlmCall): Promise<SectionLlmReply>;
}

// ── Input / output ───────────────────────────────────────────────────────────

export interface GenerateSectionedArtifactInput {
    /**
     * The distilled brief. NOT the source attachments: `vibe_prefill` already digested those, and
     * Layer D re-injecting them per child would pay for the same information N times (§6.1).
     */
    brief: string;
    /** One line naming the artifact kind, e.g. "a 10-slide presentation deck". */
    deliverable: string;
    /** Shared constraints every section must honour (the trimmed Layer A/B/L equivalent). */
    baseConstraints: string;
    planMaxTokens?: number;
    sectionMaxTokens?: number;
    concurrency?: number;
    sectionTimeoutMs?: number;
    totalTimeoutMs?: number;
    /** Attempts per section, including the first. 2 = one retry. */
    maxAttemptsPerSection?: number;
}

export type SectionStatus = "generated" | "placeholder";

export interface GeneratedSection {
    key: string;
    title: string;
    status: SectionStatus;
    html: string;
    attempts: number;
    durationMs: number;
    /** Why it degraded. Present only on placeholders — a labelled gap, never a silent one. */
    degradedReason?: string;
    finishReason?: string;
    completionTokens?: number;
}

export interface GenerateSectionedArtifactResult {
    plan: SectionPlan;
    sections: GeneratedSection[];
    html: string;
    metrics: {
        totalDurationMs: number;
        planDurationMs: number;
        fanoutDurationMs: number;
        /** Wall-clock until the first section was ready — the number the user actually feels. */
        firstSectionMs?: number;
        calls: number;
        promptTokens: number;
        completionTokens: number;
        maxCompletionTokensInOneCall: number;
        truncatedCalls: number;
        placeholders: number;
        planWasRepaired: boolean;
        hitTotalTimeout: boolean;
    };
}

export class SectionPlanFailedError extends Error {
    constructor(message: string, readonly raw: string) {
        super(message);
        this.name = "SectionPlanFailedError";
    }
}

// ── Prompt composition ───────────────────────────────────────────────────────

function renderDesignTokens(tokens: SectionDesignTokens): string {
    const lines = [
        tokens.palette.length ? `palette: ${tokens.palette.join(", ")}` : null,
        tokens.headingFont ? `heading font: ${tokens.headingFont}` : null,
        tokens.bodyFont ? `body font: ${tokens.bodyFont}` : null,
        tokens.styleNote ? `style: ${tokens.styleNote}` : null,
    ].filter(Boolean);
    return lines.length ? lines.join("\n") : "(none specified — keep it visually neutral)";
}

function buildPlanCall(input: GenerateSectionedArtifactInput): SectionLlmCall {
    return {
        label: "plan",
        maxTokens: input.planMaxTokens ?? 6000,
        // The one call where reasoning is worth its budget: deciding the structure is the part that
        // benefits from thinking, and its deliverable is small enough that thinking fits.
        disableThinking: false,
        system: `You plan the structure of ${input.deliverable}.\n\n${SECTION_PLAN_OUTPUT_CONTRACT}`,
        user: input.brief,
    };
}

function buildSectionCall(
    section: PlannedSection,
    plan: SectionPlan,
    input: GenerateSectionedArtifactInput,
    correction?: { error: string; previousReasoning?: string },
): SectionLlmCall {
    const system = [
        `You write ONE section of ${input.deliverable}. Not the whole document — only this section.`,
        "",
        input.baseConstraints,
        "",
        "Shared design decisions (already fixed — reuse them exactly, do not reinterpret):",
        renderDesignTokens(plan.designTokens),
        "",
        "Output rules:",
        "- Reply with an HTML fragment only: no <!doctype>, no <html>, <head> or <body> wrapper.",
        "- Inline any CSS you need with a style attribute or a scoped <style> inside the fragment.",
        "- Do not write any other section, and do not add navigation between sections.",
        `- Keep the rendered text of this section to roughly ${section.charBudget} characters.`,
    ].join("\n");

    const user = [
        `Section: ${section.title}`,
        `What it must say: ${section.contentBrief}`,
        section.mediaIntent ? `Media: ${section.mediaIntent}` : null,
        correction
            ? [
                "",
                "Your previous attempt was rejected. Fix exactly this and re-emit the section:",
                correction.error,
                correction.previousReasoning
                    ? `\nYour own earlier reasoning, cut off mid-way — continue from it rather than restarting:\n${correction.previousReasoning.slice(0, 4000)}`
                    : null,
            ].filter(Boolean).join("\n")
            : null,
    ].filter(Boolean).join("\n");

    return {
        label: correction ? `section:${section.key}#retry` : `section:${section.key}`,
        maxTokens: input.sectionMaxTokens ?? 4000,
        // Execution, not deliberation: the decisions were made in the plan.
        disableThinking: true,
        system,
        user,
    };
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Structural, not aesthetic. The stop condition for the retry loop has to be something the code can
 * decide (spec §8) — "the model says it is done" is not a criterion, it is a hope.
 */
function rejectionReason(reply: SectionLlmReply): string | null {
    if (reply.finishReason === "length") {
        return "the response was cut off before it finished (finish_reason: length) — produce a shorter section that fits the character budget";
    }
    const html = reply.content.trim();
    if (html.length === 0) return "the response was empty";
    if (!/<[a-z][\s\S]*>/i.test(html)) return "the response contained no HTML element";
    if (/<\/?(?:html|head|body)\b/i.test(html)) {
        return "the response wrapped the fragment in <html>/<head>/<body> — emit only the section fragment";
    }
    return null;
}

function stripFences(raw: string): string {
    const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
    return (fenced?.[1] ?? raw).trim();
}

function placeholderHtml(section: PlannedSection, reason: string): string {
    // Visible and labelled. A deck with nine real sections and one declared gap is a result; a deck
    // that silently stops at section six and reports success is the failure being replaced.
    return [
        `<section data-section="${section.key}" data-status="placeholder">`,
        `  <h2>${section.title}</h2>`,
        `  <p data-degraded="true">Questa sezione non è stata generata: ${reason}</p>`,
        `</section>`,
    ].join("\n");
}

// ── Use case ─────────────────────────────────────────────────────────────────

export class GenerateSectionedArtifact {
    constructor(private readonly dispatcher: SectionLlmDispatcher) { }

    async execute(
        input: GenerateSectionedArtifactInput,
        onSectionSettled?: (section: GeneratedSection) => void,
    ): Promise<GenerateSectionedArtifactResult> {
        const startedAt = Date.now();
        let promptTokens = 0;
        let completionTokens = 0;
        let maxCompletionTokensInOneCall = 0;
        let truncatedCalls = 0;
        let calls = 0;

        const account = (reply: SectionLlmReply) => {
            calls++;
            promptTokens += reply.usage?.promptTokens ?? 0;
            completionTokens += reply.usage?.completionTokens ?? 0;
            maxCompletionTokensInOneCall = Math.max(
                maxCompletionTokensInOneCall,
                reply.usage?.completionTokens ?? 0,
            );
            if (reply.finishReason === "length") truncatedCalls++;
        };

        // ── 1. Plan ──────────────────────────────────────────────────────────
        const planStartedAt = Date.now();
        const planReply = await this.dispatcher.dispatch(buildPlanCall(input));
        account(planReply);
        const planDurationMs = Date.now() - planStartedAt;

        const parsed = parseSectionPlan(stripFences(planReply.content));
        if (!parsed) {
            throw new SectionPlanFailedError(
                "the plan stage did not return a usable section plan",
                planReply.content.slice(0, 2000),
            );
        }
        const { plan } = parsed;

        // ── 2. Fan-out ───────────────────────────────────────────────────────
        const maxAttempts = Math.max(1, input.maxAttemptsPerSection ?? 2);
        const fanoutStartedAt = Date.now();
        let firstSectionMs: number | undefined;

        const tasks = plan.sections.map((section) => async (): Promise<GeneratedSection> => {
            const sectionStartedAt = Date.now();
            let correction: { error: string; previousReasoning?: string } | undefined;
            let lastReason = "unknown";
            let lastFinishReason: string | undefined;
            let lastCompletionTokens: number | undefined;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const reply = await this.dispatcher.dispatch(
                    buildSectionCall(section, plan, input, correction),
                );
                account(reply);
                lastFinishReason = reply.finishReason;
                lastCompletionTokens = reply.usage?.completionTokens;

                const html = stripFences(reply.content);
                const reason = rejectionReason({ ...reply, content: html });
                if (!reason) {
                    return {
                        key: section.key,
                        title: section.title,
                        status: "generated",
                        html,
                        attempts: attempt,
                        durationMs: Date.now() - sectionStartedAt,
                        finishReason: reply.finishReason,
                        completionTokens: reply.usage?.completionTokens,
                    };
                }

                lastReason = reason;
                correction = {
                    error: reason,
                    // A truncated attempt already paid for its thinking; the retry resumes from it
                    // instead of buying the same reasoning twice.
                    previousReasoning: reply.finishReason === "length" ? reply.reasoning : undefined,
                };
            }

            return {
                key: section.key,
                title: section.title,
                status: "placeholder",
                html: placeholderHtml(section, lastReason),
                attempts: maxAttempts,
                durationMs: Date.now() - sectionStartedAt,
                degradedReason: lastReason,
                finishReason: lastFinishReason,
                completionTokens: lastCompletionTokens,
            };
        });

        const pool = await runBoundedPool(tasks, {
            concurrency: input.concurrency ?? 4,
            taskTimeoutMs: input.sectionTimeoutMs ?? 120_000,
            totalTimeoutMs: input.totalTimeoutMs,
        }, (outcome) => {
            if (firstSectionMs === undefined) firstSectionMs = Date.now() - fanoutStartedAt;
            const settled = toSection(outcome, plan.sections);
            onSectionSettled?.(settled);
        });
        const fanoutDurationMs = Date.now() - fanoutStartedAt;

        const sections = pool.outcomes.map((outcome) => toSection(outcome, plan.sections));

        return {
            plan,
            sections,
            html: sections.map((s) => s.html).join("\n"),
            metrics: {
                totalDurationMs: Date.now() - startedAt,
                planDurationMs,
                fanoutDurationMs,
                firstSectionMs,
                calls,
                promptTokens,
                completionTokens,
                maxCompletionTokensInOneCall,
                truncatedCalls,
                placeholders: sections.filter((s) => s.status === "placeholder").length,
                planWasRepaired: parsed.repaired,
                hitTotalTimeout: pool.hitTotalTimeout,
            },
        };
    }
}

/**
 * Every pool outcome becomes a section, including the ones that never ran. A run always terminates
 * with N sections — the guarantee is that the outcome is defined and honest about what degraded,
 * not that every section succeeded (§8.1).
 */
function toSection(
    outcome: BoundedPoolOutcome<GeneratedSection>,
    planned: PlannedSection[],
): GeneratedSection {
    const section = planned[outcome.index] ?? {
        key: `section-${outcome.index + 1}`,
        title: `Section ${outcome.index + 1}`,
        contentBrief: "",
        charBudget: 0,
    };
    switch (outcome.status) {
        case "fulfilled":
            return outcome.value;
        case "timeout":
            return degraded(section, `it exceeded its time budget after ${outcome.durationMs}ms`, outcome.durationMs);
        case "rejected":
            return degraded(section, `the provider call failed: ${outcome.reason.message}`, outcome.durationMs);
        case "skipped":
            return degraded(section, "the run reached its total time ceiling before this section started", 0);
    }
}

function degraded(section: PlannedSection, reason: string, durationMs: number): GeneratedSection {
    return {
        key: section.key,
        title: section.title,
        status: "placeholder",
        html: placeholderHtml(section, reason),
        attempts: 0,
        durationMs,
        degradedReason: reason,
    };
}
