import type { DataDashboardDraft, VibeGenerationMode, VibePrefillResponse, AttachmentMeta, FormatHint, GuidedDraft } from "@andy-code-cat/contracts";
import { guidedLaunchSchema } from "@andy-code-cat/contracts";
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
import { buildCanonicalPresetSelectionRules } from "../prompting/vibePresetCatalog";
import { resolveModelSelection, type ResolveModelSelectionInput } from "../llm/modelSelection";
import { observeModelSelectionShadow } from "../llm/modelSelectionShadow";
import { ExecutionLogger } from "../services/ExecutionLogger";

// ── Constants ─────────────────────────────────────────────────────────────────

const TASK_KEY = "vibe_intent_prefill";
const FALLBACK_PROVIDER = "siliconflow";
const FALLBACK_MODEL = "MiniMaxAI/MiniMax-M3";
const MAX_PROMPT_CHARS = 2000;
// MIN_TOKENS/MAX_TOKENS: enforce a floor and ceiling regardless of DB task settings.
// Char budget from SYSTEM_PROMPT's own field-length hints + the zod caps in
// packages/contracts/src/pipeline.ts, at ~4 chars/token:
//   floor     ~4,100 chars  ~1,025 tok  (terse but complete — all 19 fields present)
//   realistic ~8,500 chars  ~2,127 tok  (what a rich prompt actually produces)
//   ceiling   ~23,200 chars ~5,800 tok  (every field at its schema cap)
// The old 2048 ceiling sat below the realistic case, so the nine expressive fields —
// written last by design (see the field-order rule below) — were silently truncated away.
const MIN_TOKENS = 4000;
const MAX_TOKENS = 8000;

// All valid preset IDs from the catalog — kept in sync at startup.
const VALID_PRESET_IDS: Set<string> = new Set(PRESET_CATALOG.map((p) => p.id));

// Backward-compat map: old 4-value siteType → new presetId
const SITE_TYPE_COMPAT: Record<string, string> = {
    landing_page: "landing",
    business_site: "website",
    portfolio: "neutral",
    showcase: "neutral",
};

/** Presets that carry no format commitment — the classifier's specific pick wins over these. */
const GENERIC_PRESET_IDS = new Set(["neutral"]);

/**
 * Resolve the final presetId.
 *
 * Precedence, LLM-first:
 *   1. the prefill LLM's own presetId (validated, or mapped from a legacy siteType);
 *   2. the upstream VibeClassify pick, when the LLM produced nothing usable OR
 *      collapsed a specific classification into a generic preset;
 *   3. "neutral".
 *
 * The prefill LLM receives the full annotated catalog, the selection procedure and the
 * classifier's decision as a "Detected template" block, so its answer is at least as
 * informed as the classifier's. The classifier is kept as an anchor, never as a veto.
 */
export function resolvePrefillPresetId(rawPreset: string, classifierPreset: string): string {
    const llmPreset = VALID_PRESET_IDS.has(rawPreset)
        ? rawPreset
        : (SITE_TYPE_COMPAT[rawPreset] ?? "");
    if (llmPreset && !(GENERIC_PRESET_IDS.has(llmPreset) && classifierPreset)) return llmPreset;
    return classifierPreset || llmPreset || "neutral";
}

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
export function normalizeLang(raw?: string | null): string {
    if (!raw || typeof raw !== "string") return "en";
    const base = raw.trim().toLowerCase().split("-")[0];
    return /^[a-z]{2,8}$/.test(base ?? "") ? (base ?? "en") : "en";
}

// ── Default draft ─────────────────────────────────────────────────────────────

