import { CURRENT_PASSWORD_POLICY_VERSION } from "@andy-code-cat/contracts";
import { randomUUID } from "crypto";
import { env } from "../../config";
import type { SessionRepository } from "../../domain/repositories/SessionRepository";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import { verifyRefreshToken, signAccessToken, signRefreshToken } from "../../infra/security/jwt";
import { hashPassword, verifyPassword } from "../../infra/security/password";

export class RefreshSession {
    constructor(
        private readonly sessionRepository: SessionRepository,
        private readonly userRepository: UserRepository
    ) { }

    async execute(rawRefreshToken: string, metadata?: { ip?: string; userAgent?: string }) {
        if (!rawRefreshToken || typeof rawRefreshToken !== "string") {
            throw Object.assign(new Error("Invalid refresh token format"), { statusCode: 400 });
        }

        const payload = verifyRefreshToken(rawRefreshToken);
        const userId = payload.sub;

        if (!userId) {
            throw Object.assign(new Error("Invalid refresh token payload"), { statusCode: 401 });
        }

        const session = payload.sid
            ? await this.sessionRepository.findActiveByTokenId(payload.sid)
            : await this.sessionRepository.findActiveByUserId(userId);

        if (!session) {
            throw Object.assign(new Error("No active session found"), { statusCode: 401 });
        }

        if (session.userId !== userId) {
            throw Object.assign(new Error("Refresh token does not match the active session"), { statusCode: 401 });
        }

        const isValidToken = await verifyPassword(rawRefreshToken, session.refreshTokenHash);
        if (!isValidToken) {
            throw Object.assign(new Error("Refresh token does not match stored token"), { statusCode: 401 });
        }

        if (new Date() > session.expiresAt) {
            throw Object.assign(new Error("Session has expired"), { statusCode: 401 });
        }

        const user = await this.userRepository.findById(userId);
        if (!user || user.isBlocked) {
            throw Object.assign(new Error("Account suspended"), { statusCode: 403 });
        }
        if (!user.emailVerified && !env.authBypassEmailVerification) {
            throw Object.assign(new Error("Email not verified"), { statusCode: 403 });
        }

        const nextTokenId = randomUUID();
        const newAccessToken = signAccessToken({ sub: userId, roles: user.roles, sid: nextTokenId });
        const newRefreshToken = signRefreshToken({ sub: userId, sid: nextTokenId });
        const refreshPayload = verifyRefreshToken(newRefreshToken);

        const updatedSession = await this.sessionRepository.updateRefreshToken(session.id, {
            tokenId: nextTokenId,
            refreshTokenHash: await hashPassword(newRefreshToken),
            expiresAt: new Date((refreshPayload.exp ?? 0) * 1000),
            ip: metadata?.ip,
            userAgent: metadata?.userAgent,
        });

        if (!updatedSession) {
            throw Object.assign(new Error("Failed to rotate the session"), { statusCode: 500 });
        }

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            activeProjectId: updatedSession.projectId,
            emailVerificationRequired: !user.emailVerified,
            requiresPasswordChange: (user.passwordPolicyVersion ?? 1) < CURRENT_PASSWORD_POLICY_VERSION
        };
    }
}
