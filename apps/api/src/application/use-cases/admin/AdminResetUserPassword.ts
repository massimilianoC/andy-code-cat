import {
    adminResetUserPasswordSchema,
    CURRENT_PASSWORD_POLICY_VERSION,
} from "@andy-code-cat/contracts";
import type { SessionRepository } from "../../../domain/repositories/SessionRepository";
import type { UserRepository } from "../../../domain/repositories/UserRepository";
import { hashPassword } from "../../../infra/security/password";

export class AdminResetUserPassword {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly sessionRepository: SessionRepository,
    ) { }

    async execute(targetUserId: string, rawInput: unknown) {
        const input = adminResetUserPasswordSchema.parse(rawInput);
        const user = await this.userRepository.findById(targetUserId);

        if (!user) {
            throw Object.assign(new Error("User not found"), { statusCode: 404 });
        }

        const passwordPolicyVersion = input.requireChangeOnNextLogin
            ? CURRENT_PASSWORD_POLICY_VERSION - 1
            : CURRENT_PASSWORD_POLICY_VERSION;

        const updated = await this.userRepository.updatePassword(
            targetUserId,
            await hashPassword(input.newPassword),
            passwordPolicyVersion,
        );

        if (!updated) {
            throw Object.assign(new Error("Failed to reset password"), { statusCode: 500 });
        }

        await this.sessionRepository.deleteAllByUserId(targetUserId);

        return {
            userId: updated.id,
            reauthRequired: true,
            requiresPasswordChange: (updated.passwordPolicyVersion ?? 1) < CURRENT_PASSWORD_POLICY_VERSION,
        };
    }
}