import { z } from "zod";

const tagArraySchema = z.array(z.string().min(1).max(80)).max(5);

export const updateProjectMoodboardSchema = z.object({
    inheritFromUser: z.boolean().optional(),

    visualTags: tagArraySchema.optional(),
    paletteTags: tagArraySchema.optional(),
    typographyTags: tagArraySchema.optional(),
    layoutTags: tagArraySchema.optional(),
    toneTags: tagArraySchema.optional(),
    audienceTags: tagArraySchema.optional(),
    featureTags: tagArraySchema.optional(),
    sectorTags: tagArraySchema.optional(),
    referenceTags: tagArraySchema.optional(),
    eraTags: tagArraySchema.optional(),

    projectBrief: z.string().max(500).optional(),
    targetBusiness: z.string().max(300).optional(),
    styleNotes: z.string().max(500).optional(),
});

export type UpdateProjectMoodboardInput = z.infer<typeof updateProjectMoodboardSchema>;

export interface ProjectMoodboardDto {
    id: string;
    projectId: string;
    userId: string;
    inheritFromUser: boolean;

    visualTags: string[];
    paletteTags: string[];
    typographyTags: string[];
    layoutTags: string[];
    toneTags: string[];
    audienceTags: string[];
    featureTags: string[];
    sectorTags: string[];
    referenceTags: string[];
    eraTags: string[];

    projectBrief?: string;
    targetBusiness?: string;
    styleNotes?: string;

    updatedAt: string;
    createdAt: string;
}
