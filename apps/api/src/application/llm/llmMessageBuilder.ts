/**
 * llmMessageBuilder.ts
 *
 * Pure message-building utilities for the LLM chat pipeline.
 * No infrastructure dependencies — all functions are stateless
 * and can be tested in isolation without a running server.
 *
 * Exported surface:
 *   buildOutputBudgetPolicy()      — system-prompt budget policy string
 *   buildFallbackStructured()      — fallback LlmStructuredResponse when no LLM key
 *   tryBuildSectionContextOpts()   — extract section-aware focused-edit context
 *   resolveUsageWithFallback()     — normalise token usage from provider or estimate
 *   buildMessagesWithHistory()     — assemble final message array for the provider
 *
 * Types:
 *   HistoryMessage                 — { role, content } pair from chat history
 *   LlmMessage                    — role-stamped message for the provider API
 *   SectionContextOpts            — focused-edit section context options
 */

import { type LlmFocusContext, type LlmStructuredResponse } from "@andy-code-cat/contracts";
import {
    extractSectionForElement,
    filterCssForSection,
    serializePageMap,
    type PageSection,
} from "./sectionContextExtractor";
import { env } from "../../config";

// ── Public types ──────────────────────────────────────────────────────────────

export type HistoryMessage = { role: "user" | "assistant"; content: string };
export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

/** Opts passed to buildMessagesWithHistory when section-context mode is active. */
export interface SectionContextOpts {
    sectionHtml: string;
    sectionPfId: string | undefined;
    pageMap: PageSection[];
    filteredCss: string;
    historyMode: "full" | "user_only" | "none";
}

// ── Context budget constants (resolved from env at module load) ───────────────

const MAX_CONTEXT_CHARS = env.LLM_CONTEXT_MAX_CHARS;
const MAX_ARTIFACT_CHARS = env.LLM_ARTIFACT_CONTEXT_MAX_CHARS;
const MAX_HISTORY_MESSAGES = env.LLM_MAX_HISTORY_MESSAGES;
const MAX_HISTORY_MESSAGE_CHARS = env.LLM_HISTORY_MESSAGE_MAX_CHARS;
const MAX_HISTORY_CHARS = env.LLM_HISTORY_MAX_CHARS;

// ── Exported helpers ──────────────────────────────────────────────────────────

export function buildOutputBudgetPolicy(): string {
    const maxTok = env.LLM_DEFAULT_MAX_COMPLETION_TOKENS;
    return [
        "## OUTPUT BUDGET POLICY",
        "Keep outputs compact and parse-safe.",
        "- Return ONLY one raw JSON object — no markdown fences, no prose before or after the JSON.",
        "- Required keys: chat (with summary, bullets, nextActions) and artifacts (with html, css, js).",
        `- TOTAL OUTPUT MUST stay under ${maxTok.toLocaleString()} tokens. Target 8000–32000 tokens for typical requests, up to budget for large/complex outputs. Never repeat the entire artifact if only a small change is needed.`,
        "- Keep artifacts concise and functional; avoid unnecessary boilerplate.",
        "- artifacts.css and artifacts.js must be plain code strings without <style> or <script> wrappers.",
        "- Use standard single-backslash JSON escaping: \\\" for quotes inside HTML, \\n for newlines. Never double-escape.",
        "",
        "## REASONING / THINKING BUDGET (critical)",
        "- Do NOT over-analyze the task. Keep internal reasoning/thinking under 2000 tokens.",
        "- Skip exploratory analysis and enumeration of rejected alternatives.",
        "- For code generation: plan briefly (under 300 words), then produce the JSON output immediately.",
        "- Never restate the entire user request in your reasoning. Summarize intent in one sentence, then code.",
    ].join("\n");
}

