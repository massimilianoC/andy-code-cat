import type { Session } from "../entities/Session";

export interface CreateSessionInput {
    userId: string;
    projectId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
}

export interface SessionRepository {
    create(input: CreateSessionInput): Promise<Session>;
    findActiveByUserId(userId: string): Promise<Session | null>;
    deleteAllByUserId(userId: string): Promise<number>;
}
