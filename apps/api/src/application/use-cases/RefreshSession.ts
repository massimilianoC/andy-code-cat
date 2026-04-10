import type { SessionRepository } from "../../domain/repositories/SessionRepository";
import { verifyRefreshToken, signAccessToken } from "../../infra/security/jwt";
import { verifyPassword } from "../../infra/security/password";

export class RefreshSession {
    constructor(
        private readonly sessionRepository: SessionRepository
    ) { }

    async execute(rawRefreshToken: string) {
        if (!rawRefreshToken || typeof rawRefreshToken !== "string") {
            throw new Error("Invalid refresh token format");
        }

        // Verify JWT signature and extract userId
        const payload = verifyRefreshToken(rawRefreshToken);
        const userId = payload.sub;

        if (!userId) {
            throw new Error("Invalid refresh token payload");
        }

        // Fetch the active session for this user
        const session = await this.sessionRepository.findActiveByUserId(userId);
        if (!session) {
            throw new Error("No active session found");
        }

        // Verify the refresh token hash matches
        const isValidToken = await verifyPassword(rawRefreshToken, session.refreshTokenHash);
        if (!isValidToken) {
            throw new Error("Refresh token does not match stored token");
        }

        // Check if session has expired
        if (new Date() > session.expiresAt) {
            throw new Error("Session has expired");
        }

        // Generate new access token (keep same refresh token for now)
        const newAccessToken = signAccessToken({ sub: userId, roles: [] });

        return {
            accessToken: newAccessToken,
            refreshToken: rawRefreshToken
        };
    }
}
