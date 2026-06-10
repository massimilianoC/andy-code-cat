import type { DataDashboardDraft, VibeGenerationMode, VibePrefillResponse, AttachmentMeta, FormatHint, ZeroEffortDraft } from "@andy-code-cat/contracts";
import { zeroEffortLaunchSchema } from "@andy-code-cat/contracts";
import { resolvePromptTaskSettingFromConfig } from "../../domain/entities/PlatformConfig";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { GetLlmCatalog } from "./GetLlmCatalog";
import { CostTransactionService } from "../cost/CostTransactionService";
import { ResourceType } from "../../domain/entities/CostTransaction";
import { estimateCost } from "../llm/costPolicy";
import { getSiliconFlowPrice } from "../llm/siliconflowPricing";
import { buildChatCompletionRequestBody } from "../llm/chatRequestAdapter";
import { env } from "../../config";
import { PRESET_MAP, PRESET_CATALOG } from "../../domain/entities/ProjectPreset";

// ── Constants ─────────────────────────────────────────────────────────────────

const TASK_KEY = "vibe_intent_prefill";
const FALLBACK_PROVIDER = "siliconflow";
const FALLBACK_MODEL = "MiniMaxAI/MiniMax-M2.5";
const MAX_PROMPT_CHARS = 2000;
const MAX_TOKENS = 768;

// All valid preset IDs from the catalog — kept in sync at startup.
const VALID_PRESET_IDS: Set<string> = new Set(PRESET_CATALOG.map((p) => p.id));

// Backward-compat map: old 4-value siteType → new presetId
const SITE_TYPE_COMPAT: Record<string, string> = {
    landing_page: "landing",
    business_site: "website",
    portfolio: "neutral",
    showcase: "neutral",
};
const VALID_STYLE_ATTRIBUTES = new Set([
    "minimal", "premium", "dark", "bright", "bold",
    "elegant", "corporate", "playful", "tech", "artisan", "luxury", "eco",
]);
const VALID_VIS_STYLES = new Set(["executive", "operations", "exploratory", "monitoring"]);

// ── Language helpers ──────────────────────────────────────────────────────────

/**
 * Normalize a BCP-47 language code to lowercase base language (e.g. "IT" → "it", "pt-BR" → "pt").
 * Returns "en" for any null/empty/invalid input.
 */
function normalizeLang(raw?: string | null): string {
    if (!raw || typeof raw !== "string") return "en";
    const base = raw.trim().toLowerCase().split("-")[0];
    return /^[a-z]{2,8}$/.test(base ?? "") ? (base ?? "en") : "en";
}

// ── Default draft ─────────────────────────────────────────────────────────────

