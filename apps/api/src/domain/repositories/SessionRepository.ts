import type { Session } from "../entities/Session";

export interface CreateSessionInput {
    userId: string;
    projectId: string;
    tokenId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
}

export interface UpdateSessionRefreshInput {
    tokenId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
}

export interface SessionRepository {
    create(input: CreateSessionInput): Promise<Session>;
    findActiveByTokenId(tokenId: string): Promise<Session | null>;
    findActiveByUserId(userId: string): Promise<Session | null>;
    updateRefreshToken(sessionId: string, input: UpdateSessionRefreshInput): Promise<Session | null>;
    deleteAllByUserId(userId: string): Promise<number>;
}
