import {
    CURRENT_PASSWORD_POLICY_VERSION,
    loginSchema,
    type LoginInput
} from "@andy-code-cat/contracts";
import { randomUUID } from "crypto";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { SessionRepository } from "../../domain/repositories/SessionRepository";
import { verifyPassword, hashPassword } from "../../infra/security/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../infra/security/jwt";
import { env } from "../../config";

export class LoginUser {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly projectRepository: ProjectRepository,
        private readonly sessionRepository: SessionRepository
    ) { }

    async execute(rawInput: LoginInput, metadata?: { ip?: string; userAgent?: string }) {
        const input = loginSchema.parse(rawInput);
        const normalizedEmail = input.email.toLowerCase();

        const user = await this.userRepository.findByEmail(normalizedEmail);
        if (!user) {
            throw Object.assign(new Error("Invalid credentials"), { statusCode: 401 });
        }

        const isValidPassword = await verifyPassword(input.password, user.passwordHash);
        if (!isValidPassword) {
            throw Object.assign(new Error("Invalid credentials"), { statusCode: 401 });
        }

        if (!user.emailVerified && !env.authBypassEmailVerification) {
            throw Object.assign(new Error("Email not verified"), { statusCode: 403 });
        }

        const projects = await this.projectRepository.listForUser(user.id);
        let selectedProject = projects[0];

        // Auto-recover: if the user has no projects (e.g. all were deleted) recreate the default
        // so that login always succeeds and the session can bind to a project.
        if (!selectedProject) {
            selectedProject = await this.projectRepository.create(user.id, "Default Project");
        }

        const tokenId = randomUUID();
        const accessToken = signAccessToken({ sub: user.id, roles: user.roles, sid: tokenId });
        const refreshToken = signRefreshToken({ sub: user.id, sid: tokenId });
        const refreshPayload = verifyRefreshToken(refreshToken);

        const refreshTokenHash = await hashPassword(refreshToken);
        await this.sessionRepository.create({
            userId: user.id,
            projectId: selectedProject.id,
            tokenId,
            refreshTokenHash,
            expiresAt: new Date((refreshPayload.exp ?? 0) * 1000),
            ip: metadata?.ip,
            userAgent: metadata?.userAgent
        });

        const requiresPasswordChange = (user.passwordPolicyVersion ?? 1) < CURRENT_PASSWORD_POLICY_VERSION;

        return {
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                roles: user.roles,
                llmPreferences: user.llmPreferences
            },
            projects,
            activeProjectId: selectedProject.id,
            emailVerificationRequired: !user.emailVerified,
            requiresPasswordChange,
            accessToken,
            refreshToken
        };
    }
}
