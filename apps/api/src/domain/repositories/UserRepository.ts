import type { User } from "../entities/User";

import type { UserLlmPreferences } from "../entities/User";

export interface CreateUserInput {
    email: string;
    passwordHash: string;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    llmPreferences?: UserLlmPreferences;
}

export interface UserRepository {
    create(input: CreateUserInput): Promise<User>;
    findByEmail(email: string): Promise<User | null>;
    findById(userId: string): Promise<User | null>;
    setBlocked(userId: string, isBlocked: boolean): Promise<void>;
}