export function buildFallbackStructured(message: string): LlmStructuredResponse {
    return {
        chat: {
            summary: "Preview simulata: provider key non configurata o parsing non valido.",
            bullets: [
                "La richiesta e stata ricevuta dal backend.",
                "Il formato strutturato e disponibile per la UI.",
            ],
            nextActions: [
                "Configura SILICONFLOW_API_KEY per risposta live.",
                "Raffina il prompt per ottenere codice piu specifico.",
            ],
        },
        artifacts: {
            html: `<main class=\"page\"><h1>Preview progetto</h1><p>${message.replace(/</g, "&lt;")}</p></main>`,
            css: ".page{font-family:system-ui;padding:24px} h1{margin-bottom:8px}",
            js: "console.log('preview generated')",
        },
    };
}

/**
 * Attempts to build section-context opts for a focused-edit request.
 *
 * Returns undefined when:
 *  - LLM_FOCUS_SECTION_CONTEXT is not enabled
 *  - the request is not in focused mode
 *  - the element has no data-pf-id or can't be found in the current HTML
 *
 * The caller MUST treat undefined as "use full artifact path" (graceful degradation).
 */
export function tryBuildSectionContextOpts(
    isFocusedMode: boolean,
    body: { currentArtifacts?: { html?: string; css?: string; js?: string } | null; focusContext?: LlmFocusContext },
): SectionContextOpts | undefined {
    if (!env.focusSectionContext || !isFocusedMode) return undefined;

    const outerHtml = body.focusContext?.selectedElement?.outerHtml;
    const fullHtml = body.currentArtifacts?.html;
    if (!outerHtml || !fullHtml) return undefined;

    const maxSectionChars = env.LLM_FOCUS_SECTION_HTML_MAX_CHARS;
    const extracted = extractSectionForElement(fullHtml, outerHtml, maxSectionChars);
    if (!extracted) return undefined; // element not found → full path fallback

    const rawCss = body.currentArtifacts?.css ?? "";
    const filteredCss = filterCssForSection(rawCss, extracted.classNames, extracted.elementIds);

    return {
        sectionHtml: extracted.sectionHtml,
        sectionPfId: extracted.sectionPfId,
        pageMap: extracted.pageMap,
        filteredCss,
        historyMode: env.LLM_FOCUS_HISTORY_MODE,
    };
}

export function resolveUsageWithFallback(input: {
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    messages: LlmMessage[];
    outputText: string;
}) {
    if (input.usage && input.usage.totalTokens > 0) {
        return input.usage;
    }

    const promptChars = input.messages.reduce((sum, message) => sum + message.content.length, 0);
    const promptTokens = estimateTokensFromChars(promptChars);
    const completionTokens = estimateTokensFromChars(input.outputText.length);

    return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
    };
}

