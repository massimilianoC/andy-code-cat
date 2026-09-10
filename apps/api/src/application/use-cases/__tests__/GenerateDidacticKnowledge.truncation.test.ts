/**
 * Regression for the didactic JSON parser carrying its own 3-of-5 repair-strategy subset
 * instead of reusing `application/llm/llmParser.ts`'s `parseJsonWithRepairs` (docs/specs
 * ties this to Rule Zero in AGENTS.md: a repair rule that lives in two places is a repair
 * rule that gets fixed in one of them).
 *
 * The missing strategy was `repairTruncatedJson` — closing unterminated strings/arrays/objects
 * left by a `max_tokens` cutoff. Measured runs produce 4000-6000 completion tokens of didactic
 * JSON, which makes truncation the most likely real failure mode, not a corner case.
 *
 * This is not a bare "cut the JSON in half" test: `jsonrepair` (already one of the old three
 * strategies) already closes a plain truncated object on its own. The gap that actually broke
 * production is in candidate SELECTION, not repair: the old code's only two candidates were
 * `extractFirstJsonObject` (requires balanced braces, so it returns null the instant the
 * completion is cut off mid-object) and "the trimmed text itself, if it happens to start with
 * `{`". A model that prefaces its JSON with a short acknowledgement sentence — common,
 * especially for reasoning-capable models not in strict JSON mode — defeats the second
 * candidate too, because the trimmed text starts with prose, not `{`. Combine that with a
 * `max_tokens` cutoff and BOTH old candidates are null before any repair strategy ever runs.
 *
 * The new implementation borrows the exact candidate shape `parseSectionPlan` already uses
 * (`application/llm/sectionPlan.ts`): also try the open remainder from the first `{` onward,
 * which needs no closing brace to exist. That third candidate is what makes this payload
 * reachable at all, and once reached, `repairTruncatedJson` (now included via
 * `parseJsonWithRepairs`) closes it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        providerApiKeys: {},
        COST_POLICY_TEXT_EUR_PER_1K_TOKENS: 0.002,
        COST_POLICY_IMAGE_EUR_PER_ASSET: 0.02,
        COST_POLICY_VIDEO_EUR_PER_ASSET: 0.2,
        COST_POLICY_USD_TO_EUR_RATE: 0.92,
        COST_POLICY_PROVIDER_MARKUP_FACTOR: 1.2,
    },
}));

import { GenerateDidacticKnowledge } from "../GenerateDidacticKnowledge";
import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import type { DidacticArtifactKnowledgeRepository } from "../../../domain/repositories/DidacticArtifactKnowledgeRepository";
import type { DidacticTopic, DidacticQuiz } from "../../../domain/entities/DidacticArtifactKnowledge";

const snapshot: PreviewSnapshot = {
    id: "snap-1",
    projectId: "p1",
    conversationId: "c1",
    isActive: true,
    artifacts: {
        html: '<div id="root"><h1>Hello</h1></div>',
        css: "h1 { color: red; }",
        js: "console.log('hi');",
    },
    createdAt: new Date(),
};

const llmContext = {
    provider: "siliconflow",
    model: "MiniMaxAI/MiniMax-M3",
    baseUrl: "https://api.siliconflow.com/v1",
    apiKey: "test-key",
    temperature: 0.4,
    maxTokens: 6000,
};

let saved: unknown = null;
const knowledgeRepo: DidacticArtifactKnowledgeRepository = {
    findByProjectAndSnapshot: async () => null,
    upsert: async (k) => { saved = k; return k; },
    deleteBySnapshot: async () => undefined,
    // Part of the repository contract since project deletion started cascading here; this test
    // never exercises it.
    deleteByProject: async () => 0,
};

function mkTopic(i: number): DidacticTopic {
    return {
        id: `t${i}`,
        category: "html_structure",
        difficulty: "base",
        title: `Topic ${i}`,
        summary: `Summary text for topic number ${i}.`,
        anchors: [],
    };
}

function mkQuiz(i: number): DidacticQuiz {
    return {
        id: `q${i}`,
        difficulty: "base",
        question: `Question number ${i}?`,
        options: ["A", "B", "C", "D"],
        correctIndex: i % 4,
        explanation: `Explanation for quiz ${i}.`,
        anchors: [],
    };
}

/**
 * Builds a raw model reply that is:
 *  1. prefaced by a short acknowledgement sentence, not wrapped in a ```json fence — a real
 *     pattern for models not forced into strict JSON mode;
 *  2. cut off (`max_tokens`) right after the fourth quiz object closes, before the array or the
 *     root object close — the classic mid-completion truncation shape.
 *
 * Six topics and six quizzes are intended; only the first four quizzes survive truncation, and
 * that is the whole point: the repaired JSON must still validate as `{overview, topics, quizzes}`
 * with an intact prefix, even though the tail was never generated.
 */
