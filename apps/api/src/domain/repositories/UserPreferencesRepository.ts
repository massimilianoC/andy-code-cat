import type { UserPreferences, CreateUserPreferencesInput, UpdateUserPreferencesInput } from "../entities/UserPreferences";

export interface UserPreferencesRepository {
    /** Returns the preferences if they exist, or null if never saved. */
    findByUserId(userId: string): Promise<UserPreferences | null>;

    /** Upsert — creates if missing, updates if present. Idempotent. */
    upsert(userId: string, input: UpdateUserPreferencesInput): Promise<UserPreferences>;

    /** Initialise default preferences for a newly registered user. Only inserts — does NOT overwrite. */
    initForUser(input: CreateUserPreferencesInput): Promise<UserPreferences>;
}
