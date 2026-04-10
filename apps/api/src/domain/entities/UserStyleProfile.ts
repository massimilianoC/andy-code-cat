/**
 * UserStyleProfile — style preferences collected during onboarding.
 * Stored in a separate collection (1:1 with User, created on demand).
 * Does NOT modify the User entity to preserve backward compatibility.
 */

export interface UserStyleProfile {
    id: string;
    userId: string;

    // --- Onboarding tracking -------------------------------------------
    onboardingCompleted: boolean;
    /** Which step the user was on when they last saved/skipped (0 = not started). */
    onboardingStep: number;

    // --- Tag selections (0–5 tags per category) -------------------------
    identityTags: string[];    // TC-IDENTITY
    sectorTags: string[];      // TC-SECTOR
    audienceTags: string[];    // TC-AUDIENCE
    visualTags: string[];      // TC-VISUAL
    paletteTags: string[];     // TC-PALETTE
    typographyTags: string[];  // TC-TYPOGRAPHY
    layoutTags: string[];      // TC-LAYOUT
    toneTags: string[];        // TC-TONE
    referenceTags: string[];   // TC-REFERENCE
    featureTags: string[];     // TC-FEATURE

    // --- Free-text enrichment (optional) --------------------------------
    /** Short bio / who is the user in their own words. */
    brandBio?: string;
    /** Free-text color preference (e.g. "mi piacciono i blu navy"). */
    preferredColorText?: string;

    createdAt: Date;
    updatedAt: Date;
}

export type CreateUserStyleProfileInput = Omit<UserStyleProfile, "id" | "createdAt" | "updatedAt">;

export type UpdateUserStyleProfileInput = Partial<
    Omit<UserStyleProfile, "id" | "userId" | "createdAt" | "updatedAt">
>;