function defaultDraft(prompt: string, outputLanguage = "en"): ZeroEffortDraft {
    const projectName = prompt.trim().slice(0, 64) || "Project";
    return {
        businessName: projectName,
        presetId: "landing",
        primaryGoal: prompt.trim().slice(0, 500) || "Modern, professional website.",
        audience: "General audience interested in this project.",
        outputLanguage,
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
Given a user's free-form description of a project, return a JSON object that
populates a structured project brief.

Required JSON shape (return ONLY valid JSON, no markdown fences, no extra text):
{
  "businessName": "brand or project name (string, required)",
  "presetId": "one of: neutral|landing|website|form|manifesto|slideshow|keynote|a4poster|infographic|videogame|freerunner|seriousgame|game3d|vr-aframe|interactive-story (string, required)",
  "primaryGoal": "rich structured project brief — 900 to 2200 chars when possible (string, required)",
  "audience": "target audience description — 120 to 500 chars when possible (string, required)",
  "tone": "communication tone, e.g. professional, playful (string or null)",
  "primaryCta": "main call-to-action button text (string or null)",
  "styleHint": "visual, UX, interaction, and production notes — 180 to 900 chars when useful (string or null)",
  "contactInfo": [{"key": "Email", "value": "..."}],
  "styleAttributes": ["minimal"],
  "outputLanguage": "BCP-47 language code inferred from the user's input language, e.g. 'it', 'en', 'fr' (string, required)"
}

presetId guidance — choose the best match:
  neutral         generic project with no specific template
  landing         marketing landing page / single page site
  website         multi-section business website
  form            guided form, wizard, or survey
  manifesto       editorial page, manifesto, or long-form statement
  slideshow       slide deck / presentation / carousel narrative
  keynote         pitch deck / keynote / investor presentation
  a4poster        A4 print-ready poster or flyer
  infographic     data infographic / visual storytelling
  videogame       2D browser arcade or action game
  freerunner      open canvas browser game / creative sandbox
  seriousgame     educational or training serious game
  game3d          3D WebGL browser game
  vr-aframe       WebVR / A-Frame immersive experience
  interactive-story  branching narrative / choose-your-own-adventure

Rules:
- businessName: extract from the prompt; fall back to "Project" if unclear.
- presetId: infer from the user's intent — use the MOST SPECIFIC matching id.
  A "slideshow" or "presentation" request MUST use "slideshow" or "keynote", NOT "landing".
  A "game" request MUST use one of the game presets. Default to "landing" only when no better match.
- primaryGoal: do not summarize too aggressively. Produce a robust structured brief that can be injected
  into downstream generation prompts. Include:
  1. project intent and desired output,
  2. selected template interpretation,
  3. required sections/screens/states or content modules,
  4. key functionality/interactions,
  5. success criteria and constraints,
  6. any assumptions needed to make the first generation complete.
  Adapt to the chosen presetId: a videogame brief describes gameplay and controls;
  a slideshow brief describes slides and narrative arc; a form brief describes steps and fields.
- audience: infer who uses or views the result; include needs, context, and expectations.
- If a Detected template block is present, its id takes priority as the presetId.
- contactInfo: extract any contact data mentioned (email, phone, address, socials); empty array if none.
- styleAttributes: pick 1–3 matching from: minimal, premium, dark, bright, bold, elegant, corporate, playful, tech, artisan, luxury, eco
- outputLanguage: detect the language of the user's input (e.g. "it" for Italian, "en" for English, "fr" for French). Use BCP-47 base code only (2–3 chars). Default "en" if truly ambiguous.
- Return ONLY the JSON object.`;

const DATA_DASHBOARD_SYSTEM_PROMPT = `You are a grounded data dashboard brief extractor.
Given a user's free-form description of an analytical dashboard project, return a JSON object that
describes how the dataset-backed dashboard should be shaped.

Required JSON shape (return ONLY valid JSON, no markdown fences, no extra text):
{
  "dashboardName": "short dashboard name (string, required)",
  "dashboardGoal": "what analytical outcome the dashboard must support (string, required)",
  "primaryAudience": "who uses the dashboard (string, required)",
  "primaryDatasets": ["dataset names or logical sources"],
  "mainEntities": ["main entities or business objects represented in the data"],
  "timeDimension": "time/date field name or null",
  "kpiCandidates": ["up to 8 KPI labels"],
  "questionCandidates": ["up to 8 analytical questions the dashboard should answer"],
  "preferredVisualizationStyle": "executive|operations|exploratory|monitoring|null",
  "notes": "optional implementation notes or grounding cautions"
}

Rules:
- infer a serious operational dashboard, not a marketing landing page.
- prefer concise KPI names and concrete analytical questions.
- if a dataset/table/field is unknown, keep labels generic and safe.
- respect grounded analytics: do not invent exact metric values.
- Return ONLY the JSON object.`;

function buildPresetContext(templateId?: string | null): string {
    if (!templateId) return "";
    const preset = PRESET_MAP.get(templateId);
    if (!preset) return `Detected template: ${templateId}`;

    return [
        `Detected template: ${preset.id} — ${preset.labelEn || preset.label}`,
        `Template category: ${preset.categoryLabel ?? preset.category ?? "custom"}`,
        `Template hint: ${preset.hint}`,
        `Template tags: ${(preset.tags ?? []).join(", ")}`,
        `Output shape: ${preset.outputSpec.pageModel} / ${preset.outputSpec.sectionModel}${preset.outputSpec.printReady ? " / print-ready" : ""}`,
        `Brief template to adapt: ${preset.briefTemplate.replace(/\s+/g, " ").slice(0, 900)}`,
        `Style guidance: ${preset.styleTemplate.replace(/\s+/g, " ").slice(0, 500)}`,
        preset.briefGuideQuestions.length
            ? `Discovery questions to answer implicitly: ${preset.briefGuideQuestions.join(" | ")}`
            : "",
    ].filter(Boolean).join("\n");
}

function buildUserMessage(prompt: string, attachmentMeta?: AttachmentMeta[], templateId?: string | null, formatHint?: FormatHint | null): string {
    const parts: string[] = [prompt.slice(0, MAX_PROMPT_CHARS)];
    if (attachmentMeta?.length) {
        const metaPart = attachmentMeta
            .map((a) => `[${a.filename} — ${a.mimeType}, ${(a.sizeBytes / 1024).toFixed(0)} KB]`)
            .join(", ");
        parts.push(`\nAttached files: ${metaPart}`);
    }
    const presetContext = buildPresetContext(templateId);
    if (presetContext) parts.push(`\n${presetContext}`);
    if (formatHint) parts.push(`\nFormat hint: ${formatHint}`);
    return parts.join("");
}

function defaultDataDashboardDraft(prompt: string, attachmentMeta?: AttachmentMeta[]): DataDashboardDraft {
    const datasetNames = (attachmentMeta ?? []).map((item) => item.filename).slice(0, 6);
    return {
        dashboardName: prompt.trim().slice(0, 80) || "Data Dashboard",
        dashboardGoal: prompt.trim().slice(0, 800) || "Explore real project data through grounded KPI, filters, and analytical views.",
        primaryAudience: "Operations, analysts, or decision makers working on the dataset.",
        primaryDatasets: datasetNames,
        mainEntities: [],
        kpiCandidates: ["Total records", "Key metric summary", "Distribution by category"],
        questionCandidates: ["What changed over time?", "Which segment is most relevant?", "Which values need attention?"],
    };
}

// ── Response parser ───────────────────────────────────────────────────────────

function parsePrefillResponse(raw: string, prompt: string, uiLanguage?: string): { draft: ZeroEffortDraft; confidence: number } {
    let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;

    try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;

        const businessName = typeof parsed.businessName === "string" && parsed.businessName.trim()
            ? parsed.businessName.trim().slice(0, 120)
            : prompt.trim().slice(0, 64) || "Project";

        // Accept new presetId field or old siteType for backward compat with cached drafts
        const rawPreset = typeof parsed.presetId === "string" ? parsed.presetId.trim()
            : typeof parsed.siteType === "string" ? parsed.siteType.trim() : "";
        const presetId: string = VALID_PRESET_IDS.has(rawPreset)
            ? rawPreset
            : (SITE_TYPE_COMPAT[rawPreset] ?? "landing");

        const primaryGoal = typeof parsed.primaryGoal === "string" && parsed.primaryGoal.trim().length >= 8
            ? parsed.primaryGoal.trim().slice(0, 3000)
            : prompt.trim().slice(0, 500) || "Modern web project.";

        const audience = typeof parsed.audience === "string" && parsed.audience.trim().length >= 3
            ? parsed.audience.trim().slice(0, 1000)
            : "General audience.";

        const tone = typeof parsed.tone === "string" && parsed.tone.trim()
            ? parsed.tone.trim().slice(0, 80)
            : undefined;

        const primaryCta = typeof parsed.primaryCta === "string" && parsed.primaryCta.trim()
            ? parsed.primaryCta.trim().slice(0, 120)
            : undefined;

        const styleHint = typeof parsed.styleHint === "string" && parsed.styleHint.trim()
            ? parsed.styleHint.trim().slice(0, 1000)
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

        // Language: LLM-inferred → uiLanguage hint → "en"
        const outputLanguage = normalizeLang(
            typeof parsed.outputLanguage === "string" ? parsed.outputLanguage : uiLanguage
        );

        // Validate with zod to ensure the draft is safe to use downstream
        const zodResult = zeroEffortLaunchSchema.safeParse({
            businessName, presetId, primaryGoal, audience, tone, primaryCta, styleHint, contactInfo, styleAttributes, outputLanguage,
        });

        const draft: ZeroEffortDraft = zodResult.success
            ? { ...zodResult.data, outputLanguage }
            : { businessName, presetId, primaryGoal, audience, tone, primaryCta, styleHint, contactInfo, styleAttributes, outputLanguage };

        return { draft, confidence: 0.85 };
    } catch {
        return { draft: defaultDraft(prompt, normalizeLang(uiLanguage)), confidence: 0 };
    }
}

function parseDataDashboardPrefillResponse(
    raw: string,
    prompt: string,
    attachmentMeta?: AttachmentMeta[],
): { dataDashboardDraft: DataDashboardDraft; confidence: number } {
    let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;

    try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        const dashboardName = typeof parsed.dashboardName === "string" && parsed.dashboardName.trim()
            ? parsed.dashboardName.trim().slice(0, 120)
            : prompt.trim().slice(0, 80) || "Data Dashboard";
        const dashboardGoal = typeof parsed.dashboardGoal === "string" && parsed.dashboardGoal.trim()
            ? parsed.dashboardGoal.trim().slice(0, 2000)
            : prompt.trim().slice(0, 800) || "Grounded analytics over attached datasets.";
        const primaryAudience = typeof parsed.primaryAudience === "string" && parsed.primaryAudience.trim()
            ? parsed.primaryAudience.trim().slice(0, 300)
            : "Operations, analysts, or decision makers.";
        const primaryDatasets = Array.isArray(parsed.primaryDatasets)
            ? parsed.primaryDatasets.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim().slice(0, 120)).slice(0, 8)
            : (attachmentMeta ?? []).map((item) => item.filename).slice(0, 8);
        const mainEntities = Array.isArray(parsed.mainEntities)
            ? parsed.mainEntities.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim().slice(0, 120)).slice(0, 12)
            : [];
        const timeDimension = typeof parsed.timeDimension === "string" && parsed.timeDimension.trim()
            ? parsed.timeDimension.trim().slice(0, 120)
            : undefined;
        const kpiCandidates = Array.isArray(parsed.kpiCandidates)
            ? parsed.kpiCandidates.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim().slice(0, 120)).slice(0, 8)
            : [];
        const questionCandidates = Array.isArray(parsed.questionCandidates)
            ? parsed.questionCandidates.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim().slice(0, 180)).slice(0, 8)
            : [];
        const preferredVisualizationStyle = typeof parsed.preferredVisualizationStyle === "string" && VALID_VIS_STYLES.has(parsed.preferredVisualizationStyle)
            ? (parsed.preferredVisualizationStyle as DataDashboardDraft["preferredVisualizationStyle"])
            : undefined;
        const notes = typeof parsed.notes === "string" && parsed.notes.trim()
            ? parsed.notes.trim().slice(0, 800)
            : undefined;

        return {
            dataDashboardDraft: {
                dashboardName,
                dashboardGoal,
                primaryAudience,
                primaryDatasets,
                mainEntities,
                timeDimension,
                kpiCandidates,
                questionCandidates,
                preferredVisualizationStyle,
                notes,
            },
            confidence: 0.85,
        };
    } catch {
        return { dataDashboardDraft: defaultDataDashboardDraft(prompt, attachmentMeta), confidence: 0 };
    }
}

// ── Input / Output ────────────────────────────────────────────────────────────

export interface VibePrefillInput {
    prompt: string;
    /** Pre-built Layer D block from project assets — injected verbatim into the system prompt. */
    layerDContext?: string;
    /** Dedicated grounded dataset layer used for data-dashboard flows. */
    layerXDataContext?: string;
    generationMode?: VibeGenerationMode;
    attachmentMeta?: AttachmentMeta[];
    templateId?: string | null;
    formatHint?: FormatHint | null;
    /** Optional one-shot provider override for this pipeline run. */
    provider?: string;
    /** Optional one-shot model override for this pipeline run. */
    model?: string;
    /** When provided, the use-case records an LLM cost transaction against this project. */
    userId?: string;
    /** When provided together with userId, cost is attributed to this project. */
    projectId?: string;
    /** BCP-47 UI language from the client (e.g. "it", "en"). Used as fallback when LLM can't infer language. */
    uiLanguage?: string;
}

// ── Use-case ──────────────────────────────────────────────────────────────────

export class VibePrefill {
    constructor(
        private readonly platformConfigRepository: PlatformConfigRepository,
        private readonly getLlmCatalog: GetLlmCatalog,
    ) { }

    async execute(input: VibePrefillInput): Promise<VibePrefillResponse> {
        const echoProject = input.projectId ? { projectId: input.projectId } : {};
        const platformConfig = await this.platformConfigRepository.get().catch(() => null);
        const taskSettings = resolvePromptTaskSettingFromConfig(platformConfig, "default", TASK_KEY);
        const resolvedMode = input.generationMode === "data_dashboard" || input.templateId === "data-dashboard" || input.formatHint === "analytics_dashboard"
            ? "data_dashboard"
            : "website";

        const resolvedUiLanguage = normalizeLang(input.uiLanguage);

        if (!env.vibeClassifierEnabled || !taskSettings.enabled) {
            return {
                draft: defaultDraft(input.prompt, resolvedUiLanguage),
                dataDashboardDraft: resolvedMode === "data_dashboard" ? defaultDataDashboardDraft(input.prompt, input.attachmentMeta) : undefined,
                resolvedMode,
                confidence: 0,
                skipped: true,
                ...echoProject,
            };
        }

        const catalog = await this.getLlmCatalog.execute();
        const activeProviders = catalog.providers.filter((p) => p.isActive);
        const overrideProviderCatalog = input.provider
            ? activeProviders.find((p) => p.provider === input.provider)
            : undefined;
        const selectedProviderCatalog =
            overrideProviderCatalog ??
            activeProviders.find((p) => p.provider === taskSettings.provider) ??
            activeProviders.find((p) => p.provider === FALLBACK_PROVIDER) ??
            // Never silently fall back to local LM Studio for this background task —
            // prefer any reliable cloud provider; LM Studio is used only when explicitly
            // configured (override or superadmin task settings) above.
            activeProviders.find((p) => p.provider !== "lmstudio") ??
            activeProviders[0];

        if (!selectedProviderCatalog) {
            return {
                draft: defaultDraft(input.prompt, resolvedUiLanguage),
                dataDashboardDraft: resolvedMode === "data_dashboard" ? defaultDataDashboardDraft(input.prompt, input.attachmentMeta) : undefined,
                resolvedMode,
                confidence: 0,
                skipped: true,
                ...echoProject,
            };
        }

        const providerCatalog = selectedProviderCatalog;

        const overrideModelId = input.model
            ? providerCatalog.models.find((m) => m.isActive && m.id === input.model)?.id
            : undefined;

        const modelId =
            overrideModelId ??
            providerCatalog.models.find((m) => m.isActive && m.id === taskSettings.model)?.id ??
            providerCatalog.models.find((m) => m.isActive && m.isDefault)?.id ??
            providerCatalog.models.find((m) => m.isActive)?.id ??
            FALLBACK_MODEL;

        const authHeader = resolveAuthHeader(providerCatalog.provider, providerCatalog.authType);
        if (!authHeader && providerCatalog.authType !== "none") {
            return {
                draft: defaultDraft(input.prompt, resolvedUiLanguage),
                dataDashboardDraft: resolvedMode === "data_dashboard" ? defaultDataDashboardDraft(input.prompt, input.attachmentMeta) : undefined,
                resolvedMode,
                confidence: 0,
                skipped: true,
                ...echoProject,
            };
        }

        const userMessage = buildUserMessage(input.prompt, input.attachmentMeta, input.templateId, input.formatHint);

        // Use custom systemTemplate from platform config if set; fall back to hardcoded SYSTEM_PROMPT
        const defaultSystemPrompt = resolvedMode === "data_dashboard" ? DATA_DASHBOARD_SYSTEM_PROMPT : SYSTEM_PROMPT;
        const basePrompt = taskSettings.systemTemplate?.trim() || defaultSystemPrompt;
        const contextLayers = [input.layerDContext, input.layerXDataContext].filter((value): value is string => Boolean(value && value.trim()));
        const systemPrompt = contextLayers.length > 0
            ? `${basePrompt}\n\n${contextLayers.join("\n\n")}`
            : basePrompt;

        try {
            const response = await fetch(`${providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(authHeader ? { Authorization: authHeader } : {}),
                },
                body: JSON.stringify(buildChatCompletionRequestBody({
                    provider: providerCatalog.provider,
                    model: modelId,
                    maxTokens: Math.min(taskSettings.maxCompletionTokens, MAX_TOKENS),
                    temperature: taskSettings.temperature ?? 0.3,
                    messages: [
                        { role: "system" as const, content: systemPrompt },
                        { role: "user" as const, content: userMessage },
                    ],
                })),
            });

            if (!response.ok) {
                return {
                    draft: defaultDraft(input.prompt, resolvedUiLanguage),
                    dataDashboardDraft: resolvedMode === "data_dashboard" ? defaultDataDashboardDraft(input.prompt, input.attachmentMeta) : undefined,
                    resolvedMode,
                    confidence: 0,
                    skipped: true,
                    ...echoProject,
                };
            }

            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            const raw = String(
                (payload?.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content ?? ""
            ).trim();

            // Record cost transaction when userId + projectId are both present
            if (input.userId && input.projectId) {
                const usage = payload.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
                const promptTokens = Number(usage?.prompt_tokens ?? 0);
                const completionTokens = Number(usage?.completion_tokens ?? 0);
                const totalTokens = Number(usage?.total_tokens ?? (promptTokens + completionTokens));

                let providerCostUsd: number | undefined;
                if (providerCatalog.provider === "siliconflow") {
                    const sfPrice = getSiliconFlowPrice(modelId);
                    if (sfPrice && sfPrice.priceUnit === "per_m_tokens") {
                        providerCostUsd =
                            (promptTokens / 1_000_000) * sfPrice.input +
                            (completionTokens / 1_000_000) * sfPrice.output;
                    }
                }

                const costEstimate = estimateCost(
                    { capability: "chat", tokenUsage: { promptTokens, completionTokens, totalTokens }, providerCostUsd },
                    {
                        textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                        imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                        videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                        usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
                        providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
                    },
                );

                CostTransactionService.instance.record({
                    userId: input.userId,
                    projectId: input.projectId,
                    resourceType: ResourceType.LLM_BACKGROUND,
                    resourceSubtype: modelId,
                    precomputedTotalEur: costEstimate.amount,
                    units: { promptTokens, completionTokens, totalTokens },
                    meta: {
                        taskKey: TASK_KEY,
                        provider: providerCatalog.provider,
                    },
                });
            }

            const websitePrefill = parsePrefillResponse(raw, input.prompt, resolvedUiLanguage);
            const dataPrefill = resolvedMode === "data_dashboard"
                ? parseDataDashboardPrefillResponse(raw, input.prompt, input.attachmentMeta)
                : undefined;
            return {
                draft: websitePrefill.draft,
                dataDashboardDraft: dataPrefill?.dataDashboardDraft,
                resolvedMode,
                confidence: dataPrefill?.confidence ?? websitePrefill.confidence,
                skipped: false,
                ...echoProject,
            };
        } catch {
            return {
                draft: defaultDraft(input.prompt, resolvedUiLanguage),
                dataDashboardDraft: resolvedMode === "data_dashboard" ? defaultDataDashboardDraft(input.prompt, input.attachmentMeta) : undefined,
                resolvedMode,
                confidence: 0,
                skipped: true,
                ...echoProject,
            };
        }
    }
}
