/**
 * Prompt Task Registry — single source of truth for "what default text does task X run
 * with, and which part of it (if any) can a superadmin override".
 *
 * This is a READ-ONLY descriptive catalog, not a resolution engine: it never decides what
 * prompt actually runs at request time (that remains `resolvePromptTaskSettingFromConfig`
 * in PlatformConfig.ts). It exists so the admin UI can show operators the real default text
 * and a real default-text hash instead of a hand-maintained copy that drifts from the
 * backend (see ZERO_EFFORT_PREFILL_SPEC / two production incidents this PR fixes).
 *
 * HARD RULE: every `defaultText` below must resolve to a value imported from the file that
 * actually builds/owns that prompt. Never restate prompt text as a new string literal here —
 * a single violation of that rule defeats the entire purpose of this registry.
 */
import { DEFAULT_PROMPT_TASK_SETTINGS } from "../../domain/entities/PlatformConfig";
import { buildClassifySystemPrompt } from "../use-cases/VibeClassify";
import { VIBE_PREFILL_SYSTEM_PROMPT, VIBE_PREFILL_DATA_DASHBOARD_SYSTEM_PROMPT } from "../use-cases/VibePrefill";
import { DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE } from "./optimizeUserPromptInstruction";
import { DEFAULT_OPTIMIZE_IMAGE_PROMPT_SYSTEM_TEMPLATE } from "./optimizeImagePromptInstruction";
import { DEFAULT_SUGGEST_IMAGE_IDEA_SYSTEM_TEMPLATE } from "./buildSuggestImageIdeaInstruction";
import { DEFAULT_DRAFT_TEMPLATE_MODEL_SYSTEM_TEMPLATE } from "./draftProjectTemplateInstruction";

export type PromptSlotEditability =
    | "platform"
    | "superadmin"
    | "project-owner"
    | "model-catalog"
    | "preset-catalog"
    | "filesystem"
    | "request";

export type PromptSlotStore =
    | "code"
    | "governanceByProduct.promptTemplates"
    | "governanceByProduct.promptTaskSettings.systemTemplate"
    | "project_presets.outputSpec"
    | "llm_catalog.promptTemplate"
    | "llm_prompt_configs.prePromptTemplate"
    | "brand_assets"
    | "filesystem:docs/skills/template-skills"
    | "runtime";

export interface PromptSlotDescriptor {
    id: string;
    key: string;
    label: string;
    description: string;
    editableBy: PromptSlotEditability;
    store: PromptSlotStore;
}

export interface PromptTaskDescriptor {
    key: string;
    label: string;
    group: "vibecore" | "guided" | "enrichment" | "authoring" | "media" | "didactic";
    slots: readonly PromptSlotDescriptor[];
    /** id of the slot in `slots` that maps to this task's `promptTaskSettings.systemTemplate`. Undefined when that field is never read by the backend for this task (routing-only task). */
    operatorSlotId?: string;
    defaultText: () => string;
}

const CANONICAL_CATALOG_SLOT_DESCRIPTION =
    "The live annotated preset catalog and mandatory selection procedure (built by " +
    "buildCanonicalPresetSelectionRules in vibePresetCatalog.ts). Always appended after the " +
    "operator instruction above; it is the sole selection authority and cannot be removed or " +
    "reordered by an override.";

function instructionSlot(): PromptSlotDescriptor {
    return {
        id: "instruction",
        key: "systemTemplate",
        label: "System instruction",
        description: "Superadmin-editable system prompt override. Empty means the platform default (defaultText) is used verbatim.",
        editableBy: "superadmin",
        store: "governanceByProduct.promptTaskSettings.systemTemplate",
    };
}

