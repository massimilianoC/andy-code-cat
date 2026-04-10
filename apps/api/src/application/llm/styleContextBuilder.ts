import type { UserStyleProfile } from "../../domain/entities/UserStyleProfile";
import type { ProjectMoodboard } from "../../domain/entities/ProjectMoodboard";
import { STYLE_TAG_CATALOG } from "../../domain/entities/StyleTag";

/** Index for O(1) label lookups by tag id. */
const TAG_LABEL_INDEX = new Map(STYLE_TAG_CATALOG.map((t) => [t.id, t.label]));

function tagLabels(ids: string[] | undefined): string {
    if (!ids || ids.length === 0) return "";
    return ids.map((id) => TAG_LABEL_INDEX.get(id) ?? id).join(", ");
}

/**
 * Merges user profile + project moodboard into a resolved style context.
 * When moodboard.inheritFromUser is true (or an override array is absent),
 * falls back to the corresponding user profile field.
 */
function resolveField(
    moodboardField: string[] | undefined,
    profileField: string[],
    inheritFromUser: boolean
): string[] {
    if (!inheritFromUser && moodboardField !== undefined) return moodboardField;
    if (!inheritFromUser && moodboardField === undefined) return [];
    // inheritFromUser = true: prefer moodboard override if non-empty, else user profile
    if (moodboardField && moodboardField.length > 0) return moodboardField;
    return profileField;
}

/**
 * Builds a human-readable STYLE CONTEXT block to inject into the LLM system prompt.
 * Returns an empty string when no meaningful style data is available.
 *
 * @param profile  – user style profile (may be null if not yet created)
 * @param moodboard – project moodboard (may be null if not yet created)
 */
export function buildStyleContextBlock(
    profile: UserStyleProfile | null,
    moodboard: ProjectMoodboard | null
): string {
    if (!profile && !moodboard) return "";

    const inherit = moodboard?.inheritFromUser ?? true;

    const visual = resolveField(moodboard?.visualTags, profile?.visualTags ?? [], inherit);
    const palette = resolveField(moodboard?.paletteTags, profile?.paletteTags ?? [], inherit);
    const typography = resolveField(moodboard?.typographyTags, profile?.typographyTags ?? [], inherit);
    const layout = resolveField(moodboard?.layoutTags, profile?.layoutTags ?? [], inherit);
    const tone = resolveField(moodboard?.toneTags, profile?.toneTags ?? [], inherit);
    const audience = resolveField(moodboard?.audienceTags, profile?.audienceTags ?? [], inherit);
    const features = resolveField(moodboard?.featureTags, profile?.featureTags ?? [], inherit);
    const references = resolveField(moodboard?.referenceTags, profile?.referenceTags ?? [], inherit);
    // eraTags are project-only (no user-profile equivalent)
    const era = moodboard?.eraTags ?? [];

    const lines: string[] = ["## STYLE CONTEXT"];

    // Moodboard / project-specific context fields
    if (moodboard?.projectBrief) lines.push(`Project brief: ${moodboard.projectBrief}`);
    if (moodboard?.targetBusiness) lines.push(`Target audience: ${moodboard.targetBusiness}`);
    if (moodboard?.styleNotes) lines.push(`Style notes: ${moodboard.styleNotes}`);

    // User-level enrichment
    if (profile?.brandBio) lines.push(`Creator identity: ${profile.brandBio}`);
    if (profile?.preferredColorText) lines.push(`Color preference: ${profile.preferredColorText}`);

    // Tag blocks — only emit non-empty
    const tagBlocks: [string, string[]][] = [
        ["Visual style", visual],
        ["Palette", palette],
        ["Typography", typography],
        ["Layout", layout],
        ["Tone", tone],
        ["Audience", audience],
        ["Features", features],
        ["References", references],
        ["Era / Movement", era],
    ];

    for (const [label, tags] of tagBlocks) {
        const rendered = tagLabels(tags);
        if (rendered) lines.push(`${label}: ${rendered}`);
    }

    // If all we'd produce is the header line, suppress entirely
    if (lines.length === 1) return "";

    lines.push(
        "",
        "Use the style context above as a mandatory design constraint when generating or modifying the site.",
        "Do not ignore these preferences even if the user message doesn't explicitly reference them."
    );

    return lines.join("\n");
}
