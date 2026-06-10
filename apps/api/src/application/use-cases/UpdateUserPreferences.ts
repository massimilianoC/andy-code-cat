import { updateUserPreferencesSchema } from "@andy-code-cat/contracts";
import type { UserPreferences } from "../../domain/entities/UserPreferences";
import type { UserPreferencesRepository } from "../../domain/repositories/UserPreferencesRepository";

export class UpdateUserPreferences {
    constructor(private readonly repo: UserPreferencesRepository) { }

    async execute(userId: string, rawInput: unknown): Promise<UserPreferences> {
        const input = updateUserPreferencesSchema.parse(rawInput);
        return this.repo.upsert(userId, input);
    }
}