export const PROMPT_TASK_REGISTRY: readonly PromptTaskDescriptor[] = [
    {
        key: "optimize_user_prompt",
        label: "Brief Optimization",
        group: "guided",
        operatorSlotId: "instruction",
        slots: [instructionSlot()],
        defaultText: () => DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE,
    },
    {
        key: "optimize_image_prompt",
        label: "Image Prompt Optimization",
        group: "media",
        operatorSlotId: "instruction",
        slots: [instructionSlot()],
        defaultText: () => DEFAULT_OPTIMIZE_IMAGE_PROMPT_SYSTEM_TEMPLATE,
    },
    {
        key: "suggest_image_direction",
        label: "Image Direction Suggestion",
        group: "media",
        operatorSlotId: "instruction",
        slots: [instructionSlot()],
        defaultText: () => DEFAULT_SUGGEST_IMAGE_IDEA_SYSTEM_TEMPLATE,
    },
    {
        key: "draft_template_model",
        label: "AI Template Drafter",
        group: "authoring",
        operatorSlotId: "instruction",
        slots: [instructionSlot()],
        defaultText: () => DEFAULT_DRAFT_TEMPLATE_MODEL_SYSTEM_TEMPLATE,
    },
    {
        key: "zero_effort_optimize",
        label: "Zero Effort — Brief Optimization",
        group: "guided",
        operatorSlotId: "instruction",
        // Shares the exact same instruction builder/default text as optimize_user_prompt —
        // buildOptimizeUserPromptRequest() is invoked with whichever taskKey the caller
        // resolved settings against; the default text is identical either way.
        slots: [instructionSlot()],
        defaultText: () => DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE,
    },
    {
        key: "zero_effort_generate",
        label: "Zero Effort — Generation (routing only)",
        group: "guided",
        // Verified: `zero_effort_generate`'s systemTemplate is only ever echoed back by the
        // /pipelines/zero-effort/config route (provider/model routing info) and is never
        // read to build an actual LLM system prompt anywhere in apps/api/src.
        operatorSlotId: undefined,
        slots: [],
        defaultText: () => "",
    },
    {
        key: "enrich_document",
        label: "Document Enrichment (routing only)",
        group: "enrichment",
        // Verified: AssetEnrichmentPipeline.ts reads this task's provider/model only; the
        // actual document-brief prompt is built by buildDocumentBriefPrompt() and never
        // consults taskSettings.systemTemplate.
        operatorSlotId: undefined,
        slots: [],
        defaultText: () => "",
    },
    {
        key: "enrich_image",
        label: "Image Enrichment (routing only)",
        group: "enrichment",
        // Verified: same as enrich_document — provider/model routing only.
        operatorSlotId: undefined,
        slots: [],
        defaultText: () => "",
    },
    {
        key: "vibe_intent_classify",
        label: "VibeCore — Intent Classifier",
        group: "vibecore",
        operatorSlotId: "instruction",
        slots: [
            instructionSlot(),
            {
                id: "catalog",
                key: "catalog",
                label: "Canonical preset selection contract",
                description: CANONICAL_CATALOG_SLOT_DESCRIPTION,
                editableBy: "platform",
                store: "code",
            },
        ],
        defaultText: buildClassifySystemPrompt,
    },
    {
        key: "vibe_intent_prefill",
        label: "VibeCore — Prefill Brief (website)",
        group: "vibecore",
        operatorSlotId: "shape",
        slots: [
            {
                id: "shape",
                key: "systemTemplate",
                label: "Brief JSON shape & rules",
                description: "Superadmin-editable system prompt override. The backend always prepends the authoritative JSON shape/schema first and demotes this override to an advisory suffix, so it can add emphasis but never narrow the required field list.",
                editableBy: "superadmin",
                store: "governanceByProduct.promptTaskSettings.systemTemplate",
            },
        ],
        defaultText: () => VIBE_PREFILL_SYSTEM_PROMPT,
    },
    {
        // Not a real DEFAULT_PROMPT_TASK_SETTINGS key — a read-only sibling entry so the
        // data-dashboard prefill default text is reachable through the same registry without
        // inventing a parallel "variants" resolution engine for this PR.
        key: "vibe_intent_prefill:data_dashboard",
        label: "VibeCore — Prefill Brief (data dashboard variant)",
        group: "vibecore",
        operatorSlotId: undefined,
        slots: [],
        defaultText: () => VIBE_PREFILL_DATA_DASHBOARD_SYSTEM_PROMPT,
    },
    {
        key: "vibe_mode_generate",
        label: "Vibe Mode — Final Generation (routing only)",
        group: "guided",
        // Verified: only echoed by /pipelines/zero-effort/config; never read as a prompt.
        operatorSlotId: undefined,
        slots: [],
        defaultText: () => "",
    },
    {
        key: "god_mode_generate",
        label: "Guided Mode — Final Generation (routing only)",
        group: "guided",
        // Verified: only echoed by /pipelines/zero-effort/config; never read as a prompt.
        operatorSlotId: undefined,
        slots: [],
        defaultText: () => "",
    },
    {
        key: "didactic_knowledge_generate",
        label: "Didactic — Knowledge Generation (unused)",
        group: "didactic",
        // Verified: no call site resolves promptTaskSettings for this key at all today.
        operatorSlotId: undefined,
        slots: [],
        defaultText: () => "",
    },
    {
        key: "didactic_ask",
        label: "Didactic — Ask (unused)",
        group: "didactic",
        // Verified: no call site resolves promptTaskSettings for this key at all today.
        operatorSlotId: undefined,
        slots: [],
        defaultText: () => "",
    },
];

// Fail loudly in dev/test if a DEFAULT_PROMPT_TASK_SETTINGS key is ever added without a
// matching registry entry — the anti-drift contract this file exists for.
const registeredKeys = new Set(PROMPT_TASK_REGISTRY.map((task) => task.key));
for (const taskKey of Object.keys(DEFAULT_PROMPT_TASK_SETTINGS)) {
    if (!registeredKeys.has(taskKey)) {
        throw new Error(`taskPromptRegistry.ts is missing a PROMPT_TASK_REGISTRY entry for DEFAULT_PROMPT_TASK_SETTINGS key "${taskKey}"`);
    }
}

export function getTaskDescriptor(key: string): PromptTaskDescriptor | undefined {
    return PROMPT_TASK_REGISTRY.find((task) => task.key === key);
}
