import { adminCreateUserSchema } from "@andy-code-cat/contracts";
import type { UserRepository } from "../../../domain/repositories/UserRepository";
import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";
import { hashPassword } from "../../../infra/security/password";
import { CURRENT_PASSWORD_POLICY_VERSION } from "@andy-code-cat/contracts";
import { env } from "../../../config";

export class AdminCreateUser {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly projectRepository: ProjectRepository,
    ) {}

    async execute(rawInput: unknown) {
        const input = adminCreateUserSchema.parse(rawInput);
        const normalizedEmail = input.email.toLowerCase();

        const existing = await this.userRepository.findByEmail(normalizedEmail);
        if (existing) {
            throw Object.assign(new Error("Email already in use"), { statusCode: 409 });
        }

        const user = await this.userRepository.create({
            email: normalizedEmail,
            passwordHash: await hashPassword(input.password),
            passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
            firstName: input.firstName,
            lastName: input.lastName,
            emailVerified: input.emailVerified,
            llmPreferences: { defaultProvider: env.LLM_DEFAULT_PROVIDER },
        });

        // Apply roles if not the default ["user"]
        if (input.roles.join(",") !== "user") {
            await this.userRepository.setRoles(user.id, input.roles as ("user" | "admin" | "superadmin")[]);
        }

        // Apply limits if provided
        if (input.limits) {
            await this.userRepository.setLimits(user.id, input.limits);
        }

        const defaultProject = await this.projectRepository.create(user.id, "Default Project");

        return {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            emailVerified: user.emailVerified,
            roles: input.roles,
            defaultProjectId: defaultProject.id,
        };
    }
}
