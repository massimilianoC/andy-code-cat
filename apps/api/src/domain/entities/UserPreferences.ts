/**
 * UserPreferences — persistent account-level user settings.
 * Stored in a separate collection (1:1 with User, created on demand).
 * Separated from UserStyleProfile (style/aesthetic) and BrandAsset (brand assets).
 * Does NOT modify the User entity to preserve backward compatibility.
 */

export interface UserPreferences {
    id: string;
    userId: string;

    /** BCP-47 language code for output language preference. Default: "en". */
    preferredLanguage: string;

    /** Default LLM model identifier (e.g. "deepseek-v3"). Optional. */
    preferredModel?: string;

    /** Default LLM provider key (e.g. "siliconflow"). Optional. */
    preferredProvider?: string;

    createdAt: Date;
    updatedAt: Date;
}

export type CreateUserPreferencesInput = Pick<UserPreferences, "userId"> &
    Partial<Pick<UserPreferences, "preferredLanguage" | "preferredModel" | "preferredProvider">>;

export type UpdateUserPreferencesInput = Partial<
    Omit<UserPreferences, "id" | "userId" | "createdAt" | "updatedAt">
>;
