import type { FormatHint } from "@andy-code-cat/contracts";

/**
 * Canonical format categories with trigger-keyword examples and
 * the rule block injected into the PrepromptEngine Layer Φ slot.
 *
 * These defaults ship with the platform.  Superadmins can override
 * them in PlatformConfig.formatHintRules (future v2 feature).
 */
export const FORMAT_HINT_RULES: Record<FormatHint, { triggerExamples: string[]; canonicalRules: string }> = {
    one_pager: {
        triggerExamples: ["one pager", "una pagina", "landing", "hero", "single scroll"],
        canonicalRules:
            "LAYOUT: single-scroll page, hero section above fold with primary CTA, " +
            "maximum 3 content sections below the fold, no pagination or internal anchors. " +
            "TONE: concise, benefit-first copy. ACCESSIBILITY: CTA above the fold at all viewport widths.",
    },
    a3_document: {
        triggerExamples: ["A3", "presentazione", "documento", "slide", "report stampabile"],
        canonicalRules:
            "LAYOUT: 297×420 mm (A3 landscape) page model, print-safe margins (≥12 mm), " +
            "12-column grid, no fixed viewport dependencies. " +
            "TYPOGRAPHY: serif or humanist sans at 11–14pt body, 18–28pt headings. " +
            "COLOUR: CMYK-safe palette, no pure RGB gradients.",
    },
    ratio_1_1: {
        triggerExamples: ["quadrato", "social", "instagram", "1:1", "post"],
        canonicalRules:
            "LAYOUT: 1:1 viewport (1080×1080px reference), square-first breakpoints, " +
            "no wide sidebars. IMAGERY: full-bleed or centred square crop. " +
            "TYPOGRAPHY: large display text, single focal element.",
    },
    ratio_16_9: {
        triggerExamples: ["widescreen", "presentazione", "slide deck", "16:9", "proiettore"],
        canonicalRules:
            "LAYOUT: 16:9 proportions (1920×1080px reference), slide-like full-bleed sections, " +
            "no scrolling required per slide. TYPOGRAPHY: 32–60px display headings, " +
            "high contrast on dark or light backgrounds.",
    },
    interactive_form: {
        triggerExamples: ["form", "modulo", "prenotazione", "compilazione", "registrazione", "questionario"],
        canonicalRules:
            "LAYOUT: multi-step form pattern (2–5 steps), progress indicator at top, " +
            "single-column input layout, validation states (error, success, loading). " +
            "UX: accessible labels, visible focus rings, submit button only on last step.",
    },
    portfolio: {
        triggerExamples: ["portfolio", "lavori", "galleria", "creativo", "showcase", "progetti"],
        canonicalRules:
            "LAYOUT: responsive grid or masonry layout, lightbox-ready image containers, " +
            "filterable tag system optional. IMAGERY: high-res thumbnails with lazy-load. " +
            "NAVIGATION: sticky top nav, smooth scroll to sections.",
    },
    brochure: {
        triggerExamples: ["brochure", "depliant", "3 colonne", "pieghevole", "flyer"],
        canonicalRules:
            "LAYOUT: column-based (2 or 3 columns), print-friendly typography, " +
            "clear section dividers, table/bullet-list friendly. " +
            "COLOUR: brand-consistent, min 4.5:1 contrast. " +
            "OUTPUT: suitable for both screen and PDF export.",
    },
};

/**
 * Builds the template list string injected into the classifier system prompt.
 */
export function buildTemplateListBlock(
    templates: Array<{ id: string; label: string; hint?: string }>,
): string {
    if (templates.length === 0) return "(no templates available)";
    return templates
        .map((t) => `- id: "${t.id}" | label: "${t.label}" | hint: "${t.hint ?? ""}"`)
        .join("\n");
}