export function buildMessagesWithHistory(
    systemPrompt: string,
    userMessage: string,
    history: HistoryMessage[] = [],
    currentArtifacts?: { html?: string; css?: string; js?: string } | null,
    focusContext?: LlmFocusContext,
    sectionContextOpts?: SectionContextOpts,
): { messages: LlmMessage[]; historyIncluded: number } {
    // ── History normalisation ────────────────────────────────────────────────
    let normalizedHistory = history
        .slice(-MAX_HISTORY_MESSAGES)
        .map((msg) => ({
            ...msg,
            content: msg.content.length > MAX_HISTORY_MESSAGE_CHARS
                ? `${msg.content.slice(0, MAX_HISTORY_MESSAGE_CHARS)}\n...[history-compact]`
                : msg.content,
        }));

    // Focused-edit mode: apply history reduction strategy (active even without section context).
    // LLM_FOCUS_HISTORY_MODE defaults to "none" so focused queries never pay for prior history
    // unless explicitly configured (full | user_only).
    const focusHistoryMode = sectionContextOpts?.historyMode ?? (
        focusContext && focusContext.mode !== "project" ? env.LLM_FOCUS_HISTORY_MODE : "full"
    );
    if (focusHistoryMode === "none") {
        normalizedHistory = [];
    } else if (focusHistoryMode === "user_only") {
        normalizedHistory = normalizedHistory.filter((m) => m.role === "user");
    }

    // ── Focus context block ──────────────────────────────────────────────────
    let focusBlock = "";
    if (focusContext && focusContext.mode !== "project") {
        focusBlock = [
            "[Focus Context — modifica solo il target indicato e preserva il resto]",
            `mode: ${focusContext.mode}`,
            `targetType: ${focusContext.targetType}`,
            focusContext.userIntent ? `userIntent: ${focusContext.userIntent}` : "",
            focusContext.selectedElement
                ? (() => {
                    // Exclude outerHtml from the user-message focusBlock: it is already injected
                    // verbatim in the system-prompt addendum (buildFocusedModeSystemAddendum).
                    // Removing it here eliminates ~8 000 chars (~2 000 tokens) of duplication.
                    const { outerHtml: _omit, ...elementMeta } = focusContext.selectedElement;
                    return `selectedElement: ${JSON.stringify(elementMeta)}`;
                })()
                : "",
            focusContext.codeSelection
                ? `codeSelection: ${JSON.stringify(focusContext.codeSelection)}`
                : "",
        ].filter(Boolean).join("\n");
    }

    // ── Artifact / section context block ────────────────────────────────────
    let artifactBlock = "";

    if (sectionContextOpts) {
        // SECTION-AWARE path: send only the containing section + page map + filtered CSS.
        const jsRaw = currentArtifacts?.js ?? "";
        const MAX_JS_CHARS = 4000;
        const jsContext = jsRaw.length > MAX_JS_CHARS
            ? jsRaw.slice(0, MAX_JS_CHARS) + "\n// [js-troncato]"
            : jsRaw;

        const parts: string[] = [
            "[Sezione target — contesto ottimizzato per focused-edit]",
            `Mappa struttura pagina: ${serializePageMap(sectionContextOpts.pageMap)}`,
            `\nHTML sezione target (NON modificare altri elementi fuori da questa sezione):\n${sectionContextOpts.sectionHtml}`,
        ];
        if (sectionContextOpts.filteredCss) {
            parts.push(`CSS rilevante per questa sezione:\n${sectionContextOpts.filteredCss}`);
        }
        if (jsContext) {
            parts.push(`JS pagina (riferimento):\n${jsContext}`);
        }
        artifactBlock = parts.join("\n\n");
    } else if (currentArtifacts && (currentArtifacts.html || currentArtifacts.css || currentArtifacts.js)) {
        // FULL-ARTIFACT path: original behaviour.
        const parts: string[] = ["[Codice attualmente generato — usalo come base per evoluzioni]"];
        if (currentArtifacts.html) parts.push(`HTML:\n${currentArtifacts.html}`);
        if (currentArtifacts.css) parts.push(`CSS:\n${currentArtifacts.css}`);
        if (currentArtifacts.js) parts.push(`JS:\n${currentArtifacts.js}`);
        const full = parts.join("\n\n");
        artifactBlock = full.length > MAX_ARTIFACT_CHARS
            ? full.slice(0, MAX_ARTIFACT_CHARS) + "\n...[troncato]"
            : full;
    }

    const contextBlocks = [focusBlock, artifactBlock].filter(Boolean);
    const finalUserContent = contextBlocks.length > 0
        ? `${contextBlocks.join("\n\n")}\n\n---\n${userMessage}`
        : userMessage;

    // ── History budget selection ─────────────────────────────────────────────
    const fixedChars = systemPrompt.length + finalUserContent.length + 100;
    const budgetForHistory = Math.min(MAX_HISTORY_CHARS, MAX_CONTEXT_CHARS - fixedChars);

    const selected: HistoryMessage[] = [];
    let usedChars = 0;
    for (let i = normalizedHistory.length - 1; i >= 0; i--) {
        const msg = normalizedHistory[i]!;
        const cost = msg.content.length + 20;
        if (budgetForHistory > 0 && usedChars + cost > budgetForHistory) break;
        selected.unshift(msg);
        usedChars += cost;
    }

    return {
        messages: [
            { role: "system", content: systemPrompt },
            ...selected,
            { role: "user", content: finalUserContent },
        ],
        historyIncluded: selected.length,
    };
}

// ── Module-private helpers ────────────────────────────────────────────────────

function estimateTokensFromChars(chars: number): number {
    return Math.max(1, Math.ceil(chars / 4));
}
