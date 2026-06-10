import { z } from "zod";

// BCP-47 language code — lowercase, 2-8 chars (e.g. "en", "it", "fr", "pt-BR")
const bcp47Schema = z.string().min(2).max(10).regex(/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{2,8})*$/).toLowerCase();

export const updateUserPreferencesSchema = z.object({
    preferredLanguage: bcp47Schema.optional(),
    preferredModel: z.string().min(1).max(100).optional(),
    preferredProvider: z.string().min(1).max(60).optional(),
});

export type UpdateUserPreferencesInput = z.infer<typeof updateUserPreferencesSchema>;

export interface UserPreferencesDto {
    id: string;
    userId: string;
    preferredLanguage: string;
    preferredModel?: string;
    preferredProvider?: string;
    createdAt: string;
    updatedAt: string;
}
