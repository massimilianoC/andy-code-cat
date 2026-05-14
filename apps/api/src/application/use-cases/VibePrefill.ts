import type { VibePrefillResponse, AttachmentMeta, FormatHint, ZeroEffortDraft } from "@andy-code-cat/contracts";
import { zeroEffortLaunchSchema } from "@andy-code-cat/contracts";
import { resolvePromptTaskSettingFromConfig } from "../../domain/entities/PlatformConfig";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { GetLlmCatalog } from "./GetLlmCatalog";
import { env } from "../../config";

// ── Constants ─────────────────────────────────────────────────────────────────

const TASK_KEY = "vibe_intent_prefill";
const FALLBACK_PROVIDER = "siliconflow";
const FALLBACK_MODEL = "Qwen/Qwen3-8B";
const MAX_PROMPT_CHARS = 2000;
const MAX_TOKENS = 768;

const VALID_SITE_TYPES = new Set(["landing_page", "portfolio", "showcase", "business_site"]);
const VALID_STYLE_ATTRIBUTES = new Set([
    "minimal", "premium", "dark", "bright", "bold",
    "elegant", "corporate", "playful", "tech", "artisan", "luxury", "eco",
]);

// ── Default draft ─────────────────────────────────────────────────────────────

function defaultDraft(prompt: string): ZeroEffortDraft {
    const projectName = prompt.trim().slice(0, 64) || "Progetto";
    return {
        businessName: projectName,
        siteType: "landing_page",
        primaryGoal: prompt.trim().slice(0, 500) || "Sito web moderno e professionale.",
        audience: "Pubblico generale interessato all'attività.",
    };
}

// ── Auth helper ───────────────────────────────────────────────────────────────

function resolveAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none"): string | undefined {
    if (authType === "none") return undefined;
    const key = env.providerApiKeys[providerKey];
    if (!key) return undefined;
    return (authType ?? "bearer") === "api-key" ? key : `Bearer ${key}`;
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a web project brief extractor.
Given a user's free-form description of a website project, return a JSON object that
populates a structured project brief.

Required JSON shape (return ONLY valid JSON, no markdown fences, no extra text):
{
  "businessName": "brand or project name (string, required)",
  "siteType": "landing_page|portfolio|showcase|business_site (string, required)",
  "primaryGoal": "full project description and main objective — at least 20 chars (string, required)",
  "audience": "target audience description — at least 10 chars (string, required)",
  "tone": "communication tone, e.g. professional, playful (string or null)",
  "primaryCta": "main call-to-action button text (string or null)",
  "styleHint": "visual style notes (string or null)",
  "contactInfo": [{"key": "Email", "value": "..."}],
  "styleAttributes": ["minimal"]
}

