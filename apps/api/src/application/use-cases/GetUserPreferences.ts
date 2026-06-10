import type { UserPreferences } from "../../domain/entities/UserPreferences";
import type { UserPreferencesRepository } from "../../domain/repositories/UserPreferencesRepository";

export class GetUserPreferences {
    constructor(private readonly repo: UserPreferencesRepository) { }

    async execute(userId: string): Promise<UserPreferences> {
        const existing = await this.repo.findByUserId(userId);
        if (existing) return existing;
        // Auto-create with defaults on first access
        return this.repo.initForUser({ userId });
    }
}
