import type { VibeClassifyResponse, AttachmentMeta, FormatHint } from "@andy-code-cat/contracts";
import { PRESET_CATALOG } from "../../domain/entities/ProjectPreset";
import { resolvePromptTaskSettingFromConfig } from "../../domain/entities/PlatformConfig";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { GetLlmCatalog } from "./GetLlmCatalog";
import { buildTemplateListBlock, FORMAT_HINT_RULES } from "../prompting/formatHintRules";
import { env } from "../../config";

const TASK_KEY = "vibe_intent_classify";
const FALLBACK_PROVIDER = "siliconflow";
const FALLBACK_MODEL = "Qwen/Qwen3-8B";
const CONFIDENCE_THRESHOLD = 0.65;
const MAX_PROMPT_CHARS = 2000;

const VALID_FORMAT_HINTS = new Set<string>(Object.keys(FORMAT_HINT_RULES));

function resolveAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none"): string | undefined {
    if (authType === "none") return undefined;
    const key = env.providerApiKeys[providerKey];
    if (!key) return undefined;
    return (authType ?? "bearer") === "api-key" ? key : `Bearer ${key}`;
}

function buildSystemPrompt(templateListBlock: string): string {
    return `You are a document-type and template classifier.
Given a user prompt and optional file metadata, return a JSON object:
{
  "templateId": "<id from catalog or null>",
  "formatHint": "<one of: ${Object.keys(FORMAT_HINT_RULES).join(", ")} or null>",
  "confidence": <number 0.0–1.0>,
  "reasoning": "<one sentence>"
}

Rules:
- Set templateId only if confidence >= ${CONFIDENCE_THRESHOLD} against the template catalog below.
- Set formatHint independently of templateId; it can be non-null even when templateId is null.
- If neither signal is clear, return both as null.
- Return valid JSON only — no markdown fences, no extra text.

Available templates:
${templateListBlock}`;
}

function buildUserMessage(prompt: string, attachmentMeta?: AttachmentMeta[]): string {
    const safePart = prompt.slice(0, MAX_PROMPT_CHARS);
    if (!attachmentMeta?.length) return safePart;
    const metaPart = attachmentMeta
        .map((a) => `[${a.filename} — ${a.mimeType}, ${(a.sizeBytes / 1024).toFixed(0)} KB]`)
        .join(", ");
    return `${safePart}\n\nAttached files: ${metaPart}`;
}

function parseClassifyResponse(raw: string): Omit<VibeClassifyResponse, "skipped"> {
    let text = raw.trim();
    // Strip optional code fences from models that ignore instructions
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
    try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
        const templateId = typeof parsed.templateId === "string" && parsed.templateId !== "null"
            ? parsed.templateId
            : null;
        const rawHint = typeof parsed.formatHint === "string" ? parsed.formatHint : null;
        const formatHint: FormatHint | null = rawHint && VALID_FORMAT_HINTS.has(rawHint)
            ? (rawHint as FormatHint)
            : null;
        const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
        return { templateId, formatHint, confidence, reasoning };
    } catch {
        return { templateId: null, formatHint: null, confidence: 0, reasoning: "" };
    }
}

export interface VibeClassifyInput {
    prompt: string;
    attachmentMeta?: AttachmentMeta[];
}

export class VibeClassify {
    constructor(
        private readonly platformConfigRepository: PlatformConfigRepository,
        private readonly getLlmCatalog: GetLlmCatalog,
    ) { }

    async execute(input: VibeClassifyInput): Promise<VibeClassifyResponse> {
        const platformConfig = await this.platformConfigRepository.get().catch(() => null);
        const taskSettings = resolvePromptTaskSettingFromConfig(platformConfig, "default", TASK_KEY);

        // Feature flag: skip classifier when disabled globally or via task settings
        if (!env.vibeClassifierEnabled || !taskSettings.enabled) {
            return { templateId: null, formatHint: null, confidence: 0, reasoning: "classifier disabled", skipped: true };
        }

        const templateListBlock = buildTemplateListBlock(
            PRESET_CATALOG.map((p) => ({ id: p.id, label: p.label, hint: p.hint ?? "" })),
        );

        // If a custom systemTemplate is set in platform config, use it as template
        // ({{TEMPLATE_LIST}} is substituted with the live catalog block).
        const systemPrompt = taskSettings.systemTemplate?.trim()
            ? taskSettings.systemTemplate.replace("{{TEMPLATE_LIST}}", templateListBlock)
            : buildSystemPrompt(templateListBlock);
        const userMessage = buildUserMessage(input.prompt, input.attachmentMeta);

        const catalog = await this.getLlmCatalog.execute();
        const activeProviders = catalog.providers.filter((p) => p.isActive);
        const providerCatalog =
            activeProviders.find((p) => p.provider === taskSettings.provider) ??
            activeProviders.find((p) => p.provider === FALLBACK_PROVIDER) ??
            activeProviders[0];

        if (!providerCatalog) {
            return { templateId: null, formatHint: null, confidence: 0, reasoning: "no active provider", skipped: true };
        }

        const modelId =
            providerCatalog.models.find((m) => m.isActive && m.id === taskSettings.model)?.id ??
            providerCatalog.models.find((m) => m.isActive && m.isDefault)?.id ??
            providerCatalog.models.find((m) => m.isActive)?.id ??
            FALLBACK_MODEL;

        const authHeader = resolveAuthHeader(providerCatalog.provider, providerCatalog.authType);
        if (!authHeader && providerCatalog.authType !== "none") {
            return { templateId: null, formatHint: null, confidence: 0, reasoning: "missing API key", skipped: true };
        }

        const messages = [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userMessage },
        ];

        try {
            const response = await fetch(`${providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(authHeader ? { Authorization: authHeader } : {}),
                },
                body: JSON.stringify({
                    model: modelId,
                    max_tokens: Math.min(taskSettings.maxCompletionTokens, 512),
                    temperature: taskSettings.temperature,
                    messages,
                }),
            });

            if (!response.ok) {
                return { templateId: null, formatHint: null, confidence: 0, reasoning: `provider error ${response.status}`, skipped: true };
            }

            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            const raw = String((payload?.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content ?? "").trim();

            const parsed = parseClassifyResponse(raw);

            // Enforce confidence threshold for templateId
            const templateId = parsed.confidence >= CONFIDENCE_THRESHOLD ? parsed.templateId : null;

            return {
                templateId,
                formatHint: parsed.formatHint,
                confidence: parsed.confidence,
                reasoning: parsed.reasoning,
                skipped: false,
            };
        } catch {
            return { templateId: null, formatHint: null, confidence: 0, reasoning: "classifier error", skipped: true };
        }
    }
}
