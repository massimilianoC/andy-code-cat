import { loginSchema, type LoginInput } from "@andy-code-cat/contracts";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { SessionRepository } from "../../domain/repositories/SessionRepository";
import { verifyPassword, hashPassword } from "../../infra/security/password";
import { signAccessToken, signRefreshToken } from "../../infra/security/jwt";
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
            throw new Error("Invalid credentials");
        }

        const isValidPassword = await verifyPassword(input.password, user.passwordHash);
        if (!isValidPassword) {
            throw new Error("Invalid credentials");
        }

        if (!user.emailVerified && !env.authBypassEmailVerification) {
            throw new Error("Email not verified");
        }

        const projects = await this.projectRepository.listForUser(user.id);
        let selectedProject = projects[0];

        // Auto-recover: if the user has no projects (e.g. all were deleted) recreate the default
        // so that login always succeeds and the session can bind to a project.
        if (!selectedProject) {
            selectedProject = await this.projectRepository.create(user.id, "Default Project");
        }

        const accessToken = signAccessToken({ sub: user.id, roles: user.roles });
        const refreshToken = signRefreshToken({ sub: user.id });

        const refreshTokenHash = await hashPassword(refreshToken);
        await this.sessionRepository.create({
            userId: user.id,
            projectId: selectedProject.id,
            refreshTokenHash,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            ip: metadata?.ip,
            userAgent: metadata?.userAgent
        });

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
            accessToken,
            refreshToken
        };
    }
}