Rules:
- businessName: extract from the prompt; fall back to "Progetto" if unclear.
- siteType: infer from context; default "landing_page".
- primaryGoal: expand the user's text into a detailed project description.
- audience: infer who the site is for; describe age group, interests, needs.
- contactInfo: extract any contact data mentioned (email, phone, address, socials); empty array if none.
- styleAttributes: pick 1–3 matching from: minimal, premium, dark, bright, bold, elegant, corporate, playful, tech, artisan, luxury, eco
- Return ONLY the JSON object.`;

function buildUserMessage(prompt: string, attachmentMeta?: AttachmentMeta[], templateId?: string | null, formatHint?: FormatHint | null): string {
    const parts: string[] = [prompt.slice(0, MAX_PROMPT_CHARS)];
    if (attachmentMeta?.length) {
        const metaPart = attachmentMeta
            .map((a) => `[${a.filename} — ${a.mimeType}, ${(a.sizeBytes / 1024).toFixed(0)} KB]`)
            .join(", ");
        parts.push(`\nAttached files: ${metaPart}`);
    }
    if (templateId) parts.push(`\nDetected template: ${templateId}`);
    if (formatHint) parts.push(`\nFormat hint: ${formatHint}`);
    return parts.join("");
}

// ── Response parser ───────────────────────────────────────────────────────────

function parsePrefillResponse(raw: string, prompt: string): { draft: ZeroEffortDraft; confidence: number } {
    let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;

    try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;

        const businessName = typeof parsed.businessName === "string" && parsed.businessName.trim()
            ? parsed.businessName.trim().slice(0, 120)
            : prompt.trim().slice(0, 64) || "Progetto";

        const rawSiteType = typeof parsed.siteType === "string" ? parsed.siteType : "";
        const siteType = VALID_SITE_TYPES.has(rawSiteType)
            ? (rawSiteType as ZeroEffortDraft["siteType"])
            : "landing_page";

        const primaryGoal = typeof parsed.primaryGoal === "string" && parsed.primaryGoal.trim().length >= 8
            ? parsed.primaryGoal.trim().slice(0, 3000)
            : prompt.trim().slice(0, 500) || "Progetto web moderno.";

        const audience = typeof parsed.audience === "string" && parsed.audience.trim().length >= 3
            ? parsed.audience.trim().slice(0, 1000)
            : "Pubblico generale.";

        const tone = typeof parsed.tone === "string" && parsed.tone.trim()
            ? parsed.tone.trim().slice(0, 80)
            : undefined;

        const primaryCta = typeof parsed.primaryCta === "string" && parsed.primaryCta.trim()
            ? parsed.primaryCta.trim().slice(0, 120)
            : undefined;

        const styleHint = typeof parsed.styleHint === "string" && parsed.styleHint.trim()
            ? parsed.styleHint.trim().slice(0, 400)
            : undefined;

        const rawContacts = Array.isArray(parsed.contactInfo) ? parsed.contactInfo : [];
        const contactInfo = rawContacts
            .filter((c): c is { key: string; value: string } =>
                typeof c === "object" && c !== null &&
                typeof (c as Record<string, unknown>).key === "string" &&
                typeof (c as Record<string, unknown>).value === "string")
            .map((c) => ({ key: c.key.trim().slice(0, 60), value: c.value.trim().slice(0, 200) }))
            .filter((c) => c.key && c.value)
            .slice(0, 15);

        const rawStyles = Array.isArray(parsed.styleAttributes) ? parsed.styleAttributes : [];
        const styleAttributes = rawStyles
            .filter((s): s is string => typeof s === "string" && VALID_STYLE_ATTRIBUTES.has(s))
            .slice(0, 20);

        // Validate with zod to ensure the draft is safe to use downstream
        const zodResult = zeroEffortLaunchSchema.safeParse({
            businessName, siteType, primaryGoal, audience, tone, primaryCta, styleHint, contactInfo, styleAttributes,
        });

        const draft: ZeroEffortDraft = zodResult.success
            ? zodResult.data
            : { businessName, siteType, primaryGoal, audience, tone, primaryCta, styleHint, contactInfo, styleAttributes };

        return { draft, confidence: 0.85 };
    } catch {
        return { draft: defaultDraft(prompt), confidence: 0 };
    }
}

// ── Input / Output ────────────────────────────────────────────────────────────

export interface VibePrefillInput {
    prompt: string;
    /** Pre-built Layer D block from project assets — injected verbatim into the system prompt. */
    layerDContext?: string;
    attachmentMeta?: AttachmentMeta[];
    templateId?: string | null;
    formatHint?: FormatHint | null;
}

// ── Use-case ──────────────────────────────────────────────────────────────────

export class VibePrefill {
    constructor(
        private readonly platformConfigRepository: PlatformConfigRepository,
        private readonly getLlmCatalog: GetLlmCatalog,
    ) { }

    async execute(input: VibePrefillInput): Promise<VibePrefillResponse> {
        const platformConfig = await this.platformConfigRepository.get().catch(() => null);
        const taskSettings = resolvePromptTaskSettingFromConfig(platformConfig, "default", TASK_KEY);

        if (!env.vibeClassifierEnabled || !taskSettings.enabled) {
            return { draft: defaultDraft(input.prompt), confidence: 0, skipped: true };
        }

        const catalog = await this.getLlmCatalog.execute();
        const activeProviders = catalog.providers.filter((p) => p.isActive);
        const providerCatalog =
            activeProviders.find((p) => p.provider === taskSettings.provider) ??
            activeProviders.find((p) => p.provider === FALLBACK_PROVIDER) ??
            activeProviders[0];

        if (!providerCatalog) {
            return { draft: defaultDraft(input.prompt), confidence: 0, skipped: true };
        }

        const modelId =
            providerCatalog.models.find((m) => m.isActive && m.id === taskSettings.model)?.id ??
            providerCatalog.models.find((m) => m.isActive && m.isDefault)?.id ??
            providerCatalog.models.find((m) => m.isActive)?.id ??
            FALLBACK_MODEL;

        const authHeader = resolveAuthHeader(providerCatalog.provider, providerCatalog.authType);
        if (!authHeader && providerCatalog.authType !== "none") {
            return { draft: defaultDraft(input.prompt), confidence: 0, skipped: true };
        }

        const userMessage = buildUserMessage(input.prompt, input.attachmentMeta, input.templateId, input.formatHint);

        // Extend system prompt with Layer D document context when available
        const systemPrompt = input.layerDContext
            ? `${SYSTEM_PROMPT}\n\n${input.layerDContext}`
            : SYSTEM_PROMPT;

        try {
            const response = await fetch(`${providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(authHeader ? { Authorization: authHeader } : {}),
                },
                body: JSON.stringify({
                    model: modelId,
                    max_tokens: Math.min(taskSettings.maxCompletionTokens, MAX_TOKENS),
                    temperature: taskSettings.temperature ?? 0.3,
                    messages: [
                        { role: "system" as const, content: systemPrompt },
                        { role: "user" as const, content: userMessage },
                    ],
                }),
            });

            if (!response.ok) {
                return { draft: defaultDraft(input.prompt), confidence: 0, skipped: true };
            }

            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            const raw = String(
                (payload?.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content ?? ""
            ).trim();

            const { draft, confidence } = parsePrefillResponse(raw, input.prompt);
            return { draft, confidence, skipped: false };
        } catch {
            return { draft: defaultDraft(input.prompt), confidence: 0, skipped: true };
        }
    }
}
