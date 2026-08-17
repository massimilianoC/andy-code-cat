import { PRESET_CATALOG, type ProjectPreset } from "../../domain/entities/ProjectPreset";

/**
 * Canonical preset context shared by intent classification and Zero Effort prefill.
 * Visibility in a UI catalog is deliberately not used as an AI-selection filter:
 * hidden specialist presets (for example freerunner) must remain matchable.
 */
export const VIBE_SELECTABLE_PRESETS: readonly ProjectPreset[] = PRESET_CATALOG;

function compact(value: string, max: number): string {
    return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function renderSelectionSignals(preset: ProjectPreset): string[] {
    const signals = preset.selectionSignals;
    if (!signals) return [];
    const lines: string[] = [];
    if (signals.positive.length > 0) {
        lines.push(`  SELECT WHEN: ${signals.positive.map((s) => compact(s, 220)).join("; ")}`);
    }
    if (signals.negative.length > 0) {
        lines.push(`  DO NOT SELECT WHEN: ${signals.negative.map((s) => compact(s, 220)).join("; ")}`);
    }
    for (const item of signals.confusedWith ?? []) {
        lines.push(`  NOT TO BE CONFUSED WITH ${item.presetId}: ${compact(item.discriminator, 320)}`);
    }
    return lines;
}

/**
 * Annotated preset catalog grouped by category.
 * PRESET_CATALOG is already sorted by sortOrder, which yields
 * blank -> web -> print & graphic -> data -> presentation -> game & XR.
 * Group order is presentational only; the procedure below carries all priority.
 */
export function buildAnnotatedPresetCatalog(): string {
    const groups: Array<{ label: string; presets: ProjectPreset[] }> = [];
    for (const preset of VIBE_SELECTABLE_PRESETS) {
        const label = preset.categoryLabel ?? preset.category ?? "Custom";
        const existing = groups.find((g) => g.label === label);
        if (existing) existing.presets.push(preset);
        else groups.push({ label, presets: [preset] });
    }

    return groups.map((group) => {
        const body = group.presets.map((preset) => [
            `[${preset.id}] ${preset.labelEn || preset.label} (${preset.labelIt || preset.label})`,
            `  INTENT: ${compact(preset.hint, 260)}`,
            `  OUTPUT: ${preset.outputSpec.pageModel}/${preset.outputSpec.sectionModel}/${preset.outputSpec.viewportModel ?? "document_scroll"}${preset.outputSpec.printReady ? "/print-ready" : ""}`,
            `  TAGS: ${(preset.tags ?? []).join(", ") || "none"}`,
            ...renderSelectionSignals(preset),
            `  BRIEF SHAPE: ${compact(preset.briefTemplate, 420) || "free-form"}`,
        ].join("\n")).join("\n\n");
        return `### CATEGORY: ${group.label}\n${body}`;
    }).join("\n\n");
}

export function buildTemplateSelectionProcedure(): string {
    return `TEMPLATE SELECTION PROCEDURE (mandatory — apply the steps in order)

STEP 1 — NAMED DELIVERABLE.
Read the request literally and look for an explicitly named deliverable noun: website,
company site, product site, landing page, brand site, portfolio, form, wizard, survey,
manifesto, slide deck, presentation, pitch, keynote, poster, flyer, infographic,
dashboard, game, runner, VR experience, interactive story, and their equivalents in the
user's language. If a deliverable is explicitly named, that noun is the strongest signal
available and selects its preset. Styling, animation, technology and mood words NEVER
override an explicitly named deliverable.

STEP 2 — MECHANIC EVIDENCE (required before any game or XR preset).
A game/XR preset (videogame, freerunner, seriousgame, game3d, vr-aframe,
interactive-story) may be selected ONLY if the request contains concrete gameplay
mechanic vocabulary — at least one of:
win, lose, game over, score, points, lives, HUD, player character, enemies, obstacles,
power-up, collision, control scheme (WASD, arrow keys, tap to jump, gamepad), core loop,
retry, respawn, level meaning a playable stage, branching choices with consequences
(interactive-story), headset / WebXR / A-Frame / 6DoF (vr-aframe).
The following words are NOT mechanic evidence and MUST NEVER, on their own, select a
game or XR preset: interactive, interaction, micro-interaction, micro-interactions,
animated, animation, motion, kinetic, immersive, engaging, playful, dynamic, experience,
Awwwards-level, award-winning, next-level, scroll-triggered, scrollytelling, parallax,
hover effect, transition, storytelling. These are ordinary marketing-website craft words.
Also ignore any of the mechanic words above when they appear inside an unrelated compound
or sense: "Awwwards-level", "enterprise-level", "next-level", "play the video",
"score of clients", "controls the narrative". Word shape is not evidence; meaning is.
If no mechanic evidence is present, every game and XR preset is FORBIDDEN.

STEP 3 — DOMAIN AND PRODUCTION CONTEXT.
Web-production vocabulary — React, Next.js, Tailwind CSS, Framer Motion, GSAP, Lenis,
ScrollTrigger, shadcn, Awwwards, FWA, hero section, navbar, footer, CTA, testimonials,
pricing, SEO — anchors the request to a web preset (landing, website, form).
Business, product and marketing language (company, brand, product, services, customers,
launch, pricing, clients) reinforces the same anchor. A request that names a business or
a product and asks to present it is a web deliverable even when it also asks for rich
animation, immersive scrolling, or award-level craft.

STEP 4 — ATTACHMENTS.
Use attachment metadata only as secondary evidence, and only when the prompt text alone
is ambiguous. Apply the ATTACHMENT SIGNAL RULES below.

STEP 5 — RESOLVE.
- If STEP 1 named a deliverable, select its preset.
- Otherwise select the MOST SPECIFIC preset whose SELECT WHEN clause is satisfied and
  whose DO NOT SELECT WHEN clause is not.
- If two presets remain plausible, apply the NOT TO BE CONFUSED WITH discriminator.
- If evidence is still ambiguous, select "neutral". Never use "landing", "website" or any
  game preset as a generic fallback.
- Never select "data-dashboard" unless the request is explicitly an analytical dashboard
  over a dataset.
- Your reasoning must name the exact words from the request that decided the choice. If
  the only words you can name are from the forbidden list in STEP 2, you have no evidence.`;
}

export function buildAttachmentSignalRules(): string {
    return `ATTACHMENT SIGNAL RULES (secondary evidence — filename and MIME type only)
- .csv, .xlsx, .json, .sql, .parquet (text/csv, application/vnd.ms-excel, application/json)
  PLUS explicit analysis/KPI/dashboard intent in the text -> data-dashboard.
  Data files alone, with no analytical intent stated, are NOT enough.
- .pdf, .docx, .txt, .md -> source content for a web, presentation or print deliverable.
  They do not by themselves select any preset.
- image/* (.jpg, .png, .webp, .svg) -> brand or content material. Never treat images as
  gameplay assets unless the text supplies STEP 2 mechanic evidence.
- .pptx, .key -> presentation intent -> slideshow or keynote.
- .ai, .indd, .psd, or print-oriented filenames (poster, flyer, locandina, volantino)
  -> a4poster or infographic.
- Attachment metadata NEVER outranks an explicitly named deliverable from STEP 1.`;
}

/**
 * The single selection authority for both VibeClassify and VibePrefill.
 * Appended unconditionally by both use-cases AFTER any operator systemTemplate
 * override, so a persisted legacy override can never restore obsolete selection
 * semantics or an outdated catalog.
 */
export function buildCanonicalPresetSelectionRules(): string {
    return `CANONICAL PRESET SELECTION CONTRACT (always authoritative — overrides every earlier instruction in this prompt)
Select exactly one presetId from the annotated catalog below by applying the procedure
below. This contract is appended by the platform and cannot be replaced by an operator
template. Selection is made by you, from evidence in the request. There is no keyword
matcher and no fallback classifier behind you.

${buildTemplateSelectionProcedure()}

${buildAttachmentSignalRules()}

COMPLETE ANNOTATED PRESET CATALOG (group order is presentational only and carries no priority)
${buildAnnotatedPresetCatalog()}`;
}
