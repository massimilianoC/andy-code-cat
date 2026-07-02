import { buildBaseConstraintsLayer, buildLanguageLayer, buildLayerT, buildPresetLayer, type TemplateResolution } from "./systemPromptLayers";
export type { TemplateResolution };

const LAYER_SEPARATOR = "\n\n---\n\n";

/**
 * Canonical prompt-layer identity, shared by the composer, the persisted
 * promptingTrace, and the frontend Prompt tab. This is the ONLY place layer
 * order and identity are declared — every consumer reads from here rather
 * than re-deriving it.
 *
 * See docs/specs/PROMPT_LAYER_SSOT_SPEC.md for the full rationale.
 */
export type PromptLayerId = "A" | "L" | "B" | "S" | "T" | "C" | "G" | "D" | "X" | "E" | "F" | "P" | "R";

export interface PromptLayerDescriptor {
    id: PromptLayerId;
    /** ResolvedPromptLayers field name carrying this layer's raw content. */
    field: keyof Omit<ResolvedPromptLayers, "composed" | "layers">;
    key: string;
    label: string;
    editableBy: "none" | "superadmin" | "project-owner" | "model-catalog" | "user-template";
}

/**
 * Composition order. Layer S (template skills) is reserved per
 * docs/specs/TEMPLATE_SKILLS_INJECTION_PLAN.md — it is always empty today
 * (no TemplateSkill entity/resolver exists yet, Wave 1-3 not implemented)
 * but is declared here so the slot is visible end-to-end (registry, trace,
 * UI) instead of being introduced silently later.
 */
export const PROMPT_LAYER_DESCRIPTORS: readonly PromptLayerDescriptor[] = [
    { id: "A", field: "layerA", key: "base-constraints", label: "Layer A — Base constraints", editableBy: "none" },
    { id: "L", field: "layerL", key: "output-language", label: "Layer L — Output language", editableBy: "none" },
    { id: "B", field: "layerB", key: "preset-format", label: "Layer B — Preset output format", editableBy: "superadmin" },
    { id: "S", field: "layerS", key: "template-skills", label: "Layer S — Template skills (reserved)", editableBy: "superadmin" },
    { id: "T", field: "layerT", key: "template-resolution", label: "Layer T — Template resolution", editableBy: "user-template" },
    { id: "C", field: "layerC", key: "style-context", label: "Layer C — Style context", editableBy: "none" },
    { id: "G", field: "layerG", key: "brand-identity", label: "Layer G — Global brand identity", editableBy: "project-owner" },
    { id: "D", field: "layerD", key: "document-context", label: "Layer D — Document context", editableBy: "none" },
    { id: "X", field: "layerX", key: "grounded-data", label: "Layer X — Grounded data context", editableBy: "none" },
    { id: "E", field: "layerE", key: "preprompt-template", label: "Layer E — Pre-prompt template", editableBy: "project-owner" },
    { id: "F", field: "layerF", key: "governance", label: "Layer F — Governance system prompt", editableBy: "superadmin" },
    { id: "P", field: "budgetPolicy", key: "output-budget-policy", label: "Output budget policy", editableBy: "none" },
    { id: "R", field: "layerR", key: "request-override", label: "Request-level system prompt override", editableBy: "none" },
] as const;

export interface ResolvedPromptLayers {
    layerA: string;
    layerL: string;
    layerB: string;
    /** Always "" today — reserved slot, see PROMPT_LAYER_DESCRIPTORS doc-comment. */
    layerS: string;
    layerT: string;
    layerC: string;
    layerG: string;
    layerD: string;
    layerX: string;
    layerE: string;
    layerF: string;
    budgetPolicy: string;
    layerR: string;
    composed: string;
    /** Structured breakdown of `composed`, in composition order — the same data the frontend renders. */
    layers: PromptLayerTraceEntry[];
}

export interface PromptLayerTraceEntry {
    id: PromptLayerId;
    key: string;
    label: string;
    /** Where this layer's content came from — set by the caller via `sources`, "code-default" otherwise. */
    source: string;
    chars: number;
    /** [start, end) offsets into `composed` (marker-inclusive) — content is not duplicated. */
    span: [number, number];
}

function wrapWithMarker(id: PromptLayerId, key: string, content: string): string {
    return [
        `<!-- PF_LAYER id=${id} key=${key} -->`,
        content,
        `<!-- /PF_LAYER id=${id} -->`,
    ].join("\n");
}

