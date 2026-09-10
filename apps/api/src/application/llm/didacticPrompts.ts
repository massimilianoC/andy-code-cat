export type DidacticPromptMode = "generate" | "ask";

/**
 * How much a didactic generation is asked to produce.
 *
 * Exported because the prompt states it and the caller checks the reply against it. Two copies of
 * these numbers would drift, and the drift would be invisible: the prompt would ask for one thing
 * and the shortfall report would measure another (AGENTS.md, Rule Zero).
 *
 * Not enforceable by structured output: `strict: true` JSON-schema mode does not support
 * `minItems`/`maxItems`, which is why `ARTIFACT_RESPONSE_SCHEMA` carries neither. The contract is
 * therefore stated twice in the prompt — once in the system message, where a model under long-
 * context load weights it most, and once beside the shape it applies to — and verified after the
 * fact rather than imposed.
 */
export const DIDACTIC_OUTPUT_CONTRACT = {
    minTopics: 6,
    maxTopics: 10,
    quizzes: 5,
} as const;

interface DidacticPromptInput {
    mode: DidacticPromptMode;
    artifacts: { html: string; css: string; js: string };
    promptingTrace?: {
        originalUserMessage: string;
        prePromptTemplate?: string;
        effectiveSystemPrompt?: string;
    } | null;
    focus?: {
        kind: "preview" | "html" | "css" | "js";
        pfId?: string;
        outerHtml?: string;
        lineRange?: [number, number];
        selectedText?: string;
    } | null;
    question?: string;
    uiLanguage: "it" | "en";
}

function numberLines(content: string): string {
    const lines = content.split("\n");
    const pad = String(lines.length).length;
    return lines.map((l, i) => `${String(i + 1).padStart(pad, "0")}: ${l}`).join("\n");
}

export function buildDidacticPrompt(input: DidacticPromptInput): { system: string; user: string } {
    const lang = input.uiLanguage === "en" ? "English" : "Italian";
    const { minTopics, maxTopics, quizzes } = DIDACTIC_OUTPUT_CONTRACT;

    // The output contract lives here as well as beside the shape below. It used to appear only at
    // the tail of the user message, after up to 240,000 characters of artifact; a model reading an
    // 18,000-token prompt answered with 1 topic and 1 quiz against a request for 6-10 and exactly
    // 5, stopped on its own, and nothing complained. The system message is the one position a
    // model under that load still weights heavily.
    const generateContract = input.mode === "generate"
        ? ` Every generation MUST contain ${minTopics}-${maxTopics} topics and EXACTLY ${quizzes} quizzes — this is a hard requirement, not a target: a reply with fewer is incomplete and will be rejected. Cover the artifact broadly rather than deeply: prefer ${minTopics} distinct topics across different categories over one exhaustive topic.`
        : "";

    const system = `You are a didactic code explainer embedded in a web-builder. You ONLY explain the given artifact and the prompt decisions that produced it — you NEVER propose, rewrite, or output code. Reference real elements. Anchors MUST use only \`data-pf-id\` values present in the provided HTML, or line ranges within the provided files. Answer in ${lang}.${generateContract}`;

    const blocks: string[] = [];

    if (input.mode === "generate") {
        blocks.push(`[INSTRUMENTED HTML]\n${input.artifacts.html.slice(0, 120000)}`);
        blocks.push(`[CSS (numbered)]\n${numberLines(input.artifacts.css).slice(0, 60000)}`);
        blocks.push(`[JS (numbered)]\n${numberLines(input.artifacts.js).slice(0, 60000)}`);
    } else {
        // ask mode: trimmed artifact context
        blocks.push(`[ARTIFACT CONTEXT]\nHTML:\n${input.artifacts.html.slice(0, 60000)}\n\nCSS:\n${numberLines(input.artifacts.css).slice(0, 30000)}\n\nJS:\n${numberLines(input.artifacts.js).slice(0, 30000)}`);
    }

    if (input.promptingTrace) {
        blocks.push(`[GENERATION INTENT]\nOriginal user message: ${input.promptingTrace.originalUserMessage.slice(0, 4000)}\nPre-prompt template: ${(input.promptingTrace.prePromptTemplate ?? "").slice(0, 4000)}\nEffective system prompt: ${(input.promptingTrace.effectiveSystemPrompt ?? "").slice(0, 4000)}`);
    }

    if (input.mode === "ask" && input.focus) {
        const f = input.focus;
        const focusBlock = f.kind === "preview"
            ? `Preview element (pfId=${f.pfId ?? "n/a"}):\n${(f.outerHtml ?? "").slice(0, 4000)}`
            : `${f.kind.toUpperCase()} lines ${f.lineRange?.[0] ?? "?"}-${f.lineRange?.[1] ?? "?"}:\n${(f.selectedText ?? "").slice(0, 4000)}`;
        blocks.push(`[FOCUS]\n${focusBlock}`);
    }

    if (input.mode === "generate") {
        blocks.push(`Produce a JSON object with these exact keys (no markdown fences, no extra text):\n{\n  "overview": "2-4 sentences in ${lang}",\n  "topics": [\n    {\n      "category": "html_structure|css_technique|js_function|responsiveness|accessibility|design_choice|prompt_layer",\n      "difficulty": "base|intermediate|advanced",\n      "title": "<=80 chars",\n      "summary": "1-3 sentences",\n      "anchors": [{ "kind": "preview|html|css|js|prompt", "pfId": "pf-N" | null, "lineRange": [start,end] | null }]\n    }\n  ],\n  "quizzes": [\n    {\n      "difficulty": "base|intermediate|advanced",\n      "question": "...",\n      "options": ["a","b","c","d"],\n      "correctIndex": 0..3,\n      "explanation": "...",\n      "anchors": [{ "kind": "...", "pfId": "...", "lineRange": [...] }]\n    }\n  ]\n}\nMANDATORY OUTPUT SIZE — check this before you answer:\n- "topics": ${minTopics} to ${maxTopics} entries. Not fewer than ${minTopics}. Balance them across different categories.\n- "quizzes": EXACTLY ${quizzes} entries, mixed difficulty. Not fewer than ${quizzes}.\nA large artifact gives you more to explain, not less. If you find yourself writing a single topic, you are summarising instead of teaching: split the artifact by concern (structure, styling, behaviour, responsiveness, accessibility, design decisions) and write one topic per concern.\n\nOther constraints:\n- Anchors must reference EXISTING data-pf-id values or valid line ranges only.\n- Do not invent pf-ids.\n- prompt_layer category is for prompt decisions that shaped the artifact.\n\nBefore returning, count your own "topics" and "quizzes" arrays and confirm they meet the sizes above.`);
    } else {
        blocks.push(`User question: ${input.question ?? ""}\nAnswer the question in ${lang}. Be concise but thorough. Reference specific code lines or elements when relevant.\nIMPORTANT: Respond with plain markdown text only. Do NOT wrap your answer in JSON. Do NOT produce structured objects, artifact sections, or code changes. Use standard markdown formatting where helpful: ## headings, **bold**, bullet lists, inline \`code\`.`);
    }

    return { system, user: blocks.join("\n\n---\n\n") };
}