function buildTruncatedReply(): string {
    const full = JSON.stringify({
        overview: "This artifact renders a red 'Hello' heading inside a wrapper div.",
        topics: Array.from({ length: 6 }, (_, i) => mkTopic(i)),
        quizzes: Array.from({ length: 6 }, (_, i) => mkQuiz(i)),
    });

    // Cut right after the 4th quiz object's closing brace (q3, zero-indexed) so every included
    // element is well-formed and only the tail (q4, q5, and every closing bracket) is missing.
    const marker = "\"id\":\"q3\"";
    const markerIndex = full.indexOf(marker);
    let depth = 0;
    let objectStart = -1;
    for (let i = markerIndex; i >= 0; i--) {
        if (full[i] === "}") depth++;
        else if (full[i] === "{") {
            if (depth === 0) { objectStart = i; break; }
            depth--;
        }
    }
    let d = 0;
    let objectEnd = -1;
    for (let i = objectStart; i < full.length; i++) {
        if (full[i] === "{") d++;
        else if (full[i] === "}") { d--; if (d === 0) { objectEnd = i; break; } }
    }

    const truncatedJson = full.slice(0, objectEnd + 1);
    return "Ecco l'analisi didattica del progetto:\n\n" + truncatedJson;
}

const TRUNCATED_REPLY = buildTruncatedReply();

function truncatedResponseBody(): string {
    return JSON.stringify({
        choices: [{ message: { content: TRUNCATED_REPLY }, finish_reason: "length" }],
        usage: { prompt_tokens: 900, completion_tokens: 6000, total_tokens: 6900 },
    });
}

describe("GenerateDidacticKnowledge — survives a max_tokens truncated reply", () => {
    beforeEach(() => {
        saved = null;
        vi.stubGlobal("fetch", vi.fn(async () => new Response(truncatedResponseBody(), { status: 200 })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it("fixture: the old 3-of-5 repair chain could not parse this reply at all", () => {
        // Same shape as the deleted `parseDidacticJson`: extractFirstJsonObject (needs balanced
        // braces) or "trimmed text starting with {" as the only two candidates, then
        // raw / jsonrepair / newline-escape as the only three repair strategies.
        function extractFirstJsonObject(text: string): string | null {
            const start = text.indexOf("{");
            if (start < 0) return null;
            let depth = 0;
            let inString = false;
            let escaped = false;
            for (let i = start; i < text.length; i++) {
                const ch = text[i];
                if (inString) {
                    if (escaped) escaped = false;
                    else if (ch === "\\") escaped = true;
                    else if (ch === '"') inString = false;
                    continue;
                }
                if (ch === '"') { inString = true; continue; }
                if (ch === "{") depth++;
                if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
            }
            return null;
        }

        const trimmed = TRUNCATED_REPLY.trim();
        const oldCandidates = [
            extractFirstJsonObject(trimmed),
            trimmed.startsWith("{") ? trimmed : null,
        ];
        expect(oldCandidates.every((c) => c === null)).toBe(true);
    });

    it("recovers overview, topics, and the surviving quizzes from a truncated, prose-prefixed reply", async () => {
        const useCase = new GenerateDidacticKnowledge(knowledgeRepo);

        const result = await useCase.execute({
            projectId: "p1",
            snapshotId: "snap-1",
            userId: "u1",
            snapshot,
            uiLanguage: "en",
            llmContext,
        });

        expect(result.knowledge.overview).toBe(
            "This artifact renders a red 'Hello' heading inside a wrapper div.",
        );
        expect(result.knowledge.topics).toHaveLength(6);
        // Only q0-q3 survive the cutoff — q4 and q5 were never generated, and no repair chain
        // can conjure content the model never produced.
        expect(result.knowledge.quizzes).toHaveLength(4);
        expect(result.knowledge.quizzes.map((q) => q.id)).toEqual(["q0", "q1", "q2", "q3"]);
        expect(saved).toBe(result.knowledge);
    });
});