function defaultDraft(prompt: string, outputLanguage = "en", presetId = "neutral"): GuidedDraft {
    const projectName = prompt.trim().slice(0, 64) || "Project";
    return {
        businessName: projectName,
        presetId,
        primaryGoal: prompt.trim().slice(0, 500) || "Modern, professional website.",
        audience: "General audience interested in this project.",
        sourceRequest: prompt.trim().slice(0, 4000),
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

const SYSTEM_PROMPT = `You are a multi-format project brief architect.
Given a user's free-form description of a project, return a JSON object that
populates a structured project brief.

Required JSON shape (return ONLY valid JSON, no markdown fences, no extra text):
{
  "businessName": "brand or project name (string, required)",
  "presetId": "the preset id selected by applying the CANONICAL PRESET SELECTION CONTRACT appended below (string, required)",
  "outputLanguage": "BCP-47 language code of the content to generate, e.g. 'it', 'en', 'de', 'fr' (string, required)",
  "primaryGoal": "rich structured project brief — 900 to 2200 chars when possible (string, required)",
  "audience": "target audience description — 120 to 500 chars when possible (string, required)",
  "tone": "communication tone, e.g. professional, playful (string or null)",
  "primaryCta": "main call-to-action button text (string or null)",
  "styleHint": "visual, UX, interaction, and production notes — 180 to 900 chars when useful (string or null)",
  "projectSummary": "concise product/output concept and value proposition (string or null)",
  "contentStructure": "ordered sections, screens, slides, scenes, steps, states or levels with purpose (string or null)",
  "contentRequirements": "copy, data, entities, messages, assets and information that must appear (string or null)",
  "functionalRequirements": "behaviors, mechanics, validation, calculations and user capabilities (string or null)",
  "interactionModel": "navigation, controls, input methods, feedback, state transitions and edge cases (string or null)",
  "visualDirection": "composition, hierarchy, palette, typography, imagery, motion and atmosphere (string or null)",
  "successCriteria": "observable criteria for a complete and successful first generation (string or null)",
  "constraints": "explicit limits, compatibility, accessibility, responsive, legal or content constraints (string or null)",
  "mustAvoid": "things the result must not do, inferred only from explicit negative instructions (string or null)",
  "contactInfo": [{"key": "Email", "value": "..."}],
  "styleAttributes": ["minimal"]
}

presetId — do NOT guess from this prompt alone. Apply the CANONICAL PRESET SELECTION
CONTRACT appended below: it carries the full annotated catalog, the mandatory selection
procedure, and the per-preset SELECT WHEN / DO NOT SELECT WHEN clauses.

Rules:
- businessName: extract from the prompt; fall back to "Project" if unclear.
- presetId: apply the CANONICAL PRESET SELECTION CONTRACT below. Choose the MOST SPECIFIC
  preset whose SELECT WHEN clause is satisfied and whose DO NOT SELECT WHEN clause is not.
  A game or XR preset requires concrete mechanic evidence (procedure STEP 2) — animation,
  interaction, micro-interactions, kinetic motion, immersion and Awwwards-level ambition
  are website craft vocabulary, never gameplay evidence. When evidence is genuinely
  ambiguous use "neutral"; never use "landing" as a generic fallback.
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
- COMPLETENESS CONTRACT (mandatory): every one of the nine expressive fields — projectSummary,
  contentStructure, contentRequirements, functionalRequirements, interactionModel, visualDirection,
  successCriteria, constraints, mustAvoid — MUST be a non-empty string of 250 to 900 characters.
  Use null ONLY when the request and the attached documents give literally zero signal for that
  field; for a normal project request that is never the case. Absence of an explicit user statement
  is not a reason to emit null — infer a concrete, defensible default consistent with the selected
  preset and say so. A response in which any expressive field is null, "", "N/A", or a single generic
  sentence is an INVALID response.
- Fill every applicable expressive field. Prefer concrete ordered modules and behaviors over generic adjectives.
- When a "Document knowledge extracted from project files" or brand-document block is present in this
  prompt, mine it for businessName, tone, audience, contactInfo, palette, key messages and CTA, and
  reflect it in contentRequirements and visualDirection.
- Preserve every explicit user fact, preference, requirement and prohibition. Enrichment is additive: never replace,
  weaken or contradict a specific request with a generic best practice. Leave unknown facts unspecified.
- If a "Detected template" block is present in the user message, it is the upstream
  classifier's decision made with this same contract. Adopt its id as presetId unless the
  request explicitly names a different deliverable (procedure STEP 1); if you override it,
  say why in projectSummary.
- contactInfo: extract any contact data mentioned (email, phone, address, socials); empty array if none.
- styleAttributes: pick 1–3 matching from: minimal, premium, dark, bright, bold, elegant, corporate, playful, tech, artisan, luxury, eco
- outputLanguage: detect the language the user wants the CONTENT in. If the user writes in Italian but asks "in tedesco" or "in German", outputLanguage must be "de". Use BCP-47 base code only (2–3 chars). Default "en" if truly ambiguous.
- IMPORTANT: write the JSON fields in order — businessName, presetId, outputLanguage first — so critical values are captured even if the response is long.
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

// Stable, governance-registry-facing aliases. The registry (taskPromptRegistry.ts) imports
// these instead of restating the prompt text, so the admin "default text" view can never
// drift from what the pipeline actually sends.
export const VIBE_PREFILL_SYSTEM_PROMPT = SYSTEM_PROMPT;
export const VIBE_PREFILL_DATA_DASHBOARD_SYSTEM_PROMPT = DATA_DASHBOARD_SYSTEM_PROMPT;

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

/**
 * Deterministic mapping from a parsed (possibly repaired) LLM JSON object onto the
 * GuidedDraft contract. Shared by the happy path and the truncation-repair path so a
 * cut-off response still yields every field that was fully written before the cut, instead
 * of the five-field regex recovery that used to discard everything else.
 */
function mapParsedToDraft(parsed: Record<string, unknown>, prompt: string, uiLanguage: string | undefined, classifierPreset: string): GuidedDraft {
    const businessName = typeof parsed.businessName === "string" && parsed.businessName.trim()
        ? parsed.businessName.trim().slice(0, 120)
        : prompt.trim().slice(0, 64) || "Project";

    // Accept new presetId field or old siteType for backward compat with cached drafts
    const rawPreset = typeof parsed.presetId === "string" ? parsed.presetId.trim()
        : typeof parsed.siteType === "string" ? parsed.siteType.trim() : "";
    const presetId: string = resolvePrefillPresetId(rawPreset, classifierPreset);

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

    const optionalBriefField = (key: string, max: number): string | undefined => {
        const value = parsed[key];
        return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
    };
    const sourceRequest = prompt.trim().slice(0, 4000);
    const projectSummary = optionalBriefField("projectSummary", 1600);
    const contentStructure = optionalBriefField("contentStructure", 2400);
    const contentRequirements = optionalBriefField("contentRequirements", 2400);
    const functionalRequirements = optionalBriefField("functionalRequirements", 2400);
    const interactionModel = optionalBriefField("interactionModel", 1800);
    const visualDirection = optionalBriefField("visualDirection", 1800);
    const successCriteria = optionalBriefField("successCriteria", 1600);
    const constraints = optionalBriefField("constraints", 1600);
    const mustAvoid = optionalBriefField("mustAvoid", 1200);

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
    const zodResult = guidedLaunchSchema.safeParse({
        businessName, presetId, primaryGoal, audience, tone, primaryCta, styleHint, sourceRequest,
        projectSummary, contentStructure, contentRequirements, functionalRequirements, interactionModel,
        visualDirection, successCriteria, constraints, mustAvoid, contactInfo, styleAttributes, outputLanguage,
    });

    return zodResult.success
        ? { ...zodResult.data, outputLanguage }
        : { businessName, presetId, primaryGoal, audience, tone, primaryCta, styleHint, sourceRequest,
            projectSummary, contentStructure, contentRequirements, functionalRequirements, interactionModel,
            visualDirection, successCriteria, constraints, mustAvoid, contactInfo, styleAttributes, outputLanguage };
}

/**
 * Closes a JSON object truncated mid-value (typically a max_tokens cutoff) so every
 * COMPLETE top-level key/value pair written before the cut survives. Drops only the
 * partially-written trailing pair, then closes the object. Returns null when no complete
 * pair can be recovered.
 */
function repairTruncatedJson(candidate: string): string | null {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let lastSafe = -1;
    for (let i = 0; i < candidate.length; i++) {
        const ch = candidate[i]!;
        if (escaped) { escaped = false; continue; }
        if (ch === "\\") { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") depth--;
        // A comma at depth 1 ends a complete top-level key/value pair.
        else if (ch === "," && depth === 1) lastSafe = i;
    }
    if (lastSafe < 0) return null;
    return candidate.slice(0, lastSafe) + "}";
}

export function parsePrefillResponse(raw: string, prompt: string, uiLanguage?: string, detectedTemplateId?: string | null): { draft: GuidedDraft; confidence: number } {
    // The template picked by Layer Phi (VibeClassify) is authoritative CONTEXT, injected
    // into this call's user message by buildPresetContext(). It anchors the answer but does
    // not veto it: the prefill LLM sees the same annotated catalog and the same selection
    // procedure. There is no keyword matcher in this path.
    const classifierPreset = detectedTemplateId && VALID_PRESET_IDS.has(detectedTemplateId)
        ? detectedTemplateId
        : "";
    const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;

    try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        return { draft: mapParsedToDraft(parsed, prompt, uiLanguage, classifierPreset), confidence: 0.85 };
    } catch {
        // Truncation occurs when the response hits the token cap before the JSON is closed.
        // Try a real repair first — this recovers every field written before the cut, not
        // just the handful the old regex path extracted.
        const repaired = repairTruncatedJson(candidate);
        if (repaired) {
            try {
                const parsed = JSON.parse(repaired) as Record<string, unknown>;
                return { draft: mapParsedToDraft(parsed, prompt, uiLanguage, classifierPreset), confidence: 0.6 };
            } catch { /* fall through to the regex path below */ }
        }

        // Last-resort partial recovery: extract critical fields from still-unparseable JSON
        // using regex. `(?:[^"\\]|\\.)*` (not `[^"\\]*`) so values containing an escaped
        // character (\n, \", …) — the common case for a multi-sentence field — still match.
        const unescape = (s: string) => s.replace(/\\(["\\/bfnrt])/g, (_, c) =>
            ({ '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[c as string] ?? c));
        const partialPresetRaw = candidate.match(/"presetId"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.trim() ?? "";
        const partialLangRaw   = candidate.match(/"outputLanguage"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.trim();
        const partialName      = candidate.match(/"businessName"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
        const partialGoal      = candidate.match(/"primaryGoal"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
        const partialAudience  = candidate.match(/"audience"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];

        const hasPartial = !!(partialPresetRaw || partialName || partialGoal);
        if (hasPartial) {
            const partialPresetId = resolvePrefillPresetId(partialPresetRaw, classifierPreset);
            const recoveredDraft: GuidedDraft = {
                businessName: (partialName ? unescape(partialName) : "").trim().slice(0, 120) || prompt.trim().slice(0, 64) || "Project",
                presetId: partialPresetId,
                primaryGoal: (partialGoal ? unescape(partialGoal) : "").trim().slice(0, 3000) || prompt.trim().slice(0, 500) || "Modern web project.",
                audience: (partialAudience ? unescape(partialAudience) : "").trim().slice(0, 1000) || "General audience.",
                sourceRequest: prompt.trim().slice(0, 4000),
                outputLanguage: normalizeLang(partialLangRaw ?? uiLanguage),
            };
            return { draft: recoveredDraft, confidence: 0.4 };
        }
        return { draft: defaultDraft(prompt, normalizeLang(uiLanguage), classifierPreset || "neutral"), confidence: 0 };
    }
}

function parseDataDashboardPrefillResponse(
    raw: string,
    prompt: string,
    attachmentMeta?: AttachmentMeta[],
): { dataDashboardDraft: DataDashboardDraft; confidence: number } {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
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

    /**
     * Every failure path in this use case returns HTTP 200 with a default draft, because a
     * half-filled wizard is better than a dead end. That is a deliberate product choice — what
     * was NOT deliberate is that it happened invisibly: no execution log, no journal entry, no
     * warning to the user, and no record of the provider's answer. Success and failure were
     * distinguishable only by the byte size of the response.
     *
     * This funnels all of them through one place that records what happened and returns a
     * user-visible warning. `reason` is a stable machine code for querying; `detail` carries the
     * provider status and a body excerpt — the thing you actually need when a model that worked
     * yesterday stops working today.
     */
    private fallback(input: {
        prompt: string;
        outputLanguage: string;
        resolvedMode: "website" | "data_dashboard";
        attachmentMeta?: AttachmentMeta[];
        echoProject: { projectId?: string };
        reason:
        | "task-disabled"
        | "no-active-provider"
        | "missing-api-key"
        | "provider-http-error"
        | "provider-exception";
        userMessage: string;
        detail?: Record<string, unknown>;
    }): VibePrefillResponse {
        // Console first: this survives even when the project scope is unknown (no projectId) or
        // Mongo is unreachable, which are exactly the situations worth seeing in `docker logs`.
        console.error(
            `[VibePrefill] fallback reason=${input.reason}`,
            JSON.stringify({ ...input.detail, projectId: input.echoProject.projectId ?? null }),
        );

        if (input.echoProject.projectId) {
            ExecutionLogger.instance.emit({
                projectId: input.echoProject.projectId,
                domain: "llm",
                eventType: "vibe_prefill_fallback",
                level: "warn",
                status: "failure",
                metadata: { taskKey: TASK_KEY, reason: input.reason, ...input.detail },
            });
        }

        return {
            draft: defaultDraft(input.prompt, input.outputLanguage),
            dataDashboardDraft: input.resolvedMode === "data_dashboard"
                ? defaultDataDashboardDraft(input.prompt, input.attachmentMeta)
                : undefined,
            resolvedMode: input.resolvedMode,
            confidence: 0,
            skipped: true,
            warnings: [input.userMessage],
            ...input.echoProject,
        };
    }

    async execute(input: VibePrefillInput): Promise<VibePrefillResponse> {
        const echoProject = input.projectId ? { projectId: input.projectId } : {};
        const platformConfig = await this.platformConfigRepository.get().catch(() => null);
        const taskSettings = resolvePromptTaskSettingFromConfig(platformConfig, "default", TASK_KEY);
        const resolvedMode = input.generationMode === "data_dashboard" || input.templateId === "data-dashboard" || input.formatHint === "analytics_dashboard"
            ? "data_dashboard"
            : "website";

        const resolvedUiLanguage = normalizeLang(input.uiLanguage);

        if (!env.vibeClassifierEnabled || !taskSettings.enabled) {
            return this.fallback({
                prompt: input.prompt,
                outputLanguage: resolvedUiLanguage,
                resolvedMode,
                attachmentMeta: input.attachmentMeta,
                echoProject,
                reason: "task-disabled",
                userMessage: "Compilazione automatica disattivata: il modulo va compilato manualmente.",
                detail: { vibeClassifierEnabled: env.vibeClassifierEnabled, taskEnabled: taskSettings.enabled },
            });
        }

        const catalog = await this.getLlmCatalog.execute();
        const activeProviders = catalog.providers.filter((p) => p.isActive);
        // Never silently fall back to local LM Studio for this background task — prefer any
        // reliable cloud provider; LM Studio is used only when explicitly configured (override
        // or superadmin task settings). See resolveModelSelection's vibe-cascade fallback chain.
        const selectionInput: ResolveModelSelectionInput = {
            profile: "vibe-cascade",
            activeProviders,
            requestedProvider: input.provider,
            requestedModel: input.model,
            taskSettingProvider: taskSettings.provider,
            taskSettingModel: taskSettings.model,
            fallbackProvider: FALLBACK_PROVIDER,
            hardcodedFallbackModel: FALLBACK_MODEL,
            requireOverrideInCatalog: true,
            gateOverrideOnOpenAiCompatible: false,
            policy: "legacy",
        };
        const decision = resolveModelSelection(selectionInput);
        if (input.projectId) {
            observeModelSelectionShadow(selectionInput, decision, { projectId: input.projectId, taskKey: TASK_KEY });
        }

        if (!decision.providerCatalog) {
            return this.fallback({
                prompt: input.prompt,
                outputLanguage: resolvedUiLanguage,
                resolvedMode,
                attachmentMeta: input.attachmentMeta,
                echoProject,
                reason: "no-active-provider",
                userMessage: "Nessun provider LLM disponibile per la compilazione automatica: il modulo va compilato manualmente.",
                detail: { requestedProvider: input.provider, requestedModel: input.model },
            });
        }

        const providerCatalog = decision.providerCatalog;
        const modelId = decision.effective.model;

        const authHeader = resolveAuthHeader(providerCatalog.provider, providerCatalog.authType);
        if (!authHeader && providerCatalog.authType !== "none") {
            return this.fallback({
                prompt: input.prompt,
                outputLanguage: resolvedUiLanguage,
                resolvedMode,
                attachmentMeta: input.attachmentMeta,
                echoProject,
                reason: "missing-api-key",
                userMessage: "Chiave API mancante per il provider selezionato: il modulo va compilato manualmente.",
                detail: { provider: providerCatalog.provider, authType: providerCatalog.authType },
            });
        }

        const userMessage = buildUserMessage(input.prompt, input.attachmentMeta, input.templateId, input.formatHint);

        // Use custom systemTemplate from platform config if set; fall back to hardcoded SYSTEM_PROMPT
        const defaultSystemPrompt = resolvedMode === "data_dashboard" ? DATA_DASHBOARD_SYSTEM_PROMPT : SYSTEM_PROMPT;
        const configuredPrompt = taskSettings.systemTemplate?.trim() || defaultSystemPrompt;
        // The authoritative schema/catalog contract always comes FIRST. An operator override
        // can never front-run it: if an override is stale or incomplete (e.g. missing fields
        // from the JSON shape), models overwhelmingly follow the FIRST shape they see, which
        // previously let a stale admin-page override silently collapse the full 19-field brief
        // down to whatever subset the stale text listed. The override is now demoted to an
        // advisory suffix — it may add emphasis or domain guidance, but cannot narrow the shape.
        const basePrompt = resolvedMode === "data_dashboard"
            ? configuredPrompt
            : taskSettings.systemTemplate?.trim()
                ? `${SYSTEM_PROMPT}\n\n${buildCanonicalPresetSelectionRules()}\n\nOPERATOR SPECIALIZATION (advisory only — the JSON shape and field list above are authoritative and MUST be emitted in full regardless of anything below):\n${configuredPrompt}`
                : `${SYSTEM_PROMPT}\n\n${buildCanonicalPresetSelectionRules()}`;
        const contextLayers = [input.layerDContext, input.layerXDataContext].filter((value): value is string => Boolean(value && value.trim()));
        const systemPrompt = contextLayers.length > 0
            ? `${basePrompt}\n\n${contextLayers.join("\n\n")}`
            : basePrompt;

        // Bound the provider fetch — without this a stalled provider hangs the request
        // indefinitely (the catch block below only runs once something actually rejects).
        const providerAbort = new AbortController();
        const providerTimeout = setTimeout(() => providerAbort.abort(), 4.5 * 60 * 1000);
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
                    maxTokens: Math.min(Math.max(taskSettings.maxCompletionTokens, MIN_TOKENS), MAX_TOKENS),
                    temperature: taskSettings.temperature ?? 0.3,
                    messages: [
                        { role: "system" as const, content: systemPrompt },
                        { role: "user" as const, content: userMessage },
                    ],
                })),
                signal: providerAbort.signal,
            });

            if (!response.ok) {
                // The provider's own words are the only thing that explains a model that worked
                // yesterday and fails today (rate limit, context overflow, decommissioned id).
                // Read it before discarding the response — without this the failure is unknowable.
                const errorBody = await response.text().catch(() => "<body non leggibile>");
                return this.fallback({
                    prompt: input.prompt,
                    outputLanguage: resolvedUiLanguage,
                    resolvedMode,
                    attachmentMeta: input.attachmentMeta,
                    echoProject,
                    reason: "provider-http-error",
                    userMessage: `Il modello ${providerCatalog.provider}/${modelId} ha rifiutato la richiesta (HTTP ${response.status}): il modulo va compilato manualmente o riprovato con un altro modello.`,
                    detail: {
                        provider: providerCatalog.provider,
                        model: modelId,
                        providerStatus: response.status,
                        providerStatusText: response.statusText,
                        providerBody: errorBody.slice(0, 2000),
                    },
                });
            }

            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            const raw = String(
                (payload?.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content ?? ""
            ).trim();
            const finishReason = String(
                (payload?.choices as Array<{ finish_reason?: string }>)?.[0]?.finish_reason ?? "stop"
            );

            const websitePrefill = parsePrefillResponse(raw, input.prompt, resolvedUiLanguage, input.templateId);
            const dataPrefill = resolvedMode === "data_dashboard"
                ? parseDataDashboardPrefillResponse(raw, input.prompt, input.attachmentMeta)
                : undefined;
            // A hard length cutoff means the recovery path (if any) is by definition partial —
            // never report it as confidently as a clean parse.
            const confidence = finishReason === "length"
                ? Math.min(0.5, dataPrefill?.confidence ?? websitePrefill.confidence)
                : (dataPrefill?.confidence ?? websitePrefill.confidence);
            const filledOptionalFields = Object.entries(websitePrefill.draft)
                .filter(([key, value]) => key !== "sourceRequest" && typeof value === "string" && value.trim())
                .length;

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
                        finishReason,
                        filledOptionalFields,
                    },
                });
            }

            return {
                draft: websitePrefill.draft,
                dataDashboardDraft: dataPrefill?.dataDashboardDraft,
                resolvedMode,
                confidence,
                skipped: false,
                ...echoProject,
            };
        } catch (error) {
            // Was an empty `catch {}`. An abort after the 4.5-minute timeout, a DNS failure and a
            // malformed provider payload all produced the identical silent default draft.
            const aborted = providerAbort.signal.aborted;
            return this.fallback({
                prompt: input.prompt,
                outputLanguage: resolvedUiLanguage,
                resolvedMode,
                attachmentMeta: input.attachmentMeta,
                echoProject,
                reason: "provider-exception",
                userMessage: aborted
                    ? `Il modello ${providerCatalog.provider}/${modelId} non ha risposto entro il tempo massimo: riprova o scegli un altro modello.`
                    : `Errore di comunicazione con ${providerCatalog.provider}/${modelId}: il modulo va compilato manualmente.`,
                detail: {
                    provider: providerCatalog.provider,
                    model: modelId,
                    aborted,
                    errorName: error instanceof Error ? error.name : typeof error,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    errorCause: error instanceof Error && error.cause ? String(error.cause) : undefined,
                },
            });
        } finally {
            clearTimeout(providerTimeout);
        }
    }
}
