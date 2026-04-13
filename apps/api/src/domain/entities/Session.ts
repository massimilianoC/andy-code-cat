export interface Session {
    id: string;
    userId: string;
    projectId: string;
    tokenId?: string;
    refreshTokenHash: string;
    createdAt: Date;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
}
