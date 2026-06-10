export type DidacticPromptMode = "generate" | "ask";

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
    const system = `You are a didactic code explainer embedded in a web-builder. You ONLY explain the given artifact and the prompt decisions that produced it — you NEVER propose, rewrite, or output code. Reference real elements. Anchors MUST use only \`data-pf-id\` values present in the provided HTML, or line ranges within the provided files. Answer in ${lang}.`;

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
        blocks.push(`Produce a JSON object with these exact keys (no markdown fences, no extra text):\n{\n  "overview": "2-4 sentences in ${lang}",\n  "topics": [\n    {\n      "category": "html_structure|css_technique|js_function|responsiveness|accessibility|design_choice|prompt_layer",\n      "difficulty": "base|intermediate|advanced",\n      "title": "<=80 chars",\n      "summary": "1-3 sentences",\n      "anchors": [{ "kind": "preview|html|css|js|prompt", "pfId": "pf-N" | null, "lineRange": [start,end] | null }]\n    }\n  ],\n  "quizzes": [\n    {\n      "difficulty": "base|intermediate|advanced",\n      "question": "...",\n      "options": ["a","b","c","d"],\n      "correctIndex": 0..3,\n      "explanation": "...",\n      "anchors": [{ "kind": "...", "pfId": "...", "lineRange": [...] }]\n    }\n  ]\n}\nConstraints:\n- 6–10 topics, balanced across categories.\n- Exactly 5 quizzes, mixed difficulty.\n- Anchors must reference EXISTING data-pf-id values or valid line ranges only.\n- Do not invent pf-ids.\n- prompt_layer category is for prompt decisions that shaped the artifact.`);
    } else {
        blocks.push(`User question: ${input.question ?? ""}\nAnswer the question in ${lang}. Be concise but thorough. Reference specific code lines or elements when relevant.`);
    }

    return { system, user: blocks.join("\n\n---\n\n") };
}
