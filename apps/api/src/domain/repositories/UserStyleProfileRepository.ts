import type { UserStyleProfile, CreateUserStyleProfileInput, UpdateUserStyleProfileInput } from "../entities/UserStyleProfile";

export interface UserStyleProfileRepository {
    /** Returns the profile if it exists, or null if the user has never saved one. */
    findByUserId(userId: string): Promise<UserStyleProfile | null>;

    /** Upsert — creates if missing, updates if present. Idempotent. */
    upsert(userId: string, input: UpdateUserStyleProfileInput): Promise<UserStyleProfile>;

    /** Initialise an empty profile for a newly registered user. Only inserts — does NOT overwrite. */
    initForUser(input: CreateUserStyleProfileInput): Promise<UserStyleProfile>;
}
