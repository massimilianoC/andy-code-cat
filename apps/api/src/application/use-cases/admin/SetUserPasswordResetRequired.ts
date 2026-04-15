import {
    adminSetPasswordResetRequiredSchema,
    CURRENT_PASSWORD_POLICY_VERSION,
} from "@andy-code-cat/contracts";
import type { UserRepository } from "../../../domain/repositories/UserRepository";

export class SetUserPasswordResetRequired {
    constructor(private readonly userRepository: UserRepository) { }

    async execute(targetUserId: string, rawInput: unknown) {
        const { required } = adminSetPasswordResetRequiredSchema.parse(rawInput);
        const user = await this.userRepository.findById(targetUserId);

        if (!user) {
            throw Object.assign(new Error("User not found"), { statusCode: 404 });
        }

        const passwordPolicyVersion = required
            ? CURRENT_PASSWORD_POLICY_VERSION - 1
            : CURRENT_PASSWORD_POLICY_VERSION;

        const updated = await this.userRepository.setPasswordPolicyVersion(targetUserId, passwordPolicyVersion);

        if (!updated) {
            throw Object.assign(new Error("Failed to update password reset requirement"), { statusCode: 500 });
        }

        return {
            userId: updated.id,
            requiresPasswordChange: (updated.passwordPolicyVersion ?? 1) < CURRENT_PASSWORD_POLICY_VERSION,
        };
    }
}