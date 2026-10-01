import {
    CURRENT_PASSWORD_POLICY_VERSION,
    registerSchema,
    type RegisterInput
} from "@andy-code-cat/contracts";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import { hashPassword } from "../../infra/security/password";
import { env } from "../../config";

export class RegisterUser {
    constructor(private readonly userRepository: UserRepository) { }

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
            passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
            firstName: input.firstName,
            lastName: input.lastName,
            emailVerified: env.authBypassEmailVerification,
            llmPreferences: {
                defaultProvider: env.LLM_DEFAULT_PROVIDER
            }
        });

        // No project is created here. A new account starts from the dashboard, where the first
        // project comes from Vibe or from a template. The placeholder "Default Project" this used
        // to create was the project nobody ever completed, and it carried no preset, so a user
        // who opened it got none of the template guidance either entry point provides.
        return {
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                emailVerified: user.emailVerified
            }
        };
    }
}
