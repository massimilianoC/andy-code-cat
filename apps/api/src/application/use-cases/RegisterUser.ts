import { registerSchema, type RegisterInput } from "@andy-code-cat/contracts";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import { hashPassword } from "../../infra/security/password";
import { env } from "../../config";

export class RegisterUser {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly projectRepository: ProjectRepository
    ) { }

    async execute(rawInput: RegisterInput) {
        const input = registerSchema.parse(rawInput);
        const normalizedEmail = input.email.toLowerCase();

        const existing = await this.userRepository.findByEmail(normalizedEmail);
        if (existing) {
            throw new Error("Email already in use");
        }

        const user = await this.userRepository.create({
            email: normalizedEmail,
            passwordHash: await hashPassword(input.password),
            firstName: input.firstName,
            lastName: input.lastName,
            emailVerified: env.authBypassEmailVerification,
            llmPreferences: {
                defaultProvider: env.LLM_DEFAULT_PROVIDER
            }
        });

        const defaultProject = await this.projectRepository.create(user.id, "Default Project");

        return {
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                emailVerified: user.emailVerified
            },
            defaultProject
        };
    }
}