interface ComposeOpts {
    presetId?: string | null;
    presetLayer?: string;
    templateResolution?: TemplateResolution | null;
    userTemplatePreprompt?: string;
    /** Reserved for Wave 3 of TEMPLATE_SKILLS_INJECTION_PLAN.md — not wired yet, always "" until then. */
    skillsLayer?: string;
    styleBlock?: string;
    brandContextLayer?: string;
    documentContextLayer?: string;
    dataContextLayer?: string;
    prePromptTemplate?: string;
    outputBudgetPolicy?: string;
    requestSystemPrompt?: string;
    governanceSystemPrompt?: string;
    /** BCP-47 output language (e.g. "it", "en"). When provided, injects Layer L after Layer A. */
    outputLanguage?: string | null;
    /**
     * Provenance label per layer id (e.g. "code-default", "product-override",
     * "project-config", "model-template"). Layers without an entry default to
     * "code-default" for non-editable layers or "runtime" for context layers.
     */
    sources?: Partial<Record<PromptLayerId, string>>;
}

/**
 * Compose the full system prompt from the architectural layers + budget policy.
 * Registry-driven: order and identity come from PROMPT_LAYER_DESCRIPTORS, the
 * only place that ordering is declared. Every non-empty layer is wrapped with
 * a PF_LAYER marker so the composed string is self-describing (see
 * docs/specs/PROMPT_LAYER_SSOT_SPEC.md §5), and the returned `layers` array
 * gives byte-exact spans into `composed` — the same text sent to the provider,
 * persisted in promptingTrace, and rendered by the frontend Prompt tab.
 *
 * Empty layers are omitted from `composed` (no double separators) but still
 * appear in `layers` with chars: 0, so operators can see what is NOT being
 * injected and why.
 */
export function composeSystemPromptWithLayers(opts: ComposeOpts): ResolvedPromptLayers {
    const layerA = buildBaseConstraintsLayer();
    const layerL = opts.outputLanguage ? buildLanguageLayer(opts.outputLanguage) : "";
    const layerB = opts.presetLayer ?? buildPresetLayer(opts.presetId);
    const layerS = opts.skillsLayer ?? "";
    const layerT = buildLayerT(opts.templateResolution, { userTemplatePreprompt: opts.userTemplatePreprompt });
    const layerC = opts.styleBlock ?? "";
    const layerG = opts.brandContextLayer ?? "";
    const layerD = opts.documentContextLayer ?? "";
    const layerX = opts.dataContextLayer ?? "";
    const layerE = opts.prePromptTemplate ?? "";
    const layerF = opts.governanceSystemPrompt ?? "";
    const budgetPolicy = opts.outputBudgetPolicy ?? "";
    const layerR = opts.requestSystemPrompt ?? "";

    const raw: Record<string, string> = {
        layerA, layerL, layerB, layerS, layerT, layerC, layerG, layerD, layerX, layerE, layerF, budgetPolicy, layerR,
    };

    const defaultSource = (id: PromptLayerId): string => {
        const descriptor = PROMPT_LAYER_DESCRIPTORS.find((d) => d.id === id)!;
        return descriptor.editableBy === "none" ? "code-default" : "runtime";
    };

    const segments: string[] = [];
    const layers: PromptLayerTraceEntry[] = [];
    let cursor = 0;

    for (const descriptor of PROMPT_LAYER_DESCRIPTORS) {
        const content = raw[descriptor.field] ?? "";
        if (!content) {
            layers.push({ id: descriptor.id, key: descriptor.key, label: descriptor.label, source: "empty", chars: 0, span: [cursor, cursor] });
            continue;
        }
        const wrapped = wrapWithMarker(descriptor.id, descriptor.key, content);
        if (segments.length > 0) {
            cursor += LAYER_SEPARATOR.length;
        }
        const start = cursor;
        segments.push(wrapped);
        cursor += wrapped.length;
        layers.push({
            id: descriptor.id,
            key: descriptor.key,
            label: descriptor.label,
            source: opts.sources?.[descriptor.id] ?? defaultSource(descriptor.id),
            chars: content.length,
            span: [start, cursor],
        });
    }

    // No .trim(): PF_LAYER markers guarantee the first/last segment has no stray
    // leading/trailing whitespace, so spans stay byte-exact against `composed`.
    const composed = segments.join(LAYER_SEPARATOR);

    return { layerA, layerL, layerB, layerS, layerT, layerC, layerG, layerD, layerX, layerE, layerF, budgetPolicy, layerR, composed, layers };
}
