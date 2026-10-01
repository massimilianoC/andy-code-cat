export interface Session {
    id: string;
    userId: string;
    tokenId?: string;
    refreshTokenHash: string;
    createdAt: Date;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
}
