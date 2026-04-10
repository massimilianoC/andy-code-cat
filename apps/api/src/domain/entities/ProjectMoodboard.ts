/**
 * ProjectMoodboard — per-project style override.
 * Inherits from UserStyleProfile when `inheritFromUser = true`.
 * Stored in a separate collection (1:1 with Project, created on demand).
 * Does NOT modify the Project entity to preserve backward compatibility.
 */

export interface ProjectMoodboard {
    id: string;
    projectId: string;
    userId: string;

    /** When true, style is fully inherited from the user's UserStyleProfile. */
    inheritFromUser: boolean;

    // --- Tag overrides (only defined fields override user profile) ------
    visualTags?: string[];
    paletteTags?: string[];
    typographyTags?: string[];
    layoutTags?: string[];
    toneTags?: string[];
    audienceTags?: string[];
    featureTags?: string[];
    sectorTags?: string[];
    referenceTags?: string[];
    /** Era/movement inspiration tags (e.g. bauhaus, steampunk). */
    eraTags?: string[];

    // --- Project-specific context ---------------------------------------
    /** Short plain-text description of the project (what is the site for). */
    projectBrief?: string;
    /** Target business / who is the website's audience. */
    targetBusiness?: string;
    /** Free-text color/style notes for this project specifically. */
    styleNotes?: string;

    createdAt: Date;
    updatedAt: Date;
}

export type CreateProjectMoodboardInput = Omit<ProjectMoodboard, "id" | "createdAt" | "updatedAt">;

export type UpdateProjectMoodboardInput = Partial<
    Omit<ProjectMoodboard, "id" | "projectId" | "userId" | "createdAt" | "updatedAt">
>;
