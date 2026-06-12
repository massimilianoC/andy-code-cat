import { env } from "../../config";
import { buildChatCompletionRequestBody } from "../llm/chatRequestAdapter";
import { buildDidacticPrompt } from "../llm/didacticPrompts";
import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { DidacticQnaEntry, DidacticQnaFocus } from "../../domain/entities/DidacticQnaEntry";
import type { DidacticQnaRepository } from "../../domain/repositories/DidacticQnaRepository";

interface LlmContext {
    provider: string;
    model: string;
    baseUrl: string;
    apiKey: string;
    temperature: number;
    maxTokens: number;
}

interface Input {
    projectId: string;
    userId: string;
    snapshotId: string;
    snapshot: PreviewSnapshot;
    question: string;
    focus?: DidacticQnaFocus;
    uiLanguage: "it" | "en";
    llmContext: LlmContext;
}

interface Output {
    answer: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    model: string;
    provider: string;
}

export class AskDidacticQuestion {
    constructor(private repo: DidacticQnaRepository) {}

    async execute(input: Input): Promise<Output> {
        const { snapshot, llmContext, uiLanguage, question, focus } = input;

        const { system, user } = buildDidacticPrompt({
            mode: "ask",
            artifacts: snapshot.artifacts,
            promptingTrace: snapshot.metadata?.promptingTrace,
            focus: focus
                ? {
                      kind: focus.kind,
                      pfId: focus.pfId,
                      outerHtml: focus.outerHtml,
                      lineRange: focus.lineRange,
                      selectedText: focus.selectedText,
                  }
                : undefined,
            question,
            uiLanguage,
        });

        const body = buildChatCompletionRequestBody({
            provider: llmContext.provider,
            model: llmContext.model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            maxTokens: llmContext.maxTokens,
            temperature: llmContext.temperature,
        });

        const url = `${llmContext.baseUrl}/chat/completions`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${llmContext.apiKey}`,
        };

        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        if (!res.ok) {
            const text = await res.text().catch(() => "unknown");
            throw new Error(`LLM request failed: ${res.status} ${text}`);
        }

        const json = await res.json();
        const answer = String(json.choices?.[0]?.message?.content ?? "");
        const usage = json.usage
            ? {
                  promptTokens: Number(json.usage.prompt_tokens ?? 0),
                  completionTokens: Number(json.usage.completion_tokens ?? 0),
                  totalTokens: Number(json.usage.total_tokens ?? 0),
              }
            : undefined;

        return { answer, usage, model: llmContext.model, provider: llmContext.provider };
    }

    async streamTokens(
        input: Input,
        onToken: (delta: string) => void
    ): Promise<{ fullAnswer: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; model: string; provider: string }> {
        const { snapshot, llmContext, uiLanguage, question, focus } = input;

        const { system, user } = buildDidacticPrompt({
            mode: "ask",
            artifacts: snapshot.artifacts,
            promptingTrace: snapshot.metadata?.promptingTrace,
            focus: focus
                ? {
                      kind: focus.kind,
                      pfId: focus.pfId,
                      outerHtml: focus.outerHtml,
                      lineRange: focus.lineRange,
                      selectedText: focus.selectedText,
                  }
                : undefined,
            question,
            uiLanguage,
        });

        const body = buildChatCompletionRequestBody({
            provider: llmContext.provider,
            model: llmContext.model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            maxTokens: llmContext.maxTokens,
            temperature: llmContext.temperature,
        });

        const url = `${llmContext.baseUrl}/chat/completions`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${llmContext.apiKey}`,
        };

        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...body, stream: true }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "unknown");
            throw new Error(`LLM request failed: ${res.status} ${text}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body from LLM");

        const decoder = new TextDecoder();
        let sseBuffer = "";
        let fullAnswer = "";
        let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });

            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (data === "[DONE]") continue;
                try {
                    const chunk = JSON.parse(data) as {
                        choices?: Array<{ delta?: { content?: string } }>;
                        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
                    };
                    const delta = chunk.choices?.[0]?.delta?.content;
                    if (delta) {
                        fullAnswer += delta;
                        onToken(delta);
                    }
                    if (chunk.usage) {
                        usage = {
                            promptTokens: Number(chunk.usage.prompt_tokens ?? 0),
                            completionTokens: Number(chunk.usage.completion_tokens ?? 0),
                            totalTokens: Number(chunk.usage.total_tokens ?? 0),
                        };
                    }
                } catch {
                    // skip malformed SSE chunks
                }
            }
        }

        return { fullAnswer, usage, model: llmContext.model, provider: llmContext.provider };
    }

    async persist(input: Input & Output): Promise<DidacticQnaEntry> {
        const entry: DidacticQnaEntry = {
            id: crypto.randomUUID(),
            projectId: input.projectId,
            userId: input.userId,
            snapshotId: input.snapshotId,
            focus: input.focus,
            question: input.question,
            answer: input.answer,
            model: input.model,
            provider: input.provider,
            usage: input.usage,
            createdAt: new Date(),
        };
        return this.repo.insert(entry);
    }
}
