import type { User, UserLimits, UserRole } from "../entities/User";
import type { UserLlmPreferences } from "../entities/User";

export interface ListUsersFilter {
    search?: string;
    role?: UserRole;
    isBlocked?: boolean;
}

export interface ListUsersResult {
    users: User[];
    total: number;
}

export interface CreateUserInput {
    email: string;
    passwordHash: string;
    passwordPolicyVersion?: number;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    llmPreferences?: UserLlmPreferences;
}

export interface UpdateUserProfileInput {
    email?: string;
    firstName?: string;
    lastName?: string;
    emailVerified?: boolean;
}

export interface UserRepository {
    create(input: CreateUserInput): Promise<User>;
    findByEmail(email: string): Promise<User | null>;
    findById(userId: string): Promise<User | null>;
    updatePassword(userId: string, passwordHash: string, passwordPolicyVersion: number): Promise<User | null>;
    updateProfile(userId: string, input: UpdateUserProfileInput): Promise<User | null>;
    setPasswordPolicyVersion(userId: string, passwordPolicyVersion: number): Promise<User | null>;
    setBlocked(userId: string, isBlocked: boolean): Promise<void>;
    // ── Admin ops ─────────────────────────────────────────────────────────────
    listPaginated(page: number, limit: number, filter?: ListUsersFilter): Promise<ListUsersResult>;
    setRoles(userId: string, roles: UserRole[]): Promise<void>;
    setLimits(userId: string, limits: UserLimits): Promise<void>;
    countAll(): Promise<number>;
    countBlocked(): Promise<number>;
    sumTokensConsumedLifetime(): Promise<number>;
    deleteById(userId: string): Promise<void>;
    incrementTokensConsumed(userId: string, tokens: number): Promise<void>;
}
